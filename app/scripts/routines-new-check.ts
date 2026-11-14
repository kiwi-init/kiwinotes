// As rotinas novas (spec #12944, T13010): pelo botão "Nova rotina" e pedindo ao agente. No hub de verdade, com o
// AppEngine headless, o agente falso e o relógio de teste do headless (`KIWI_CLOCK_START`), num WebKit headless. Nada na
// tela de ninguém, e nenhum Claude Code de verdade.
//
// 1. Uma rotina nova, ligada, roda às 18h do relógio falso, como as prontas: a nota nasce e o balão diz o nome dela.
// 2. Ajustes › Agente › Rotinas: a linha dos dois caminhos e o botão "Nova rotina"; o cartão cria a rotina desligada;
//    editar e ligar; apagar (claro e escuro).
// 3. Pedir ao agente ("todo dia às 7h, …"): a proposta no balão do gato com [Criar] [Ajustar] [Descartar]; [Criar] a cria
//    desligada. [Ajustar] abre o mesmo cartão em Ajustes, preenchido; salvar cria com o que a pessoa mudou.
//
//   bun scripts/routines-new-check.ts [pasta]
//
// Sai na pasta: `rotinas-novas.webp` (a folha com os prints).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T13010-routines"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-routines-new-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
/** Segunda, 16/11/2026, 17:59 no relógio do Mac: a rotina das 18h é ligada antes e passa logo. */
const CLOCK = "2026-11-16T17:59:00";
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
  send: async (msg) => {
    const r = await request(data, msg);
    assert.ok(r);
    return r;
  },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => {
      if (!("id" in line)) onMsg(line);
    });
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
  for (let n = 0; (await invoke("agent.status")).busy; n++) {
    assert.ok(n < 300);
    await Bun.sleep(100);
  }
}
const custom = async () => (await invoke("agent.status")).routines.custom as { id: string; name: string; time: string; days: unknown; on: boolean }[];

const shots: { file: string; caption: string }[] = [];
async function shot(p: Page, sel: string, file: string, caption: string) {
  await Bun.sleep(300);
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  await p.locator(sel).first().screenshot({ path: join(out, file) });
  shots.push({ file, caption });
}
/**
 * O balão parado: nenhum saindo (a troca entre os balões acabou), o de `sel` inteiro na tela, e assim por 600 ms. Sem
 * isso, o print pega a passagem, com o texto de trás atravessando o balão (revisão do lead, #13102).
 */
async function settled(p: Page, sel: string) {
  const still = () =>
    p.evaluate((s) => {
      const el = document.querySelector(s);
      const slot = el?.closest(".kn-bubble-slot");
      const exiting = document.querySelector('.kn-bubble-slot[data-phase="exit"]');
      return !!slot && !exiting && slot.getAttribute("data-phase") !== "exit" && Number(getComputedStyle(slot).opacity) > 0.99;
    }, sel);
  for (let n = 0, since = 0; ; n++) {
    assert.ok(n < 200, `${sel} não parou`);
    if (await still()) {
      if (since && Date.now() - since >= 600) return;
      since ||= Date.now();
    } else since = 0;
    await Bun.sleep(50);
  }
}
/** O recorte do canto do gato: o balão e o gato juntos, com o balão parado. */
async function cornerShot(p: Page, sel: string, file: string, caption: string) {
  await settled(p, sel);
  const b = await p.locator(sel).first().boundingBox();
  const c = await p.locator(".kn-kiwicat").boundingBox();
  assert.ok(b && c, `${sel} e o gato na tela`);
  const x = Math.min(b.x, c.x) - 16;
  const y = Math.min(b.y, c.y) - 16;
  await p.screenshot({ path: join(out, file), clip: { x, y, width: Math.max(b.x + b.width, c.x + c.width) - x + 16, height: Math.max(b.y + b.height, c.y + c.height) - y + 16 } });
  shots.push({ file, caption });
}
/** Preenche o cartão aberto. */
async function fill(p: Page, o: { name?: string; prompt?: string; time?: string; days?: string }) {
  const card = p.locator(".kn-routine-editor");
  if (o.name !== undefined) await card.locator("input.kn-input").fill(o.name);
  if (o.prompt !== undefined) await card.locator("textarea").fill(o.prompt);
  if (o.time) await card.locator('select[aria-label$="a hora"]').selectOption(o.time);
  if (o.days) await card.locator('select[aria-label$="os dias"]').selectOption(o.days);
}

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  booted = Date.now();
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Kiwi", title: "Kiwi", content: "# Kiwi\n\n- [ ] Rever o prazo\n" });
  await invoke("agent.enable", { consent: true });
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) {
    assert.ok(n < 200);
    await Bun.sleep(100);
  }

  // 1. Uma rotina nova, ligada antes das 18h do relógio falso: às 18h ela roda sozinha.
  await invoke("agent.routineCreate", { name: "Resumo das reuniões", prompt: "Faz um resumo das reuniões do dia.", time: "18:00", days: "every", folder: "Rotinas" });
  const first = (await custom())[0]!;
  assert.equal(first.on, false, "entra desligada");
  assert.ok(Date.now() - booted < 50_000, `a preparação levou ${Math.round((Date.now() - booted) / 1000)} s: o relógio de teste já passou das 18h`);
  await invoke("agent.routineUpdate", { id: first.id, on: true });
  const h = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 980, height: 900, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
  const p = h.page;
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
  await ctx.send({ cmd: "hubView", view: true });
  await p.waitForFunction(() => document.querySelector(".kn-routine-bubble")?.textContent?.includes("A rotina “Resumo das reuniões” está pronta: Resumo das reuniões de 16-11-2026."), undefined, { timeout: 90000 });
  await idle();
  await p.waitForSelector(".kn-routine-bubble button:has-text('Descartar')", { timeout: 30000 });
  const note = (await invoke("notes.get", { path: "Rotinas/Resumo das reuniões de 16-11-2026.md" })).content as string;
  assert.ok(note.length > 0);
  const req = (await invoke("agent.activity", {})).requests[0];
  assert.ok(req.request.startsWith("[Rotina do Kiwi] Resumo das reuniões, 16/11/2026.") && req.request.includes("Faz um resumo das reuniões do dia."), req.request);
  await cornerShot(p, ".kn-routine-bubble", "1-rodou.png", "1. A rotina nova, ligada, roda às 18h do relógio falso");
  await p.locator(".kn-routine-bubble button:has-text('Manter')").click();
  await p.waitForSelector(".kn-routine-bubble", { state: "detached", timeout: 5000 });
  report.checks.push("a new routine, turned on, runs at 18:00 on the fake clock like the built-in ones: the note is created by the normal write, and the bubble says its name");

  // 2. A tela: os dois caminhos e "Nova rotina"; o cartão cria a rotina desligada; editar, ligar e apagar.
  const box = ".kn-agent-routines";
  const paths = (await p.locator(".kn-routine-paths").textContent()) ?? "";
  assert.ok(paths.includes("Nova rotina") && paths.includes("Kiwi Cat"), paths);
  await p.locator(`${box} button:has-text('Nova rotina')`).click();
  await p.waitForSelector(".kn-routine-editor", { timeout: 5000 });
  await fill(p, { name: "Pendentes do dia", prompt: "Junta as caixas em aberto das notas de hoje, por projeto.", time: "08:30", days: "chosen" });
  // Os dias escolhidos: segunda, quarta e sexta (os dias úteis vêm marcados; tira terça e quinta).
  for (const d of ["Terça", "Quinta"]) await p.locator(`.kn-routine-day[aria-label=${d}]`).click();
  await shot(p, ".kn-routine-editor", "2-cartao.png", "2. \"Nova rotina\": o cartão, com os dias escolhidos");
  await p.locator(".kn-routine-editor button:has-text('Criar')").click();
  await p.waitForSelector(".kn-routine-editor", { state: "detached", timeout: 5000 });
  const made = (await custom()).find((r) => r.name === "Pendentes do dia")!;
  assert.deepEqual([made.time, made.days, made.on], ["08:30", [1, 3, 5], false]);
  const card = `.kn-routine-card[data-routine=${made.id}]`;
  await p.waitForSelector(card, { timeout: 5000 });
  assert.equal(await p.locator(`${card} [role=switch]`).getAttribute("aria-checked"), "false");
  assert.ok(((await p.locator(`${card} .kn-routine-last`).textContent()) ?? "").includes("Desligada (seg, qua e sex às 08:30)."));
  // Editar o nome e ligar.
  await p.locator(`${card} button:has-text('Editar')`).click();
  await fill(p, { name: "Pendentes de hoje" });
  await p.locator(".kn-routine-editor button:has-text('Salvar')").click();
  await p.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("aria-label") === "Pendentes de hoje", card, { timeout: 5000 });
  await p.locator(`${card} [role=switch]`).click();
  await p.waitForSelector(`${card} [role=switch][aria-checked=true]`, { timeout: 5000 });
  assert.equal((await custom()).find((r) => r.id === made.id)!.on, true);
  report.checks.push("Settings › Agent › Rotinas says both ways (the button and asking the Kiwi Cat); Nova rotina creates a routine off, with the chosen days; edit and turn it on");

  // 3. Pedir ao agente: a proposta no balão, com [Criar] [Ajustar] [Descartar].
  await invoke("agent.ask", { text: "todo dia às 7h, faz a lista do que vence hoje" });
  await p.waitForSelector(".kn-proposal-bubble button:has-text('Ajustar')", { timeout: 60000 });
  await idle();
  const line = (await p.locator(".kn-proposal-bubble .kn-proposal-line").textContent()) ?? "";
  assert.equal(line, "O Kiwi Cat propõe a rotina “A lista do que vence hoje”: todo dia às 07:00. Ela entra desligada.");
  assert.deepEqual(await p.locator(".kn-proposal-bubble .kn-proposal-actions button").allTextContents(), ["Criar", "Ajustar", "Descartar"]);
  await cornerShot(p, ".kn-proposal-bubble", "3-proposta.png", "3. Pedindo ao Kiwi Cat: a proposta no balão");
  // [Ajustar]: o cartão em Ajustes, preenchido; a pessoa muda a hora e cria.
  await p.locator(".kn-proposal-bubble button:has-text('Ajustar')").click();
  await p.waitForSelector('.kn-routine-editor[aria-label^="Ajustar"]', { timeout: 10000 });
  // O balão da proposta sai: o cartão é o lugar dela agora.
  await p.waitForSelector(".kn-proposal-bubble", { state: "detached", timeout: 5000 });
  assert.equal(await p.locator(".kn-routine-editor input.kn-input").inputValue(), "A lista do que vence hoje");
  await fill(p, { time: "07:30", days: "weekdays" });
  await shot(p, ".kn-routine-editor", "4-ajustar.png", "4. [Ajustar]: o mesmo cartão, preenchido pela proposta");
  await p.locator(".kn-routine-editor button:has-text('Criar')").click();
  await p.waitForSelector(".kn-routine-editor", { state: "detached", timeout: 5000 });
  const adjusted = (await custom()).find((r) => r.name === "A lista do que vence hoje")!;
  assert.deepEqual([adjusted.time, adjusted.days, adjusted.on], ["07:30", "weekdays", false]);
  const proposal = (await invoke("agent.proposals")).proposals.find((x: any) => x.kind === "routine")!;
  assert.equal(proposal.status, "applied");
  // [Criar] direto no balão.
  await invoke("agent.ask", { text: "dias úteis às 9h, faz a lista das ações em aberto das reuniões" });
  await p.waitForSelector(".kn-proposal-bubble button:has-text('Criar')", { timeout: 60000 });
  await idle();
  await p.locator(".kn-proposal-bubble button:has-text('Criar')").click();
  await p.waitForFunction(() => document.querySelector(".kn-proposal-bubble .kn-proposal-line")?.textContent?.startsWith("Pronto: a rotina"), undefined, { timeout: 10000 });
  assert.ok((await custom()).some((r) => r.name === "A lista das ações em aberto das reuniões" && r.on === false));
  report.checks.push("asking the agent shows the proposal in the cat's bubble with [Criar] [Ajustar] [Descartar]; [Criar] creates it off; [Ajustar] opens the same card in Settings, filled, and creates it with the changes");
  report.problems.push(...h.report.problems);
  await h.close();

  // 4. A parte Rotinas inteira, no claro e no escuro, e o apagar.
  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 2000, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    await w.page.waitForSelector(`${box} .kn-routine-card[data-routine=weekly]`, { timeout: 15000 });
    await shot(w.page, box, `5-rotinas-${theme}.png`, `5. Ajustes › Agente › Rotinas, com as novas (${theme === "light" ? "claro" : "escuro"})`);
    report.problems.push(...w.report.problems);
    await w.close();
  }
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 1600, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
  await w.page.locator(`${card} button:has-text('Apagar')`).click();
  await w.page.locator(`${card} [role=group] button:has-text('Apagar')`).click();
  await w.page.waitForSelector(card, { state: "detached", timeout: 5000 });
  assert.ok(!(await custom()).some((r) => r.id === made.id));
  // As prontas não se apagam.
  assert.equal(await w.page.locator(".kn-routine-card[data-routine=daily] button:has-text('Apagar')").count(), 0);
  report.problems.push(...w.report.problems);
  await w.close();
  report.checks.push("a created routine is deleted (with the confirmation); the built-in ones have no Apagar");

  // A folha em WebP.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 20px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">Rotinas novas: pelo botão ou pedindo ao Kiwi Cat (spec #12944)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:8px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "80", join(out, "folha.png"), "-o", join(out, "rotinas-novas.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
