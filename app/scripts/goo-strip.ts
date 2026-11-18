#!/usr/bin/env bun
// A tira da gota (T18950): junta os recortes que o `hub-goo-check` salva em OUT/<tema>/<ida|volta>/lado-*/ numa grade
// 6×2 por tema e sentido, como os 12 quadros de uma referência de gota pingando.
//
//   bun scripts/goo-strip.ts OUT DEST [--side fim|inicio] [--ref IMAGEM]
//
// Sai DEST/<tema>-<ida|volta>.png. Com `--ref`, a imagem de referência vai ao lado de cada grade, na mesma altura: essa
// versão é só para comparar no canal, nunca para o repo (a referência não é nossa).
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { webkit } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const side = flag("--side") ?? "fim";
const ref = flag("--ref");
const [srcArg, destArg] = args;
if (!srcArg || !destArg || !["fim", "inicio"].includes(side)) {
  console.error("uso: bun scripts/goo-strip.ts OUT DEST [--side fim|inicio] [--ref IMAGEM]");
  process.exit(2);
}
const src = resolve(srcArg);
const dest = resolve(destArg);
mkdirSync(dest, { recursive: true });

const dataUrl = (file: string) => {
  const type = extname(file).toLowerCase() === ".png" ? "png" : extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
};
const refUrl = ref ? dataUrl(resolve(ref)) : null;

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let made = 0;
  for (const theme of ["light", "dark"]) {
    for (const dir of ["ida", "volta"]) {
      const folder = join(src, theme, dir, `lado-${side}`);
      if (!existsSync(folder)) continue;
      const frames = readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
      if (frames.length === 0) continue;
      const cells = frames.map((f) => `<figure><img src="${dataUrl(join(folder, f))}"><figcaption>${Number(f.replace(".png", "").split("-")[1])}%</figcaption></figure>`).join("");
      const bg = theme === "dark" ? "#1c1c1e" : "#ffffff";
      const ink = theme === "dark" ? "#ddd" : "#333";
      await page.setContent(`<!doctype html><html><head><style>
        body { margin: 0; background: ${bg}; color: ${ink}; font: 13px -apple-system, sans-serif; }
        main { display: inline-flex; gap: 24px; padding: 16px; align-items: stretch; }
        h1 { font-size: 14px; margin: 0 0 8px; }
        .grid { display: grid; grid-template-columns: repeat(6, auto); gap: 8px; }
        figure { margin: 0; }
        .grid img { display: block; width: 280px; border: 1px solid rgba(128,128,128,.35); }
        figcaption { text-align: center; opacity: .7; }
        .ref { background: #fff; padding: 0 8px 8px; }
        .ref img { display: block; width: 560px; }
      </style></head><body><main>
        ${refUrl ? `<section class="ref"><h1 style="color:#333">referência</h1><img src="${refUrl}"></section>` : ""}
        <section><h1>${theme === "dark" ? "escuro" : "claro"} · ${dir} · lado ${side}</h1><div class="grid">${cells}</div></section>
      </main></body></html>`);
      await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())));
      const out = join(dest, `${theme}-${dir}.png`);
      await page.locator("main").screenshot({ path: out });
      console.log(out);
      made++;
    }
  }
  if (made === 0) throw new Error(`nenhum quadro em ${src}/<tema>/<ida|volta>/lado-${side}/: rode antes o hub-goo-check com OUT`);
} finally {
  await browser.close();
}
