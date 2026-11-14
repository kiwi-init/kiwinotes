// Os balões do gato (spec #9495, T10832): o hub de verdade, o AppEngine headless de verdade e o agente falso, num
// WebKit headless. Nunca abre janela nativa nem chama o macOS. Prints e vídeo na pasta do argumento.
//
//   bun scripts/kiwicat-bubble-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T10832-bubble"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-bubble-"));
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
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
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
const bubble = ".kn-bubble";
const box = (p: Page, sel: string) => p.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
const lineHeight = (p: Page) => p.locator(`${bubble} .kn-bubble-text`).evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
/** Espera o balão terminar o pedido (sumir) e devolve os trechos inteiros que passaram por ele. */
async function chunksUntilGone(p: Page, ms = 90_000): Promise<string[]> {
  const seen: string[] = [];
  const end = Date.now() + ms;
  for (;;) {
    const s = await p.evaluate(() => {
      const b = document.querySelector(".kn-bubble");
      if (!b) return null;
      return { full: b.querySelector(".kn-bubble-ghost")!.textContent ?? "", typed: b.querySelector(".kn-bubble-typed")!.textContent ?? "" };
    });
    if (!s) return seen;
    if (s.typed === s.full && seen.at(-1) !== s.full) seen.push(s.full);
    assert.ok(Date.now() < end, `o balão não terminou: ${JSON.stringify(s)} depois de ${JSON.stringify(seen)}`);
    await Bun.sleep(40);
  }
}
const LONG =
  "Esta é uma resposta longa do agente falso, para mostrar que o balão do gato tem um tamanho máximo. " +
  "Quando o texto passa de três linhas, ele vira uma sequência de balões, cortada sempre entre palavras, " +
  "e cada balão fica na tela o tempo de leitura do texto dele antes de dar lugar ao próximo.";

const browser = await webkit.launch({ headless: true });
const report: { scope: string; checks: string[]; problems?: string[] } = { scope: "WebKit headless hub with the fake ACP agent; no native app", checks: [] };
try {
  await cli(["start", "--no-helper"]);
  const videos = join(out, "video-tmp");
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 620, motion: true, browser: "webkit", query: { section: "about" }, video: videos });
  const p = w.page;
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito (T12273).
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');

  // Quem está digitando continua digitando: um campo com o foco, e o balão não o tira.
  await p.evaluate(() => {
    const i = document.createElement("textarea");
    i.id = "digitando";
    i.style.cssText = "position:absolute;left:16px;top:120px;width:240px;height:60px;z-index:50";
    document.body.appendChild(i);
    i.focus();
  });

  // 1. A resposta digitada num balão ao lado do gato, com a ponta para ele.
  await invoke("agent.ask", { text: `/conta ${LONG}` });
  await p.waitForSelector(bubble);
  const t1 = await p.locator(`${bubble} .kn-bubble-typed`).textContent();
  await Bun.sleep(250);
  const t2 = await p.locator(`${bubble} .kn-bubble-typed`).textContent();
  assert.ok((t2 ?? "").length > (t1 ?? "").length, "o texto aparece sendo digitado");
  const cat = await box(p, ".kn-kiwicat");
  const b = await box(p, bubble);
  assert.ok(b.right <= cat.x, "o balão fica à esquerda do gato");
  assert.ok(b.bottom > cat.y && b.y < cat.bottom, "na altura do gato, com a ponta virada para ele");
  assert.ok(b.w <= 280.5, `até 280 px (${b.w})`);
  await p.screenshot({ path: join(out, "1-digitando.png"), clip: { x: b.x - 16, y: Math.min(b.y, cat.y) - 16, width: cat.right - b.x + 32, height: Math.max(b.bottom, cat.bottom) - Math.min(b.y, cat.y) + 32 } });
  report.checks.push("typed text in a balloon to the left of the cat, pointing at it, at most 280 px");

  // 2. O balão é clicável, o resto do canto deixa passar, e o foco fica no campo.
  const through = await p.locator(".kn-kiwicat").evaluate((c) => { const r = c.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !hit?.closest(".kn-kiwicat, .kn-bubble"); });
  assert.ok(through, "o clique no gato atravessa");
  const onBubble = await p.locator(bubble).evaluate((e) => { const r = e.getBoundingClientRect(); return !!document.elementFromPoint(r.x + 10, r.y + 10)?.closest(".kn-bubble"); });
  assert.ok(onBubble, "o balão recebe o clique");

  // 3. Até 3 linhas por balão, e o [Ver mais] com tudo, sem fechar o balão.
  await p.waitForSelector(`${bubble} .kn-bubble-more`, { timeout: 15000 });
  const lh = await lineHeight(p);
  const textH = await p.locator(`${bubble} .kn-bubble-text`).evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(textH <= lh * 3 + 1, `no máximo 3 linhas (${textH} / ${lh})`);
  await p.locator(`${bubble} .kn-bubble-more`).click();
  await p.waitForSelector(".kn-bubble-big");
  assert.equal(await p.evaluate(() => document.activeElement?.id), "digitando", "o [Ver mais] não tira o foco");
  await p.screenshot({ path: join(out, "2-ver-mais.png") });
  await p.keyboard.press("Escape");
  await p.waitForSelector(".kn-bubble-big", { state: "detached" });
  // O [Ver mais] não fechou o balão: fechado o grande, o pequeno continua.
  await p.waitForSelector(bubble, { timeout: 2000 });
  await p.locator(`${bubble} .kn-bubble-more`).click();
  await p.waitForSelector(".kn-bubble-big");
  await p.mouse.click(400, 300);
  await p.waitForSelector(".kn-bubble-big", { state: "detached" });
  // O clique fora é um clique na página: o foco vai para onde a pessoa clicou, como em qualquer lugar. Volta ao campo.
  await p.locator("#digitando").focus();
  report.checks.push("at most 3 lines; [Ver mais] opens the whole answer without closing the balloon; Esc and a click outside close it");

  // 4. A sequência: cortada entre palavras, cada trecho na vez dele, e juntos são a resposta.
  const chunks = await chunksUntilGone(p);
  const words = new Set(LONG.split(/\s+/));
  for (const c of chunks) for (const word of c.split(/\s+/).filter(Boolean)) assert.ok(words.has(word), `"${word}" é palavra inteira`);
  assert.ok(chunks.length >= 3, `vários balões (${chunks.length})`);
  assert.ok(LONG.endsWith(chunks.at(-1)!.trim()), "o último trecho é o fim da resposta");
  assert.equal(await p.evaluate(() => document.activeElement?.id), "digitando");
  // O leitor de tela: a resposta inteira, uma vez, no fim.
  assert.equal((await p.locator(".kn-visually-hidden[aria-live]").textContent())?.trim(), LONG);
  report.checks.push(`a long answer became ${chunks.length} balloons, cut between words, then disappeared; announced once, whole`);

  // 5. O clique fecha o balão, e um pedido novo fecha o do anterior.
  await invoke("agent.ask", { text: `/conta ${LONG}` });
  await p.waitForSelector(bubble);
  await p.locator(bubble).click({ position: { x: 12, y: 12 } });
  await p.waitForSelector(bubble, { state: "detached" });
  assert.equal(await p.evaluate(() => document.activeElement?.id), "digitando", "o clique no balão não tira o foco");
  await Bun.sleep(1500);
  assert.equal(await p.locator(bubble).count(), 0, "fechado, o resto do pedido não volta");
  for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await invoke("agent.ask", { text: "/conta primeira resposta, que vai ser trocada" });
  await p.waitForSelector(bubble);
  for (let n = 0; (await invoke("agent.status")).busy; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await invoke("agent.ask", { text: "/conta a segunda" });
  await p.waitForFunction(() => document.querySelector(".kn-bubble-ghost")?.textContent?.startsWith("a segunda"), undefined, { timeout: 10000 });
  report.checks.push("a click closes the balloon (focus stays); a new request replaces the previous balloon");
  await chunksUntilGone(p);

  // 6. O texto dito antes de uma ferramenta sai quando ela começa; o [Ver mais] mostra tudo.
  await invoke("agent.ask", { text: "/antes-da-ferramenta" });
  await p.waitForFunction(() => document.querySelector(".kn-bubble-ghost")?.textContent?.startsWith("Vou ler a nota"), undefined, { timeout: 10000 });
  await p.waitForFunction(() => document.querySelector(".kn-bubble-typed")?.textContent === document.querySelector(".kn-bubble-ghost")?.textContent);
  await Bun.sleep(250); // a entrada do balão (160 ms)
  await p.screenshot({ path: join(out, "3-antes-da-ferramenta.png") });
  await p.waitForSelector(bubble, { state: "detached", timeout: 5000 });
  await p.waitForFunction(() => document.querySelector(".kn-bubble-ghost")?.textContent?.startsWith("Pronto"), undefined, { timeout: 10000 });
  await p.locator(`${bubble} .kn-bubble-more`).click();
  const big = await p.locator(".kn-bubble-big").textContent();
  assert.ok(big?.includes("Vou ler a nota") && big.includes("o prazo do Kiwi é março"), "o [Ver mais] mostra tudo o que o agente disse");
  await p.keyboard.press("Escape");
  report.checks.push("text said before a tool leaves when the tool starts; the final answer comes in a new balloon; [Ver mais] has everything");
  await chunksUntilGone(p);

  // 7. O erro em uma linha.
  await invoke("agent.ask", { text: "/limite" });
  await p.waitForSelector(`${bubble}[data-error]`, { timeout: 10000 });
  const eh = await p.locator(`${bubble} .kn-bubble-text`).evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(eh <= (await lineHeight(p)) + 1, `o erro em uma linha (${eh})`);
  await Bun.sleep(250);
  await p.screenshot({ path: join(out, "4-erro.png") });
  report.checks.push("the error in one line");
  await chunksUntilGone(p);

  // 8. Um texto hostil, um código longo e uma marcação pela metade: texto, legível, sem quebrar o balão.
  const hostile = '<img src=x onerror="window.__xss=1"> **negrito** e **pela metade `codigo_muito_longo_sem_espaco_nenhum_que_nao_cabe_numa_linha_do_balao`';
  await invoke("agent.ask", { text: `/conta ${hostile}` });
  await p.waitForSelector(bubble);
  await Bun.sleep(400);
  assert.equal(await p.locator(`${bubble} img, .kn-bubble-big img`).count(), 0, "nada vira HTML");
  assert.equal(await p.evaluate(() => (window as any).__xss), undefined);
  const hb = await box(p, bubble);
  assert.ok(hb.w <= 280.5 && hb.right <= cat.x, "o balão não quebra");
  await p.locator(`${bubble} .kn-bubble-more`).click({ timeout: 10000 }).catch(() => {});
  if (await p.locator(".kn-bubble-big").count()) {
    const bigHtml = await p.locator(".kn-bubble-big").innerHTML();
    assert.ok(bigHtml.includes("&lt;img"), "o <img> aparece como texto");
    assert.ok(bigHtml.includes("<strong>negrito</strong>"), "o negrito legível");
    assert.ok(bigHtml.includes("**pela metade"), "a marcação pela metade fica como texto");
    await p.screenshot({ path: join(out, "5-texto-hostil.png") });
    await p.keyboard.press("Escape");
  }
  report.checks.push("hostile text, a long code and half-written markup stay text and legible, without breaking the balloon");
  await chunksUntilGone(p);
  report.problems = w.report.problems;
  await w.close();
  const v = readdirSync(videos).find((f) => f.endsWith(".webm"));
  if (v) renameSync(join(videos, v), join(out, "baloes.webm"));
  rmSync(videos, { recursive: true, force: true });

  // 9. O escuro, e o Reduzir movimento: cada trecho aparece inteiro, sem digitação.
  await invoke("settings.set", { appearance: { mode: "dark", darkTheme: "channels-oled", lightTheme: "channels-light", textSize: "default", font: "system", motion: "reduced" } });
  const d = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width: 900, height: 620, motion: false, browser: "webkit", query: { section: "about" } });
  await d.page.waitForSelector('.kn-kiwicat[data-ready="true"]');
  await invoke("agent.ask", { text: `/conta ${LONG}` });
  await d.page.waitForSelector(bubble);
  const first = await d.page.evaluate(() => ({ full: document.querySelector(".kn-bubble-ghost")!.textContent, typed: document.querySelector(".kn-bubble-typed")!.textContent }));
  assert.equal(first.typed, first.full, "com o Reduzir movimento, o trecho aparece inteiro");
  assert.equal(await d.page.locator(bubble).evaluate((e) => getComputedStyle(e).animationName), "none");
  await d.page.waitForSelector(`${bubble} .kn-bubble-more`, { timeout: 15000 });
  const db = await box(d.page, bubble);
  const dc = await box(d.page, ".kn-kiwicat");
  await d.page.screenshot({ path: join(out, "6-escuro-reduzir.png"), clip: { x: db.x - 16, y: Math.min(db.y, dc.y) - 16, width: dc.right - db.x + 32, height: Math.max(db.bottom, dc.bottom) - Math.min(db.y, dc.y) + 32 } });
  report.checks.push("dark theme; with Reduce Motion each chunk appears whole, without animation");
  report.problems = [...(report.problems ?? []), ...d.report.problems];
  await d.close();
  assert.deepEqual(report.problems, []);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
  await browser.close().catch(() => {});
  await cli(["stop"]).catch(() => {});
  registry.stop();
  rmSync(data, { recursive: true, force: true });
}
