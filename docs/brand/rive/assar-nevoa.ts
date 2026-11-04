// Os sprites da névoa do Kiwi-cat no Rive (T3151, roteiro.md › "Como a névoa é feita"). Nada é borrado ao vivo (#2085):
// cada sprite é um PNG com alfa, já borrado, que o Rive só move, gira, escala e esmaece. Assados no WebKit do Playwright
// (o mesmo do docs/brand/intro/gerar.ts), à metade do tamanho de uso: borrados, a ampliação não aparece.
//
// Uso: bun docs/brand/rive/assar-nevoa.ts   (escreve docs/brand/rive/sprites/*.webp; precisa do `cwebp`)
// O PNG de um degradê macio pesa (760 KB os 16); em WebP com alfa (que o Rive aceita) cabem na meta de 300 KB.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "sprites");

/** A paleta do roteiro, no fundo preto. */
export const COR = {
  ciano: "#3FD8FF",
  azul: "#2E9BFF",
  anil: "#4F72FF",
  violeta: "#8B5CFF",
  purpura: "#A245E0",
  ameixa: "#D35FC9",
  lavanda: "#8C84B0",
  corpo: "#0A0A0F",
} as const;

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Uma mancha macia: núcleo da cor e borda que some, com o blur por cima. */
const mancha = (cor: string, a: number, blur: number, nucleo = 0) =>
  `background: radial-gradient(circle at 50% 50%, ${hexA(cor, a)} ${nucleo}%, ${hexA(cor, a * 0.55)} 38%, ${hexA(cor, 0)} 62%); filter: blur(${blur}px);`;

interface Sprite {
  name: string;
  w: number;
  h: number;
  css?: string;
  html?: string;
}

const RODA = `${COR.ciano}, ${COR.azul}, ${COR.anil}, ${COR.violeta}, ${COR.purpura}, ${COR.ameixa}, ${COR.ciano}`;

const SPRITES: Sprite[] = [
  // O anel contínuo em volta do círculo (R = 225 no palco = 112,5 aqui): uma imagem só, sem pontas. Girar um borrado
  // pronto não muda a borda, então não existe o efeito shuriken.
  {
    name: "anel",
    w: 512,
    h: 512,
    css: `background: conic-gradient(from 200deg, ${RODA});
      -webkit-mask: radial-gradient(circle, transparent 78px, #000 108px, #000 146px, transparent 200px);
      filter: blur(24px); opacity: .9;`,
  },
  // As 4 manchas de cor que dão volume ao anel, cada uma com órbita própria.
  { name: "mancha-ciano", w: 256, h: 256, css: mancha(COR.ciano, 0.85, 14, 6) },
  { name: "mancha-violeta", w: 256, h: 256, css: mancha(COR.violeta, 0.8, 14, 6) },
  { name: "mancha-purpura", w: 256, h: 256, css: mancha(COR.purpura, 0.8, 14, 6) },
  { name: "mancha-ameixa", w: 256, h: 256, css: mancha(COR.ameixa, 0.75, 14, 6) },
  // O corpo de névoa: a massa do corpo, do tom do corpo à lavanda. Miolo escuro, borda mais clara.
  { name: "corpo-1", w: 256, h: 256, css: mancha(COR.corpo, 0.98, 10, 20) },
  { name: "corpo-2", w: 256, h: 256, css: mancha(COR.corpo, 0.95, 12, 12) },
  { name: "corpo-3", w: 256, h: 256, css: mancha("#16131F", 0.92, 12, 10) },
  { name: "corpo-4", w: 256, h: 256, css: mancha(COR.violeta, 0.45, 16, 0) },
  { name: "corpo-5", w: 256, h: 256, css: mancha(COR.purpura, 0.4, 16, 0) },
  { name: "corpo-6", w: 256, h: 256, css: mancha(COR.lavanda, 0.55, 18, 0) },
  // A névoa ambiente, escura e quase parada, para dar profundidade.
  { name: "ambiente-1", w: 256, h: 256, css: mancha("#1A1726", 0.55, 20, 0) },
  { name: "ambiente-2", w: 256, h: 256, css: mancha("#14121D", 0.5, 22, 0) },
  { name: "ambiente-3", w: 256, h: 256, css: mancha("#1E1A2B", 0.45, 22, 0) },
  // O aro prismático: uma faixa fina de luz em arco, do ciano à esquerda ao púrpura à direita, com as pontas sumindo.
  {
    name: "aro",
    w: 512,
    h: 128,
    html: `<svg width="512" height="128" viewBox="0 0 512 128" style="overflow:visible">
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop offset="0" stop-color="${COR.ciano}"/><stop offset=".3" stop-color="${COR.azul}"/>
          <stop offset=".5" stop-color="${COR.anil}"/><stop offset=".72" stop-color="${COR.violeta}"/>
          <stop offset="1" stop-color="${COR.purpura}"/>
        </linearGradient>
        <linearGradient id="fade" x1="0" x2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".16" stop-color="#fff"/>
          <stop offset=".84" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <mask id="m"><rect width="512" height="128" fill="url(#fade)"/></mask>
        <filter id="b" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>
      </defs>
      <g mask="url(#m)"><path d="M 40 104 Q 256 4 472 104" fill="none" stroke="url(#g)" stroke-width="11" stroke-linecap="round" filter="url(#b)"/>
      <path d="M 40 104 Q 256 4 472 104" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round" opacity=".9"/></g>
    </svg>`,
  },
  // O brilho especular do círculo de vidro (B1): um arco claro no canto de cima à esquerda.
  {
    name: "brilho",
    w: 256,
    h: 256,
    html: `<svg width="256" height="256" viewBox="0 0 256 256"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
      <path d="M 52 150 A 84 84 0 0 1 150 52" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="16" stroke-linecap="round" filter="url(#b)"/></svg>`,
  },
];

async function main() {
  mkdirSync(out, { recursive: true });
  const { webkit } = await import(path.join(here, "../../../app/node_modules/playwright-core/index.mjs"));
  const browser = await webkit.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  let total = 0;
  for (const s of SPRITES) {
    // Uma margem em volta: o blur passa da caixa, e o screenshot pega o elemento inteiro com a margem transparente.
    const inner = s.html ?? `<div style="width:${s.w}px;height:${s.h}px;${s.css}"></div>`;
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div id="s" style="width:${s.w}px;height:${s.h}px;display:grid;place-items:center;overflow:visible">${inner}</div></body></html>`);
    const png: Buffer = await page.locator("#s").screenshot({ omitBackground: true });
    const tmp = path.join(out, `${s.name}.png`);
    const file = path.join(out, `${s.name}.webp`);
    writeFileSync(tmp, png);
    const r = spawnSync("cwebp", ["-quiet", "-q", "82", "-alpha_q", "90", tmp, "-o", file]);
    rmSync(tmp);
    if (r.status !== 0) throw new Error(`assar-nevoa: cwebp falhou em ${s.name} (instale com \`brew install webp\`)`);
    total += statSync(file).size;
    console.log(`assar-nevoa: ${s.name}.webp ${s.w}×${s.h} (${(statSync(file).size / 1024).toFixed(1)} KB)`);
  }
  await browser.close();
  console.log(`assar-nevoa: ${SPRITES.length} sprites, ${(total / 1024).toFixed(0)} KB no total (meta do roteiro: < 300 KB)`);
}

if (import.meta.main) await main();
