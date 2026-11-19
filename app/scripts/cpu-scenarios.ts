// A CPU do app, roteiro por roteiro (spec #24228, a régua). Cada roteiro abre o seu próprio app sem tela (o headless,
// `bun run cli start`, com o helper de verdade), com os dados num tmp e tudo inventado, abre as janelas no WebKit
// headless com as animações ligadas, espera assentar e mede a CPU média de cada processo numa janela de tempo:
//
// - **main:** o processo do headless (o Bun, com os workers dele, que são threads do mesmo processo);
// - **helper:** o `kiwi-helper` filho dele;
// - **webview:** os processos `WebContent` do WebKit do Playwright que abriram com as janelas;
// - **gpu:** o processo `GPU` do mesmo WebKit (o WebGL do gato e a composição caem nele).
//
//   bun run cpu:scenarios [--only repouso,…] [--seconds 60] [--out <arquivo.json>] [--no-fail] [--require-helper]
//
// | repouso      | o Hub, as Notas e os Ajustes abertos e parados, com o agente falso ligado (o gato aparece), o índice |
// |              | pronto, e a pessoa em outro app (o `blur` em cada janela): tela e helper < 1%, tudo < 2%           |
// | repouso-foco | o mesmo, com a janela na frente e ninguém mexendo                                                  |
// | indexando-   | a 1ª passada do índice do conteúdo numa pasta inventada grande de código e JSON, sem tela: o       |
// |   codigo     | principal com média < 50% e nenhum segundo acima de 100% (o teto do índice, T24286). Mede a passada|
// |              | até ela acabar (5 s quietos, até `--seconds`), e ela tem de durar 20 s, senão não mediu nada       |
// | indexando-md | a pasta grande só de `.md`: as notas não passam pelo índice do conteúdo (ele é dos outros arquivos);|
// |              | o que sobra no fundo, em `--seconds` depois da lista (a busca aquecida, as tags), com a mesma régua|
// | cedendo      | a passada de código com a pessoa escrevendo (um `notes.save` por segundo): o portão fecha, a       |
// |              | passada para e o principal fica < 10%. Depois, 30 s sem escrever: a passada tem de voltar          |
//
// - Antes de medir o repouso, o roteiro espera o app assentar (`waitQuiet`: janelas de 5 s até a soma ficar na régua
//   de "tudo", no máximo 60 s) e diz quanto esperou. O trabalho do começo não conta; um timer à toa nunca assenta.
// - A CPU sai do tempo de CPU acumulado de cada processo (`ps -o time`), no começo e no fim da janela: a média, sem
//   perder os picos curtos que uma amostra do `top` perde. Em % de um núcleo.
// - Os processos do WebKit do Playwright são filhos do launchd, não do navegador: entram os que apareceram depois que
//   o navegador abriu (pelo caminho do `ms-playwright`). Outro agente com um WebKit aberto ao mesmo tempo se mistura:
//   pegue `kiwi lock bench --ttl 10m` antes (AGENTS.md).
// - Sai com exit 1 quando um roteiro passa da régua (`--no-fail` só mostra). Sem o helper, o roteiro sai pulado; com
//   `--require-helper` (o CI, T24486), o pulado também sai com exit 1: o check não fica verde sem medir. Nada do mic, nada na tela, nada das notas
//   de ninguém: só o app sem tela que o próprio script abre. A saída é só números. Os dados ficam numa pasta `.noindex`,
//   fora do Spotlight, e saem no fim.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { webkit, type Browser } from "playwright-core";

import { fakeRegistry } from "../src/agent/fake/registry.ts";
import { defaultHelper, stateFile } from "../src/headless/server.ts";
import type { UiWindow } from "../src/shared/ui-contract.ts";
import { connect, request } from "./cli.ts";
import { openWindow, type OpenedPage, type UiContext } from "./ui-page.ts";

const APP = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const opt = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const SECONDS = Number(opt("--seconds") ?? 60);
const OUT = opt("--out");
const FAIL = !argv.includes("--no-fail");
const REQUIRE_HELPER = argv.includes("--require-helper");
const HELPER = process.env.KIWI_HELPER || defaultHelper(APP);

type Env = Record<string, string | undefined>;
export type Role = "main" | "helper" | "webview" | "gpu";

/** A CPU média de cada papel na janela, em % de um núcleo (a soma dos processos daquele papel). */
export type CpuByRole = Record<Role, number>;

export interface Limit {
  /** Os papéis somados que a régua olha. */
  roles: Role[];
  /** O teto da média, em % de um núcleo. */
  max: number;
  label: string;
}

export interface ScenarioResult {
  name: string;
  seconds: number;
  cpu: CpuByRole | null;
  /** O segundo mais alto do principal (os roteiros do índice). */
  peak?: number;
  limits: { label: string; max: number; got: number; ok: boolean }[];
  skipped?: string;
  /** Os segundos que o repouso esperou o app assentar antes de medir (`waitQuiet`). */
  warmup?: number;
}

/** O `TIME` do `ps` (`[[dd-]hh:]mm:ss.cc`) em segundos. */
export function cpuSeconds(time: string): number {
  const [days, rest] = time.includes("-") ? time.split("-") as [string, string] : ["0", time];
  const parts = rest.split(":").map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return Number(days) * 86400 + s;
}

/** Pid → (tempo de CPU em s, comando), de todos os processos deste usuário. */
function processTable(): Map<number, { cpu: number; command: string; ppid: number }> {
  const out = spawnSync("ps", ["-Ao", "pid=,ppid=,time=,command="]).stdout.toString();
  const table = new Map<number, { cpu: number; command: string; ppid: number }>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), cpu: cpuSeconds(m[3]!), command: m[4]! });
  }
  return table;
}

/** Os processos do WebKit do Playwright, por papel. */
function playwrightWebKit(): Map<number, Role> {
  const out = new Map<number, Role>();
  for (const [pid, p] of processTable()) {
    if (!p.command.includes("ms-playwright/webkit")) continue;
    if (p.command.includes("WebKit.WebContent")) out.set(pid, "webview");
    else if (p.command.includes("WebKit.GPU")) out.set(pid, "gpu");
  }
  return out;
}

/**
 * A CPU de cada papel em `seconds`: o tempo de CPU de cada pid no começo e no fim. Um processo que some no meio entra
 * só com o que gastou até a última leitura que o viu (a cada 5 s).
 */
async function measureCpu(pids: Map<number, Role>, seconds: number): Promise<CpuByRole> {
  const start = processTable();
  const last = new Map<number, number>();
  for (const pid of pids.keys()) { const p = start.get(pid); if (p) last.set(pid, p.cpu); }
  const began = performance.now();
  const end = began + seconds * 1000;
  while (performance.now() < end) {
    await Bun.sleep(Math.min(5000, end - performance.now()));
    const now = processTable();
    for (const pid of pids.keys()) { const p = now.get(pid); if (p) last.set(pid, p.cpu); }
  }
  const wall = (performance.now() - began) / 1000;
  const cpu: CpuByRole = { main: 0, helper: 0, webview: 0, gpu: 0 };
  for (const [pid, role] of pids) {
    const a = start.get(pid)?.cpu, b = last.get(pid);
    if (a != null && b != null) cpu[role] += ((b - a) / wall) * 100;
  }
  for (const k of Object.keys(cpu) as Role[]) cpu[k] = Math.round(cpu[k] * 100) / 100;
  return cpu;
}

/**
 * Espera o app assentar: janelas de 5 s até a soma de todos os papéis ficar em `limit` ou passar `maxS`. Devolve os
 * segundos de espera. Um trabalho do começo (no CI, o helper recém-compilado chegou a 5% numa 1ª janela de 60 s, e
 * 0,15% no roteiro seguinte do mesmo Mac) não é repouso; um timer rodando à toa nunca assenta e cai na medida.
 */
async function waitQuiet(pids: Map<number, Role>, limit: number, maxS: number): Promise<number> {
  const began = performance.now();
  while ((performance.now() - began) / 1000 < maxS) {
    const cpu = await measureCpu(pids, 5);
    if (Object.values(cpu).reduce((a, b) => a + b, 0) <= limit) break;
  }
  return Math.round((performance.now() - began) / 1000);
}

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

/** O app sem tela num tmp, com o helper: o contexto das janelas e os pids do principal e do helper. */
async function headless(data: string, env: Env) {
  const r = await cliRun(data, ["start"], env);
  if (r.code !== 0) throw new Error(`o headless não subiu (${r.code})`);
  const send = async (msg: Record<string, unknown>) => {
    const res = await request(data, msg);
    if (!res) throw new Error("o headless caiu");
    return res as { ok: boolean; value?: any; code?: string; message?: string };
  };
  for (let i = 0; (await send({ cmd: "status" })).value?.helper !== "ready"; i++) {
    if (i > 240) throw new Error("o helper não ficou pronto em 60 s");
    await Bun.sleep(250);
  }
  const main = (JSON.parse(readFileSync(stateFile(data), "utf8")) as { pid: number }).pid;
  const helper = [...processTable()].find(([, p]) => p.ppid === main && p.command.includes("kiwi-helper"))?.[0];
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
  const invoke = async (cap: string, args: unknown = {}) => {
    const res = await send({ cmd: "invoke", cap, args });
    if (!res.ok) throw new Error(`${cap}: ${res.code ?? ""}`);
    return res.value;
  };
  return {
    ctx,
    main,
    helper,
    invoke,
    stop: async () => {
      await cliRun(data, ["stop"], env);
      for (let i = 0; i < 40 && existsSync(path.join(data, "control.sock")); i++) await Bun.sleep(100);
    },
  };
}

/** Uma pasta inventada pequena: o índice fica pronto logo, e o repouso mede o repouso. */
function smallVault(root: string) {
  for (let i = 0; i < 40; i++) {
    mkdirSync(path.join(root, `Pasta ${i % 4}`), { recursive: true });
    writeFileSync(path.join(root, `Pasta ${i % 4}/Nota ${i}.md`), `# Nota ${i}\n\nUm texto de exemplo sobre o Projeto X, número ${i}.\n`);
  }
}

/**
 * Abre as janelas com o agente falso ligado (o gato do hub e o dos Ajustes só aparecem com ele), espera `settleS` e
 * mede `SECONDS` com tudo parado. `away`: a pessoa está em outro app, e cada janela recebe o `blur`.
 */
async function idle(name: string, windows: UiWindow[], limits: Limit[], away: boolean, settleS = 25): Promise<ScenarioResult> {
  if (!HELPER) return { name, seconds: 0, cpu: null, limits: [], skipped: "sem o helper (KIWI_HELPER ou native/.build)" };
  // Numa pasta `.noindex`: o Spotlight (`mds_stores`, `fseventsd`) não indexa o que o roteiro cria (lead #24316).
  const base = path.join(tmpdir(), "kn-cpu.noindex");
  mkdirSync(base, { recursive: true });
  const data = mkdtempSync(path.join(base, "run-"));
  let app: Awaited<ReturnType<typeof headless>> | null = null;
  let browser: Browser | null = null;
  let registry: ReturnType<typeof fakeRegistry> | null = null;
  const pages: OpenedPage[] = [];
  try {
    smallVault(path.join(data, "vault"));
    registry = fakeRegistry([
      { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
      { name: "zod", version: "4.6.7", files: { "index.js": "" } },
    ]);
    const packages = path.join(data, "packages.json");
    writeFileSync(packages, JSON.stringify(registry.pinned));
    app = await headless(data, { KIWI_DEBUG: "1", KIWI_HELPER: HELPER, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages });
    await app.invoke("agent.enable", { consent: true });
    await app.invoke("agent.download");
    await app.invoke("agent.configure", { onboarding: { state: "done" } });
    for (let n = 0; (await app.invoke("agent.status")).adapter.phase !== "ready"; n++) {
      if (n > 200) throw new Error("o agente falso não ficou pronto em 20 s");
      await Bun.sleep(100);
    }
    const before = new Set(playwrightWebKit().keys());
    browser = await webkit.launch({ headless: true });
    for (const window of windows) {
      pages.push(await openWindow(browser, app.ctx, { window, scale: 2, theme: "light", width: 1180, height: 760, browser: "webkit", motion: true, query: {} }));
    }
    // O gato do hub de pé: sem ele, o roteiro não mede o que diz.
    const hub = pages[windows.indexOf("hub")];
    if (hub) await hub.page.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 20_000 });
    if (away) for (const p of pages) await p.page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await Bun.sleep(settleS * 1000);
    const pids = new Map<number, Role>([[app.main, "main"]]);
    if (app.helper) pids.set(app.helper, "helper");
    for (const [pid, role] of playwrightWebKit()) if (!before.has(pid)) pids.set(pid, role);
    const all = limits.find((l) => l.roles.length === 4)?.max ?? 2;
    const warmup = await waitQuiet(pids, all, 60);
    const cpu = await measureCpu(pids, SECONDS);
    return {
      name,
      seconds: SECONDS,
      warmup,
      cpu,
      limits: limits.map((l) => {
        const got = Math.round(l.roles.reduce((s, r) => s + cpu[r], 0) * 100) / 100;
        return { label: l.label, max: l.max, got, ok: got <= l.max };
      }),
    };
  } finally {
    for (const p of pages) await p.close().catch(() => {});
    await browser?.close().catch(() => {});
    await app?.stop().catch(() => {});
    // O servidor do registro falso segura o processo vivo: sem o `stop`, o script mede e não sai (o CI esperou 10 min).
    registry?.stop();
    rmSync(data, { recursive: true, force: true });
  }
}

/**
 * Uma pasta inventada grande, num gerador fixo (sempre a mesma pasta). `md`: notas com tarefas e links. `code`: 2/3
 * de módulos `.ts` e 1/3 de `.json`.
 */
function bigVault(root: string, files: number, kind: "md" | "code") {
  const words = "kiwi nota reunião projeto ideia pauta prazo exemplo semana feira pão bairro sábado lista tarefa plano".split(" ");
  let seed = 24485;
  const text = (n: number) => Array.from({ length: n }, () => words[(seed = (seed * 1103515245 + 12345) % 2 ** 31) % words.length]).join(" ");
  for (let i = 0; i < files; i++) {
    const dir = path.join(root, `Pasta ${i % 100}`, `Sub ${i % 7}`);
    if (i < 700) mkdirSync(dir, { recursive: true });
    if (kind === "md") writeFileSync(path.join(dir, `Nota ${i}.md`), `# Nota ${i}\n\n${text(120)}\n\n- [ ] ${text(5)}\n\n[[Nota ${(i + 1) % files}]]\n`);
    else if (i % 3 < 2) writeFileSync(path.join(dir, `mod${i}.ts`), `export function f${i}(a: number) {\n  // ${text(30)}\n  return a + ${i};\n}\n`.repeat(20));
    else writeFileSync(path.join(dir, `dados${i}.json`), JSON.stringify({ id: i, itens: text(200).split(" ") }));
  }
}

/**
 * A CPU do principal a cada segundo, por `seconds`, enquanto `during` roda ao lado: a média e o segundo mais alto.
 * `quiet`: para antes quando o principal fica 5 s seguidos abaixo dele (o trabalho acabou), e a média e o tempo
 * (`active`) ficam só com o trecho que andou.
 */
async function samplePid(pid: number, seconds: number, during?: (stop: () => boolean) => Promise<void>, quiet?: number) {
  const cpu = () => processTable().get(pid)?.cpu;
  const first = cpu();
  if (first == null) throw new Error("o principal sumiu");
  let last = first, lastT = performance.now(), done = false;
  const began = lastT;
  const each: number[] = [];
  const side = during?.(() => done);
  const marks: { c: number; t: number }[] = [];
  for (let k = 0; k < seconds; k++) {
    await Bun.sleep(1000);
    const c = cpu() ?? last, t = performance.now();
    each.push(((c - last) / ((t - lastT) / 1000)) * 100);
    marks.push({ c, t });
    last = c; lastT = t;
    if (quiet != null && each.length > 5 && each.slice(-5).every((x) => x < quiet)) break;
  }
  done = true;
  await side;
  const round = (n: number) => Math.round(n * 100) / 100;
  // Sem o trecho quieto do fim, quando parou por ele.
  const quietEnd = quiet != null && each.length < seconds ? 5 : 0;
  const end = marks[marks.length - 1 - quietEnd] ?? { c: first, t: began };
  const active = (end.t - began) / 1000;
  return {
    avg: round(active > 0 ? ((end.c - first) / active) * 100 : 0),
    peak: round(Math.max(0, ...each)),
    active: Math.round(active),
  };
}

/**
 * A 1ª passada do índice do conteúdo numa pasta grande, sem tela e sem helper (só o principal conta). Mede desde que a
 * lista das notas voltou: a busca já está aquecida (o `warm` em fatias, sem teto de propósito, T24286), e o que sobra
 * é a passada. `typing`: um `notes.save` por segundo, a pessoa escrevendo, e o portão segura a passada.
 */
async function indexing(name: string, kind: "md" | "code", files: number, typing: boolean): Promise<ScenarioResult> {
  // A passada anda: o principal passa disto (o repouso fica perto de 1%).
  const MOVING = 3;
  // Menos que isso não é a passada de uma pasta grande: o roteiro não mediu o que diz.
  const MIN_PASS = 20;
  const base = path.join(tmpdir(), "kn-cpu.noindex");
  mkdirSync(base, { recursive: true });
  const data = mkdtempSync(path.join(base, "run-"));
  const env = { KIWI_DEBUG: "1" };
  let stop: (() => Promise<void>) | null = null;
  try {
    const vault = path.join(data, "vault");
    bigVault(vault, files, kind);
    const r = await cliRun(data, ["start", "--no-helper"], env);
    if (r.code !== 0) throw new Error(`o headless não subiu (${r.code})`);
    stop = async () => {
      await cliRun(data, ["stop"], env);
      for (let i = 0; i < 40 && existsSync(path.join(data, "control.sock")); i++) await Bun.sleep(100);
    };
    const invoke = async (cap: string, args: unknown = {}) => {
      const res = (await request(data, { cmd: "invoke", cap, args })) as { ok: boolean; value?: any; code?: string } | null;
      if (!res?.ok) throw new Error(`${cap}: ${res?.code ?? "o headless caiu"}`);
      return res.value;
    };
    const main = (JSON.parse(readFileSync(stateFile(data), "utf8")) as { pid: number }).pid;
    await invoke("notes.list");
    const draft = "Rascunho.md";
    writeFileSync(path.join(vault, draft), "# Rascunho\n");
    const write = async (stopped: () => boolean) => {
      let text = "# Rascunho\n";
      while (!stopped()) {
        const before = await invoke("notes.get", { path: draft });
        text += "Mais uma linha de exemplo.\n";
        await invoke("notes.save", { path: draft, content: text, baseVersion: before.version });
        await Bun.sleep(1000);
      }
    };
    const { avg, peak, active } = await samplePid(main, SECONDS, typing ? write : undefined, kind === "code" && !typing ? MOVING : undefined);
    const limits: { label: string; max: number; got: number; min?: number }[] = typing
      ? [{ label: "principal com a pessoa escrevendo", max: 10, got: avg }]
      : [{ label: "principal (média)", max: 50, got: avg }, { label: "principal (pico de 1 s)", max: 100, got: peak }];
    // A prova de que o roteiro mediu a passada: ela seguia no fim da janela, ou voltou quando a pessoa parou.
    if (kind === "code" && !typing) limits.push({ label: "a passada durou (s)", max: Infinity, min: MIN_PASS, got: active });
    if (typing) {
      const back = await samplePid(main, 30);
      limits.push({ label: "a passada voltou sem a pessoa (pico em 30 s)", max: Infinity, min: MOVING, got: back.peak });
    }
    return {
      name,
      seconds: active,
      cpu: { main: avg, helper: 0, webview: 0, gpu: 0 },
      peak,
      limits: limits.map(({ min, ...l }) => ({ ...l, ok: l.got <= l.max && l.got >= (min ?? -Infinity) })),
    };
  } finally {
    await stop?.().catch(() => {});
    rmSync(data, { recursive: true, force: true });
  }
}

const REST: Limit[] = [
  { roles: ["webview", "gpu"], max: 1, label: "tela (webview + gpu)" },
  { roles: ["helper"], max: 1, label: "helper" },
  { roles: ["main", "helper", "webview", "gpu"], max: 2, label: "tudo" },
];

const scenarios: Record<string, () => Promise<ScenarioResult>> = {
  // A pessoa em outro app, com o Kiwi aberto atrás: o caso do harry (#24228).
  repouso: () => idle("repouso", ["hub", "notes", "settings"], REST, true),
  // A janela do Kiwi na frente, sem ninguém mexer.
  "repouso-foco": () => idle("repouso-foco", ["hub", "notes", "settings"], REST, false),
  // A pasta grande que a pessoa acabou de abrir (o 200% do #24228): a passada anda com o teto.
  "indexando-md": () => indexing("indexando-md", "md", 20_000, false),
  "indexando-codigo": () => indexing("indexando-codigo", "code", 30_000, false),
  // A mesma passada com a pessoa escrevendo: ela para.
  cedendo: () => indexing("cedendo", "code", 30_000, true),
};

if (import.meta.main) {
  const only = opt("--only")?.split(",") ?? Object.keys(scenarios);
  const results: ScenarioResult[] = [];
  for (const name of only) {
    const run = scenarios[name];
    if (!run) throw new Error(`roteiro desconhecido: ${name} (${Object.keys(scenarios).join(", ")})`);
    const r = await run();
    results.push(r);
    if (r.skipped) { console.log(`${name}: pulado (${r.skipped})`); continue; }
    const c = r.cpu!;
    console.log(`${name} (${r.seconds} s${r.warmup ? `, depois de ${r.warmup} s assentando` : ""}): main ${c.main}% · helper ${c.helper}% · webview ${c.webview}% · gpu ${c.gpu}%${r.peak != null ? ` · pico do main ${r.peak}%` : ""}`);
    for (const l of r.limits) {
      const unit = l.label.endsWith("(s)") ? "" : "%";
      const ruler = Number.isFinite(l.max) ? `teto ${l.max}${unit}` : "tem de andar";
      console.log(`  ${l.ok ? "ok " : Number.isFinite(l.max) ? "PASSOU" : "PAROU"} ${l.label}: ${l.got}${unit} (${ruler})`);
    }
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  if (FAIL && results.some((r) => r.limits.some((l) => !l.ok))) process.exit(1);
  if (REQUIRE_HELPER && results.some((r) => r.skipped)) {
    console.log("--require-helper: um roteiro saiu pulado, e o CI não aceita pular a medida");
    process.exit(1);
  }
}
