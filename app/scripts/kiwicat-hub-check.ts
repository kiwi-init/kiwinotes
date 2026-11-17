// T9567: real hub + real headless AppEngine + ACP fake. Never launches a native window.
// T14885 (spec #14813): o gato novo. O que era o `[data-symbol]` do gato three.js virou o `data-emote` do gato e a tinta
// do emote; os olhos são o canvas do rosto.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { CAT_PALETTES } from "../src/shared/kiwicat-colors";
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
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
// A tinta dos emotes (T10737): clara no escuro, escura no claro (cat-emotes.ts). Vale com um emote na tela.
const INK = { dark: "#FFFFFF", light: "#0A0B10" } as const;
const inkOf = (page: import("playwright-core").Page) =>
  page.evaluate(() => { const g = document.querySelector(".kn-kiwicat svg > g"); const inks = new Set<string>();
    g?.querySelectorAll("[stroke],[fill]").forEach(e => { for (const a of ["stroke", "fill"]) { const v = e.getAttribute(a); if (v && v !== "none") inks.add(v); } });
    return [...inks]; });
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
  const identity = await p.locator(".kn-kiwicat canvas").first().evaluate(c => { (window as any).__catCanvas = c; return c.getBoundingClientRect().height; });
  assert.equal(Math.round(identity), 96); // o gato novo é quadrado: 96 × 96, embaixo da caixa de 96 × 120
  // O Sobre virou um assunto de Configurações (spec #11966): ficam as quatro abas (T12273).
  for (const section of ["notes", "meetings", "dictation", "settings"]) {
    await p.locator(`.kn-tab[data-section=${section}]`).click();
    assert.ok(await p.evaluate(() => (window as any).__catCanvas === document.querySelector(".kn-kiwicat canvas")));
    const hit = await p.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    assert.equal(hit, false);
    await p.screenshot({ path: join(out, `${section}.png`) });
  }
  report.checks.push("96px square, four tabs, same canvas, click-through");
  // O rosto (olhos e orelhas) fica na caixa do gato e aparece em repouso (#10039): o canvas do rosto tem pixels desenhados.
  const face = await p.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>(".kn-kiwicat canvas")], c = canvases[1]!;
    const a = c.getBoundingClientRect(), box = document.querySelector(".kn-kiwicat")!.getBoundingClientRect();
    const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let drawn = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 128) drawn++;
    return { canvases: canvases.length, drawn, inside: a.left >= box.left && a.right <= box.right && a.top >= box.top && a.bottom <= box.bottom };
  });
  assert.equal(face.canvases, 2, JSON.stringify(face)); assert.ok(face.inside, JSON.stringify(face)); assert.ok(face.drawn > 50, JSON.stringify(face));
  report.checks.push("face inside its box, drawn at rest");
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
    const clip = await q.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
    await q.screenshot({ path: join(out, `cat-${theme}-repouso.png`), clip });
    await invoke("agent.ask", { text: "/lento" }); await q.waitForSelector('.kn-kiwicat[data-state="agindo"]'); await q.waitForTimeout(600);
    await q.screenshot({ path: join(out, `cat-${theme}-agindo.png`), clip });
    await q.waitForSelector('.kn-kiwicat[data-state="pronto"]'); await q.waitForTimeout(1500);
    // O erro fica até o próximo estado, com a nuvem do confuso: a tinta conforme o tema da janela.
    await invoke("agent.ask", { text: "/sem-rede" }); await q.waitForSelector('.kn-kiwicat[data-state="erro"]');
    await q.waitForSelector('.kn-kiwicat[data-emote="confuso"]'); await q.waitForTimeout(600);
    assert.ok((await inkOf(q)).includes(INK[theme]), `ink in ${theme}: ${await inkOf(q)}`);
    await q.screenshot({ path: join(out, `cat-${theme}-erro.png`), clip });
    await big.close();
  }
  report.checks.push("still prints at full size, rest and working, dark and light");
  // A troca de tema ao vivo (a Aparência ou o macOS mudam o data-theme): a tinta acompanha, sem remontar o gato.
  await p.waitForSelector('.kn-kiwicat[data-emote="confuso"]');
  await p.evaluate(() => { (window as any).__inkCanvas = document.querySelector(".kn-kiwicat canvas"); });
  for (const side of ["light", "dark"] as const) {
    await p.evaluate(t => { document.documentElement.dataset.theme = t; }, side);
    for (let n = 0; !(await inkOf(p)).includes(INK[side]); n++) { assert.ok(n < 30, `live ink ${side}`); await p.waitForTimeout(100); }
  }
  assert.ok(await p.evaluate(() => (window as any).__inkCanvas === document.querySelector(".kn-kiwicat canvas")));
  report.checks.push("symbol ink follows the theme, also when it changes live");
  // As 5 paletas (spec #14963, T15034): trocar em Ajustes muda a névoa e o anel na hora, sem remontar o gato. A média da
  // névoa segue a paleta: o verde manda no Kiwi Elétrico, o vermelho no Âmbar Noturno.
  {
    const mean = () => p.evaluate(() => {
      const c = document.querySelector(".kn-kiwicat canvas") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 40 && d[i]! + d[i + 1]! + d[i + 2]! > 120) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++; }
      return n ? [r / n, g / n, b / n].map(Math.round) : [0, 0, 0];
    });
    const means: Record<string, number[]> = {};
    for (const cor of ["kiwi-neon", "ambar-solar", "soul-claro", "nevoa-violeta", "prisma-original"]) {
      await invoke("settings.set", { kiwicat: { cor } });
      await p.waitForSelector(`.kn-kiwicat[data-cor="${cor}"]`); await p.waitForTimeout(400);
      means[cor] = await mean();
    }
    const [nr, ng, nb] = means["kiwi-neon"]!, [ar, ag, ab] = means["ambar-solar"]!;
    assert.ok(ng > nr && ng > nb, `kiwi-neon fog is green: ${means["kiwi-neon"]}`);
    assert.ok(ar > ag && ar > ab, `ambar-solar fog is red: ${means["ambar-solar"]}`);
    assert.equal(new Set(Object.values(means).map(String)).size, 5, JSON.stringify(means));
    assert.ok(await p.evaluate(() => (window as any).__inkCanvas === document.querySelector(".kn-kiwicat canvas")));
    report.paletteMeans = means;
    // A borda do balão (spec #14963): o accentColor da paleta, também trocando com o balão na tela.
    await invoke("agent.ask", { text: "oi" }); await p.waitForSelector(".kn-bubble-shell");
    const border = () => p.evaluate(() => getComputedStyle(document.querySelector(".kn-bubble-shell")!).borderTopColor);
    for (const pal of CAT_PALETTES) {
      await invoke("settings.set", { kiwicat: { cor: pal.id } }); await p.waitForSelector(`.kn-kiwicat[data-cor="${pal.id}"]`);
      for (let n = 0; (await border()) !== rgbOf(pal.accentColor); n++) assert.ok(n < 30, `bubble border ${pal.id}: ${await border()}`), await p.waitForTimeout(50);
      if (pal.id === "ambar-solar") await p.locator(".kn-bubble-shell").screenshot({ path: join(out, "balao-ambar-solar.png") });
    }
    // Prints parados das 5, em tamanho real, no escuro e no claro.
    for (const theme of ["dark", "light"] as const) {
      const big = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 1000, height: 740, motion: true, browser: "webkit", query: { section: "notes" } });
      const q = big.page; await q.waitForSelector('.kn-kiwicat[data-ready="true"]');
      const clip = await q.locator(".kn-kiwicat").evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; });
      for (const cor of ["prisma-original", "kiwi-neon", "ambar-solar", "soul-claro", "nevoa-violeta"]) {
        await invoke("settings.set", { kiwicat: { cor } });
        await q.waitForSelector(`.kn-kiwicat[data-cor="${cor}"]`); await q.waitForTimeout(800);
        await q.screenshot({ path: join(out, `paleta-${theme}-${cor}.png`), clip });
      }
      await big.close();
    }
  }
  report.checks.push("the 5 palettes: the fog and the bubble border follow the choice live, without remounting the cat");
  // O Reduzir movimento para a animação, não o estado (#434): o pronto volta sozinho ao repouso, no quadro parado.
  {
    const still = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "dark", width: 1000, height: 740, motion: false, browser: "webkit", query: { section: "notes" } });
    const r = still.page; await r.waitForSelector('.kn-kiwicat[data-ready="true"]');
    await invoke("agent.ask", { text: "oi" }); await r.waitForSelector('.kn-kiwicat[data-state="pronto"]');
    await r.waitForSelector('.kn-kiwicat[data-emote="feliz"]', { timeout: 2000 });
    await r.waitForSelector('.kn-kiwicat[data-emote="repouso"]', { timeout: 4000 }); // o `auto` do repouso é o emote dele (nenhum)
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
