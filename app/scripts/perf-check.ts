// O app leve (spec #13384, T13408): mede o que o harry sentiu pesado na rc19, num cofre do tamanho do dele (517 notas,
// 6.625 pastas e 150.775 outros arquivos, pelo log), com o AppEngine headless, o agente falso e um WebKit headless:
// nada na tela de ninguém, sem mic e sem colar de verdade.
//
// 0. o índice do cofre: quanto leva e se o Bun responde nesse meio;
// 1. a CPU parada: o Bun com o hub fechado, e o Bun e o WebKit com ele aberto nas Notas (meta: perto de 0 %);
// 2. digitar numa nota no ritmo de uma pessoa: o eco de cada tecla (do envio ao quadro com a letra) e o quadro mais
//    longo, com os saves de 500 ms e o que cada save refaz na tela;
// 3. um ditado numa nota: o texto chega de uma vez no editor, como a colagem do helper (o STT e a colagem são do
//    helper, fora daqui), e o save depois.
// As metas estão em `GOALS`.
//
//   bun scripts/perf-check.ts [--notes N] [--folders N] [--files N] [--keys N] [--idle S] [--no-limits]
//
// `--no-limits` só mede (os números de antes). Sai com exit 1 se alguma meta não bateu. Pesado (escreve 150 mil
// arquivos num tmp): pegue `kiwi lock bench` antes.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { ensureBuild, openWindow, type UiContext } from "./ui-page";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const NOTES = arg("notes", 517);
const FOLDERS = arg("folders", 6625);
const FILES = arg("files", 150775);
const KEYS = arg("keys", 120);
const IDLE_S = arg("idle", 10);
const LIMITS = !process.argv.includes("--no-limits");
/**
 * As metas do spec #13384. CPU parado em % de um núcleo; o resto em ms: o eco da tecla (a mediana num quadro de 60 Hz,
 * o p95 em dois), o quadro mais longo digitando (com os saves), o ditado colado aparecendo e o quadro mais longo dele.
 * Antes (rc19, este cofre): eco p95 4.744 ms, quadro 8.416 ms, ditado 1.351 ms.
 */
export const GOALS = { idleCpu: 2, keyEcho: 16, keyEchoP95: 33, keyFrame: 150, dictationEcho: 50, dictationFrame: 100 } as const;

const app = resolve(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "kiwi-perf-"));

/** O cofre do harry em números: pastas até uns 5 níveis, as notas e os arquivos espalhados nelas. */
function bigVault(root: string) {
  const top = Math.max(1, Math.min(60, FOLDERS));
  const dirs: string[] = [];
  for (let i = 0; i < top; i++) dirs.push(`Área ${String(i).padStart(2, "0")}`);
  for (let i = 0; dirs.length < FOLDERS; i++) dirs.push(`${dirs[Math.floor(i / 8)]}/pasta ${i}`);
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  for (let i = 0; i < NOTES; i++) {
    const d = dirs[(i * 7) % dirs.length]!;
    writeFileSync(join(root, d, `Nota ${i}.md`), `# Nota ${i}\n\nUma linha da nota ${i}, com [[Nota ${(i + 1) % NOTES}]] e #tag${i % 9}.\n`);
  }
  const ext = ["pdf", "png", "ts", "json", "txt", "jpg", "docx"];
  for (let i = 0; i < FILES; i++) writeFileSync(join(root, dirs[(i * 13) % dirs.length]!, `arquivo ${i}.${ext[i % ext.length]}`), "x");
  writeFileSync(join(root, "Caixa de entrada.md"), "# Caixa de entrada\n\n");
}

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1" },
  });
  const text = await new Response(p.stdout).text();
  assert.equal(await p.exited, 0, text + (await new Response(p.stderr).text()));
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

/** O tempo de CPU de um processo (usuário + sistema), em segundos, pelo `ps`. */
async function cpuSeconds(pid: number): Promise<number> {
  const p = Bun.spawn(["ps", "-o", "time=", "-p", String(pid)], { stdout: "pipe" });
  const out = (await new Response(p.stdout).text()).trim();
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(out);
  assert.ok(m, `ps: ${out}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
/** Os processos do WebKit headless (o da página, o da rede, o da GPU), pelo caminho do Playwright. */
async function webkitPids(): Promise<number[]> {
  const p = Bun.spawn(["ps", "-A", "-o", "pid=,command="], { stdout: "pipe" });
  return (await new Response(p.stdout).text()).split("\n").filter((l) => /ms-playwright\/webkit/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0])).filter((n) => n > 0);
}
/** A CPU média de vários processos juntos em `seconds`, em % de um núcleo. */
async function cpuPercentAll(pids: number[], seconds: number): Promise<number> {
  const sum = async () => (await Promise.all(pids.map((p) => cpuSeconds(p).catch(() => 0)))).reduce((a, b) => a + b, 0);
  const a = await sum();
  const t = performance.now();
  await Bun.sleep(seconds * 1000);
  return ((await sum()) - a) / ((performance.now() - t) / 1000) * 100;
}
/** A CPU média do processo em `seconds`, em % de um núcleo. */
async function cpuPercent(pid: number, seconds: number): Promise<number> {
  const a = await cpuSeconds(pid);
  const t = performance.now();
  await Bun.sleep(seconds * 1000);
  return ((await cpuSeconds(pid)) - a) / ((performance.now() - t) / 1000) * 100;
}

/** O laço de quadros: guarda o instante de cada quadro, para achar o maior intervalo durante uma ação. */
async function frameMonitor(p: Page) {
  await p.evaluate(() => {
    const w = window as any;
    w.__frames = [] as number[];
    const tick = (t: number) => {
      w.__frames.push(t);
      if (w.__frames.length > 50000) w.__frames.splice(0, 25000);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** O maior intervalo entre quadros desde `since` (o relógio da página), e quantos passaram de 50 ms. */
async function longestFrame(p: Page, since: number): Promise<{ frame: number; long: number }> {
  return p.evaluate((since) => {
    const f: number[] = (window as any).__frames.filter((t: number) => t >= since);
    let frame = 0;
    let long = 0;
    for (let i = 1; i < f.length; i++) {
      const d = f[i]! - f[i - 1]!;
      frame = Math.max(frame, d);
      if (d > 50) long++;
    }
    return { frame, long };
  }, since);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const fails: string[] = [];
function goal(name: string, value: number, limit: number, unit: string) {
  const ok = value <= limit;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${value.toFixed(1)} ${unit} (meta ${limit} ${unit})`);
  if (!ok) fails.push(name);
}

// O build do hub antes de medir: com os fontes mudados, o `openWindow` refaz o Vite, e isso não é o app.
ensureBuild("hub");
const browser = await webkit.launch({ headless: true });
try {
  let t0 = performance.now();
  bigVault(join(data, "vault"));
  console.log(`cofre: ${NOTES} notas, ${FOLDERS} pastas, ${FILES} outros arquivos, escrito em ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  t0 = performance.now();
  await cli(["start", "--no-helper"]);
  // Enquanto indexa, o Bun responde? O `notes.folders` espera o scan acabar (de propósito); enquanto isso, um
  // `settings.get`, que não toca no cofre, a cada 50 ms: o mais lento é o tempo que o Bun ficou preso.
  let indexed = false;
  const folders = invoke("notes.folders").then((c) => { indexed = true; return c; });
  const lag: number[] = [];
  while (!indexed) {
    const t = performance.now();
    await invoke("settings.get");
    lag.push(performance.now() - t);
    await Bun.sleep(50);
  }
  assert.equal((await folders).folders.length, FOLDERS);
  console.log(`0. indexado em ${((performance.now() - t0) / 1000).toFixed(1)} s; o Bun respondendo nesse meio: mediana ${median(lag).toFixed(0)} ms, pior ${Math.max(...lag).toFixed(0)} ms`);
  const st = (await ctx.send({ cmd: "status" })) as { pid?: number; value?: { pid?: number } };
  const pid = st.value?.pid ?? st.pid;
  assert.ok(typeof pid === "number", "o status não trouxe o pid");
  const listed = JSON.stringify(await invoke("notes.list"));
  let tl = performance.now();
  for (let i = 0; i < 5; i++) await invoke("notes.list");
  console.log(`notes.list: ${(listed.length / 1e6).toFixed(1)} MB, ${((performance.now() - tl) / 5).toFixed(0)} ms por chamada (pelo socket)`);
  // O que roda logo depois de indexar (a conferência do watcher, o OCR) passa antes de medir o parado.
  await Bun.sleep(3000);

  // 1. Parado, com o hub fechado.
  const idleClosed = await cpuPercent(pid, IDLE_S);
  console.log(`1a. o Bun parado, hub fechado: ${idleClosed.toFixed(1)} % de CPU em ${IDLE_S} s`);

  const to = performance.now();
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 800, motion: true, browser: "webkit", query: { section: "notes" } }, 60000);
  const p = w.page;
  await p.waitForSelector(".cm-content", { timeout: 60000 });
  console.log(`   abrir o hub nas Notas, até o editor: ${(performance.now() - to).toFixed(0)} ms; chamadas: ${JSON.stringify(w.report.invokes)}`);
  await Bun.sleep(3000);
  const wk = await webkitPids();
  const [idleOpen, idleWeb] = await Promise.all([cpuPercent(pid, IDLE_S), cpuPercentAll(wk, IDLE_S)]);
  console.log(`1b. parado, hub aberto nas Notas: o Bun ${idleOpen.toFixed(1)} %, o WebKit ${idleWeb.toFixed(1)} % (${wk.length} processos) de CPU em ${IDLE_S} s`);

  // 2. Digitar: uma tecla a cada 90 ms (uns 130 caracteres por minuto), com uma pausa de 700 ms a cada 30 (o save).
  await p.click(".cm-content");
  await p.keyboard.press("Meta+ArrowDown");
  await frameMonitor(p);
  await p.evaluate(() => {
    const w = window as any;
    w.__echo = [] as number[];
    const ed = document.querySelector(".cm-content")!;
    let len = ed.textContent?.length ?? 0;
    new MutationObserver(() => {
      const n = ed.textContent?.length ?? 0;
      if (n === len) return;
      len = n;
      requestAnimationFrame(() => w.__echo.push(performance.timeOrigin + performance.now()));
    }).observe(ed, { subtree: true, childList: true, characterData: true });
  });
  const before = { ...w.report.invokes };
  const since = await p.evaluate(() => performance.now());
  const sent: number[] = [];
  const text = "Uma frase ditada ou digitada na nota, para ver se o editor acompanha. ";
  for (let i = 0; i < KEYS; i++) {
    sent.push(performance.timeOrigin + performance.now());
    await p.keyboard.type(text[i % text.length]!);
    await Bun.sleep(i % 30 === 29 ? 700 : 90);
  }
  await Bun.sleep(1500);
  const echoes: number[] = await p.evaluate(() => (window as any).__echo);
  const echo = sent.map((s) => (echoes.find((e) => e >= s) ?? Infinity) - s).filter((x) => Number.isFinite(x));
  const typing = await longestFrame(p, since);
  const calls = Object.fromEntries(Object.entries(w.report.invokes).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
  console.log(`2. digitar ${KEYS} teclas: eco mediana ${median(echo).toFixed(1)} ms, p95 ${pct(echo, 0.95).toFixed(1)} ms, pior ${Math.max(...echo).toFixed(0)} ms; quadro mais longo ${typing.frame.toFixed(0)} ms, ${typing.long} acima de 50 ms`);
  console.log(`   chamadas da tela enquanto digitava: ${JSON.stringify(calls)}`);

  // 3. Um ditado numa nota do Kiwi: o texto chega de uma vez no editor (o que a colagem do helper faz), e o save vem
  // 500 ms depois. O STT e a colagem são do helper (`swift test`); aqui, o que o app faz com o texto.
  const since3 = await p.evaluate(() => performance.now());
  const dictCpu0 = await cpuSeconds(pid);
  const sentD = performance.timeOrigin + performance.now();
  await p.keyboard.insertText("Uma nota ditada para medir o app, com umas palavras a mais e uma vírgula, como o harry fala. ");
  await Bun.sleep(2500);
  const echoD = ((await p.evaluate(() => (window as any).__echo)) as number[]).find((e) => e >= sentD)! - sentD;
  const dict = await longestFrame(p, since3);
  console.log(`3. um ditado colado na nota: o texto na tela em ${echoD.toFixed(1)} ms; ${((await cpuSeconds(pid)) - dictCpu0).toFixed(2)} s de CPU do Bun com o save; quadro mais longo ${dict.frame.toFixed(0)} ms, ${dict.long} acima de 50 ms`);

  if (w.report.problems.length) console.log("problemas:", w.report.problems.slice(0, 5));
  await w.close();

  if (LIMITS) {
    goal("CPU parado, hub fechado", idleClosed, GOALS.idleCpu, "%");
    goal("CPU parado, Notas abertas", idleOpen, GOALS.idleCpu, "%");
    goal("CPU parado do WebKit, Notas abertas", idleWeb, GOALS.idleCpu, "%");
    goal("eco da tecla (mediana)", median(echo), GOALS.keyEcho, "ms");
    goal("eco da tecla (p95)", pct(echo, 0.95), GOALS.keyEchoP95, "ms");
    goal("quadro mais longo digitando", typing.frame, GOALS.keyFrame, "ms");
    goal("o ditado colado aparecendo", echoD, GOALS.dictationEcho, "ms");
    goal("quadro mais longo no ditado", dict.frame, GOALS.dictationFrame, "ms");
  }
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  rmSync(data, { recursive: true, force: true });
}
if (fails.length && LIMITS) {
  console.log(`FALHOU: ${fails.join(", ")}`);
  process.exit(1);
}
console.log(LIMITS ? "ok: todas as metas" : "medido (sem conferir as metas)");
