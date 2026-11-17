// O fim da intro vira a janela do hub (T16769, spec #16759), no WebKit headless e no headless do app. Nunca abre janela.
//
// 1. A intro (o build de verdade, com o `?layout=` no papel do main), para o hub padrão e para um hub salvo noutro
//    lugar e tamanho:
//    - no meio do gato (t=3,5), o quadro é o de antes: 320 px, no meio da área útil;
//    - no último frame, a moldura é o retângulo do hub ao pixel, com os cantos da janela e a cor de fundo do hub, e a
//      janela de mentira do pacote não existe mais; fora dela, a janela continua transparente;
//    - no movimento reduzido, a moldura não cresce: some no lugar.
// 2. O hub (com o headless e o agente falso): segurado para a intro (`__kiwiHold`), o conteúdo fica transparente; ao
//    aparecer (`__kiwiReveal`), entra só com o fade, sem o `window-in`, e ocupa a janela inteira. O --bg dele é o da
//    moldura no fim da intro.
//
// Da raiz do app: `bun scripts/intro-hub-check.ts [pasta]` (os prints). Sai 1 se algo não bate.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";
import { HUB_CORNER_RADIUS, hubFrame, introWindow, type IntroLayout } from "../src/shared/intro-layout.ts";
import { WINDOW_SPECS } from "../src/shared/window-specs.ts";
import { INTRO_DURATION, REDUCED_DURATION } from "../ui/kiwicat-v2/timeline.ts";
import { connect, request } from "./cli";
import { ensureBuild, openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T16769-intro-hub"));
mkdirSync(out, { recursive: true });

// Uma tela inventada de 1512×982, com a barra de menus de 33 px.
const AREA = { x: 0, y: 33, width: 1512, height: 949 };
const CASES = [
  { name: "padrao", saved: null },
  { name: "salvo", saved: { x: 120, y: 80, width: 1000, height: 680 } },
] as const;

const checks: string[] = [];
const near = (a: number, b: number, what: string, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b}`);

// ------------------------------------------------------------------ 1. a intro
const dist = ensureBuild("intro");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const rel = new URL(req.url).pathname.replace(/^\/+/, "") || "index.html";
    const file = Bun.file(resolve(dist, rel));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "Content-Security-Policy": VIEWS_CSP } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await webkit.launch({ headless: true });
let decoder: Page | undefined;

/** A cor do pixel no meio de `r`, pelo print da página (o que a tela mostra, não o CSS). */
async function pixel(p: Page, x: number, y: number): Promise<[number, number, number, number]> {
  // Sem o fundo padrão do print: o que é transparente na janela sai com alfa 0.
  const png = await p.screenshot({ clip: { x: x - 2, y: y - 2, width: 4, height: 4 }, omitBackground: true });
  // Lido numa página em branco: a CSP da intro não deixa a página dela buscar um data: URL.
  decoder ??= await browser.newPage();
  return decoder.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number];
  }, png.toString("base64"));
}
const hex = (s: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  assert.ok(m, `--bg não é #rrggbb: ${s}`);
  const n = Number.parseInt(m[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

let introBg = "";
try {
  for (const c of CASES) {
    const hub = hubFrame(c.saved, AREA, [AREA], WINDOW_SPECS.hub);
    const { frame, layout } = introWindow(AREA, WINDOW_SPECS.intro, hub);
    assert.ok(layout, `${c.name}: sem layout`);
    const L = layout as IntroLayout;
    for (const reduced of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: frame.width, height: frame.height },
        deviceScaleFactor: 2,
        colorScheme: "dark",
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(String(e)));
      await page.route("**/*", (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
      const at = async (t: number) => {
        await page.goto(`${origin}/index.html?t=${t}&layout=${encodeURIComponent(JSON.stringify(L))}`);
        await page.waitForTimeout(250);
        return page.evaluate(() => {
          const s = document.getElementById("stage")!;
          const r = s.getBoundingClientRect();
          const cs = getComputedStyle(s);
          return {
            box: { x: r.x, y: r.y, width: r.width, height: r.height },
            radius: Number.parseFloat(cs.borderTopLeftRadius),
            opacity: Number(cs.opacity),
            mockup: document.querySelectorAll("#app-win, .aw-bar, .aw-body").length,
            bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
          };
        });
      };
      const tag = `${c.name}${reduced ? " (reduzido)" : ""}`;

      // O começo é o de antes: o quadrado de 320 no meio da área útil.
      const mid = await at(reduced ? 0.5 : 3.5);
      near(mid.box.width, 320, `${tag}: o quadro no meio do gato`);
      near(mid.box.x + mid.box.width / 2, L.center.x, `${tag}: o meio do quadro (x)`);
      near(mid.box.y + mid.box.height / 2, L.center.y, `${tag}: o meio do quadro (y)`);
      checks.push(`${tag}: o gato no quadro de 320 px, no meio da área útil`);

      const end = await at(reduced ? REDUCED_DURATION : INTRO_DURATION);
      assert.equal(end.mockup, 0, `${tag}: a janela de mentira ainda está na página`);
      if (!reduced) {
        near(end.box.x, L.target.x, `${tag}: x da moldura no fim`);
        near(end.box.y, L.target.y, `${tag}: y da moldura no fim`);
        near(end.box.width, L.target.width, `${tag}: largura da moldura no fim`);
        near(end.box.height, L.target.height, `${tag}: altura da moldura no fim`);
        near(end.radius, HUB_CORNER_RADIUS, `${tag}: os cantos no fim`, 0.5);
        // Na tela: a moldura tem a cor do fundo do hub, no meio e perto dos cantos.
        const want = hex(end.bg);
        for (const [x, y] of [[L.target.x + L.target.width / 2, L.target.y + L.target.height / 2], [L.target.x + 40, L.target.y + 40], [L.target.x + L.target.width - 40, L.target.y + L.target.height - 40]]) {
          const got = (await pixel(page, x!, y!)).slice(0, 3);
          got.forEach((v, i) => near(v, want[i]!, `${tag}: a cor em ${Math.round(x!)},${Math.round(y!)} (${got} ≠ ${want})`, 2));
        }
        // Fora da moldura, a janela continua transparente: nada de fundo cinza que some de repente na troca.
        const corner = await pixel(page, 4, 4);
        // (A ponta da sombra pode chegar ao canto: um alfa baixo passa; o fundo opaco dá 255.)
        assert.ok(corner[3]! <= 40, `${tag}: o canto da janela não é transparente (${corner})`);
        introBg = end.bg;
        await page.screenshot({ path: join(out, `intro-fim-${c.name}.png`) });
        checks.push(`${tag}: no fim, a moldura é o hub (${L.target.width}×${L.target.height} em ${L.target.x},${L.target.y}), com cantos de ${HUB_CORNER_RADIUS} e o --bg ${end.bg}`);
      } else {
        near(end.box.width, 320, `${tag}: no reduzido a moldura não cresce`);
        assert.ok(end.opacity <= 0.01, `${tag}: no reduzido a moldura some (${end.opacity})`);
        checks.push(`${tag}: a moldura não cresce e some no lugar`);
      }
      assert.deepEqual(problems, [], `${tag}: erros na página`);
      await page.close();
    }
  }
} finally {
  server.stop(true);
}

// ------------------------------------------------------------------ 2. o hub
const data = mkdtempSync(join(tmpdir(), "kiwi-intro-hub-"));
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, KIWI_FAKE_AGENT: "1" },
  });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
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
try {
  await cli(["start", "--no-helper"]);
  const { width, height } = WINDOW_SPECS.hub;
  const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "dark", width, height, motion: true, browser: "webkit", query: {} });
  const p = w.page;
  try {
    await p.waitForSelector('.kn-hub-pane[data-section="home"]:not([hidden])');
    await p.waitForTimeout(800); // a entrada da 1ª pintura acaba
    await p.evaluate(() => window.__kiwiHold!());
    const held = await p.evaluate(() => getComputedStyle(document.querySelector(".kn-hub")!).opacity);
    assert.equal(held, "0", "segurado para a intro, o conteúdo do hub fica transparente");
    checks.push("hub: segurado para a intro, o conteúdo fica transparente");

    const names = await p.evaluate(() => {
      window.__kiwiReveal!();
      return document.querySelector(".kn-hub")!.getAnimations().map((a) => (a as CSSAnimation).animationName).sort();
    });
    assert.deepEqual(names, ["fade"], `ao aparecer, só o fade (sem o window-in): ${names}`);
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".kn-hub")!;
      const r = el.getBoundingClientRect();
      return {
        opacity: getComputedStyle(el).opacity,
        transform: getComputedStyle(el).transform,
        box: [r.x, r.y, r.width, r.height],
        bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      };
    });
    assert.equal(after.opacity, "1");
    assert.equal(after.transform, "none", "o hub não sobe nem cresce");
    assert.deepEqual(after.box, [0, 0, width, height], "o hub ocupa a janela inteira");
    assert.equal(after.bg, introBg, "o fundo do hub é a cor em que a moldura da intro termina");
    await p.screenshot({ path: join(out, "hub-revelado.png") });
    checks.push(`hub: aparece só com o fade, na janela inteira, com o mesmo --bg da moldura (${after.bg})`);
  } finally {
    await w.close();
  }
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
for (const c of checks) console.log(`ok  ${c}`);
console.log(`prints em ${out}`);
