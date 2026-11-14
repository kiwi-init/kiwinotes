// A troca entre os balões do gato (spec #11652, T11683): proposta → pergunta → resposta → aviso, no hub de verdade,
// com o AppEngine headless e o agente falso, num WebKit headless. As notas são de teste, num tmp; nada na tela de
// ninguém. Mede quadro a quadro (requestAnimationFrame) a opacidade e a escala de cada lugar de balão:
// - nenhum quadro de troca sem balão (enquanto um sai e outro entra, um deles está visível);
// - nunca dois balões cheios no mesmo quadro;
// - com o Reduzir movimento, só o esmaecer de 120 ms, sem escala (e sem corte seco).
// E o tempo de CPU dos processos do WebKit na sequência (para comparar com a `main`, rode `--cpu-only` lá).
//
//   bun scripts/kiwicat-bubble-swap-check.ts [pasta] [--cpu-only]
// Pegue `kiwi lock bench` antes (a CPU é medida).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const argv = process.argv.slice(2);
const cpuOnly = argv.includes("--cpu-only");
const app = resolve(import.meta.dir, "..");
const out = resolve(argv.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "kiwi-T11683-swap"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-bubble-swap-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
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
async function idle() {
  for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 300); await Bun.sleep(100); }
}

/** O tempo de CPU (s) de cada processo do WebKit do Playwright: só os dele, nunca o WebKit de outro app. */
function webkitCpu(): Map<number, number> {
  const ps = Bun.spawnSync(["ps", "-Ao", "pid=,time=,command="], { stdout: "pipe" });
  const out = new Map<number, number>();
  for (const line of new TextDecoder().decode(ps.stdout).split("\n")) {
    const m = /^\s*(\d+)\s+([\d:.]+)\s+(.*)$/.exec(line);
    if (!m || !m[3]!.includes("ms-playwright/webkit")) continue;
    let s = 0;
    for (const v of m[2]!.split(":").map(Number)) s = s * 60 + v;
    out.set(Number(m[1]), s);
  }
  return out;
}
/** O que os processos gastaram entre as duas medidas (só os que existem nas duas: um que fechou no meio não conta). */
const cpuDelta = (a: Map<number, number>, b: Map<number, number>) => [...b].reduce((n, [pid, s]) => n + (a.has(pid) ? s - a.get(pid)! : s), 0);

/** Espera um balão vivo do canto (não o que está saindo), pela classe. */
async function live(p: Page, sel: string, timeout = 30000) {
  await p.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => !e.closest('[data-phase="exit"]')), sel, { timeout });
}

type Slot = { phase: string; op: number; sc: number; kind: string; anim: string; vw: number; lw: number; vh: number; lh: number };
type Frame = { t: number; slots: Slot[] };
async function startSampler(p: Page) {
  await p.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    w.__sampling = true;
    const t0 = performance.now();
    // Lido logo depois da pintura do quadro (uma tarefa depois do rAF): é o que se viu. Dentro do rAF a leitura viria antes
    // do layout e do ResizeObserver do quadro, e veria o tamanho novo antes do FLIP que o quadro pinta.
    const read = () => {
      const slots = [...document.querySelectorAll(".kn-bubble-slot")].map((s) => {
        const cs = getComputedStyle(s);
        const m = cs.transform === "none" ? null : new DOMMatrixReadOnly(cs.transform);
        const c = (s.firstElementChild as HTMLElement | null)?.className ?? "";
        const kind = c.includes("kn-cat-ask") ? "pergunta" : c.includes("kn-proposal") ? "proposta" : c.includes("kn-memory") ? "memoria" : "resposta";
        // O tamanho da casca: o visto (com o FLIP) e o do layout.
        const shell = s.firstElementChild as HTMLElement | null;
        const r = shell?.getBoundingClientRect();
        const k = m ? m.a : 1;
        return { phase: (s as HTMLElement).dataset.phase ?? "", op: Number(cs.opacity), sc: k, kind, anim: cs.animationName,
          vw: r ? r.width / k : 0, lw: shell?.offsetWidth ?? 0, vh: r ? r.height / k : 0, lh: shell?.offsetHeight ?? 0 };
      });
      w.__frames.push({ t: performance.now() - t0, slots });
    };
    const tick = () => {
      setTimeout(read, 0);
      if (w.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopSampler(p: Page): Promise<Frame[]> {
  return p.evaluate(() => {
    (window as any).__sampling = false;
    return (window as any).__frames;
  });
}

/** Proposta → pergunta → resposta → aviso. */
async function sequence(p: Page) {
  await invoke("agent.ask", { text: "faz o resumo executivo do projeto Migração" });
  await idle();
  await live(p, ".kn-proposal-bubble");
  await Bun.sleep(1500);
  await p.locator(".kn-kiwicat-hit").click();
  await live(p, ".kn-cat-ask");
  await Bun.sleep(400);
  await p.keyboard.type("/conta Pronto: o resumo está no balão; quer que eu leia a reunião também?", { delay: 8 });
  await Bun.sleep(500);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => {
    const b = [...document.querySelectorAll(".kn-bubble")].find((e) => !e.closest('[data-phase="exit"]') && !e.matches(".kn-proposal-bubble, .kn-memory-bubble"));
    const g = b?.querySelector(".kn-bubble-ghost")?.textContent;
    return !!g && b!.querySelector(".kn-bubble-typed")?.textContent === g;
  }, undefined, { timeout: 30000 });
  await Bun.sleep(900);
  await invoke("agent.ask", { text: "/limite" });
  await live(p, ".kn-bubble[data-error]");
  await Bun.sleep(1500);
  // O texto chegando aos poucos: a caixa cresce suave (o FLIP). No hub headless o balão do agente falso já aparece com o
  // trecho inteiro (o aviso KNOWN do kiwicat-bubble-check), então a caixa cresce aqui pelo texto invisível que dá o tamanho
  // dela (`.kn-bubble-ghost`): uma linha a mais, como um pedaço novo que chega.
  await idle();
  await invoke("agent.ask", { text: "/conta Um pedaço que chegou." });
  await p.waitForFunction(() => [...document.querySelectorAll(".kn-bubble-ghost")].some((g) => !g.closest('[data-phase="exit"]') && g.textContent?.includes("Um pedaço")), undefined, { timeout: 30000 });
  await Bun.sleep(500);
  await p.evaluate(() => {
    const g = [...document.querySelectorAll(".kn-bubble-ghost")].find((x) => !x.closest('[data-phase="exit"]'));
    g?.append(document.createTextNode(" E mais um pedaço, que chega depois e passa para a linha de baixo."));
  });
  await Bun.sleep(600);
}

/** A caixa da resposta crescendo: o maior salto de tamanho (largura ou altura) entre dois quadros, no layout e no que se vê. */
function growth(frames: Frame[]) {
  let layout = 0, seen = 0, changes = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!.slots.find((s) => s.kind === "resposta" && s.phase === "enter" && s.op > 0.9);
    const b = frames[i]!.slots.find((s) => s.kind === "resposta" && s.phase === "enter" && s.op > 0.9);
    if (!a || !b) continue;
    const dl = Math.max(Math.abs(b.lw - a.lw), Math.abs(b.lh - a.lh)), dv = Math.max(Math.abs(b.vw - a.vw), Math.abs(b.vh - a.vh));
    if (dl >= 4) changes++;
    layout = Math.max(layout, dl);
    seen = Math.max(seen, dv);
  }
  return { changes, maxLayoutJump: Math.round(layout), maxSeenJump: Math.round(seen) };
}

/** As trocas: quadros com um balão saindo e outro entrando. */
function analyse(frames: Frame[]) {
  const vis = (f: Frame) => Math.max(0, ...f.slots.map((s) => s.op));
  const twoFull = frames.filter((f) => f.slots.filter((s) => s.op > 0.9).length >= 2);
  const swapFrames = frames.filter((f) => f.slots.some((s) => s.phase === "exit") && f.slots.some((s) => s.phase === "enter"));
  // As trocas seguidas viram uma (quadros a menos de 50 ms um do outro).
  const swaps: { from: string; to: string; start: number; end: number; minVisible: number; frames: number }[] = [];
  for (const f of swapFrames) {
    const last = swaps.at(-1);
    const from = f.slots.find((s) => s.phase === "exit")!.kind, to = f.slots.find((s) => s.phase === "enter")!.kind;
    if (last && f.t - last.end < 50) { last.end = f.t; last.minVisible = Math.min(last.minVisible, vis(f)); last.frames++; }
    else swaps.push({ from, to, start: f.t, end: f.t, minVisible: vis(f), frames: 1 });
  }
  // Os quadros vazios depois que o primeiro balão apareceu (com o tempo e o que veio antes e depois).
  const first = frames.findIndex((f) => vis(f) > 0.02);
  const empties: { t: number; ms: number; after: string; before: string }[] = [];
  for (let i = Math.max(first, 0); i < frames.length; i++) {
    if (vis(frames[i]!) > 0.02) continue;
    let j = i;
    while (j + 1 < frames.length && vis(frames[j + 1]!) <= 0.02) j++;
    const before = frames[i - 1]?.slots.map((s) => s.kind).join("+") ?? "";
    const after = frames[j + 1]?.slots.map((s) => s.kind).join("+") ?? "(fim)";
    empties.push({ t: Math.round(frames[i]!.t), ms: Math.round(frames[j]!.t - frames[i]!.t + 16), after: before, before: after });
    i = j;
  }
  const detail = twoFull.slice(0, 6).map((f) => ({ t: Math.round(f.t), slots: f.slots.map((s) => `${s.kind}:${s.phase}:${s.op.toFixed(2)}`) }));
  const lowSwap = swapFrames.filter((f) => vis(f) < 0.3).slice(0, 6).map((f) => ({ t: Math.round(f.t), slots: f.slots.map((s) => `${s.kind}:${s.phase}:${s.op.toFixed(2)}:${s.anim}`) }));
  return { frames: frames.length, twoFull: twoFull.length, twoFullDetail: detail, lowSwap, swaps: swaps.map((s) => ({ ...s, start: Math.round(s.start), end: Math.round(s.end), minVisible: +s.minVisible.toFixed(3) })), empties };
}

const browser = await webkit.launch({ headless: true });
const report: Record<string, unknown> = { scope: "WebKit headless hub with the fake ACP agent; no native app", cpuOnly };
const problems: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Projetos/Migração", title: "Migração", content: "# Migração\n\nA migração do arquivo antigo para o PACS novo.\n" });
  await invoke("projects.mark", { folder: "Projetos/Migração" });
  await invoke("notes.create", { folder: "Projetos/Migração", title: "2026-11-10 · Cronograma", content: "---\ntype: meeting\ndate: 2026-11-10\nstart: 2026-11-10T10:00:00.000Z\nend: 2026-11-10T10:45:00.000Z\nduration: 2700\napp: Zoom\nparticipants:\n  - Ana\n---\n\n## Transcrição\n\n**Ana** (00:00): Começamos pelo arquivo de 2019.\n" });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  const runs = cpuOnly ? (["light"] as const) : (["light", "dark", "reduced"] as const);
  for (const run of runs) {
    const dark = run !== "light";
    await invoke("settings.set", { appearance: { mode: dark ? "dark" : "light", darkTheme: "channels-oled", lightTheme: "channels-light", textSize: "default", font: "system", motion: run === "reduced" ? "reduced" : "full" } });
    const videoDir = join(out, `video-${run}`);
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: dark ? "dark" : "light", width: 900, height: 620, motion: run !== "reduced", browser: "webkit", query: { section: "about" }, ...(cpuOnly || run === "reduced" ? {} : { video: videoDir }) });
    const p = w.page;
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
    // Uma proposta de antes (a rodada anterior) sai primeiro: começa limpo.
    await Bun.sleep(500);
    if (!cpuOnly) await startSampler(p);
    const cpu0 = webkitCpu(), t0 = performance.now();
    await sequence(p);
    const cpu = cpuDelta(cpu0, webkitCpu()), secs = (performance.now() - t0) / 1000;
    report[`cpu-${run}`] = { seconds: +secs.toFixed(2), cpuSeconds: +cpu.toFixed(2), percentOfCore: +((cpu / secs) * 100).toFixed(1) };
    if (!cpuOnly) {
      const frames = await stopSampler(p);
      writeFileSync(join(out, `quadros-${run}.json`), JSON.stringify(frames));
      const a = analyse(frames);
      report[run] = a;
      if (a.twoFull) problems.push(`${run}: ${a.twoFull} quadro(s) com dois balões cheios`);
      for (const s of a.swaps) if (s.minVisible < 0.3) problems.push(`${run}: a troca ${s.from} → ${s.to} chega a ${s.minVisible} de opacidade`);
      if (run !== "reduced") {
        const g = growth(frames);
        report[`${run}-growth`] = g;
        if (!g.changes) problems.push(`${run}: a caixa da resposta não mudou de tamanho`);
        else if (g.maxSeenJump > g.maxLayoutJump * 0.6) problems.push(`${run}: a caixa salta (${g.maxSeenJump} px num quadro; o layout salta ${g.maxLayoutJump})`);
      }
      if (run === "reduced") {
        const scaled = frames.flatMap((f) => f.slots).filter((s) => Math.abs(s.sc - 1) > 0.001);
        if (scaled.length) problems.push(`reduced: ${scaled.length} amostra(s) com escala`);
        // A entrada e a saída são o esmaecer da Web Animations (o base.css corta as do CSS com o Reduzir movimento): sem
        // escala (acima), e com quadros no meio do esmaecer (não um corte seco).
        const fading = frames.filter((f) => f.slots.some((s) => s.op > 0.05 && s.op < 0.95)).length;
        report["reduced-fading-frames"] = fading;
        if (!fading) problems.push("reduced: nenhum quadro no meio do esmaecer (a troca foi seca)");
      }
    }
    problems.push(...w.report.problems.map((m) => `${run}: ${m}`));
    await w.close();
    if (!cpuOnly && run !== "reduced") {
      const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
      if (webm) {
        const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=900:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, `trocas-${run}.mp4`)]);
        if (ff.exitCode !== 0) problems.push(`ffmpeg: ${ff.stderr.toString()}`);
      }
      rmSync(videoDir, { recursive: true, force: true });
    }
  }
  report.problems = problems;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(problems, []);
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
