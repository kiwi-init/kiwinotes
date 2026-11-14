// T9567: real hub + real headless AppEngine + ACP fake. Never launches a native window.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T9567-hub"); mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-hub-"));
const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(data, "packages.json"); writeFileSync(packages, JSON.stringify(registry.pinned));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1", KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
  });
  const text = await new Response(p.stdout).text(); const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err); return text;
}
const ctx: UiContext = { data, send: async msg => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, line => { if (!("id" in line)) onMsg(line); }); assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false }); return () => c.close();
  } };
async function invoke(cap: string, args: unknown = {}) { const r = await ctx.send({ cmd: "invoke", cap, args }); assert.equal(r.ok, true, JSON.stringify(r)); return r.value as any; }
// A tinta dos símbolos (T10737): a cor da camada que tem os símbolos do gato.
const INK = { dark: "rgb(255, 255, 255)", light: "rgb(23, 23, 28)" } as const;
const inkOf = (page: import("playwright-core").Page) =>
  page.evaluate(() => { const s = document.querySelector(".kn-kiwicat [data-symbol]"); return s?.parentElement ? getComputedStyle(s.parentElement).color : null; });
const browser = await webkit.launch({ headless: true });
const report: any = { scope: "WebKit headless hub with fake ACP agent; no native app", checks: [] };
try {
  await cli(["start", "--no-helper"]);
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "about" } });
  const p = w.page;
  const requested: string[] = []; p.on("request", r => requested.push(r.url()));
  await p.waitForTimeout(200);
  assert.equal(await p.locator(".kn-kiwicat").count(), 0); report.checks.push("agent off: no renderer");
  await invoke("agent.enable", { consent: true }); await invoke("agent.download");
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito (T12273).
  await invoke("agent.configure", { onboarding: { state: "done" } });
  // O gato do overlay (spec #9810) entra quando um pedido começa e o hub não está na frente, e o headless nunca está: o
  // gato do hub ia embora no meio do roteiro. Este roteiro é o do gato do hub; o overlay tem o kiwicat-overlay-check (T12273).
  await invoke("settings.set", { kiwicat: { overlay: false } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  const identity = await p.locator(".kn-kiwicat canvas").evaluate(c => { (window as any).__catCanvas = c; return c.getBoundingClientRect().height; });
  assert.equal(identity, 120);
  // O Sobre virou um assunto de Configurações (spec #11966): ficam as quatro abas (T12273).
  for (const section of ["notes", "meetings", "dictation", "settings"]) {
    await p.locator(`.kn-tab[data-section=${section}]`).click();
    assert.ok(await p.evaluate(() => (window as any).__catCanvas === document.querySelector(".kn-kiwicat canvas")));
    const hit = await p.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    assert.equal(hit, false);
    await p.screenshot({ path: join(out, `${section}.png`) });
  }
  report.checks.push("120px, four tabs, same canvas, click-through");
  // Os olhos ficam na caixa deles: um <svg> inline descia com a altura de linha do hub e o recorte o escondia (#10039).
  const eyes = await p.evaluate(() => [...document.querySelectorAll(".kn-kiwicat circle")].filter(c => c.getAttribute("r") === "1").map(c => {
    const svg = c.closest("svg")!, disk = svg.parentElement!, a = svg.getBoundingClientRect(), b = disk.getBoundingClientRect();
    const box = document.querySelector(".kn-kiwicat")!.getBoundingClientRect();
    const inside = a.left >= box.left && a.right <= box.right && a.top >= box.top && a.bottom <= box.bottom;
    return { dy: Math.abs(a.y - b.y), dx: Math.abs(a.x - b.x), w: a.width, opacity: getComputedStyle(disk).opacity, inside };
  }));
  assert.equal(eyes.length, 2);
  for (const e of eyes) { assert.ok(e.dx < 0.5 && e.dy < 0.5, JSON.stringify(eyes)); assert.ok(e.w > 4); assert.ok(e.inside); assert.equal(e.opacity, "1"); }
  report.checks.push("eyes inside their box, visible at rest");
  await invoke("agent.ask", { text: "/lento" });
  await p.waitForSelector('.kn-kiwicat[data-state="agindo"]');
  await p.screenshot({ path: join(out, "agindo.png") });
  await p.waitForSelector('.kn-kiwicat[data-state="pronto"]');
  await p.screenshot({ path: join(out, "pronto.png") });
  await p.waitForTimeout(1400);
  await invoke("agent.ask", { text: "/sem-rede" });
  await p.waitForSelector('.kn-kiwicat[data-state="erro"]');
  await p.screenshot({ path: join(out, "erro.png") });
  await invoke("agent.ask", { text: "/lento" }); await p.waitForSelector('.kn-kiwicat[data-state="agindo"]');
  await invoke("agent.cancel"); await p.waitForSelector('.kn-kiwicat[data-state="repouso"]');
  report.checks.push("fake tool, ready, error, cancellation");
  await invoke("settings.set", { kiwicat: { show: false } }); await p.waitForSelector(".kn-kiwicat", { state: "detached" });
  await invoke("settings.set", { kiwicat: { show: true } }); await p.waitForSelector('.kn-kiwicat[data-ready="true"]');
  // Prints parados em tamanho real (o gato com 120 px, em 2×), em repouso e em agindo, nos dois temas (#10039).
  for (const theme of ["dark", "light"] as const) {
    const big = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
    const q = big.page; await q.waitForSelector('.kn-kiwicat[data-ready="true"]'); await q.waitForTimeout(1500);
    // A tinta conforme o tema da janela (T10737): sem o background, o claro saía com os símbolos brancos.
    assert.equal(await inkOf(q), INK[theme], `ink in ${theme}`);
    const clip = await q.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
    await q.screenshot({ path: join(out, `cat-${theme}-repouso.png`), clip });
    await invoke("agent.ask", { text: "/lento" }); await q.waitForSelector('.kn-kiwicat[data-state="agindo"]'); await q.waitForTimeout(600);
    await q.screenshot({ path: join(out, `cat-${theme}-agindo.png`), clip });
    await q.waitForSelector('.kn-kiwicat[data-state="pronto"]'); await q.waitForTimeout(1500);
    await big.close();
  }
  report.checks.push("still prints at full size, rest and working, dark and light");
  // A troca de tema ao vivo (a Aparência ou o macOS mudam o data-theme): a tinta acompanha, sem remontar o gato.
  await p.evaluate(() => { (window as any).__inkCanvas = document.querySelector(".kn-kiwicat canvas"); });
  for (const side of ["light", "dark"] as const) {
    await p.evaluate(t => { document.documentElement.dataset.theme = t; }, side);
    const ink: string = INK[side];
    await p.waitForFunction((want: string) => { const s = document.querySelector(".kn-kiwicat [data-symbol]"); return !!s?.parentElement && getComputedStyle(s.parentElement).color === want; }, ink, { timeout: 3000 });
  }
  assert.ok(await p.evaluate(() => (window as any).__inkCanvas === document.querySelector(".kn-kiwicat canvas")));
  report.checks.push("symbol ink follows the theme, also when it changes live");
  // O Reduzir movimento para a animação, não o estado (#434): o pronto volta sozinho ao repouso, no quadro parado.
  {
    const still = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1000, height: 740, motion: false, browser: "webkit", query: { section: "notes" } });
    const r = still.page; await r.waitForSelector('.kn-kiwicat[data-ready="true"]');
    await invoke("agent.ask", { text: "oi" }); await r.waitForSelector('.kn-kiwicat[data-state="pronto"]');
    await r.waitForFunction(() => getComputedStyle(document.querySelector('.kn-kiwicat [data-symbol="pronto"]')!).opacity === "1", null, { timeout: 2000 });
    await r.waitForFunction(() => getComputedStyle(document.querySelector('.kn-kiwicat [data-symbol="pronto"]')!).opacity === "0", null, { timeout: 4000 });
    await still.close();
  }
  report.checks.push("reduced motion: ready goes back to rest on its own");
  await invoke("agent.disable"); await p.waitForSelector(".kn-kiwicat", { state: "detached" });
  report.checks.push("show switch and agent disable unmount");
  report.page = w.report; report.requests = requested; assert.deepEqual(w.report.problems, []);
  await w.close();
} finally {
  await browser.close(); await cli(["stop"]); registry.stop();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  rmSync(data, { recursive: true, force: true });
}
console.log(JSON.stringify(report));
