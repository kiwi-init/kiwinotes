// Compara backends do LLM da limpeza no mesmo conjunto (T270), com o prompt e a guarda de produção.
//
//   bun src/cleanup/eval.ts --fm ../native/.build/debug/kiwi-helper --out fm.jsonl
//   bun src/cleanup/eval.ts --mlx http://127.0.0.1:8090 --model mlx-community/Qwen3.5-2B-4bit --out qwen.jsonl
//   bun src/cleanup/eval.ts --golden [--fm …|--mlx …]   o golden com nota (T6592); sem backend, só as regras
//
// O MLX roda no `mlx_lm.server` do Python (só em 127.0.0.1): o mesmo MLX do mlx-swift-lm do VoiceInk. Nada sai
// do Mac. Pegue o `kiwi lock bench` antes. Uma linha JSON por caso, mais um resumo no stderr.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evalCases } from "./evalset.ts";
import { type GoldenScore, goldenCases, meanScore, scoreGolden } from "./golden.ts";
import { cleanup, cleanupWithRules, sidecarLlm } from "./index.ts";
import type { LlmBackend, LlmRequest } from "./types.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const value = process.argv[i + 1];
  const flagOnly = value === undefined || value.startsWith("--");
  args.set(process.argv[i]!.replace(/^--/, ""), flagOnly ? "" : value);
  if (!flagOnly) i++;
}

/** Quanto esperar por resposta: alto, para medir a latência inteira (a produção usa 1,5 s). */
const TIMEOUT_MS = Number(args.get("timeout") ?? 30_000);

// ------------------------------------------------------------------ backends

/** Apple Foundation Models pelo sidecar: o eval faz o papel do app e escuta o socket. */
async function foundationModels(helper: string): Promise<{ backend: LlmBackend; close(): void }> {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-eval-"));
  const socketPath = join(dir, "s.sock");
  const pending = new Map<string, (m: any) => void>();
  let ready: (m: any) => void;
  const readyMsg = new Promise<any>((r) => (ready = r));
  let buffer = "";
  let sock: any;
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(s) {
        sock = s;
      },
      data(_s, chunk) {
        buffer += Buffer.from(chunk).toString("utf8");
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.type === "ready") ready(m);
          else if (m.type === "result") pending.get(m.id)?.(m);
        }
      },
    },
  });
  const proc = Bun.spawn([helper, "--socket", socketPath], { stdout: "ignore", stderr: "ignore" });
  const hello = await readyMsg;
  let n = 0;
  const backend = sidecarLlm({
    status: () => hello.llm,
    request: (command) =>
      new Promise((resolve) => {
        const id = `e${n++}`;
        pending.set(id, resolve);
        sock.write(JSON.stringify({ v: 1, id, ...command }) + "\n");
      }),
  });
  return {
    backend,
    close() {
      proc.kill();
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Um modelo no `mlx_lm.server` (API do OpenAI em 127.0.0.1), com o raciocínio desligado como no VoiceInk. */
function mlx(baseUrl: string, model: string): LlmBackend {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(baseUrl)) throw new Error("o MLX tem que estar em 127.0.0.1");
  return {
    name: `mlx:${model.split("/").pop()}`,
    available: () => true,
    async complete(req: LlmRequest, signal: AbortSignal) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!res.ok) throw new Error(`mlx ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as any;
      return j.choices[0].message.content as string;
    },
  };
}

// ------------------------------------------------------------------ run

/** Guarda a resposta crua do modelo, mesmo quando a guarda descarta. */
function recording(inner: LlmBackend) {
  let last: { answer?: string; ms?: number } = {};
  const backend: LlmBackend = {
    name: inner.name,
    available: () => inner.available(),
    async complete(req, signal) {
      const t0 = performance.now();
      last = {};
      const answer = await inner.complete(req, signal);
      last = { answer, ms: Math.round(performance.now() - t0) };
      return answer;
    },
  };
  // Zera a cada caso: um caso que nem chama o LLM (entrada vazia) não herda a resposta do anterior.
  const take = () => {
    const l = last;
    last = {};
    return l;
  };
  return { backend, take };
}

let closer: (() => void) | undefined;
let inner: LlmBackend | undefined;
if (args.has("fm")) {
  const fm = await foundationModels(args.get("fm")!);
  inner = fm.backend;
  closer = fm.close;
  if (!inner.available()) throw new Error("Foundation Models indisponível");
} else if (args.has("mlx")) {
  inner = mlx(args.get("mlx")!, args.get("model") ?? "mlx-community/Qwen3.5-2B-4bit");
} else if (!args.has("golden")) {
  throw new Error("use --fm <kiwi-helper> ou --mlx <url> --model <id>, ou --golden para só as regras");
}

/** O golden: a nota das regras e, com backend, a das regras com o LLM, caso a caso. */
async function golden(llm: LlmBackend | undefined, take: () => { answer?: string; ms?: number }) {
  const lines: string[] = [];
  const rulesScores: GoldenScore[] = [];
  const llmScores: GoldenScore[] = [];
  const outcomes = new Map<string, number>();
  for (const c of goldenCases) {
    const input = { raw: c.raw, bundleId: c.bundleId, dictionary: c.dictionary };
    const rules = cleanupWithRules(input);
    const rulesScore = scoreGolden(c, rules.text);
    rulesScores.push(rulesScore);
    if (!llm || rules.tone === "literal") {
      lines.push(JSON.stringify({ id: c.id, tone: rules.tone, rules: rules.text, expected: c.expected, rulesScore: rulesScore.score }));
      continue;
    }
    const r = await cleanup(input, { llm, llmMode: "always", llmTimeoutMs: TIMEOUT_MS });
    const { answer, ms } = take();
    const key = !r.llm ? "skipped" : r.llm.used ? "used" : `${r.llm.reason}${r.llm.detail ? `:${r.llm.detail.split(":")[0]}` : ""}`;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    const llmScore = scoreGolden(c, r.text);
    llmScores.push(llmScore);
    lines.push(
      JSON.stringify({ id: c.id, tone: rules.tone, rules: rules.text, answer, final: r.text, expected: c.expected, outcome: key, ms, rulesScore: rulesScore.score, llmScore: llmScore.score }),
    );
    process.stderr.write(".");
  }
  const worst = (xs: GoldenScore[]) => xs.reduce((a, b) => (b.score < a.score ? b : a));
  const w = worst(rulesScores);
  let summary = `\ngolden: ${goldenCases.length} casos\n  só regras: nota ${meanScore(rulesScores)} · exatos ${rulesScores.filter((x) => x.score === 1).length} · pior ${w.id} (${w.score})\n`;
  if (llm && llmScores.length) {
    const lw = worst(llmScores);
    const byId = new Map(rulesScores.map((x) => [x.id, x.score]));
    const better = llmScores.filter((x) => x.score > byId.get(x.id)!).length;
    const worse = llmScores.filter((x) => x.score < byId.get(x.id)!).length;
    summary +=
      `  regras + ${llm.name}: nota ${meanScore(llmScores)} · exatos ${llmScores.filter((x) => x.score === 1).length} · pior ${lw.id} (${lw.score})\n` +
      `  o LLM melhorou ${better}, piorou ${worse}, igual ${llmScores.length - better - worse} · ${[...outcomes].map(([k, v]) => `${k} ${v}`).join(" · ")}\n`;
  }
  return { lines, summary };
}

if (args.has("golden")) {
  const rec = inner ? recording(inner) : undefined;
  const { lines, summary } = await golden(rec?.backend, rec ? rec.take : () => ({}));
  closer?.();
  process.stderr.write(summary);
  const file = args.get("out");
  if (file) await Bun.write(file, lines.join("\n") + "\n");
  else console.log(lines.join("\n"));
  process.exit(0);
}
if (!inner) throw new Error("sem backend");

const { backend, take } = recording(inner);
const out: string[] = [];
const times: number[] = [];
const outcomes = new Map<string, number>();
let first: number | undefined;
for (const c of evalCases) {
  const { tone } = cleanupWithRules({ raw: c.raw, bundleId: c.bundleId, dictionary: c.dictionary });
  if (tone === "literal") continue;
  const r = await cleanup(
    { raw: c.raw, bundleId: c.bundleId, dictionary: c.dictionary },
    { llm: backend, llmMode: "always", llmTimeoutMs: TIMEOUT_MS },
  );
  const { answer, ms } = take();
  const key = !r.llm ? "skipped" : r.llm.used ? "used" : `${r.llm.reason}${r.llm.detail ? `:${r.llm.detail.split(":")[0]}` : ""}`;
  outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  if (ms !== undefined) {
    if (first === undefined) first = ms;
    else times.push(ms);
  }
  out.push(JSON.stringify({ id: c.id, tone, raw: c.raw, rules: r.rulesText, answer, final: r.text, outcome: key, ms, watch: c.watch }));
  process.stderr.write(".");
}
closer?.();

times.sort((a, b) => a - b);
const at = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
process.stderr.write(
  `\n${inner.name}: ${out.length} casos · 1ª chamada ${first} ms · depois p50 ${at(0.5)} ms, p90 ${at(0.9)} ms, máx ${at(1)} ms\n` +
    `  ${[...outcomes].map(([k, v]) => `${k} ${v}`).join(" · ")}\n`,
);
const file = args.get("out");
if (file) await Bun.write(file, out.join("\n") + "\n");
else console.log(out.join("\n"));
