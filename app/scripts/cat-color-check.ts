// A cor da névoa do Kiwi-cat (spec #9349, T11429), de ponta a ponta no hub de verdade (AppEngine headless e agente
// falso), num WebKit headless: Ajustes › Agente, a amostra parada, o gato do canto trocando ao vivo, o Reduzir
// movimento, a linha desabilitada e a escolha depois de reabrir. Por fim, a folha: a névoa de cada cor no fundo preto e
// no branco. Nada na tela de ninguém, nenhum mic, nenhum agente de verdade.
//
//   bun scripts/cat-color-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { serveFogDemo } from "./kiwicat-demo";
import { openWindow, type UiContext } from "./ui-page";
import { fakeRegistry } from "../src/agent/fake/registry";
import { catColorHex, catColorOptions, contrastRatio } from "../src/shared/kiwicat-colors";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T11429-cor"));
mkdirSync(join(out, "frames"), { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-cat-color-"));
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

/** A cor guardada chega a esta (o clique salva sem esperar). */
async function savedCor(want: string) {
  for (let n = 0; (await invoke("settings.get")).kiwicat.cor !== want; n++) { assert.ok(n < 40, `saved colour is not ${want}`); await Bun.sleep(50); }
}

/** O matiz (graus) de uma cor `#rrggbb` ou de [r, g, b] em 0–255. */
function hue(c: string | number[]): number {
  const [r, g, b] = (typeof c === "string" ? [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) : c).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** A cor média da névoa num elemento: só os pixels com cor (o gato é preto e o fundo é cinza). */
async function fog(p: Page, sel: string): Promise<{ rgb: number[]; hue: number; n: number }> {
  const png = (await p.locator(sel).screenshot()).toString("base64");
  const rgb = await p.evaluate(async (src) => {
    const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const max = Math.max(px[i]!, px[i + 1]!, px[i + 2]!), min = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
      if (max < 40 || (max - min) / max < 0.25) continue;
      r += px[i]!; gg += px[i + 1]!; b += px[i + 2]!; n++;
    }
    return n ? [r / n, gg / n, b / n, n] : [0, 0, 0, 0];
  }, png);
  return { rgb: rgb.slice(0, 3).map(Math.round), hue: hue(rgb.slice(0, 3)), n: rgb[3]! };
}
async function expectHue(p: Page, sel: string, hex: string, what: string, tolerance = 25) {
  const f = await fog(p, sel);
  assert.ok(f.n > 30, `${what}: no coloured fog pixels`);
  assert.ok(hueGap(f.hue, hue(hex)) <= tolerance, `${what}: fog hue ${f.hue.toFixed(0)}° (rgb ${f.rgb}) is not ${hex} (${hue(hex).toFixed(0)}°)`);
  return f;
}

const row = ".kn-row:has(.kn-row-label:text-is('Cor do Kiwi Cat'))";
const corner = ".kn-kiwicat";
const preview = ".kn-cat-preview";
const report: { checks: string[]; samples: Record<string, unknown> } = { checks: [], samples: {} };
const browser = await webkit.launch({ headless: true });
try {
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  await invoke("agent.download");
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }

  for (const theme of ["light", "dark"] as const) {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme, width: 900, height: 900, motion: true, browser: "webkit", query: { section: "settings", topic: "agent" } });
    const p = w.page;
    await p.waitForSelector(row);
    await p.locator(row).scrollIntoViewIfNeeded();
    await p.waitForSelector(`${preview}[data-ready="true"]`);
    await p.waitForSelector(`${corner}[data-ready="true"]`);
    await Bun.sleep(600);
    if (theme === "light") {
      // 1. Só amostras prontas, a do agente marcada; nenhum campo de código, nenhum seletor livre.
      const radios = p.locator(`${row} [role=radio]`);
      assert.equal(await radios.count(), catColorOptions().length);
      assert.equal(await p.locator(`${row} [role=radio][aria-checked=true]`).getAttribute("aria-label"), "A do agente");
      assert.equal(await p.locator(`${row} input`).count(), 0, "no input in the row (no hex field, no <input type=color>)");
      assert.equal(await p.locator(preview).getAttribute("data-cor"), "#ff9b5e");
      await expectHue(p, preview, "#ff9b5e", "preview, agent colour");
      await expectHue(p, corner, "#ff9b5e", "corner cat, agent colour");
      report.checks.push(`Settings › Agente shows "Cor do Kiwi Cat" with ${catColorOptions().length} ready swatches, the agent's checked, no input of any kind`);
    }
    await p.locator(row).screenshot({ path: join(out, `linha-${theme}.png`) });
    // A posição e o tamanho do gato (spec #12949), logo abaixo do "por cima dos outros apps": a prévia segue a escolha.
    const place = ".kn-row:has(.kn-cat-place)";
    await p.locator(place).scrollIntoViewIfNeeded();
    if (theme === "light") {
      await p.locator(`${place} select`).selectOption("bottom-left");
      for (let i = 0; (await invoke("settings.get")).kiwicat.posicao !== "bottom-left"; i++) { assert.ok(i < 50, "a posição vai para os ajustes"); await Bun.sleep(100); }
      assert.equal(await p.locator(`${place} .kn-cat-screen-cat`).getAttribute("data-posicao"), "bottom-left");
      report.checks.push("Settings › Agente: the position (six options) and the size slider under the overlay switch, with the screen preview following the choice");
    }
    await p.locator(place).screenshot({ path: join(out, `posicao-${theme}.png`) });
    if (theme === "dark") { await w.close(); break; }

    // 2. Um clique: a amostra e o gato do canto trocam na hora, sem reiniciar o gato (o mesmo canvas).
    await p.evaluate((sel) => ((document.querySelector(`${sel} canvas`) as any).__kept = true), corner);
    await p.locator(`${row} [role=radio][aria-label="Violeta"]`).click();
    await savedCor("violeta");
    await p.waitForSelector(`${preview}[data-cor="#a98bff"]`, { timeout: 2000 });
    await Bun.sleep(600);
    await expectHue(p, preview, "#a98bff", "preview after the click");
    await expectHue(p, corner, "#a98bff", "corner cat after the click");
    assert.equal(await p.evaluate((sel) => (document.querySelector(`${sel} canvas`) as any)?.__kept === true, corner), true, "the corner cat was not recreated");
    report.checks.push("a click on Violeta saves it, and the preview and the corner cat turn violet within the 400 ms passage, the same cat (no restart)");

    // 3. Pelo teclado: as setas andam entre as amostras e escolhem.
    await p.locator(`${row} [role=radio][aria-checked=true]`).focus();
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Verde");
    await savedCor("verde");
    await p.locator(row).screenshot({ path: join(out, "linha-teclado.png") });
    report.checks.push("by keyboard: ArrowRight moves to Verde and picks it, the focus ring on it");
    await Bun.sleep(600);

    // 4. Uma segunda troca no meio da passagem parte da cor em que está: quadros a cada ~60 ms.
    const box = (await p.locator(corner).boundingBox())!;
    const frames: { t: number; hue: number }[] = [];
    const t0 = Date.now();
    await invoke("settings.set", { kiwicat: { cor: "azul" } });
    let switched = false;
    for (let i = 0; Date.now() - t0 < 1100; i++) {
      if (!switched && Date.now() - t0 > 180) { await invoke("settings.set", { kiwicat: { cor: "rosa" } }); switched = true; }
      const file = join(out, "frames", `f${String(i).padStart(3, "0")}.png`);
      await p.screenshot({ path: file, clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 } });
      frames.push({ t: Date.now() - t0, hue: (await fog(p, corner)).hue });
    }
    report.samples.midTransition = frames.map((f) => `${f.t}ms ${f.hue.toFixed(0)}°`);
    await expectHue(p, corner, "#ff86bf", "corner cat after azul → rosa mid-passage");
    // Nunca volta ao verde depois de sair dele: a segunda troca parte da cor de agora, não da de antes.
    const greenHue = hue("#3cc47c");
    const left = frames.findIndex((f) => hueGap(f.hue, greenHue) > 20);
    assert.ok(left >= 0 && frames.slice(left).every((f) => hueGap(f.hue, greenHue) > 12), JSON.stringify(report.samples.midTransition));
    report.checks.push(`a second change mid-passage (azul, then rosa at ~180 ms) ends on rosa and never jumps back to the old colour (${frames.length} frames)`);

    // 5. Com o Reduzir movimento, a cor troca sem passagem: certa já no primeiro quadro.
    const appearance = (await invoke("settings.get")).appearance;
    await invoke("settings.set", { appearance: { ...appearance, motion: "reduced" } });
    await Bun.sleep(400);
    await invoke("settings.set", { kiwicat: { cor: "ciano" } });
    await p.waitForSelector(`${preview}[data-cor="#27bfd0"]`, { timeout: 2000 });
    await Bun.sleep(60);
    report.samples.reduced = (await expectHue(p, corner, "#27bfd0", "reduced motion: first frame already cyan", 20)).rgb;
    await invoke("settings.set", { appearance });
    report.checks.push("with Reduce Motion the colour changes without the passage (cyan in the first frame)");

    // 6. Com o gato desligado: a linha desabilitada, sem amostra, e nenhum gato carregado na página.
    await invoke("settings.set", { kiwicat: { show: false } });
    await p.waitForSelector(`${row} [role=radio][disabled]`);
    assert.equal(await p.locator(preview).count(), 0);
    assert.equal(await p.locator(`${corner}`).count(), 0);
    await p.locator(row).screenshot({ path: join(out, "linha-desligada.png") });
    await invoke("settings.set", { kiwicat: { show: true } });
    await w.close();
    report.checks.push("with the cat off, the row is disabled and shows no preview");
  }

  // 7. Uma página aberta com o gato desligado nem baixa o módulo do gato (o import dinâmico nunca roda).
  await invoke("settings.set", { kiwicat: { show: false } });
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 900, height: 900, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    await w.page.waitForSelector(`${row} [role=radio][disabled]`);
    await Bun.sleep(500);
    assert.equal(await w.page.locator("canvas").count(), 0, "no cat canvas with the cat off");
    report.samples.resources = await w.page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()));
    await w.close();
  }
  await invoke("settings.set", { kiwicat: { show: true } });
  await invoke("agent.disable");
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 900, height: 900, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    await w.page.waitForSelector(`${row} [role=radio][disabled]`);
    assert.equal(await w.page.locator("canvas").count(), 0);
    assert.match((await w.page.locator(row).textContent()) ?? "", /Ligue o agente/);
    await w.close();
  }
  report.checks.push("a page opened with the cat off, or with the agent off, has the row disabled and no cat canvas at all");

  // 8. A escolha continua depois de fechar e abrir o app.
  await cli(["stop"]);
  await cli(["start", "--no-helper"]);
  await invoke("agent.enable", { consent: true });
  // O onboarding (spec #11955) abre na primeira vez que o agente liga e cobre o hub: aqui ele já foi feito.
  await invoke("agent.configure", { onboarding: { state: "done" } });
  for (let n = 0; (await invoke("agent.status")).adapter.phase !== "ready"; n++) { assert.ok(n < 200); await Bun.sleep(100); }
  assert.equal((await invoke("settings.get")).kiwicat.cor, "ciano");
  {
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 900, height: 900, motion: false, browser: "webkit", query: { section: "settings", topic: "agent" } });
    await w.page.waitForSelector(`${corner}[data-ready="true"]`);
    assert.equal(await w.page.locator(`${row} [role=radio][aria-checked=true]`).getAttribute("aria-label"), "Ciano");
    assert.equal(await w.page.locator(corner).getAttribute("data-cor"), catColorHex("ciano"));
    // Com o gato ligado, o módulo do gato vem num pedaço à parte; com ele desligado (o passo 7), esse pedaço não veio.
    const on: string[] = await w.page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()!));
    const catChunks = on.filter((name) => !(report.samples.resources as string[]).includes(name) && /\.js$/.test(name));
    report.samples.catChunks = catChunks;
    assert.ok(catChunks.length > 0, `the cat module is a chunk of its own: ${JSON.stringify(on)}`);
    await w.close();
  }
  report.checks.push("after closing and opening the app, Ciano is still checked and the corner cat is cyan");

  // 9. A folha: a névoa de cada cor no fundo preto e no branco, o gato sempre preto.
  const server = await serveFogDemo("cat-demo.ts");
  try {
    const cells: string[] = [];
    for (const o of catColorOptions()) {
      for (const bg of ["#000000", "#ffffff"]) {
        const page = await browser.newPage({ viewport: { width: 160, height: 200 }, deviceScaleFactor: 2 });
        await page.goto(`${server.url}/?state=repouso&parado=1&cutout=1&width=160&height=200&color=${encodeURIComponent(o.hex)}&background=${encodeURIComponent(bg)}&symbolTheme=${bg === "#000000" ? "dark" : "light"}`);
        await page.waitForFunction(() => (window as any).kiwiCatReady);
        await Bun.sleep(300);
        const png = (await page.screenshot()).toString("base64");
        cells.push(`<figure><img src="data:image/png;base64,${png}"><figcaption>${o.label} <code>${o.hex}</code><br>${(contrastRatio(o.hex, bg)).toFixed(2)}:1 no ${bg === "#000000" ? "preto" : "branco"}</figcaption></figure>`);
        await page.close();
      }
    }
    const sheet = await browser.newPage({ viewport: { width: 1400, height: 560 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<style>body{margin:0;padding:24px;background:#6b6b74;font:13px -apple-system,sans-serif;color:#fff}
      h1{font-size:18px;margin:0 0 16px}main{display:grid;grid-template-columns:repeat(8,160px);gap:12px 8px}
      figure{margin:0}img{width:160px;height:200px;display:block;border-radius:8px}figcaption{margin-top:4px;line-height:1.35}</style>
      <h1>A névoa de cada cor no fundo preto e no branco (spec #9349): o gato é sempre preto; toda cor tem contraste ≥ 2:1 nos dois</h1>
      <main>${cells.join("")}</main>`);
    await sheet.screenshot({ path: join(out, "folha.png"), fullPage: true });
    await sheet.close();
    report.checks.push(`the sheet: ${catColorOptions().length} colours × black and white backgrounds`);
  } finally {
    server.close();
  }
  console.log(JSON.stringify({ ok: true, ...report }, null, 1));
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
  registry.stop?.();
  rmSync(data, { recursive: true, force: true });
}
