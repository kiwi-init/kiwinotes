// A busca no texto dos arquivos com 2.000 arquivos inventados (T21240, spec #21165): quanto a primeira indexação leva, a
// RAM do principal pelo `cli mem` (o medidor do #149: antes, o pico e depois), o tempo de uma busca, o tamanho do índice
// em disco e a 2ª abertura (que não lê de novo o que não mudou). Tudo num tmp, num app sem tela que o script abre e
// fecha. Pegue o bench antes, como manda o AGENTS.md:
//
//   kiwi lock bench --ttl 10m && bun scripts/text-index-bench.ts [--out arquivo.json]; kiwi unlock bench
//
// Para comparar com a `main` (sem o índice): `KIWI_APP=<outra worktree>/app bun scripts/text-index-bench.ts`. Ali a
// busca não acha os arquivos, e o script mede só a abertura e a RAM.

import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TextIndex } from "../src/notes/text-index.ts";
import type { VaultFile } from "../src/notes/vault.ts";
import { request } from "./cli.ts";

const APP = process.env.KIWI_APP ? path.resolve(process.env.KIWI_APP) : path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
const N = 2000;

/** Um gerador fixo: os mesmos arquivos a cada rodada. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const WORDS = "caju manga goiaba feira mercado planilha valor total conta projeto exemplo prazo entrega lista item caixa banco data hora tipo nome".split(" ");

/** 2.000 arquivos de texto de seis tipos, de 2 a 40 KB, e dois de 20 MB (que entram só pelo nome). */
function vault(root: string): { files: number; bytes: number } {
  const r = rng(21240);
  // Um terço das palavras sai de 50 mil inventadas (como os nomes de um código), para o índice ter o vocabulário de verdade.
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const POOL = Array.from({ length: 50_000 }, () => Array.from({ length: 4 + Math.floor(r() * 8) }, () => letters[Math.floor(r() * 26)]).join(""));
  const word = () => (r() < 1 / 3 ? POOL[Math.floor(r() * POOL.length)]! : WORDS[Math.floor(r() * WORDS.length)]!);
  const words = (n: number) => Array.from({ length: n }, word).join(" ");
  const kinds = ["py", "ts", "json", "csv", "txt", "log"] as const;
  let bytes = 0;
  for (let i = 0; i < N; i++) {
    const kind = kinds[i % kinds.length]!;
    const lines = 50 + Math.floor(r() * 900);
    const body: string[] = [];
    for (let l = 0; l < lines; l++) {
      const w = words(4 + Math.floor(r() * 6));
      body.push(
        kind === "py" ? `    valor_${l} = "${w}"` :
        kind === "ts" ? `export const v${l} = "${w}";` :
        kind === "json" ? `  "k${l}": "${w}",` :
        kind === "csv" ? `${l};${w.replaceAll(" ", ";")}` :
        kind === "log" ? `2026-11-01T10:00:${String(l % 60).padStart(2, "0")} info ${w}` : w,
      );
    }
    // Cada arquivo tem a palavra comum e uma só dele, no meio.
    body.splice(Math.floor(lines / 2), 0, `comum marca${i}`);
    const rel = `Pasta ${i % 40}/arquivo-${i}.${kind}`;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    const text = body.join("\n") + "\n";
    writeFileSync(path.join(root, rel), text);
    bytes += Buffer.byteLength(text);
  }
  mkdirSync(path.join(root, "Grandes"), { recursive: true });
  const big = "2026-11-01;exemplo;Projeto X;123,45;Ana;comum\n";
  for (let i = 0; i < 2; i++) {
    const text = big.repeat(Math.ceil((20 * 1024 * 1024) / big.length));
    writeFileSync(path.join(root, `Grandes/planilha-${i}.csv`), text);
    bytes += text.length;
  }
  return { files: N + 2, bytes };
}

async function cli(data: string, args: string[]) {
  const p = Bun.spawn([process.execPath, path.join(APP, "scripts/cli.ts"), ...args, "--data", data], { cwd: APP, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_HEADLESS_DATA: "" } });
  await new Response(p.stdout).text();
  return p.exited;
}

async function open(data: string) {
  if ((await cli(data, ["start", "--no-helper"])) !== 0) throw new Error("o headless não subiu");
  const send = async (msg: Record<string, unknown>) => {
    const res = (await request(data, msg)) as { ok: boolean; value?: any; code?: string } | null;
    if (!res) throw new Error("o headless caiu");
    return res;
  };
  const invoke = async (cap: string, args: unknown = {}) => {
    const res = await send({ cmd: "invoke", cap, args });
    if (!res.ok) throw new Error(`${cap}: ${res.code ?? ""}`);
    return res.value;
  };
  return {
    invoke,
    mem: async () => (await send({ cmd: "mem" })).value as { main: { now: number; peak: number; heapUsed: number } },
    stop: async () => {
      await cli(data, ["stop"]);
      for (let i = 0; i < 40 && existsSync(path.join(data, "control.sock")); i++) await Bun.sleep(100);
    },
  };
}

const MB = (n: number) => Math.round(n / 1e5) / 10;
const ms = (t0: number) => Math.round(performance.now() - t0);

/**
 * Espera a indexação acabar: 25 arquivos espalhados (e o último) achados pela palavra só deles, com buscas pequenas,
 * para a espera não pesar na RAM medida. Devolve os segundos, ou null se não acabar em 5 min.
 */
async function untilIndexed(app: Awaited<ReturnType<typeof open>>, t0: number) {
  const left = new Set([...Array.from({ length: 25 }, (_, k) => Math.floor((k * N) / 25) + 7), N - 1]);
  for (;;) {
    for (const i of [...left]) {
      const hits = (await app.invoke("notes.search", { query: `marca${i}`, limit: 1 })) as unknown[];
      if (hits.length) left.delete(i);
    }
    if (!left.size) return Math.round((performance.now() - t0) / 100) / 10;
    if (performance.now() - t0 > 300_000) return null;
    await Bun.sleep(250);
  }
}

/** A primeira indexação medida direto no `TextIndex`, neste processo, com a pausa padrão entre os lotes. */
async function direct(root: string, dir: string) {
  const files: VaultFile[] = [];
  for (const rel of new Bun.Glob("**/*").scanSync({ cwd: root })) {
    const st = statSync(path.join(root, rel));
    files.push({ path: rel, size: st.size, mtime: st.mtime.toISOString() });
  }
  const t = new TextIndex({ root, dir });
  const t0 = performance.now();
  await t.sync(files);
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const stats = { ...t.stats };
  await t.close();
  return { seconds, ...stats };
}

const data = mkdtempSync(path.join(tmpdir(), "kn-text-index-"));
try {
  const made = vault(path.join(data, "vault"));
  const inProcess = await direct(path.join(data, "vault"), path.join(data, "direto"));
  let app = await open(data);
  await Bun.sleep(1000);
  const before = await app.mem();
  const t0 = performance.now();
  await app.invoke("notes.list", {});
  const first = await untilIndexed(app, t0);
  const peak = await app.mem();

  // 20 buscas: uma palavra de um arquivo só, uma comum, uma frase.
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const q = i % 3 === 0 ? "comum caju" : i % 3 === 1 ? `marca${(i * 97) % N}` : '"goiaba feira"';
    const t = performance.now();
    await app.invoke("notes.search", { query: q, limit: 20 });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  await Bun.sleep(5000);
  const after = await app.mem();
  // A conferência: todos os 2.000 pela palavra comum (os dois de 20 MB entram só pelo nome, e o nome não a tem).
  const found = ((await app.invoke("notes.search", { query: "comum", limit: N + 10 })) as { file?: unknown }[]).filter((h) => h.file).length;
  await app.stop();

  const db = path.join(data, "text-index", "index.sqlite");
  const disk = [db, `${db}-wal`].filter(existsSync).reduce((s, f) => s + statSync(f).size, 0);

  // A 2ª abertura: nada mudou, e a busca acha tudo logo.
  app = await open(data);
  const t1 = performance.now();
  await app.invoke("notes.list", {});
  const second = await untilIndexed(app, t1);
  const reopenPeak = await app.mem();
  await app.stop();

  const result = {
    files: made.files,
    foundByCommonWord: found,
    textMB: MB(made.bytes),
    firstIndexSeconds: first,
    firstIndexInProcess: inProcess,
    searchMs: { median: Math.round(times[10]!), p95: Math.round(times[18]!), max: Math.round(times[19]!) },
    indexDiskMB: MB(disk),
    reopenSeconds: second,
    mainMB: { before: MB(before.main.now), peak: MB(peak.main.peak), after: MB(after.main.now), heapAfter: MB(after.main.heapUsed), reopenPeak: MB(reopenPeak.main.peak) },
    tookMs: ms(t0),
  };
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
} finally {
  rmSync(data, { recursive: true, force: true });
}
