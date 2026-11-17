// As rotinas do agente (spec #12150, T12188–T12191): os dois cartões em Ajustes › Agente, desligados, no claro e no escuro;
// ligar o resumo do dia pela tela, e o relógio falso passar das 18h: a rotina roda sozinha, a nota nasce pela escrita de
// sempre e o balão traz [Ver] [Manter] [Descartar]; o "Rodar agora" dos pendentes da semana. No hub de verdade, com o
// AppEngine headless, o agente falso e o relógio de teste do headless (`KIWI_CLOCK_START`), num WebKit headless. Nada na
// tela de ninguém, e nenhum Claude Code de verdade.
//
//   bun scripts/routines-check.ts [pasta]
//
// Sai na pasta: `rotinas.webp` (a folha com os prints) e `rotinas.mp4` (o vídeo da rotina rodando sozinha).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T12150-routines"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-routines-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
/** Segunda, 16/11/2026, 17:59 no relógio do Mac: a preparação e os prints cabem antes das 18h, e a rotina passa logo. */
const CLOCK = "2026-11-16T17:59:00";
/** Quando o headless subiu: o relógio de teste anda junto com o de verdade a partir daí (um pouco depois, no máximo). */
let booted = 0;
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages, KIWI_CLOCK_START: CLOCK, KIWI_ROUTINE_TICK_MS: "500" },
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

const shots: { file: string; caption: string }[] = [];
async function shot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(300);
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  await p.locator(sel).first().screenshot({ path: join(out, file) });
  shots.push({ file, caption });
}
/** O recorte do canto do gato: o balão e o gato juntos. */
async function cornerShot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(300);
  const b = await p.locator(sel).first().boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16;
  const y = Math.min(b.y, c.y) - 16;
  await p.screenshot({ path: join(out, file), clip: { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 } });
  shots.push({ file, caption });
}

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  booted = Date.now();
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Kiwi", title: "Kiwi", content: "# Kiwi\n\n- [ ] Rever o prazo\n" });
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  // 1. Os dois cartões, desligados, no claro e no escuro.
  const cards = ".kn-agent-routines";
  for (const theme of ["dark", "light"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 1400, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    await w.page.waitForSelector(`${cards} .kn-routine-card[data-routine=weekly]`, { timeout: 15000 });
    for (const kind of ["daily", "weekly"]) assert.equal(await w.page.locator(`.kn-routine-card[data-routine=${kind}] [role=switch]`).getAttribute("aria-checked"), "false", `${kind} desligada`);
    const text = (await w.page.locator(cards).textContent()) ?? "";
    assert.ok(text.includes("Rodar agora") && text.includes("Gasta um pedido do seu plano") && text.includes("Ainda não rodou."), text);
    await shot(w.page, cards, `1-cartoes-${theme}.png`, `1. Ajustes › Agente › Rotinas: as duas desligadas (${theme === "light" ? "claro" : "escuro"})`);
    report.problems.push(...w.report.problems);
    await w.close();
  }
  report.checks.push("Settings › Agent › Rotinas shows the two cards, off, with the time, the folder, the cost and Rodar agora (light and dark)");

  // 2. Ligar o resumo do dia pela tela; o relógio passa das 18h e a rotina roda sozinha.
  const videoDir = join(out, "video");
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 820, motion: true, browser: "webkit", query: { section: "settings", topic: "agent" }, video: videoDir });
  const p = h.page;
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
  await ctx.send({ cmd: "hubView", view: true });
  const daily = ".kn-routine-card[data-routine=daily]";
  // Ligar antes das 18h do relógio de teste: depois, a rotina só rodaria amanhã (ligar não dispara um horário que passou).
  assert.ok(Date.now() - booted < 55_000, `a preparação levou ${Math.round((Date.now() - booted) / 1000)} s: o relógio de teste já passou das 18h`);
  await p.locator(daily).scrollIntoViewIfNeeded();
  await p.locator(`${daily} [role=switch]`).click();
  await p.waitForSelector(`${daily} [role=switch][aria-checked=true]`, { timeout: 15000 });
  assert.equal((await invoke("agent.status")).routines.daily.on, true);
  await p.waitForFunction(() => document.querySelector(".kn-routine-bubble")?.textContent?.includes("O resumo do dia está pronto: Resumo de 16-11-2026."), undefined, { timeout: 90000 });
  await idle();
  // O balão da resposta do pedido vem antes; o da rotina espera ele sair, como os outros balões do canto.
  await p.waitForSelector(".kn-routine-bubble button:has-text('Descartar')", { timeout: 30000 });
  const note = (await invoke("notes.get", { path: "Rotinas/Resumo de 16-11-2026.md" })).content as string;
  assert.ok(note.includes("## Próximos passos"), note);
  const req = (await invoke("agent.activity", {})).requests[0];
  assert.ok(req.request.startsWith("[Rotina do Kiwi]") && req.changes[0]?.path === "Rotinas/Resumo de 16-11-2026.md", JSON.stringify(req));
  assert.deepEqual(await p.locator(".kn-routine-bubble button").allTextContents(), ["Ver", "Manter", "Descartar"]);
  await cornerShot(p, ".kn-routine-bubble", "2-pronto.png", "2. Às 18h, sozinha: o balão com [Ver] [Manter] [Descartar]");
  await p.locator(".kn-routine-bubble button:has-text('Ver')").click();
  await p.waitForSelector(".kn-routine-view .kn-diff, .kn-routine-view pre, .kn-routine-view", { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector(".kn-routine-view")?.textContent?.includes("Próximos passos"), undefined, { timeout: 15000 });
  await cornerShot(p, ".kn-routine-bubble", "3-ver.png", "3. [Ver]: o que a nota tem");
  await p.locator(".kn-routine-bubble button:has-text('Manter')").click();
  await p.waitForSelector(".kn-routine-bubble", { state: "detached", timeout: 5000 });
  // O cartão diz a data pelo relógio do Mac, e o relógio de teste só existe no serviço: aqui confere a hora.
  await p.waitForFunction(() => /Todo dia às 18:00\. Rodou .* às 18:0\d\./.test(document.querySelector(".kn-routine-card[data-routine=daily] .kn-routine-last")?.textContent ?? ""), undefined, { timeout: 15000 });
  await shot(p, daily, "4-rodou.png", "4. O cartão: ligado, e a última vez que rodou");
  report.checks.push("turning on the daily summary in the UI: at 18:00 on the fake clock it runs by itself, the note is created by the normal write (Atividade), and the bubble has [Ver] [Manter] [Descartar]; [Ver] shows the note; the card shows the last run");

  // 3. "Rodar agora" nos pendentes da semana, desligados.
  const weekly = ".kn-routine-card[data-routine=weekly]";
  await p.locator(`${weekly} button:has-text('Rodar agora')`).click();
  await p.waitForFunction(() => document.querySelector(".kn-routine-bubble")?.textContent?.includes("Os pendentes da semana estão prontos"), undefined, { timeout: 60000 });
  await idle();
  await p.waitForSelector(".kn-routine-bubble button:has-text('Descartar')", { timeout: 30000 });
  assert.ok((await invoke("notes.get", { path: "Rotinas/Pendentes da semana de 16-11-2026.md" })).content.includes("- [ ]"));
  await cornerShot(p, ".kn-routine-bubble", "5-rodar-agora.png", "5. \"Rodar agora\" nos pendentes da semana");
  await p.locator(".kn-routine-bubble button:has-text('Manter')").click();
  report.checks.push("Rodar agora runs the weekly routine even when it is off, and the bubble says it is ready");

  // 4. Desligar o agente desliga as rotinas.
  await invoke("agent.disable");
  const st = await invoke("agent.status");
  assert.deepEqual([st.routines.daily.on, st.routines.weekly.on], [false, false]);
  report.checks.push("turning the agent off turns both routines off");
  report.problems.push(...h.report.problems);
  await h.close();

  // A folha em WebP e o vídeo em mp4.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 20px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">As rotinas do agente (spec #12150)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:8px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "rotinas.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=980:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "rotinas.mp4")]);
    if (ff.exitCode !== 0) report.problems.push(`ffmpeg: ${ff.stderr.toString()}`);
  }
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
