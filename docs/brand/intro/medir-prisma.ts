// Mede, no intro.html congelado aos 2,5 s (os três prismas abertos), o ângulo NA TELA da borda de cima de cada
// lâmina, de baixo para cima (a ordem dos .ly.face no DOM), e aos 3,1 s a direção das listras do arco-íris. O alvo é o ícone do Channels (~−28°, #3988; o roteiro pedia o
// leque 17°/21°/24°, trocado pelo harry), e a rotação em X do pose() achata o
// ângulo aplicado no plano, então o intro.js compensa; isto é a conferência (T3898, #3973).
//
//   bun docs/brand/intro/medir-prisma.ts      (usa o Playwright do app/; sai com 1 se algum ângulo passar de 2° do alvo)

import { existsSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const ALVO = [-28, -28, -28]; // de baixo para cima; negativo = a borda longa desce para a direita, como no ícone do Channels (#3988)
const APP = [path.join(here, "../../../app"), path.join(here, "../../../../../kiwinotes/app")].find((d) => existsSync(path.join(d, "node_modules/playwright-core/index.mjs")));
if (!APP) throw new Error("medir-prisma: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.route(/^https?:/, (r: { abort(): void }) => r.abort());
await page.goto(`file://${path.join(here, "intro.html")}?t=2.5`);
await page.waitForTimeout(400);
// Os cantos de cima da face (520×320), projetados pela matriz do elemento: o ângulo da aresta entre eles.
const angulos: number[] = await page.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll(".ly.face")) {
    const m = new DOMMatrix(getComputedStyle(el).transform), w = 520, h = 320;
    const pt = (x, y) => { const v = new DOMPoint(x - w / 2, y - h / 2, 0, 1).matrixTransform(m); return [v.x / v.w, v.y / v.w]; };
    const a = pt(0, 0), c = pt(w, 0);
    out.push((Math.atan2(-(c[1] - a[1]), c[0] - a[0]) * 180) / Math.PI);
  }
  return out;
})()`);
// A direção das listras do arco-íris na tela, aos 3,1 s (a faixa parada nas três lâminas): o eixo x da faixa, pela
// matriz da face composta com a da faixa. No ícone elas descem para a esquerda, a ~−46° (y para baixo; #4288, #4302).
await page.goto(`file://${path.join(here, "intro.html")}?t=3.1`);
await page.waitForTimeout(400);
const listras: number[] = await page.evaluate(`(() => {
  const out = [];
  for (const face of document.querySelectorAll(".ly.face")) {
    const band = face.querySelector(".band");
    const M = new DOMMatrix(getComputedStyle(face).transform).multiply(new DOMMatrix(getComputedStyle(band).transform)), w = 520, h = 320;
    const pt = (x, y) => { const v = new DOMPoint(x - w / 2, y - h / 2, 0, 1).matrixTransform(M); return [v.x / v.w, v.y / v.w]; };
    const a = pt(w / 2 - 100, h / 2), c = pt(w / 2 + 100, h / 2);
    out.push((Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI);
  }
  return out;
})()`);
await browser.close();
let ok = true;
const ALVO_LISTRAS = -46;
listras.forEach((a, i) => { const d = Math.abs(a - ALVO_LISTRAS); if (d > 4) ok = false; console.log(`medir-prisma: listras da lâmina ${["de baixo", "do meio", "de cima"][i]}: ${a.toFixed(1)}° na tela (alvo ${ALVO_LISTRAS}°, descendo para a esquerda)${d > 4 ? "  ← fora" : ""}`); });
angulos.forEach((a, i) => { const d = Math.abs(a - ALVO[i]!); if (d > 2) ok = false; console.log(`medir-prisma: lâmina ${["de baixo", "do meio", "de cima"][i]}: ${a.toFixed(1)}° na tela (alvo ${ALVO[i]}°)${d > 2 ? "  ← fora" : ""}`); });
if (!ok) process.exit(1);
