// `bun run cli dictate …` (T1740): o ditado inteiro pelo modo headless (T1739), sem microfone nem colagem.
//
//   dictate <arquivo.wav> | --wav <arquivo.wav> | --text "<transcript>"
//           [--app slack|teams|ghostty|mail|…|<bundleId>] [--note] [--field-before "<texto>"]
//           [--field-role AXTextArea|none] [--secure-input] [--no-accessibility] [--no-caret]
//   dictate --batch <pasta|arquivo.jsonl>
//
// Sai um JSON no stdout: o relatório do ditado, ou o da bateria (`--batch`). Exit 0 é ok; 1, o app recusou ou um caso
// da bateria não bateu com o `expect`; 2, uso errado. O "não está rodando" (3) é do `send` da CLI.
//
// A bateria: um .jsonl, um caso por linha, ou uma pasta de .wav (cada um com um .json do lado, opcional, com os mesmos
// campos). Um caso é o pedido do `dictate` (`wav` ou `text`, `app`, `note`, `fieldBefore`, `field`) mais `name` e
// `expect`: `text`, `typed`, `tone`, `plan`, `spaced`, `contains` (um texto ou uma lista). Áudio só sintético (`say`).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type Send = (msg: Record<string, unknown>) => Promise<{ ok: boolean; value?: unknown; code?: string; message?: string }>;

type Report = {
  text: string;
  tone: string | null;
  insert: { plan: string | null; spaced: boolean; typed: string } | null;
  [key: string]: unknown;
};

export interface Expect {
  text?: string;
  typed?: string;
  tone?: string;
  plan?: string;
  spaced?: boolean;
  contains?: string | string[];
}

export interface BatchCase {
  name: string;
  request: Record<string, unknown>;
  expect?: Expect;
}

export class UsageError extends Error {}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Os argumentos de um ditado só, já no formato do `cmd: "dictate"`. */
export function parseArgs(argv: string[]): { batch: string } | { request: Record<string, unknown> } {
  const request: Record<string, unknown> = {};
  const field: Record<string, unknown> = {};
  let batch: string | undefined;
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--wav":
        request.wav = value(i++, a);
        break;
      case "--text":
        request.text = argv[++i] ?? (() => { throw new UsageError("--text needs a value"); })();
        break;
      case "--app":
        request.app = value(i++, a);
        break;
      case "--note":
        request.note = true;
        break;
      case "--field-before":
        // Pode ser vazio (o começo do campo) ou começar com "-": vale o que vier.
        if (argv[i + 1] === undefined) throw new UsageError("--field-before needs a value");
        request.fieldBefore = argv[++i];
        break;
      case "--field-role": {
        const role = value(i++, a);
        field.role = role === "none" ? null : role;
        break;
      }
      case "--secure-input":
        field.secureInput = true;
        break;
      case "--no-accessibility":
        field.accessibility = false;
        break;
      case "--no-caret":
        field.hasCaret = false;
        break;
      case "--batch":
        batch = value(i++, a);
        break;
      default:
        if (a.startsWith("--")) throw new UsageError(`unknown flag ${a}`);
        if (request.wav !== undefined) throw new UsageError(`one wav only (got ${a} too)`);
        request.wav = a;
    }
  }
  if (batch !== undefined) {
    if (Object.keys(request).length || Object.keys(field).length) throw new UsageError("--batch takes no other flags");
    return { batch };
  }
  if ((request.wav === undefined) === (request.text === undefined)) throw new UsageError("give a wav or --text (one of them)");
  if (Object.keys(field).length) request.field = field;
  return { request };
}

/** Os casos de um .jsonl ou de uma pasta de .wav. Os caminhos dos wav são relativos ao arquivo do caso. */
export function loadBatch(source: string): BatchCase[] {
  const abs = path.resolve(source);
  if (!existsSync(abs)) throw new UsageError(`--batch: nothing at ${abs}`);
  const toCase = (raw: Record<string, unknown>, base: string, fallbackName: string): BatchCase => {
    const { name, expect, ...request } = raw;
    if (typeof request.wav === "string") request.wav = path.resolve(base, request.wav);
    return { name: typeof name === "string" ? name : fallbackName, request, expect: expect as Expect | undefined };
  };
  if (statSync(abs).isDirectory()) {
    const wavs = readdirSync(abs).filter((f) => /\.wav$/i.test(f)).sort();
    if (!wavs.length) throw new UsageError(`--batch: no .wav in ${abs}`);
    return wavs.map((wav) => {
      const side = path.join(abs, wav.replace(/\.wav$/i, ".json"));
      const extra = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as Record<string, unknown>) : {};
      return toCase({ ...extra, wav }, abs, wav);
    });
  }
  return readFileSync(abs, "utf8")
    .split("\n")
    .map((line, n) => [line.trim(), n + 1] as const)
    .filter(([line]) => line && !line.startsWith("//"))
    .map(([line, n]) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new UsageError(`--batch: line ${n} isn't JSON`);
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError(`--batch: line ${n} isn't an object`);
      return toCase(raw as Record<string, unknown>, path.dirname(abs), `line ${n}`);
    });
}

/** O que não bateu com o `expect`, um texto por diferença. */
export function check(report: Report, expect: Expect | undefined): string[] {
  if (!expect) return [];
  const out: string[] = [];
  const same = (what: string, got: unknown, want: unknown) => {
    if (want !== undefined && got !== want) out.push(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  same("text", report.text, expect.text);
  same("tone", report.tone, expect.tone);
  same("typed", report.insert?.typed, expect.typed);
  same("plan", report.insert?.plan, expect.plan);
  same("spaced", report.insert?.spaced, expect.spaced);
  for (const piece of expect.contains === undefined ? [] : [expect.contains].flat()) {
    if (!report.text.includes(piece)) out.push(`text: expected it to contain ${JSON.stringify(piece)}`);
  }
  return out;
}

/** Roda a bateria, um caso por vez (os ditados vão em fila no app de qualquer jeito). */
export async function runBatch(cases: BatchCase[], send: Send) {
  const started = performance.now();
  const results: { name: string; ok: boolean; failures: string[]; report?: unknown; error?: { code?: string; message?: string } }[] = [];
  for (const c of cases) {
    const r = await send({ cmd: "dictate", ...c.request });
    if (!r.ok) {
      results.push({ name: c.name, ok: false, failures: [`${r.code}: ${r.message}`], error: { code: r.code, message: r.message } });
      continue;
    }
    const failures = check(r.value as Report, c.expect);
    results.push({ name: c.name, ok: failures.length === 0, failures, report: r.value });
  }
  const failed = results.filter((r) => !r.ok).length;
  return { cases: results, passed: results.length - failed, failed, ms: Math.round(performance.now() - started) };
}

/** O subcomando `dictate` da CLI (T1739 chama isto). Devolve o exit code. */
export async function runDictate(argv: string[], send: Send): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  let cases: BatchCase[] | undefined;
  try {
    parsed = parseArgs(argv);
    if ("batch" in parsed) cases = loadBatch(parsed.batch);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    print({ ok: false, code: "E_USAGE", message: e.message });
    return 2;
  }
  if (cases) {
    const result = await runBatch(cases, send);
    print(result);
    return result.failed ? 1 : 0;
  }
  const r = await send({ cmd: "dictate", ...(parsed as { request: Record<string, unknown> }).request });
  print(r.ok ? r.value : { ok: false, code: r.code, message: r.message });
  return r.ok ? 0 : 1;
}
