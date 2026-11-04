// O ícone do app (T2467, spec #2457 ponto 1), como o Channels faz (`kiwi-init/channels`, `desktop/scripts/icons.ts`):
// cada tamanho renderizado do vetor, nunca um PNG grande reamostrado. Até aqui o app não tinha ícone nenhum (o Info.plist
// pedia `AppIcon`, e o bundle não tinha o .icns), e o Dock mostrava o genérico.
//
//   bun scripts/app-icon.ts                                   # gera build-config/icon.svg e build-config/icon.iconset
//   bun scripts/app-icon.ts --compare <channels.svg> <out.png> # prancha lado a lado com o do Channels (16, 32, 128, 512)
//
// O desenho é o Kiwi-cat Aura (T2025, `docs/brand/kiwi-cat-familia/kiwi-cat-1-aura.svg`), na grade do ícone do Channels:
// a base de 824 px com 100 de margem numa tela de 1024, e o raio de 185 (o grid de ícone do macOS). O resultado é
// commitado; o build só copia (`electrobun.config.ts`, `mac.icons`). Rode de novo ao mudar o SVG. Usa o WebKit do
// Playwright de app/node_modules (o mesmo do `cli screenshot`), com a rede bloqueada.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(APP, "..", "docs", "brand", "kiwi-cat-familia", "kiwi-cat-1-aura.svg");
const OUT_SVG = path.join(APP, "build-config", "icon.svg");
const OUT_ICONSET = path.join(APP, "build-config", "icon.iconset");

/** A grade do Channels (`desktop/build/icon.svg`): base em 100..924, raio 185. */
export const GRID = { canvas: 1024, inset: 100, base: 824, radius: 185 } as const;
/** Os tamanhos do iconset do macOS: cada um em 1x e 2x (16@2x = 32, 512@2x = 1024). */
export const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;

/**
 * O SVG do ícone: o Aura inteiro (1024, raio 224) encaixado na base de 824 do Channels. O raio de dentro vira 230 para
 * que, reduzido a 824/1024, dê os 185 do Channels.
 */
export function iconSvg(aura: string): string {
  const open = /<svg\b[^>]*>/.exec(aura);
  const close = aura.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error("app-icon: the Aura SVG has no <svg> root");
  const inner = aura.slice(open.index + open[0].length, close);
  const innerRadius = Math.round((GRID.radius * GRID.canvas) / GRID.base);
  const body = inner.replace(/rx="224"/g, `rx="${innerRadius}"`);
  if (body === inner) throw new Error('app-icon: the Aura SVG has no rx="224" base to fit');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID.canvas} ${GRID.canvas}" width="${GRID.canvas}" height="${GRID.canvas}">`,
    `<!-- Gerado por app/scripts/app-icon.ts (T2467) de docs/brand/kiwi-cat-familia/kiwi-cat-1-aura.svg. Não edite à mão. -->`,
    `<svg id="kiwi-cat" x="${GRID.inset}" y="${GRID.inset}" width="${GRID.base}" height="${GRID.base}" viewBox="0 0 ${GRID.canvas} ${GRID.canvas}">`,
    body.trim(),
    `</svg>`,
    `</svg>`,
    "",
  ].join("\n");
}

/** Os arquivos do iconset: `icon_16x16.png`, `icon_16x16@2x.png`… com o tamanho em px de cada um. */
export function iconsetFiles(): { name: string; px: number }[] {
  return ICONSET_SIZES.flatMap((n) => [
    { name: `icon_${n}x${n}.png`, px: n },
    { name: `icon_${n}x${n}@2x.png`, px: n * 2 },
  ]);
}

type Page = {
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  screenshot(o: { omitBackground: boolean; type: "png" }): Promise<Buffer>;
  route(re: RegExp, fn: (r: { abort(): void }) => void): Promise<void>;
};

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const { webkit } = await import(path.join(APP, "node_modules", "playwright-core", "index.mjs"));
  const browser = await webkit.launch();
  try {
    const page = (await browser.newPage({ deviceScaleFactor: 1 })) as Page;
    await page.route(/^https?:/, (r) => r.abort());
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Um tamanho, do vetor: o SVG desenhado já no tamanho final. */
async function render(page: Page, svg: string, px: number): Promise<Buffer> {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true, type: "png" });
}

async function generate(): Promise<void> {
  const svg = iconSvg(readFileSync(SOURCE, "utf8"));
  writeFileSync(OUT_SVG, svg);
  rmSync(OUT_ICONSET, { recursive: true, force: true });
  mkdirSync(OUT_ICONSET, { recursive: true });
  await withPage(async (page) => {
    for (const f of iconsetFiles()) writeFileSync(path.join(OUT_ICONSET, f.name), await render(page, svg, f.px));
  });
  // Confere que o iconutil aceita (é o que o Electrobun roda no build) e que o .icns sai com todos os tamanhos.
  const tmp = mkdtempSync(path.join(tmpdir(), "kn-icon-"));
  try {
    execFileSync("iconutil", ["-c", "icns", OUT_ICONSET, "-o", path.join(tmp, "AppIcon.icns")]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`app-icon: ${path.relative(APP, OUT_SVG)} and ${iconsetFiles().length} PNGs in ${path.relative(APP, OUT_ICONSET)}`);
}

/** A prancha: o Kiwi Notes em cima e o Channels embaixo, em 16, 32, 128 e 512 px, cada um do vetor e a 1:1. */
async function compare(channelsSvg: string, out: string): Promise<void> {
  const ours = readFileSync(OUT_SVG, "utf8");
  const theirs = readFileSync(channelsSvg, "utf8");
  const sizes = [16, 32, 128, 512];
  const shots: Record<string, string> = {};
  await withPage(async (page) => {
    for (const [who, svg] of [["kiwi", ours], ["channels", theirs]] as const) {
      for (const px of sizes) shots[`${who}-${px}`] = (await render(page, svg, px)).toString("base64");
    }
    const cell = (who: string, px: number) =>
      `<figure><img width="${px}" height="${px}" src="data:image/png;base64,${shots[`${who}-${px}`]}"><figcaption>${px}</figcaption></figure>`;
    const row = (who: string, label: string) => `<div class="row"><h2>${label}</h2>${sizes.map((px) => cell(who, px)).join("")}</div>`;
    const html = `<!doctype html><style>
      body{margin:0;padding:24px;font:13px -apple-system,system-ui;color:#222;background:#ececec}
      .row{display:flex;align-items:flex-end;gap:28px;margin-bottom:24px}
      h2{width:110px;font-size:13px;margin:0 0 20px}
      figure{margin:0;text-align:center} img{display:block;image-rendering:pixelated}
      figcaption{margin-top:6px;color:#666}
    </style>${row("kiwi", "Kiwi Notes")}${row("channels", "Channels")}`;
    await page.setViewportSize({ width: 900, height: 1180 });
    await page.setContent(html);
    writeFileSync(out, await page.screenshot({ omitBackground: false, type: "png" }));
  });
  console.log(`app-icon: board in ${out}`);
}

if (import.meta.main) {
  const i = process.argv.indexOf("--compare");
  if (i >= 0) {
    const [channels, out] = process.argv.slice(i + 1);
    if (!channels || !out) throw new Error("usage: bun scripts/app-icon.ts --compare <channels icon.svg> <out.png>");
    await compare(channels, out);
  } else await generate();
}
