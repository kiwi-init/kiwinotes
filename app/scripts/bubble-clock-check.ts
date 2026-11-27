// O clique, o relógio e a resposta de volta (T33179, spec #32534, Cena 3). Num WebKit headless, no claro e no escuro:
//
// - o Hub de verdade, no headless com o agente falso (`/diga`), o mouse do Playwright e o relógio dele
//   (`context.clock`): o clique no balão não fecha; 45 s parado, a pergunta "Precisa de mais alguma coisa?" (com a
//   marca, se o mouse está longe); o mouse em cima segura, com a pergunta à vista; mais 15 s, e o balão sai; o mouse no
//   Kiwi traz a última resposta de volta; o × e o Esc fecham, e ela ainda volta.
// - o overlay: a página de verdade (dist/catoverlay), com os comandos como o helper manda. O clique no balão manda o
//   `touch` (recomeça a espera), nunca o `closed`; o × manda o `closed`; a pergunta com o mouse longe acende a marca.
//   O relógio do overlay é o do app (`cat-overlay.ts`), com os mesmos tempos, e o `bun test` o prova com o relógio falso.
//
// Nada nativo na tela, nenhum agente de verdade, nenhum microfone. Sai a prancha `prancha.webp`. Tudo inventado.
//
//   bun scripts/bubble-clock-check.ts [pasta]
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
import { BUBBLE_ASK_LEAVE_MS, BUBBLE_IDLE_ASK_MS } from "../ui/hub/bubble-clock";
import { PEEK_LEAVE_MS } from "../ui/hub/bubble-peek";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T33179-balao-clique"));
mkdirSync(out, { recursive: true });

const CURTA = "Pronto: a lista da feira da Ana está na nota Casa/Feira.md.";
const OUTRA = "Também guardei a receita do bolo de cenoura em Casa/Receitas.md.";
const ASK = "Precisa de mais alguma coisa?";

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

type Post = { touch?: true; closed?: true };
const set = (p: Page, input: Record<string, unknown>) => p.evaluate((i) => (window as any).kiwiOverlay.set(i), input);
const stats = (p: Page) => p.evaluate(() => (window as any).kiwiOverlayStats);
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
  const postsSince = (n: number) => p.evaluate((i) => (window as any).__posts.slice(i), n) as Promise<Post[]>;
  const count = () => p.evaluate(() => (window as any).__posts.length) as Promise<number>;
  try {
    // 1. O clique no balão (com o mouse nele, como o helper deixa) manda o `touch`, nunca o `closed`, e o balão fica.
    await set(p, { estado: "pronto", visible: true, sala: 200, bubble: { text: CURTA, error: false }, catHover: true, bubbleHover: true });
    await frames(p);
    let n = await count();
    await p.locator("#bubble-text").click();
    let after = await postsSince(n);
    assert.ok(after.some((m) => m.touch === true), "overlay: o clique no balão manda o touch (recomeça a espera)");
    assert.ok(!after.some((m) => m.closed === true), "overlay: o clique no balão não fecha");
    assert.equal((await stats(p)).bubble?.text, CURTA, "overlay: o balão fica depois do clique");

    // 2. A pergunta com o mouse longe: acende a marca; o mouse no Kiwi a mostra junto com a resposta.
    await set(p, { catHover: false, bubbleHover: false });
    await Bun.sleep(PEEK_LEAVE_MS + 100);
    assert.equal((await stats(p)).unseen, false, "overlay: a resposta já foi vista");
    await set(p, { bubble: { text: CURTA, error: false, ask: true } });
    assert.equal((await stats(p)).unseen, true, "overlay: a pergunta com o mouse longe acende a marca");
    await set(p, { catHover: true });
    await frames(p);
    assert.equal((await stats(p)).unseen, false);
    assert.equal(await opacity(p, "#bubble-ask"), 1, "overlay: a pergunta à vista com o mouse no Kiwi");
    await Bun.sleep(200);
    await p.screenshot({ path: join(out, `overlay-pergunta-${theme}.png`) });
    shots.push({ file: `overlay-pergunta-${theme}.png`, caption: `Overlay (${tema}): a pergunta, com o mouse no Kiwi` });

    // 3. O × do balão fecha (o `closed`).
    n = await count();
    await p.locator("#bubble-close").click();
    after = await postsSince(n);
    assert.ok(after.some((m) => m.closed === true), "overlay: o × fecha");
    checks.push(`overlay (${theme}): the click on the bubble only touches (restarts the wait), never closes; the question lights the mark with the mouse away and shows with it; the × closes`);
    assert.deepEqual(problems, [], "overlay: erros na página");
  } finally {
    await ctx.close();
  }
}

// -------------------------------------------------------------------------------------------------------------------- hub
const data = mkdtempSync(join(tmpdir(), "kiwi-balao-clique-"));
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
const hubData = (p: Page, key: "bubblePeek" | "bubbleUnseen") => p.evaluate((k) => document.querySelector<HTMLElement>(".kn-hub")!.dataset[k], key);
const away = (p: Page) => p.mouse.move(40, 120);
const bubbleText = (p: Page) => p.evaluate((s) => document.querySelector(`${s} .kn-bubble-typed`)?.textContent ?? null, BUBBLE);
const hasAsk = (p: Page) => p.evaluate((s) => !!document.querySelector(`${s} .kn-bubble-ask`), BUBBLE);

async function hub(theme: "light" | "dark") {
  const tema = theme === "light" ? "claro" : "escuro";
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 700, motion: false, browser: "webkit", query: {}, clock: true });
  const p = w.page;
  const shot = async (file: string, caption: string) => {
    await Bun.sleep(200);
    await p.screenshot({ path: join(out, file) });
    shots.push({ file, caption });
  };
  /** Pula o relógio (o `context.clock`) e dá um tempo para a página pintar o que mudou. */
  const jump = async (ms: number) => {
    await p.clock.fastForward(ms);
    await Bun.sleep(300);
  };
  try {
    await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
    await p.locator('[role="tab"][data-section="notes"]').click();
    await p.waitForFunction(() => !document.querySelector<HTMLElement>(".kn-hub")?.dataset.catAt);

    // 1. A resposta, com o mouse no Kiwi; o clique no balão não fecha.
    await peekKiwi(p);
    await invoke("agent.ask", { text: `/diga ${CURTA}` });
    await p.waitForFunction((s) => document.querySelector(s), BUBBLE, { timeout: 30_000 });
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubblePeek === "true");
    await Bun.sleep(600);
    const box = (await p.locator(`${BUBBLE} .kn-bubble-text`).boundingBox())!;
    await p.mouse.click(box.x + 20, box.y + box.height / 2);
    await Bun.sleep(800);
    assert.equal(await bubbleText(p), CURTA, "hub: o clique no balão não fecha");
    await shot(`hub-clique-${theme}.png`, `Hub (${tema}): depois do clique, o balão fica, com o ×`);
    checks.push(`hub (${theme}): the click on the bubble does not close it`);

    // 2. O relógio: 45 s parado (o mouse longe), a pergunta, e a marca acende.
    await away(p);
    await Bun.sleep(PEEK_LEAVE_MS + 150);
    assert.equal(await hubData(p, "bubblePeek"), "false");
    await jump(BUBBLE_IDLE_ASK_MS - 2_000);
    assert.equal(await hasAsk(p), false, "hub: antes dos 45 s, sem pergunta");
    await jump(2_500);
    assert.equal(await hasAsk(p), true, "hub: aos 45 s, a pergunta");
    assert.equal(await hubData(p, "bubbleUnseen"), "true", "hub: a pergunta com o mouse longe acende a marca");

    // 3. O mouse no Kiwi mostra a pergunta e segura: um minuto depois, o balão continua.
    await peekKiwi(p);
    await p.waitForFunction(() => document.querySelector<HTMLElement>(".kn-hub")!.dataset.bubblePeek === "true");
    await shot(`hub-pergunta-${theme}.png`, `Hub (${tema}): aos 45 s, a pergunta; o mouse no Kiwi a mostra e segura`);
    await jump(60_000);
    assert.equal(await bubbleText(p), CURTA, "hub: o mouse em cima segura o balão");
    assert.equal(await hasAsk(p), true, "hub: com o mouse em cima, a pergunta fica à vista");

    // 4. O mouse sai: a pergunta sai e a espera recomeça do zero; 45 s + 15 s, e o balão sai.
    await away(p);
    await Bun.sleep(PEEK_LEAVE_MS + 150);
    assert.equal(await hasAsk(p), false, "hub: solto, a pergunta sai");
    await jump(BUBBLE_IDLE_ASK_MS - 2_000);
    assert.equal(await bubbleText(p), CURTA, "hub: a espera recomeçou do zero");
    await jump(2_500);
    assert.equal(await hasAsk(p), true);
    await jump(BUBBLE_ASK_LEAVE_MS - 2_000);
    assert.equal(await bubbleText(p), CURTA, "hub: antes dos 15 s, o balão fica");
    await jump(2_500);
    await p.waitForFunction((s) => !document.querySelector(s), BUBBLE, { timeout: 5_000 });
    checks.push(`hub (${theme}): ${BUBBLE_IDLE_ASK_MS / 1000} s idle → the question (and the mark), the mouse holds it with the question shown, then ${BUBBLE_ASK_LEAVE_MS / 1000} s more and the bubble leaves`);

    // 5. A última resposta volta com o mouse no Kiwi.
    await peekKiwi(p);
    await p.waitForFunction((s) => document.querySelector(s), BUBBLE, { timeout: 5_000 });
    assert.equal(await bubbleText(p), CURTA, "hub: a última resposta volta");
    assert.equal(await hasAsk(p), false, "hub: volta sem a pergunta");
    await shot(`hub-volta-${theme}.png`, `Hub (${tema}): o balão saiu; o mouse no Kiwi traz a última resposta`);

    // 6. O × fecha; ela ainda volta no próximo mouse no Kiwi. O Esc (com o mouse no Kiwi) também fecha.
    await p.locator(`${BUBBLE} .kn-bubble-close`).click();
    await p.waitForFunction((s) => !document.querySelector(s), BUBBLE, { timeout: 5_000 });
    await away(p);
    await peekKiwi(p);
    await p.waitForFunction((s) => document.querySelector(s), BUBBLE, { timeout: 5_000 });
    assert.equal(await bubbleText(p), CURTA, "hub: depois do ×, ela volta com o mouse no Kiwi");
    await Bun.sleep(400);
    await p.keyboard.press("Escape");
    await p.waitForFunction((s) => !document.querySelector(s), BUBBLE, { timeout: 5_000 });
    checks.push(`hub (${theme}): after it left, the mouse on Kiwi brings the last answer back; the × and Esc close it`);

    // 7. Até o próximo pedido: um pedido novo, e a resposta de antes não volta mais; volta a nova.
    await away(p);
    await invoke("agent.ask", { text: `/diga ${OUTRA}` });
    await p.waitForFunction((t) => [...document.querySelectorAll(".kn-visually-hidden[aria-live]")].some((e) => e.textContent?.includes(t)), OUTRA, { timeout: 15_000 });
    await p.locator(`${BUBBLE} .kn-bubble-close`).click({ force: true });
    await p.waitForFunction((s) => !document.querySelector(s), BUBBLE, { timeout: 5_000 });
    await peekKiwi(p);
    await p.waitForFunction((s) => document.querySelector(s), BUBBLE, { timeout: 5_000 });
    assert.equal(await bubbleText(p), OUTRA, "hub: volta a resposta do último pedido");
    checks.push(`hub (${theme}): the next request replaces the answer that comes back`);
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
      `<h1 style="margin:0 0 6px;font-size:24px">O clique, o relógio e a resposta de volta (T33179, spec #32534)</h1>` +
      `<p style="margin:0 0 18px;font-weight:500">O clique no balão não fecha; o × e o Esc fecham. 45 s parado, "${ASK}", mais 15 s, e o balão sai; o mouse em cima segura. Depois, o mouse no Kiwi traz a última resposta.</p>` +
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
