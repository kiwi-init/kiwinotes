// A RAM do app, roteiro por roteiro (spec #20953, T21014, parte 2). Cada roteiro abre o seu próprio app sem tela (o
// headless, `bun run cli start`), com os dados num tmp e tudo inventado, e fecha no fim: o pico do processo é o pico
// daquele roteiro. Para cada um: a RAM **antes** (o app de pé, parado), o **pico** durante (o `phys_footprint` máximo
// desde que o processo abriu) e a RAM **30 s depois** do fim. Do principal e do helper, pelo `cli mem`.
//
//   bun run mem:scenarios [--only 1,2,…] [--out <arquivo.json>] [--after <segundos>]
//
// | 1. Pasta grande | 2.000 notas inventadas e cinco arquivos de 20 MB: abrir, listar, buscar, ler                       |
// | 2. Ditados      | 50 ditados seguidos, com áudio do `say` e `dryRun` (o helper de verdade, o STT, sem mic)              |
// | 3. Reunião      | 5 min de reunião do `say` nos dois canais, em tempo real (veja abaixo)                                |
// | 4. Agente       | o agente falso, com 20 respostas longas e 20 leituras de arquivo                                      |
// | 5. Janelas      | o Hub e as Notas abertos e fechados 20 vezes no WebKit headless                                       |
// | 6. Somados      | o 1, o 2, o 4 e o 5 em seguida, num app só, sem reiniciar (lead #21589)                              |
//
// - **A reunião são dois processos** (lead #21126, #21127): o headless não grava reunião de um WAV. O helper roda o
//   pipeline inteiro da reunião (`kiwi-helper --meeting-live <wav> --realtime --segments-live`, os dois streamings, o filtro de eco, a
//   diarização), e cada `segment` dele vai, no ritmo do WAV, para um principal que escreve a nota pelo `MeetingNotes`
//   de verdade (`mem-meeting-notes.ts`). O WAV é o `say.limpo` do banco das reuniões (`scripts/meeting-bench`), repetido
//   até 5 min.
// - **Os roteiros 2, 3 e 6 usam o STT:** cada um pega `kiwi lock bench --ttl 10m` antes e solta depois (AGENTS.md). Sem o
//   bench, o roteiro sai com `skipped`.
// - O helper vem de `KIWI_HELPER` ou do build do `native/` (o mesmo do headless). Nada do mic, nada na tela, nada das
//   notas de ninguém: só o app sem tela que o próprio script abre é medido. A saída é só números.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { webkit } from "playwright-core";

import { processMemory, type MemReport, type ProcessMemory } from "../src/bun/memory.ts";
import { fakeRegistry } from "../src/agent/fake/registry.ts";
import { defaultHelper } from "../src/headless/server.ts";
import { connect, request } from "./cli.ts";
import { openWindow, type UiContext } from "./ui-page.ts";

const APP = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const opt = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const ONLY = opt("--only")?.split(",").map(Number) ?? [1, 2, 3, 4, 5, 6];
const AFTER_S = Number(opt("--after") ?? 30);
const OUT = opt("--out");
const HELPER = process.env.KIWI_HELPER || defaultHelper(APP);

/** Antes, pico e depois de um processo, em bytes. */
export interface Measure {
  before: number;
  peak: number;
  after: number;
}

export interface ScenarioResult {
  id: number;
  name: string;
  main: (Measure & { heapBefore: number; heapAfter: number }) | null;
  helper: Measure | null;
  /** Quanto tempo o roteiro levou (sem os 30 s do depois). */
  seconds: number;
  /** O que o roteiro fez, em números (notas, ditados, respostas…). */
  did: Record<string, number>;
  skipped?: string;
  /** A RAM do helper ao longo do roteiro, em MB, uma amostra a cada `everySeconds` (só a reunião): onde o pico mora. */
  curve?: { everySeconds: number; helperMB: number[] };
}

// ---------------------------------------------------------------- o app sem tela

type Env = Record<string, string | undefined>;

async function cliRun(data: string, args: string[], env: Env): Promise<{ code: number; out: string }> {
  const p = Bun.spawn([process.execPath, path.join(APP, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: APP,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_HEADLESS_DATA: "", ...env },
  });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
}

/** Um app sem tela num tmp: sobe, mede, invoca e fecha. */
async function headless(data: string, env: Env, helper: boolean) {
  const r = await cliRun(data, ["start", ...(helper ? [] : ["--no-helper"])], env);
  if (r.code !== 0) throw new Error(`o headless não subiu (${r.code})`);
  const send = async (msg: Record<string, unknown>) => {
    const res = await request(data, msg);
    if (!res) throw new Error("o headless caiu");
    return res as { ok: boolean; value?: any; code?: string; message?: string };
  };
  const invoke = async (cap: string, args: unknown = {}) => {
    const res = await send({ cmd: "invoke", cap, args });
    if (!res.ok) throw new Error(`${cap}: ${res.code ?? ""}`);
    return res.value;
  };
  if (helper) {
    for (let i = 0; (await send({ cmd: "status" })).value?.helper !== "ready"; i++) {
      if (i > 240) throw new Error("o helper não ficou pronto em 60 s");
      await Bun.sleep(250);
    }
  }
  const ctx: UiContext = {
    data,
    send,
    subscribe: async (topics, onMsg) => {
      const c = await connect(data, (line) => {
        if (!("id" in line)) onMsg(line);
      });
      if (!c) throw new Error("o headless caiu");
      c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
      return () => c.close();
    },
  };
  return {
    ctx,
    send,
    invoke,
    mem: async () => (await send({ cmd: "mem" })).value as MemReport,
    stop: async () => {
      await cliRun(data, ["stop"], env);
      for (let i = 0; i < 40 && existsSync(path.join(data, "control.sock")); i++) await Bun.sleep(100);
    },
  };
}

type App = Awaited<ReturnType<typeof headless>>;

const MB = (n: number) => Math.round(n / 1e5) / 10;

/** Roda um roteiro num app próprio: antes (parado 2 s), o roteiro, o pico, e a RAM depois de `AFTER_S`. */
async function measured(
  id: number,
  name: string,
  setup: { env?: Env; helper?: boolean; prepare?: (data: string) => void | Promise<void> },
  run: (app: App, data: string) => Promise<Record<string, number>>,
): Promise<ScenarioResult> {
  const data = mkdtempSync(path.join(tmpdir(), "kn-mem-"));
  let app: App | null = null;
  try {
    await setup.prepare?.(data);
    app = await headless(data, { KIWI_DEBUG: "1", ...(setup.helper && HELPER ? { KIWI_HELPER: HELPER } : {}), ...setup.env }, !!setup.helper);
    await Bun.sleep(2000);
    const before = await app.mem();
    const began = Date.now();
    const did = await run(app, data);
    const seconds = Math.round((Date.now() - began) / 1000);
    const peak = await app.mem();
    await Bun.sleep(AFTER_S * 1000);
    const after = await app.mem();
    const both = (k: "main" | "helper") => {
      const b = before[k];
      const p = peak[k];
      const a = after[k];
      return b && p && a ? { before: b.now, peak: Math.max(p.peak, a.peak), after: a.now } : null;
    };
    const m = both("main");
    return {
      id,
      name,
      main: m && { ...m, heapBefore: before.main!.heapUsed, heapAfter: after.main!.heapUsed },
      helper: both("helper"),
      seconds,
      did,
    };
  } finally {
    await app?.stop().catch(() => {});
    rmSync(data, { recursive: true, force: true });
  }
}

/** O bench da máquina dividida (AGENTS.md): `true` se pegou; o `release` solta. */
function lockBench(): boolean {
  const r = spawnSync("kiwi", ["lock", "bench", "--ttl", "10m", "--wait", "30m"], { stdio: "ignore" });
  return r.status === 0;
}
const releaseBench = () => spawnSync("kiwi", ["unlock", "bench"], { stdio: "ignore" });

async function withBench(id: number, name: string, fn: () => Promise<ScenarioResult>): Promise<ScenarioResult> {
  if (!lockBench()) return { id, name, main: null, helper: null, seconds: 0, did: {}, skipped: "sem o bench (kiwi lock bench)" };
  try {
    return await fn();
  } finally {
    releaseBench();
  }
}

// ---------------------------------------------------------------- os dados inventados

/** Um gerador fixo: os mesmos dados a cada rodada. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const WORDS = "kiwi nota reunião projeto ideia pauta prazo exemplo cliente semana feira pão bairro sábado lista tarefa plano".split(" ");

function text(r: () => number, words: number): string {
  return Array.from({ length: words }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
}

/** 2.000 notas em 40 pastas, com links e tarefas, e cinco arquivos de 20 MB (três binários e dois CSV). */
export function bigVault(root: string): { notes: number; files: number } {
  const r = rng(21014);
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const rel = `Pasta ${i % 40}/Nota ${i}.md`;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    const body = `---\ntags: [t${i % 12}]\n---\n# Nota ${i}\n\n${text(r, 250)}\n\n- [ ] ${text(r, 6)}\n\n[[Nota ${(i + 1) % N}]] [[Nota ${(i + 13) % N}]]\n`;
    writeFileSync(path.join(root, rel), body);
  }
  mkdirSync(path.join(root, "Anexos"), { recursive: true });
  const SIZE = 20 * 1024 * 1024;
  for (let i = 0; i < 3; i++) {
    const bytes = new Uint8Array(SIZE);
    for (let k = 0; k < SIZE; k += 4096) bytes[k] = Math.floor(r() * 256);
    writeFileSync(path.join(root, `Anexos/arquivo-${i}.zip`), bytes);
  }
  const row = "2026-11-01;exemplo;Projeto X;123,45;Ana\n";
  for (let i = 0; i < 2; i++) writeFileSync(path.join(root, `Anexos/planilha-${i}.csv`), `data;tipo;projeto;valor;quem\n${row.repeat(Math.ceil(SIZE / row.length))}`);
  return { notes: N, files: 5 };
}

/** Um WAV do `say`, 16 kHz mono (o que o ditado testa; nada de mic). */
function sayWav(file: string, phrase: string) {
  const r = spawnSync("say", ["-v", "Luciana", "-o", file, "--data-format=LEI16@16000", phrase]);
  if (r.status !== 0) throw new Error(`say: ${r.stderr}`);
}

const PHRASES = [
  "Lembrar de comprar pão para a feira do bairro no sábado.",
  "A reunião do Projeto X ficou para quinta às três da tarde.",
  "Mandar para a Ana a lista de tarefas da semana.",
  "O prazo do exemplo é dia catorze, e a pauta já está pronta.",
  "Anotar a ideia nova do cliente sobre o plano do mês que vem.",
];

/**
 * A reunião de 5 min: o `say.limpo` do banco das reuniões (dois canais, 16 kHz, um roteiro inventado), repetido até
 * `seconds`. `null` se o banco não está preparado nesta máquina.
 */
function meetingWav(out: string, seconds: number): string | null {
  const bench = process.env.KIWI_MEETING_BENCH ?? path.join(homedir(), "Library/Caches/kiwinotes-bench/meetings");
  const src = path.join(bench, "reunioes", "say.limpo.wav");
  if (!existsSync(src)) return null;
  const wav = readFileSync(src);
  const at = wav.indexOf("data");
  if (wav.indexOf("WAVE") !== 8 || at < 0) return null;
  const pcm = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  const want = seconds * 16000 * 2 * 2;
  const body = Buffer.alloc(want);
  for (let o = 0; o < want; o += pcm.length) pcm.copy(body, o, 0, Math.min(pcm.length, want - o));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + want, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(16000 * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(want, 40);
  writeFileSync(out, Buffer.concat([head, body]));
  return out;
}

// ---------------------------------------------------------------- os roteiros

// Os passos de cada roteiro, à parte: o 6 roda os mesmos, um depois do outro, numa sessão só.

async function folderSteps(app: App): Promise<Record<string, number>> {
  const list = await app.invoke("notes.list");
  let reads = 0;
  for (const q of ["feira", "Projeto", "prazo", "kiwi nota", "Nota 1999", "sábado bairro"]) await app.invoke("notes.search", { query: q, limit: 50 });
  for (let i = 0; i < 2000; i += 10, reads++) await app.invoke("notes.get", { path: `Pasta ${i % 40}/Nota ${i}.md` });
  // Os CSV de 20 MB: o `files.read` recusa (`tooLarge`, acima do limite), e a RAM não deve subir por eles.
  let refused = 0;
  for (let i = 0; i < 2; i++) if ((await app.invoke("files.read", { path: `Anexos/planilha-${i}.csv`, as: "text" })).tooLarge) refused++;
  return { notes: list.notes.length, reads, searches: 6, bigReadsRefused: refused };
}

/** Os WAVs do `say` para os ditados, numa pasta própria que o `cleanup` apaga. */
function dictationWavs() {
  const dir = mkdtempSync(path.join(tmpdir(), "kn-mem-wav-"));
  const files = PHRASES.map((p, i) => {
    const f = path.join(dir, `d${i}.wav`);
    sayWav(f, p);
    return f;
  });
  return { files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function dictationSteps(data: string, files: string[]): Promise<Record<string, number>> {
  let ok = 0;
  for (let i = 0; i < 50; i++) {
    const r = await cliRun(data, ["dictate", files[i % files.length]!, "--note"], { KIWI_DEBUG: "1" });
    if (r.code === 0) ok++;
  }
  return { dictations: 50, ok };
}

/** O agente falso: o registro de pacotes de mentira e o env do app que o usa. */
function fakeAgent() {
  const registry = fakeRegistry([
    { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
    { name: "zod", version: "4.6.7", files: { "index.js": "" } },
  ]);
  // Os pacotes fixados num tmp próprio, já escritos: o env pode ser copiado antes do `prepare` (o roteiro 6 faz isso).
  const dir = mkdtempSync(path.join(tmpdir(), "kn-mem-agent-"));
  const packages = path.join(dir, "packages.json");
  writeFileSync(packages, JSON.stringify(registry.pinned));
  return {
    env: { KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages } as Env,
    /** Os 20 arquivos de ~150 KB que o agente lê. */
    prepare(data: string) {
      const r = rng(4);
      mkdirSync(path.join(data, "vault", "Projeto X"), { recursive: true });
      for (let i = 0; i < 20; i++) writeFileSync(path.join(data, "vault", "Projeto X", `relatorio-${i}.txt`), `${text(r, 20_000)}\n`);
    },
    stop: () => {
      registry.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function agentSteps(app: App): Promise<Record<string, number>> {
  await app.invoke("agent.enable", { consent: true });
  await app.invoke("agent.download");
  await app.invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await app.invoke("agent.status")).adapter.phase !== "ready"; n++) {
    if (n > 600) throw new Error("o agente falso não ficou pronto");
    await Bun.sleep(100);
  }
  const r = rng(44);
  const idle = async () => {
    for (let n = 0; (await app.invoke("agent.status")).busy; n++) {
      if (n > 1200) throw new Error("o agente falso não terminou");
      await Bun.sleep(50);
    }
  };
  for (let i = 0; i < 20; i++) {
    // Uma resposta longa (~20 mil caracteres) e uma leitura de arquivo de ~150 KB, como num pedido de verdade.
    await app.invoke("agent.ask", { text: `/diga ${text(r, 3000)}` });
    await idle();
    await app.invoke("agent.ask", { text: `/ler-arquivo Projeto X/relatorio-${i}.txt` });
    await idle();
  }
  // As leituras que o agente fez de fato, pelo registro do Kiwi: um roteiro que não leu nada não mede o que diz.
  const activity = (await app.invoke("agent.activity", { limit: 100 })).requests as { reads: { tool: string }[] }[];
  const fileReads = activity.reduce((n, q) => n + q.reads.filter((x) => /files_read/.test(x.tool)).length, 0);
  return { answers: 20, asked: 40, fileReads };
}

async function windowSteps(app: App): Promise<Record<string, number>> {
  const browser = await webkit.launch({ headless: true });
  try {
    let opened = 0;
    for (let i = 0; i < 20; i++) {
      for (const window of ["hub", "notes"] as const) {
        const w = await openWindow(browser, app.ctx, { window, scale: 1, theme: "light", width: 1180, height: 760, browser: "webkit", motion: false, query: {} });
        await w.page.waitForTimeout(300);
        await w.close();
        opened++;
      }
    }
    return { windows: opened };
  } finally {
    await browser.close();
  }
}

const scenarios: Record<number, () => Promise<ScenarioResult>> = {
  1: () => {
    let files = 0;
    return measured(1, "Pasta grande", { prepare: (data) => void (files = bigVault(path.join(data, "vault")).files) }, async (app) => ({
      ...(await folderSteps(app)),
      files,
    }));
  },

  2: () =>
    withBench(2, "Ditados", () => {
      const wavs = dictationWavs();
      return measured(2, "Ditados", { helper: true, env: { KIWI_STT_BOOSTING: "off" } }, (_app, data) => dictationSteps(data, wavs.files)).finally(wavs.cleanup);
    }),

  3: () =>
    withBench(3, "Reunião (dois processos)", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "kn-mem-meet-"));
      try {
        const wav = meetingWav(path.join(dir, "reuniao.wav"), 300);
        if (!wav) return { id: 3, name: "Reunião (dois processos)", main: null, helper: null, seconds: 0, did: {}, skipped: "sem o banco das reuniões (scripts/meeting-bench/prepare.ts e build.ts)" };
        if (!HELPER) return { id: 3, name: "Reunião (dois processos)", main: null, helper: null, seconds: 0, did: {}, skipped: "sem o helper (KIWI_HELPER ou native/.build)" };
        return await meeting(wav, dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }),

  4: () => {
    const agent = fakeAgent();
    return measured(4, "Agente", { env: agent.env, prepare: (data) => agent.prepare(data) }, agentSteps).finally(agent.stop);
  },

  5: () => measured(5, "Janelas", { prepare: (data) => void bigVault0(path.join(data, "vault")) }, windowSteps),

  // Os roteiros somados (lead #21589): o app do 1º passo segue aberto pelos outros, sem reiniciar, como o de quem usa
  // o Kiwi o dia inteiro. A reunião fica de fora: ela não roda dentro do headless (são dois processos, veja o 3).
  6: () =>
    withBench(6, "1, 2, 4 e 5 somados (uma sessão)", () => {
      const wavs = dictationWavs();
      const agent = fakeAgent();
      return measured(
        6,
        "1, 2, 4 e 5 somados (uma sessão)",
        {
          helper: true,
          env: { KIWI_STT_BOOSTING: "off", ...agent.env },
          prepare: (data) => {
            bigVault(path.join(data, "vault"));
            agent.prepare(data);
          },
        },
        async (app, data) => ({
          ...(await folderSteps(app)),
          ...(await dictationSteps(data, wavs.files)),
          ...(await agentSteps(app)),
          ...(await windowSteps(app)),
        }),
      ).finally(() => {
        wavs.cleanup();
        agent.stop();
      });
    }),
};

/** Umas poucas notas, para as janelas terem o que mostrar. */
function bigVault0(root: string) {
  const r = rng(5);
  for (let i = 0; i < 50; i++) {
    mkdirSync(path.join(root, `Pasta ${i % 5}`), { recursive: true });
    writeFileSync(path.join(root, `Pasta ${i % 5}/Nota ${i}.md`), `# Nota ${i}\n\n${text(r, 200)}\n`);
  }
}

/**
 * A reunião em dois processos: o helper com o pipeline inteiro, em tempo real, e um principal que escreve a nota com
 * cada `segment` assim que ele sai. A RAM dos dois pelo `proc_pid_rusage`, como o `cli mem`.
 */
async function meeting(wav: string, dir: string): Promise<ScenarioResult> {
  const notes = spawn(process.execPath, [path.join(APP, "scripts/mem-meeting-notes.ts"), path.join(dir, "Cofre")], { stdio: ["pipe", "pipe", "inherit"] });
  const notesExited = new Promise((r) => notes.once("exit", r));
  await new Promise<void>((resolve) => notes.stdout!.once("data", () => resolve()));
  const mem = (pid: number | undefined): ProcessMemory | null => (pid ? processMemory(pid) : null);
  const main0 = mem(notes.pid)!;
  // `--linger`: o helper fica de pé depois do fim, como o do app fica depois de uma reunião, para o "depois".
  const args = ["--meeting-live", wav, "--realtime", "--segments-live", "--output", "headphones", "--linger", String(AFTER_S + 10)];
  const helper = spawn(HELPER!, args, { stdio: ["ignore", "pipe", "ignore"] });
  const helperExited = new Promise((r) => helper.once("exit", r));
  await Bun.sleep(2000);
  const helper0 = mem(helper.pid);
  const began = Date.now();
  let segments = 0;
  let helperPeak: ProcessMemory | null = null;
  let tick = 0;
  const curve: number[] = [];
  // O pico do helper só se lê com ele vivo: uma amostra por segundo, e a curva a cada 5 s.
  const sampler = setInterval(() => {
    const m = mem(helper.pid);
    if (m) helperPeak = m;
    if (m && ++tick % 5 === 0) curve.push(MB(m.now));
  }, 1000);
  let seconds = 0;
  let main1: ProcessMemory | null = null;
  let helper1: ProcessMemory | null = null;
  for await (const line of createInterface({ input: helper.stdout! })) {
    if (line.includes('"type":"segment"')) {
      notes.stdin!.write(`${line}\n`);
      segments++;
    } else if (line.includes('"type":"stats"')) {
      // O fim da reunião (o VBx já rodou): a nota fecha, e o "depois" dos dois sai `AFTER_S` mais tarde.
      notes.stdin!.write('{"type":"finish"}\n');
      seconds = Math.round((Date.now() - began) / 1000);
      await Bun.sleep(AFTER_S * 1000);
      main1 = mem(notes.pid);
      helper1 = mem(helper.pid);
    }
  }
  clearInterval(sampler);
  await helperExited;
  notes.stdin!.end();
  await notesExited;
  const hp = helperPeak as ProcessMemory | null;
  return {
    id: 3,
    name: "Reunião (dois processos)",
    main: main1 && { before: main0.now, peak: main1.peak, after: main1.now, heapBefore: 0, heapAfter: 0 },
    helper: helper0 && hp && helper1 ? { before: helper0.now, peak: Math.max(hp.peak, helper1.peak), after: helper1.now } : null,
    seconds,
    did: { audioSeconds: 300, segments },
    curve: { everySeconds: 5, helperMB: curve },
  };
}

// ---------------------------------------------------------------- main

if (import.meta.main) {
  const results: ScenarioResult[] = [];
  for (const id of ONLY) {
    const run = scenarios[id];
    if (!run) continue;
    console.error(`roteiro ${id}…`);
    try {
      const r = await run();
      results.push(r);
      const row = (m: Measure | null) => (m ? `${MB(m.before)} → pico ${MB(m.peak)} → ${MB(m.after)} MB` : "—");
      console.error(`  ${r.name}: principal ${row(r.main)} · helper ${row(r.helper)}${r.skipped ? ` · pulado: ${r.skipped}` : ""}`);
    } catch (e) {
      results.push({ id, name: `roteiro ${id}`, main: null, helper: null, seconds: 0, did: {}, skipped: e instanceof Error ? e.message : String(e) });
      console.error(`  falhou: ${e instanceof Error ? e.message : e}`);
    }
  }
  const json = JSON.stringify({ spec: 20953, afterSeconds: AFTER_S, results }, null, 2);
  if (OUT) writeFileSync(OUT, `${json}\n`);
  else console.log(json);
}
