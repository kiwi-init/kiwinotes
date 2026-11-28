// O balão no mouse (T32766, spec #32534): todo balão do Kiwi, no Hub e no overlay, só aparece com o mouse em cima do
// Kiwi ou do balão, e sai 250 ms depois que o mouse sai; o "Ver mais" aberto fica até o ×, o Esc ou um clique fora. Uma
// marca pequena no Kiwi, na cor de destaque, enquanto houver balão não visto. Num WebKit headless, no claro e no escuro:
//
// - o overlay: a página de verdade (dist/catoverlay), com os comandos como o helper manda (`catHover`, `bubbleHover`,
//   `collapse()`, `escape()`). Escondido, a página não manda o lugar do balão (o clique passa ao app de trás);
// - o Hub: o de verdade, no headless com o agente falso (`/diga`), e o mouse do Playwright;
// - o leitor de tela não depende do mouse: a resposta está na região viva com o balão escondido, e o Esc fecha o
//   "Ver mais" com o mouse longe.
//
// Nada nativo na tela, nenhum agente de verdade, nenhum microfone. Sai a prancha `prancha.webp`. Tudo inventado.
//
//   bun scripts/bubble-peek-check.ts [pasta]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, peekKiwi, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { openPlacement, overlayPlacement, SHELL_W } from "../ui/catoverlay/placement";
import { PEEK_LEAVE_MS } from "../ui/hub/bubble-peek";
import { CAT_BODY } from "../ui/kiwicat-v2/bubbleTail";

/** A marca encosta no Kiwi (T33053, #33052): o centro dela na quina de cima à direita do corpo, o `CAT_BODY` (x1, y0). */
async function markOnKiwi(p: Page, mark: string, cat: string, where: string) {
  const [m, c] = await Promise.all([p.locator(mark).boundingBox(), p.locator(cat).boundingBox()]);
  assert.ok(m && c, `${where}: a marca e o gato na página`);
  const dx = m.x + m.width / 2 - (c.x + c.width * CAT_BODY.x1);
  const dy = m.y + m.height / 2 - (c.y + c.height * CAT_BODY.y0);
  assert.ok(Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5, `${where}: a marca fora da quina do corpo (dx ${dx.toFixed(1)}, dy ${dy.toFixed(1)})`);
}

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T32766-balao-mouse"));
mkdirSync(out, { recursive: true });

const CURTA = "Pronto: a lista da feira da Ana está na nota Casa/Feira.md.";
const OUTRA = "Também guardei a lista da semana em Casa/Semana.md.";
const LONGA =
  "Juntei o que a Ana anotou sobre a mudança para o apartamento novo, no fim do mês. O caminhão está marcado para o " +
  "sábado de manhã, e a chave fica com o porteiro a partir de sexta. Faltam a internet nova, que precisa de uma visita " +
  "do técnico, e o conserto da porta do armário antes da entrega. Os móveis grandes vão primeiro, e as plantas ficam " +
  "para o domingo, no carro. Se chover, a Ana prefere adiar as plantas e levar só os livros, que já estão nas caixas.";

const checks: string[] = [];
const shots: { file: string; caption: string }[] = [];
const browser = await webkit.launch({ headless: true });

// ---------------------------------------------------------------------------------------------------------------- overlay
const page = join(app, "dist", "catoverlay");
const build = spawnSync("bun", ["x", "vite", "build"], { cwd: app, stdio: "ignore", env: { ...process.env, KIWI_UI_WINDOW: "catoverlay" } });
assert.ok(build.status === 0 && existsSync(join(page, "index.html")), "o build da página catoverlay");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(r) {
    const file = Bun.file(join(page, new URL(r.url).pathname.replace(/^\/$/, "/index.html")));
    return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
  },
});

type Post = { bubble?: { x: number; y: number; w: number; h: number } | null; open?: boolean; closed?: true };
const set = (p: Page, input: Record<string, unknown>) => p.evaluate((i) => (window as any).kiwiOverlay.set(i), input);
const stats = (p: Page) => p.evaluate(() => (window as any).kiwiOverlayStats);
const lastRect = (p: Page) =>
  p.evaluate(() => {
    const posts = (window as any).__posts as Post[];
    for (let i = posts.length - 1; i >= 0; i--) if ("bubble" in posts[i]!) return posts[i]!.bubble ?? null;
    return undefined;
  });
const opacity = (p: Page, sel: string) => p.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!).opacity), sel);
const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function overlay(theme: "light" | "dark") {
  const tema = theme === "light" ? "claro" : "escuro";
  const query = "escala=1.00&lado=right&balao=acima";
  const place = overlayPlacement(new URLSearchParams(query));
  const width = openPlacement(place, SHELL_W).winW;
  const height = place.catH + 200;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    const posts: unknown[] = [];
    (window as any).__posts = posts;
    (window as any).webkit = { messageHandlers: { kiwiCat: { postMessage: (m: unknown) => posts.push(JSON.parse(JSON.stringify(m))) } } };
  });
  const p = await ctx.newPage();
  const problems: string[] = [];
  p.on("pageerror", (e) => problems.push(e.message));
  await p.goto(`http://127.0.0.1:${server.port}/index.html?backend=none&${query}`);
  await p.waitForFunction(() => (window as any).kiwiCatReady === true, undefined, { timeout: 20_000 });
  const shot = async (file: string, caption: string) => {
    await Bun.sleep(200);
    await p.screenshot({ path: join(out, file), omitBackground: false });
    shots.push({ file, caption });
  };
  try {
    // 1. A resposta chega com o mouse longe: o balão espera escondido, sem pegar o clique, e a marca aparece no Kiwi.
    await set(p, { estado: "pronto", visible: true, sala: 200, bubble: { text: CURTA, error: false } });
    await frames(p);
    assert.equal(await opacity(p, "#bubble"), 0, "overlay: o balão com o mouse longe");
    assert.equal(await lastRect(p), null, "overlay: escondido, o lugar do balão não vai ao helper");
    assert.equal((await stats(p)).unseen, true);
    assert.equal(await opacity(p, "#cat-mark"), 1, "overlay: a marca do balão não visto");
    await markOnKiwi(p, "#cat-mark", "#cat", "overlay");
    // O leitor de tela não depende do mouse: a resposta inteira está na região viva.
    assert.ok((await p.locator("#bubble-sr").textContent())?.includes(CURTA), "overlay: o leitor de tela com o balão escondido");
    await shot(`overlay-longe-${theme}.png`, `Overlay (${tema}): a resposta chegou com o mouse longe, e a marca`);

    // 2. O mouse no Kiwi: o balão aparece, pega o clique e a marca some.
    await set(p, { catHover: true });
    await frames(p);
    assert.equal(await opacity(p, "#bubble"), 1, "overlay: o balão com o mouse no Kiwi");
    assert.ok(await lastRect(p), "overlay: à vista, o lugar do balão vai ao helper");
    assert.equal((await stats(p)).unseen, false);
    assert.equal(await opacity(p, "#cat-mark"), 0, "overlay: a marca some quando o balão aparece");
    // O print com o mouse ainda no Kiwi: depois de sair, a espera de 200 ms do shot já encosta nos 250 ms.
    await shot(`overlay-mouse-${theme}.png`, `Overlay (${tema}): o mouse no Kiwi, o balão à vista`);
    await set(p, { catHover: false });
    await frames(p);

    // 3. Do Kiwi para o balão dentro dos 250 ms: fica. Saindo do balão: ainda à vista antes dos 250 ms, e some depois.
    await set(p, { bubbleHover: true });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal(await opacity(p, "#bubble"), 1, "overlay: o mouse no balão");
    await set(p, { bubbleHover: false });
    await Bun.sleep(PEEK_LEAVE_MS / 2);
    assert.equal((await stats(p)).peek, true, "overlay: antes dos 250 ms");
    await Bun.sleep(PEEK_LEAVE_MS);
    assert.equal((await stats(p)).peek, false, "overlay: depois dos 250 ms");
    assert.equal(await opacity(p, "#bubble"), 0);
    assert.equal(await lastRect(p), null, "overlay: o lugar do balão sai junto");
    checks.push(`overlay (${theme}): hidden with the mouse away (no rect to the helper, the mark on Kiwi, the answer in the live region); shown with the mouse on Kiwi or the bubble; leaves ${PEEK_LEAVE_MS} ms after the mouse`);

    // 4. O "Ver mais" prende o balão: o mouse sai e ele fica; o clique fora (o `collapse` do helper) volta ao resumo.
    await set(p, { bubble: { text: LONGA, error: false }, catHover: true });
    await frames(p);
    await p.locator("#bubble-more").click();
    await set(p, { catHover: false });
    await Bun.sleep(PEEK_LEAVE_MS * 3);
    assert.equal((await stats(p)).bubbleOpen, true);
    assert.equal(await opacity(p, "#bubble"), 1, "overlay: o Ver mais aberto fica com o mouse longe");
    await shot(`overlay-ver-mais-${theme}.png`, `Overlay (${tema}): o Ver mais aberto fica com o mouse longe`);
    await p.evaluate(() => (window as any).kiwiOverlay.collapse());
    assert.equal((await stats(p)).bubbleOpen, false, "overlay: o clique fora fecha o Ver mais");
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal((await stats(p)).peek, false, "overlay: fechado, volta a seguir o mouse");

    // 5. O Esc (o helper só o passa com o mouse no Kiwi ou no balão): fecha o Ver mais; de novo, o balão, como o ×.
    await set(p, { catHover: true });
    await p.locator("#bubble-more").click();
    const before = (await p.evaluate(() => (window as any).__posts.length)) as number;
    await p.evaluate(() => (window as any).kiwiOverlay.escape());
    assert.equal((await stats(p)).bubbleOpen, false, "overlay: o Esc fecha o Ver mais");
    await p.evaluate(() => (window as any).kiwiOverlay.escape());
    const after = (await p.evaluate((n) => (window as any).__posts.slice(n), before)) as Post[];
    assert.ok(after.some((m) => m.closed === true), "overlay: o segundo Esc fecha o balão, como o ×");
    checks.push(`overlay (${theme}): "See more" pins the bubble with the mouse away; the click outside (collapse) and Esc close it; Esc again closes the bubble like its ×`);

    // 6. A mesma resposta que cresceu não é um balão novo (o `grew`, T33053, Cena 1): o balão nasce na fala, a pessoa o
    // vê, e o `done` traz o texto inteiro com a fala de resumo. A marca continua apagada, e o "Ver mais" aberto fica.
    // Um balão de fato novo (outro texto) acende a marca: o controle do passo.
    const FALA = "Achei a lista da feira.";
    await set(p, { bubble: null, catHover: false });
    // O passo 5 deixou o mouse no Kiwi: o balão segue à vista por PEEK_LEAVE_MS depois que ele sai.
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal((await stats(p)).peek, false);
    await set(p, { bubble: { text: FALA, error: false } });
    await frames(p);
    assert.equal((await stats(p)).unseen, true, "overlay: a fala com o mouse longe acende a marca");
    await set(p, { catHover: true });
    await frames(p);
    assert.equal((await stats(p)).unseen, false, "overlay: vista, a marca apaga");
    await set(p, { catHover: false });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal((await stats(p)).peek, false);
    await set(p, { bubble: { text: LONGA, summary: FALA, error: false } });
    await frames(p);
    assert.equal((await stats(p)).unseen, false, "overlay: a resposta que só cresceu (o done depois da fala) não acende a marca");
    await set(p, { catHover: true });
    await frames(p);
    await p.locator("#bubble-more").click();
    await set(p, { catHover: false });
    await set(p, { bubble: { text: `${LONGA} E a nota tem a data da próxima ida.`, summary: FALA, error: false } });
    await frames(p);
    assert.equal((await stats(p)).bubbleOpen, true, "overlay: a mesma resposta, crescida de novo, não fecha o Ver mais");
    await p.evaluate(() => (window as any).kiwiOverlay.collapse());
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    // O andamento: o passo seguinte do mesmo pedido é outra linha, não um balão novo.
    await set(p, { bubble: null });
    await set(p, { bubble: { text: "Procurando nas notas…", error: false, progress: true } });
    await frames(p);
    await set(p, { catHover: true });
    await frames(p);
    assert.equal((await stats(p)).unseen, false);
    await set(p, { catHover: false });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    await set(p, { bubble: { text: "Lendo Casa/Feira.md…", error: false, progress: true } });
    await frames(p);
    assert.equal((await stats(p)).unseen, false, "overlay: o passo seguinte do andamento não acende a marca");
    await set(p, { bubble: { text: CURTA, error: false } });
    await frames(p);
    assert.equal((await stats(p)).unseen, true, "overlay: um balão novo de fato acende a marca");
    checks.push(`overlay (${theme}): the same answer that only grew (the done after the speech) and the next progress step keep the mark off and "See more" open; a really new bubble lights it`);
    assert.deepEqual(problems, [], "overlay: erros na página");
  } finally {
    await ctx.close();
  }
}

// -------------------------------------------------------------------------------------------------------------------- hub
const data = mkdtempSync(join(tmpdir(), "kiwi-balao-mouse-"));
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
const BUBBLE = ".kn-bubble-slot:not([data-phase='exit']) .kn-bubble";
const peekOf = (p: Page) => p.evaluate(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubblePeek);
const away = (p: Page) => p.mouse.move(40, 120);

async function hub(theme: "light" | "dark") {
  const tema = theme === "light" ? "claro" : "escuro";
  const size = { width: 1000, height: 700 };
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, ...size, motion: false, browser: "webkit", query: {} });
  const p = w.page;
  const shot = async (file: string, caption: string) => {
    await Bun.sleep(200);
    await p.screenshot({ path: join(out, file) });
    shots.push({ file, caption });
  };
  try {
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
    await p.locator('[role="tab"][data-section="notes"]').click();
    await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);

    // 1. A resposta chega com o mouse longe: o balão espera invisível e sem pegar o mouse; a marca aparece no Kiwi.
    await away(p);
    // Passada a espera do mouse que saiu (o openWindow o pôs no Kiwi): um balão que chega antes ainda aparece, e é visto.
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubblePeek === "false");
    await invoke("agent.ask", { text: `/diga ${CURTA}` });
    await p.waitForSelector(BUBBLE, { state: "attached", timeout: 30_000 });
    await p.waitForTimeout(600);
    assert.equal(await peekOf(p), "false");
    assert.equal(await opacity(p, BUBBLE), 0, "hub: o balão com o mouse longe");
    assert.equal(await p.evaluate((s) => getComputedStyle(document.querySelector(s)!).pointerEvents, BUBBLE), "none");
    // O lugar do balão escondido (#32805): o clique chega ao que está atrás, e o mouse passando ali não o mostra.
    const hiddenBox = (await p.locator(BUBBLE).boundingBox())!;
    const spot = { x: hiddenBox.x + hiddenBox.width / 2, y: hiddenBox.y + hiddenBox.height / 2 };
    const behind = await p.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { inBubble: !!el?.closest(".kn-bubble-slot, .kn-bubble-shell"), what: el?.className ?? null };
    }, spot);
    assert.equal(behind.inBubble, false, `hub: o clique no lugar do balão escondido chega atrás (pegou ${behind.what})`);
    await p.mouse.move(spot.x, spot.y, { steps: 3 });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal(await peekOf(p), "false", "hub: o mouse no lugar do balão escondido não o mostra");
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubbleUnseen === "true");
    assert.equal(await opacity(p, ".kn-kiwicat-mark"), 1, "hub: a marca do balão não visto");
    await markOnKiwi(p, ".kn-kiwicat-mark", ".kn-kiwicat", "hub");
    // O leitor de tela: a resposta é anunciada uma vez, com o balão escondido.
    await p.waitForFunction((t) => [...document.querySelectorAll(".kn-visually-hidden[aria-live]")].some((e) => e.textContent?.includes(t)), CURTA, { timeout: 15_000 });
    await shot(`hub-longe-${theme}.png`, `Hub (${tema}): a resposta chegou com o mouse longe, e a marca no Kiwi`);

    // 2. O mouse no Kiwi: o balão aparece e a marca some.
    await peekKiwi(p);
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubblePeek === "true");
    await Bun.sleep(200);
    assert.equal(await opacity(p, BUBBLE), 1, "hub: o balão com o mouse no Kiwi");
    assert.equal(await opacity(p, ".kn-kiwicat-mark"), 0, "hub: a marca some");
    await shot(`hub-mouse-${theme}.png`, `Hub (${tema}): o mouse no Kiwi, o balão à vista`);

    // 3. Do Kiwi para o balão: fica. Saindo: ainda à vista antes dos 250 ms, e some depois.
    const b = (await p.locator(BUBBLE).boundingBox())!;
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal(await peekOf(p), "true", "hub: o mouse no balão");
    await away(p);
    await Bun.sleep(PEEK_LEAVE_MS / 2);
    assert.equal(await peekOf(p), "true", "hub: antes dos 250 ms");
    await Bun.sleep(PEEK_LEAVE_MS);
    assert.equal(await peekOf(p), "false", "hub: depois dos 250 ms");
    checks.push(`hub (${theme}): hidden with the mouse away (no pointer, the mark on Kiwi, the answer announced); shown with the mouse on Kiwi or the bubble; leaves ${PEEK_LEAVE_MS} ms after the mouse`);

    // 3b. Um balão novo com o outro ainda na tela (T33053, nota 1 do #33047): o primeiro já foi visto, e a marca acende de novo.
    assert.equal(await p.evaluate(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubbleUnseen), "false", "hub: o balão visto apaga a marca");
    await invoke("agent.ask", { text: `/diga ${OUTRA}` });
    await p.waitForFunction((t) => [...document.querySelectorAll(".kn-visually-hidden[aria-live]")].some((e) => e.textContent?.includes(t)), OUTRA, { timeout: 15_000 });
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubbleUnseen === "true", undefined, { timeout: 5_000 });
    assert.equal(await peekOf(p), "false", "hub: o balão novo espera o mouse");
    checks.push(`hub (${theme}): a new bubble while another is still on screen lights the mark again`);

    // 4. O "Ver mais" fica com o mouse longe; o Esc (sem o mouse) fecha; um clique fora também.
    await invoke("agent.ask", { text: `/diga ${LONGA}` });
    await peekKiwi(p);
    await p.waitForSelector(`${BUBBLE} .kn-bubble-more`, { timeout: 30_000 });
    await p.waitForTimeout(600);
    await p.locator(`${BUBBLE} .kn-bubble-more`).click();
    await p.waitForSelector(".kn-bubble-big");
    await away(p);
    await Bun.sleep(PEEK_LEAVE_MS * 3);
    assert.equal(await opacity(p, ".kn-bubble-big"), 1, "hub: o Ver mais aberto fica com o mouse longe");
    await shot(`hub-ver-mais-${theme}.png`, `Hub (${tema}): o Ver mais aberto fica com o mouse longe`);
    await p.keyboard.press("Escape");
    await p.waitForSelector(".kn-bubble-big", { state: "detached" });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal(await peekOf(p), "false", "hub: fechado, volta a seguir o mouse");
    await peekKiwi(p);
    await p.locator(`${BUBBLE} .kn-bubble-more`).click();
    await p.waitForSelector(".kn-bubble-big");
    await p.mouse.click(40, 120);
    await p.waitForSelector(".kn-bubble-big", { state: "detached" });
    checks.push(`hub (${theme}): "See more" pins the bubble with the mouse away; Esc (keyboard, mouse away) and a click outside close it`);
    assert.deepEqual(w.report.problems, [], "hub: problemas na página");
  } finally {
    await w.close();
  }
}

try {
  for (const theme of ["light", "dark"] as const) await overlay(theme);
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  await invoke("agent.download");
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  for (const theme of ["light", "dark"] as const) await hub(theme);

  // A prancha.
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1500, height: 900 } });
  const img = (f: string) => `data:image/png;base64,${readFileSync(join(out, f)).toString("base64")}`;
  const fig = (x: (typeof shots)[number]) =>
    `<figure style="margin:0"><figcaption style="margin-bottom:6px">${x.caption}</figcaption><img src="${img(x.file)}" style="display:block;max-width:${x.file.startsWith("hub") ? 700 : 340}px;border-radius:8px;box-shadow:0 1px 4px #0003"></figure>`;
  const group = (prefix: string) => `<div style="display:flex;flex-wrap:wrap;gap:20px;margin-bottom:24px">${shots.filter((s) => s.file.startsWith(prefix)).map(fig).join("")}</div>`;
  await sheet.setContent(
    `<body style="margin:0;padding:24px;background:#eceae4;font:600 15px -apple-system,sans-serif;color:#222">` +
      `<h1 style="margin:0 0 6px;font-size:24px">O balão no mouse (T32766, spec #32534)</h1>` +
      `<p style="margin:0 0 18px;font-weight:500">O balão só aparece com o mouse no Kiwi ou nele e sai 250 ms depois; o Ver mais fica até o ×, o Esc ou um clique fora. A marca no Kiwi: balão não visto.</p>` +
      group("overlay") + group("hub") + `</body>`,
  );
  await sheet.screenshot({ path: join(out, "prancha.png"), fullPage: true });
  await sheet.close();
  const webp = spawnSync("cwebp", ["-quiet", "-q", "80", join(out, "prancha.png"), "-o", join(out, "prancha.webp")]);
  if (webp.status !== 0) console.log("sem o cwebp: a prancha ficou em PNG");
  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`a prancha em ${join(out, "prancha.webp")}`);
} finally {
  await browser.close();
  server.stop(true);
  await cli(["stop"]).catch(() => {});
  registry.stop();
}
