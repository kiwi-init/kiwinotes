// O vídeo do fim da intro (T16769, spec #16759), no WebKit headless: a intro de verdade, tocando em tempo real, e o
// hub aparecendo no lugar da moldura. A troca de janelas é simulada na página (o print do hub por cima, com o mesmo
// fade do `__kiwiReveal`): o headless não tem as duas janelas do macOS.
//
// Da raiz do app: `bun scripts/intro-video.ts <pasta> <print do hub> [--antes]`. Com `--antes`, a intro sem o
// `?layout=` na caixa de 720×480 (como era na main: a janela de mentira), e o hub no meio da tela depois.
import { mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { webkit } from "playwright-core";

import { VIEWS_CSP } from "../src/bun/window-security.ts";
import { hubFrame, introWindow } from "../src/shared/intro-layout.ts";
import { WINDOW_SPECS } from "../src/shared/window-specs.ts";
import { ensureBuild } from "./ui-page.ts";

const [outArg, hubPng] = process.argv.slice(2);
const before = process.argv.includes("--antes");
const out = resolve(outArg ?? "/tmp/kiwi-intro-video");
mkdirSync(out, { recursive: true });
const AREA = { x: 0, y: 33, width: 1512, height: 949 };
const hub = hubFrame(null, AREA, [AREA], WINDOW_SPECS.hub);
const { frame, layout } = introWindow(AREA, WINDOW_SPECS.intro, hub);
const dist = ensureBuild("intro");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/hub.png" && hubPng) return new Response(Bun.file(resolve(hubPng)));
    const file = Bun.file(resolve(dist, path.replace(/^\/+/, "") || "index.html"));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "Content-Security-Policy": VIEWS_CSP } });
  },
});
// A tela inteira (a área útil), para o antes e o depois saírem no mesmo quadro.
const size = { width: AREA.width, height: AREA.height };
const browser = await webkit.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir: out, size } });
  const page = await ctx.newPage();
  // Um fundo de mesa inventado, e a janela da intro como um iframe no lugar dela na tela.
  const win = before
    ? { x: Math.round((AREA.width - 720) / 2), y: Math.round((AREA.height - 480) / 2), width: 720, height: 480 }
    : { x: frame.x - AREA.x, y: frame.y - AREA.y, width: frame.width, height: frame.height };
  const src = `http://127.0.0.1:${server.port}/index.html${before ? "" : `?layout=${encodeURIComponent(JSON.stringify(layout))}`}`;
  const target = before ? { x: hub.x - AREA.x, y: hub.y - AREA.y } : { x: win.x + layout!.target.x, y: win.y + layout!.target.y };
  await page.setContent(`<body style="margin:0;background:linear-gradient(135deg,#3a4a6b,#6b5a7a);height:100vh;overflow:hidden">
    <iframe id="intro" src="${src}" style="position:absolute;left:${win.x}px;top:${win.y}px;width:${win.width}px;height:${win.height}px;border:0;background:transparent" allowtransparency="true"></iframe>
    <img id="hub" src="http://127.0.0.1:${server.port}/hub.png" style="position:absolute;left:${target.x}px;top:${target.y}px;width:${hub.width}px;height:${hub.height}px;border-radius:16px;opacity:0;box-shadow:0 22px 70px rgba(0,0,0,.55)">
  </body>`);
  const intro = page.frameLocator("#intro");
  await intro.locator("body.done").waitFor({ state: "attached", timeout: 15000 });
  // A troca: o hub aparece por cima (o fade do conteúdo é o do __kiwiReveal, 0,28 s); no antes, a intro fecha e o hub abre
  // com o window-in.
  await page.evaluate((b) => {
    const img = document.getElementById("hub") as HTMLImageElement;
    if (b) document.getElementById("intro")!.remove();
    img.animate(
      b
        ? [{ opacity: 0, transform: "translateY(8px) scale(0.985)" }, { opacity: 1, transform: "none" }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: b ? 480 : 280, fill: "forwards" },
    );
    if (!b) setTimeout(() => document.getElementById("intro")!.remove(), 150);
  }, before);
  await page.waitForTimeout(1200);
  const video = page.video();
  await ctx.close();
  const p = await video!.path();
  renameSync(p, resolve(out, before ? "antes.webm" : "depois.webm"));
} finally {
  await browser.close();
  server.stop(true);
}
