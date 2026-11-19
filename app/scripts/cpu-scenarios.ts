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
//
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
  limits: { label: string; max: number; got: number; ok: boolean }[];
  skipped?: string;
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
  const pages: OpenedPage[] = [];
  try {
    smallVault(path.join(data, "vault"));
    const registry = fakeRegistry([
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
    const cpu = await measureCpu(pids, SECONDS);
    return {
      name,
      seconds: SECONDS,
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
    console.log(`${name} (${r.seconds} s): main ${c.main}% · helper ${c.helper}% · webview ${c.webview}% · gpu ${c.gpu}%`);
    for (const l of r.limits) console.log(`  ${l.ok ? "ok " : "PASSOU"} ${l.label}: ${l.got}% (teto ${l.max}%)`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  if (FAIL && results.some((r) => r.limits.some((l) => !l.ok))) process.exit(1);
  if (REQUIRE_HELPER && results.some((r) => r.skipped)) {
    console.log("--require-helper: um roteiro saiu pulado, e o CI não aceita pular a medida");
    process.exit(1);
  }
}
