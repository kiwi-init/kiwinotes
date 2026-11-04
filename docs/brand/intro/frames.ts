// Os frames-chave da intro (T3720), capturados do intro.html no WebKit headless com o `?t=` (o frame congelado
// daquele instante). Sai uma prancha com os frames lado a lado e um PNG por frame, para o harry aprovar.
//
//   bun docs/brand/intro/frames.ts [PASTA]      (padrão: docs/brand/intro/frames/; usa o Playwright do app/)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, "frames");
mkdirSync(out, { recursive: true });

/** Os instantes (s) e o que o roteiro diz que está na tela. f = frame a 60 fps a partir da emenda (3,7 s). */
const FRAMES: [string, number][] = [
  ["f0 · a emenda: o círculo de vidro", 3.7],
  ["f48 · a névoa nasceu e gira", 3.7 + 48 / 60],
  ["f126 · a orelha esquerda levantou", 3.7 + 126 / 60],
  ["f190 · o círculo virou a cabeça", 3.7 + 190 / 60],
  ["f230 · os olhos meio abertos", 3.7 + 230 / 60],
  ["f268 · os olhos abriram de vez", 3.7 + 268 / 60],
  ["f390 · o corpo se formou", 3.7 + 390 / 60],
  ["f480 · a pose final", 3.7 + 480 / 60],
];

const APP = [path.join(here, "../../../app"), path.join(here, "../../../../../kiwinotes/app")].find((d) => existsSync(path.join(d, "node_modules/playwright-core/index.mjs")));
if (!APP) throw new Error("frames: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const html = path.join(here, "intro.html");
const SIZE = 512;
const shots: Buffer[] = [];
try {
  for (const [label, t] of FRAMES) {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    await page.route(/^https?:/, (r: { abort(): void }) => r.abort());
    await page.goto(`file://${html}?t=${t}`);
    await page.waitForTimeout(400);
    const png: Buffer = await page.screenshot();
    const file = path.join(out, `${label.split(" ")[0]}.png`);
    writeFileSync(file, png);
    shots.push(png);
    console.log(`frames: ${label} → ${path.relative(process.cwd(), file)}`);
    await page.close();
  }
  // A prancha: os frames lado a lado, com o rótulo, montada numa página.
  const page = await browser.newPage({ viewport: { width: SIZE * 4 + 5 * 16, height: 2 * (SIZE + 48) + 3 * 16 }, deviceScaleFactor: 1 });
  const cells = FRAMES.map(([label], i) => `<figure><img src="data:image/png;base64,${shots[i]!.toString("base64")}"><figcaption>${label}</figcaption></figure>`).join("");
  await page.setContent(
    `<style>body{margin:16px;background:#1b1b20;color:#eee;font:14px -apple-system,sans-serif;display:grid;grid-template-columns:repeat(4,${SIZE}px);gap:16px}figure{margin:0}img{display:block;width:${SIZE}px;height:${SIZE}px;border-radius:12px}figcaption{padding:8px 0 0}</style>${cells}`,
  );
  const prancha = path.join(out, "prancha.png");
  writeFileSync(prancha, await page.screenshot({ fullPage: true }));
  console.log(`frames: prancha em ${path.relative(process.cwd(), prancha)}`);
} finally {
  await browser.close();
}
