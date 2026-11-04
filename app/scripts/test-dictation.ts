// A bateria de regressão do ditado (T1908, spec #15): o texto sai sem muletas, pontuado, com as autocorreções
// faladas e no tom do app. Um comando só, pela CLI headless (T1739), sem mic, sem colagem e sem nada na tela:
//
//   bun run test:dictation [--only text|wav] [--no-boosting] [--keep] [--json]
//
// 1. sobe o headless (com o helper em --headless) numa pasta de dados temporária;
// 2. põe o dicionário e os snippets de test/dictation/config.json pelo engine (`dictionary.set`, `snippets.set`);
// 3. modo `text`: test/dictation/casos.jsonl pelo `cli dictate --batch` (da limpeza para a frente, rápido);
// 4. modo `wav`: test/dictation/falados.jsonl vira WAV com o `say` (scripts/dictation-fixtures.ts) e vai de ponta a
//    ponta, do STT ao texto. O áudio fica na pasta temporária, nunca no repo;
// 5. para o headless e apaga a pasta (com `--keep`, deixa e diz onde).
//
// Exit 0 se todos os casos passam; 1 se algum falhou; 2 uso errado. O modo wav usa o STT de verdade: na máquina
// dividida, pegue `kiwi lock bench` antes (AGENTS.md).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSpoken, makeFixtures, missingVoices } from "./dictation-fixtures.ts";

const APP = path.resolve(import.meta.dir, "..");
const CASES = path.join(APP, "test/dictation/casos.jsonl");
const CONFIG = path.join(APP, "test/dictation/config.json");

type Json = Record<string, any>;
interface BatchResult {
  name: string;
  ok: boolean;
  failures: string[];
  report?: { text?: string };
}

function parseArgs(argv: string[]) {
  const a = { modes: ["text", "wav"] as ("text" | "wav")[], keep: false, json: false, boosting: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") a.keep = true;
    else if (arg === "--json") a.json = true;
    // Sem o boosting do vocabulário (T1973): para medir a diferença de latência.
    else if (arg === "--no-boosting") a.boosting = false;
    else if (arg === "--only") {
      const m = argv[++i];
      if (m !== "text" && m !== "wav") throw new Error("--only text|wav");
      a.modes = [m];
    } else throw new Error(`flag desconhecida: ${arg}`);
  }
  return a;
}

/** A CLI de teste como caixa-preta: o mesmo caminho de qualquer agente. */
function cli(data: string, ...args: string[]): { code: number; out: Json } {
  const r = spawnSync("bun", ["scripts/cli.ts", ...args, "--data", data], { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let out: Json = {};
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = { ok: false, message: (r.stderr || r.stdout || "").trim().slice(-2000) };
  }
  return { code: r.status ?? 1, out };
}

/**
 * O modelo CTC do boosting carrega em segundo plano depois do principal (T1973): os casos falados esperam por ele,
 * senão os primeiros saem sem boosting. A primeira vez baixa 99 MB. Devolve o estado em que parou.
 */
async function waitBoosting(data: string, timeoutMs = 300_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const b = cli(data, "status").out.value?.session?.boosting;
    if (b === "ready" || b === "unavailable") return b;
    await Bun.sleep(250);
  }
  return "timeout";
}

/** A latência do STT nos casos falados, do fim da gravação até o texto: a mediana e o pior. */
function sttLatency(r: ModeResult): string | null {
  const ms = r.cases
    .map((c) => (c.report as { latencyMs?: { stt?: number } } | undefined)?.latencyMs?.stt)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  if (!ms.length) return null;
  return `STT: mediana ${ms[Math.floor(ms.length / 2)]} ms, pior ${ms.at(-1)} ms (${ms.length} casos)`;
}

async function waitHelper(data: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = cli(data, "status");
    if (s.out.value?.helper === "ready") return;
    await Bun.sleep(250);
  }
  throw new Error(`o helper não ficou pronto em ${timeoutMs / 1000} s (veja \`bun run cli logs --data ${data}\`)`);
}

function invoke(data: string, cap: string, args: unknown) {
  const r = cli(data, "invoke", cap, JSON.stringify(args));
  if (r.code !== 0) throw new Error(`${cap}: ${r.out.code ?? ""} ${r.out.message ?? ""}`.trim());
}

interface ModeResult {
  passed: number;
  failed: number;
  /** Os casos com `known` que falharam como esperado: aparecem, mas não falham a bateria. */
  known: number;
  /** Casos com `known` que passaram: o problema sumiu, tire o `known`. Não falham, mas aparecem. */
  fixed: string[];
  cases: (BatchResult & { known?: string })[];
  error?: string;
  /** Uma linha a mais no relatório (falado: o estado do boosting e a latência do STT). */
  note?: string;
}

/** Os `known` de um .jsonl de casos (pelo nome), e o arquivo sem eles, que o `cli dictate --batch` aceita. */
function splitKnown(file: string, out: string): { batch: string; known: Map<string, string> } {
  const known = new Map<string, string>();
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("//"))
    .map((l) => {
      const { known: k, ...rest } = JSON.parse(l) as Json;
      if (typeof k === "string") known.set(rest.name, k);
      return JSON.stringify(rest);
    });
  writeFileSync(out, `${lines.join("\n")}\n`);
  return { batch: out, known };
}

function runBatch(data: string, file: string, known: Map<string, string>): ModeResult {
  const r = cli(data, "dictate", "--batch", file);
  if (!Array.isArray(r.out.cases)) return { passed: 0, failed: 1, known: 0, fixed: [], cases: [], error: `${r.out.code ?? "E_FAILED"}: ${r.out.message ?? "sem relatório"}` };
  const cases = (r.out.cases as BatchResult[]).map((c): BatchResult & { known?: string } => (known.has(c.name) ? { ...c, known: known.get(c.name) } : c));
  return {
    passed: cases.filter((c) => c.ok).length,
    failed: cases.filter((c) => !c.ok && !c.known).length,
    known: cases.filter((c) => !c.ok && c.known).length,
    fixed: cases.filter((c) => c.ok && c.known).map((c) => c.name),
    cases,
  };
}

function printMode(mode: string, r: ModeResult) {
  console.log(`\n${mode}: ${r.passed}/${r.cases.length} ok${r.known ? `, ${r.known} conhecido(s)` : ""}`);
  if (r.note) console.log(`  ${r.note}`);
  if (r.error) console.log(`  FALHOU  a bateria não rodou: ${r.error}`);
  for (const name of r.fixed) console.log(`  PASSOU  ${name}: era conhecido e agora passa, tire o \`known\``);
  for (const c of r.cases.filter((c) => !c.ok)) {
    console.log(`  ${c.known ? "CONHEC." : "FALHOU "} ${c.name}${c.known ? ` — ${c.known}` : ""}`);
    for (const f of c.failures) console.log(`          ${f}`);
    // O que saiu, quando a falha ainda não diz (`contains`, tom, espaço): para ver se é o STT ou a limpeza.
    const r = c.report as { raw?: string; text?: string } | undefined;
    if (r?.text !== undefined && !c.failures.some((f) => f.includes(", got "))) console.log(`          got: ${JSON.stringify(r.text)}${r.raw !== undefined ? ` (STT: ${JSON.stringify(r.raw)})` : ""}`);
  }
}

async function main(): Promise<number> {
  let a: ReturnType<typeof parseArgs>;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\nusage: bun run test:dictation [--only text|wav] [--no-boosting] [--keep] [--json]`);
    return 2;
  }
  const spoken = a.modes.includes("wav") ? loadSpoken() : [];
  const missing = missingVoices(spoken);
  if (missing.length) {
    console.error(`faltam as vozes do say: ${missing.join(", ")} (Ajustes › Acessibilidade › Conteúdo falado › Gerenciar vozes), ou rode com --only text`);
    return 1;
  }

  // Caminho curto: o socket unix tem limite de 104 caracteres.
  const data = mkdtempSync(path.join(tmpdir(), "kn-dict-"));
  const results: Record<string, ModeResult> = {};
  let started = false;
  const stop = () => {
    if (started) cli(data, "stop");
    started = false;
    if (!a.keep) rmSync(data, { recursive: true, force: true });
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  try {
    // O helper herda o ambiente da CLI, que herda o deste processo.
    if (!a.boosting) process.env.KIWI_STT_BOOSTING = "off";
    const s = cli(data, "start");
    if (s.code !== 0) throw new Error(`o headless não subiu: ${s.out.message ?? JSON.stringify(s.out)}`);
    started = true;
    await waitHelper(data);
    const config = JSON.parse(readFileSync(CONFIG, "utf8")) as { dictionary: unknown[]; snippets: unknown[] };
    invoke(data, "dictionary.set", { terms: config.dictionary });
    invoke(data, "snippets.set", { snippets: config.snippets });

    if (a.modes.includes("text")) {
      const { batch, known } = splitKnown(CASES, path.join(data, "casos.batch.jsonl"));
      results.text = runBatch(data, batch, known);
    }
    if (a.modes.includes("wav")) {
      const boosting = a.boosting ? await waitBoosting(data) : "off";
      const known = new Map(spoken.filter((c) => typeof c.known === "string").map((c) => [c.name, c.known as string]));
      results.wav = runBatch(data, makeFixtures(path.join(data, "wav"), spoken), known);
      results.wav.note = [`boosting do vocabulário: ${boosting}`, sttLatency(results.wav)].filter(Boolean).join(" · ");
    }
  } catch (e) {
    console.error(`a bateria não rodou: ${(e as Error).message}`);
    stop();
    return 1;
  } finally {
    if (started) stop();
  }

  if (a.json) console.log(JSON.stringify(results, null, 2));
  else for (const [mode, r] of Object.entries(results)) printMode(mode === "text" ? "texto (casos.jsonl)" : "falado (falados.jsonl, say → STT)", r);
  const failed = Object.values(results).reduce((n, r) => n + r.failed, 0);
  if (!a.json) console.log(failed ? `\n${failed} caso(s) falharam${a.keep ? ` (dados em ${data})` : ""}` : "\ntudo ok");
  return failed ? 1 : 0;
}

process.exit(await main());
