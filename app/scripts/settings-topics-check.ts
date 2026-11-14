// Configurações por assunto (spec #11966, T12115–T12118): a barra lateral dos 8 assuntos no claro e no escuro, cada
// seção num assunto só, a aba Sobre fora do topo, o teclado, o último assunto, o link "Abrir a memória" do balão e a
// janela estreita com "‹ Voltar". No hub de verdade, com o AppEngine headless e o agente falso, num WebKit headless.
// Nada na tela de ninguém.
//
//   bun scripts/settings-topics-check.ts [pasta]
//
// Sai na pasta: `ajustes.webp` (a folha com os prints) e `ajustes.mp4` (o vídeo).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { SETTINGS_TOPICS, TOPIC_LABELS, type SettingsTopic } from "../ui/settings/topics";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11966-settings"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-settings-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
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

/**
 * As seções de cada assunto: as da aba Configurações de antes do spec, mais as duas que mudaram de lugar ("Ajustes de
 * reunião", que era só da aba Reuniões, e "Suas reuniões", que estava dentro do Agente). O Sobre não tem título de seção.
 */
const EXPECTED: Record<SettingsTopic, string[]> = {
  appearance: ["Aparência"],
  dictation: ["Atalhos · Ditado", "Transcrição", "Dicionário", "Snippets"],
  notes: ["Notas", "Atalhos · Notas", "Atalhos · Barra lateral das Notas"],
  meetings: ["Ajustes de reunião", "Atalhos · Reuniões", "Suas reuniões"],
  agent: ["Agente", "O gasto do agente"],
  activity: ["Atividade do agente"],
  privacy: ["Privacidade"],
  about: [],
};
const SECTIONS = Object.values(EXPECTED).flat();

const shots: { file: string; caption: string }[] = [];
async function shot(p: Page, file: string, caption: string) {
  await Bun.sleep(250);
  await p.screenshot({ path: join(out, file) });
  shots.push({ file, caption });
}
const shown = (p: Page, t: SettingsTopic) => p.waitForSelector(`.kn-prefs-topic[data-topic=${t}]:not([hidden])`, { timeout: 15000 });
const active = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("[data-topic]")?.getAttribute("data-topic") ?? document.activeElement?.className ?? null);

const browser = await webkit.launch({ headless: true });
const report: { checks: string[]; problems: string[] } = { checks: [], problems: [] };
try {
  await cli(["start", "--no-helper"]);
  await invoke("notes.create", { folder: "Kiwi", title: "Kiwi", content: "# Kiwi\n" });
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  // 1. Os 8 assuntos, no claro e no escuro: só o painel do assunto aparece, e cada seção está num assunto só.
  const videoDir = join(out, "video");
  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme, width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings", topic: "appearance" }, ...(theme === "light" ? { video: videoDir } : {}) });
    const p = w.page;
    await shown(p, "appearance");
    // A aba Sobre saiu do topo: quatro abas.
    assert.deepEqual(await p.locator(".kn-tab").allTextContents(), ["Notas", "Reuniões", "Ditado", "Configurações"]);
    assert.deepEqual(await p.locator(".kn-prefs-item").allTextContents(), SETTINGS_TOPICS.map((t) => TOPIC_LABELS[t]));
    const seen = new Map<string, SettingsTopic[]>();
    for (const [i, t] of SETTINGS_TOPICS.entries()) {
      await p.locator(`.kn-prefs-item[data-topic=${t}]`).click();
      await shown(p, t);
      assert.equal(await p.locator(`.kn-prefs-item[data-topic=${t}]`).getAttribute("aria-current"), "page");
      assert.equal(await p.locator(".kn-prefs-topic:not([hidden])").count(), 1, "só o painel do assunto");
      assert.equal(await p.locator(".kn-prefs-topic:not([hidden]) .kn-prefs-title").textContent(), TOPIC_LABELS[t]);
      // As seções que leem o app chegam depois do clique: espera todas antes de contar.
      for (const title of EXPECTED[t]) await p.waitForSelector(`.kn-prefs-topic[data-topic=${t}] .kn-section-title:text-is("${title}")`, { state: "attached", timeout: 15000 });
      if (t === "agent") await p.waitForSelector(".kn-prefs-topic[data-topic=agent] [role=switch][aria-label='Ligar o agente']", { timeout: 15000 });
      if (t === "meetings") await p.waitForSelector(".kn-prefs-topic[data-topic=meetings] .kn-agent-meetings", { timeout: 15000 });
      if (t === "about") await p.waitForSelector(".kn-prefs-topic[data-topic=about] .kn-about-name", { timeout: 15000 });
      for (const title of await p.locator(`.kn-prefs-topic[data-topic=${t}] .kn-section-title`).allTextContents()) seen.set(title, [...(seen.get(title) ?? []), t]);
      await shot(p, `${i + 1}-${t}-${theme}.png`, `${i + 1}. ${TOPIC_LABELS[t]} (${theme === "light" ? "claro" : "escuro"})`);
    }
    for (const title of SECTIONS) assert.equal(seen.get(title)?.length, 1, `"${title}" num assunto só: ${JSON.stringify(seen.get(title))}`);
    for (const [title, where] of seen) assert.equal(where.length, 1, `"${title}" repetida em ${where.join(", ")}`);
    if (theme === "light") {
      report.checks.push(`the sidebar shows the 8 topics and the top bar lost the Sobre tab; each topic shows only its panel; the ${SECTIONS.length} sections are each in exactly one topic`);

      // 2. O teclado: ↑ e ↓ andam pela lista, Enter abre o assunto, Tab entra no painel.
      await p.locator(".kn-prefs-item[data-topic=appearance]").click();
      await shown(p, "appearance");
      await p.keyboard.press("ArrowDown");
      await p.keyboard.press("ArrowDown");
      assert.equal(await active(p), "notes");
      await p.keyboard.press("ArrowUp");
      assert.equal(await active(p), "dictation");
      await p.keyboard.press("Enter");
      await shown(p, "dictation");
      await p.keyboard.press("Tab");
      assert.equal(await p.evaluate(() => !!document.activeElement?.closest(".kn-prefs-topic[data-topic=dictation]")), true, "o Tab entra no painel");
      report.checks.push("keyboard: ↓/↑ move along the list, Enter opens the topic, Tab goes into the panel");

      // 3. O último assunto: o app lembra (o localStorage da janela), e abrir Ajustes sem assunto volta nele.
      await p.locator(".kn-prefs-item[data-topic=privacy]").click();
      assert.equal(await p.evaluate(() => localStorage.getItem("kn-settings-topic")), "privacy");
      report.checks.push("the last topic is remembered (localStorage kn-settings-topic)");

    }
    report.problems.push(...w.report.problems);
    await w.close();
  }

  // 3b. Abrir de novo, sem assunto: volta no último (no mesmo contexto, o storage fica).
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings" } });
    const p = w.page;
    await p.evaluate(() => localStorage.setItem("kn-settings-topic", "agent"));
    await p.reload();
    await shown(p, "agent");
    report.checks.push("reopening Settings without a topic goes back to the last one");
    report.problems.push(...w.report.problems);
    await w.close();
  }
  // 4. A seção `about` do hub (o menu da barra, os scripts) abre Ajustes › Sobre.
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "about" } });
    await shown(w.page, "about");
    assert.equal(await w.page.locator(".kn-tab[data-section=settings]").getAttribute("aria-selected"), "true");
    report.checks.push("the hub section `about` (tray menu, scripts) opens Settings › Sobre");
    report.problems.push(...w.report.problems);
    await w.close();
  }

  // 5. Um link de dentro do app: a memória cheia, no balão, abre Ajustes › Agente e rola até a Memória.
  {
    const full = Array.from({ length: 60 }, (_, i) => `fato ${i + 1}`);
    await invoke("agent.memorySet", { facts: full });
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1100, height: 720, motion: false, browser: "webkit", query: { section: "settings", topic: "appearance" } });
    const p = w.page;
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 15000 });
    await ctx.send({ cmd: "hubView", view: true });
    await invoke("agent.ask", { text: "lembra que tenho um gato chamado Kiwi" });
    await idle();
    await p.waitForFunction(() => document.querySelector(".kn-memory-bubble")?.textContent?.includes("A memória está cheia"), undefined, { timeout: 30000 });
    await shot(p, "9-link-balao.png", "9. A memória cheia: o balão leva para a Memória");
    await p.locator(".kn-memory-bubble button:has-text('Abrir a memória')").click();
    await shown(p, "agent");
    const flash = p.locator(".kn-prefs-topic[data-topic=agent] [data-flash=true]");
    await flash.waitFor({ timeout: 10000 });
    assert.equal((await flash.locator(".kn-row-label").first().textContent())?.trim(), "Memória");
    assert.equal(await flash.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, "a linha está à vista");
    await shot(p, "10-link-memoria.png", "10. Ajustes › Agente, rolado até a Memória");
    report.checks.push("the full-memory bubble's [Abrir a memória] opens Settings › Agente and scrolls to the Memória row");
    report.problems.push(...w.report.problems);
    await w.close();
  }

  // 6. A janela estreita: a lista na largura toda; o assunto abre em tela cheia, com "‹ Voltar".
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 640, height: 720, motion: false, browser: "webkit", query: { section: "settings" } });
    const p = w.page;
    await p.evaluate(() => localStorage.removeItem("kn-settings-topic"));
    await p.waitForSelector(".kn-prefs[data-narrow] .kn-prefs-side", { timeout: 15000 });
    assert.equal(await p.locator(".kn-prefs-panel").count(), 0, "estreita: só a lista");
    await shot(p, "11-estreita-lista.png", "11. Janela estreita: a lista");
    await p.locator(".kn-prefs-item[data-topic=agent]").click();
    await shown(p, "agent");
    assert.equal(await p.locator(".kn-prefs-side").count(), 0, "o assunto em tela cheia");
    await shot(p, "12-estreita-assunto.png", "12. Janela estreita: o assunto, com ‹ Voltar");
    await p.locator(".kn-prefs-topic[data-topic=agent] .kn-prefs-back").click();
    await p.waitForSelector(".kn-prefs-side", { timeout: 5000 });
    await p.waitForFunction(() => document.activeElement?.getAttribute("data-topic") === "agent", undefined, { timeout: 5000 });
    report.checks.push("narrow window (< 720 px): the list, the topic full screen with ‹ Voltar, and Voltar returns to the list with focus on the topic");
    report.problems.push(...w.report.problems);
    await w.close();
  }

  // A folha em WebP e o vídeo em mp4.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 2000, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 20px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 16px;font-size:30px">Configurações por assunto (spec #11966)</h1>` +
      `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;align-items:start">` +
      shots.map((x) => `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption><img src="${img(x.file)}" style="width:100%;border-radius:10px;box-shadow:0 1px 4px #0003"></figure>`).join("") +
      `</div></body>`,
  );
  // Todas as imagens carregadas antes do print (com 20 prints, os últimos ficavam em branco).
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 30000 });
  await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
  await sheet.close();
  const webp = Bun.spawnSync(["cwebp", "-quiet", "-q", "78", join(out, "folha.png"), "-o", join(out, "ajustes.webp")]);
  if (webp.exitCode !== 0) report.problems.push(`cwebp: ${webp.stderr.toString()}`);
  const webm = [...new Bun.Glob("*.webm").scanSync(videoDir)][0];
  if (webm) {
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", join(videoDir, webm), "-vf", "scale=1100:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "ajustes.mp4")]);
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
