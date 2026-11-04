// Gera o intro.html (T2113) e a janela `intro` do app (T2308) a partir do intro.template.html, do intro.js e das
// camadas do Kiwi-cat (T3720, spec #3133: a imagem aprovada pelo harry, em camadas, animada com CSS).
//
// - **As camadas** vêm de docs/brand/kiwi-cat/camadas/ (camadas.ts, das da T3705): luz, luz-anel, corpo,
//   cabeca, orelha-esquerda, orelha-direita e aro, WebP com alfa no espaço da foto (512×640). Cada uma vira um `<img>`
//   embutido (data URI) numa camada do palco, encaixada pelo camadas.json (a foto ×1,6, o meio dos olhos em 512,414).
//   Nada é borrado ao vivo (#2085): as camadas já vêm macias, e o CSS só move, gira, escala e esmaece.
// - **Os olhos** são dois círculos brancos em HTML, nítidos, sem efeito (roteiro: "olhos 100% nítidos").
// - **O clip das orelhas** é o contorno da cabeça (camadas.json), um `clip-path: path()` no palco: a orelha levanta de
//   dentro da cabeça (B3 do roteiro). (O WebKit não aplica `clip-path: url(#id)` em elementos HTML.)
// - **A geometria** (as origens das rotações, os olhos, o encaixe) sai daqui num `<style>`; a linha do tempo (os
//   beats do roteiro, em @keyframes) fica no modelo.
//
// Duas saídas: o intro.html (o protótipo, um arquivo só, com o script dentro) e app/ui/intro/ (index.html + intro.js):
// lá a CSP das views não deixa script inline, o fundo é transparente e não há o "De novo".
//
//   bun docs/brand/intro/gerar.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const template = readFileSync(path.join(here, "intro.template.html"), "utf8");
const script = readFileSync(path.join(here, "intro.js"), "utf8");
const camDir = path.join(here, "../kiwi-cat/camadas");
const appDir = path.join(here, "../../../app/ui/intro");

interface Camadas {
  espaco: { w: number; h: number };
  olhos: { x: number; y: number; r: number }[];
  pivos: { earLeft: number[]; earRight: number[] };
  encaixe: { escala: number; dx: number; dy: number };
  camadas: string[];
  clipCabeca: string;
}
const cam: Camadas = JSON.parse(readFileSync(path.join(camDir, "camadas.json"), "utf8"));
const { escala: S, dx, dy } = cam.encaixe;
const px = (v: number) => `${Math.round(v * 100) / 100}px`;
/** Um ponto da foto no palco. */
const at = (x: number, y: number) => [dx + x * S, dy + y * S] as const;

const LAYERS = ["luz", "luz-anel", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"];
for (const n of LAYERS) if (!cam.camadas.includes(n)) throw new Error(`gerar: o camadas.json não lista a camada ${n}`);
let total = 0;
const img = (name: string) => {
  const bytes = readFileSync(path.join(camDir, `${name}.webp`));
  total += bytes.length;
  return `<img class="K" alt="" draggable="false" src="data:image/webp;base64,${bytes.toString("base64")}">`;
};

const catHtml = `<div id="cat-float" class="L"><div id="cat-settle" class="L">
        <div id="luz-anel" class="L">${img("luz-anel")}</div>
        <div id="luz" class="L">${img("luz")}</div>
        <div id="corpo" class="L">${img("corpo")}</div>
        <div id="cabeca" class="L">${img("cabeca")}</div>
        <div id="orelhas" class="L"><div id="orelha-esquerda" class="L">${img("orelha-esquerda")}</div><div id="orelha-direita" class="L">${img("orelha-direita")}</div></div>
        <div id="aro" class="L">${img("aro")}</div>
        <div id="olhos" class="L">${cam.olhos.map((o, i) => `<b class="olho" id="olho-${i ? "dir" : "esq"}"></b>`).join("")}</div>
      </div></div>`;

const [pl, pr] = [cam.pivos.earLeft, cam.pivos.earRight].map(([x, y]) => at(x, y));
const [eyeL, eyeR] = cam.olhos.map((o) => ({ c: at(o.x, o.y), r: o.r * S }));
const eyeMid = at(cam.espaco.w / 2, cam.olhos[0]!.y);
const clipStage = cam.clipCabeca.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => { const [sx, sy] = at(Number(x), Number(y)); return `${Math.round(sx * 10) / 10} ${Math.round(sy * 10) / 10}`; });
const geoCss = `
  /* ---- a geometria do Kiwi-cat (gerar.ts, de docs/brand/kiwi-cat/camadas/camadas.json) ---- */
  .K { position: absolute; left: ${px(dx)}; top: ${px(dy)}; width: ${px(cam.espaco.w * S)}; height: ${px(cam.espaco.h * S)}; user-select: none; -webkit-user-drag: none; }
  #orelha-esquerda { transform-origin: ${px(pl[0])} ${px(pl[1])}; }
  #orelha-direita { transform-origin: ${px(pr[0])} ${px(pr[1])}; }
  /* O WebKit não aplica clip-path: url() em HTML; o contorno vai como path(), já no palco. */
  #orelhas { clip-path: path("${clipStage}"); -webkit-clip-path: path("${clipStage}"); }
  #olhos { transform-origin: ${px(eyeMid[0])} ${px(eyeMid[1])}; }
  .olho { position: absolute; border-radius: 50%; background: #fff; will-change: transform; }
  #olho-esq { left: ${px(eyeL.c[0] - eyeL.r)}; top: ${px(eyeL.c[1] - eyeL.r)}; width: ${px(eyeL.r * 2)}; height: ${px(eyeL.r * 2)}; }
  #olho-dir { left: ${px(eyeR.c[0] - eyeR.r)}; top: ${px(eyeR.c[1] - eyeR.r)}; width: ${px(eyeR.r * 2)}; height: ${px(eyeR.r * 2)}; }
</style>`;
const defsSvg = "";

const html = template
  .replace("</style>", geoCss)
  .replace("<!--CAT-->", catHtml)
  .replace("<!--DEFS-->", defsSvg)
  // O comentário longo fica no modelo e no README; o gerado só aponta para eles.
  .replace(/<!--\n  A intro do Kiwi Notes[\s\S]*?-->\n/, "<!-- A intro do Kiwi Notes (T2113). Gerado por gerar.ts a partir de intro.template.html: leia o README.md e edite o modelo. -->\n");
if (html.includes("A intro do Kiwi Notes (T2113), spec")) throw new Error("gerar: o comentário do modelo mudou");
for (const id of ["cat-float", "cat-settle", "luz-anel", "luz", "corpo", "cabeca", "orelhas", "aro", "olhos"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`gerar: falta a camada #${id}`);
}

const docs = html.replace("<!--SCRIPT-->", `<script>\n${script.replace(/^(?=.)/gm, "  ")}</script>`);
writeFileSync(path.join(here, "intro.html"), docs);
console.log(`gerar: docs/brand/intro/intro.html (${(Buffer.byteLength(docs) / 1024).toFixed(1)} KB; as camadas pesam ${(total / 1024).toFixed(0)} KB)`);

// A janela do app: o script num arquivo do pack (a VIEWS_CSP não deixa inline), sem fundo e sem o "De novo".
const appCss = `\n  /* ---- a janela \`intro\` do app (T2308): sem fundo (só o ícone, no meio da tela) e sem o "De novo" ---- */\n  html, body { background: transparent; }\n  #again { display: none; }\n</style>`;
const app = html
  .replace(/<\/style>(?![\s\S]*<\/style>)/, appCss)
  .replace("<!--SCRIPT-->", '<script type="module" src="./intro.js"></script>')
  .replace("<title>Kiwi Notes: intro</title>", "<title>Kiwi Notes</title>");
if (/<script>/.test(app)) throw new Error("gerar: sobrou script inline na janela do app");
mkdirSync(appDir, { recursive: true });
writeFileSync(path.join(appDir, "index.html"), app);
writeFileSync(path.join(appDir, "intro.js"), `// Gerado por docs/brand/intro/gerar.ts a partir de docs/brand/intro/intro.js: edite lá.\n${script}`);
console.log(`gerar: app/ui/intro/index.html (${(Buffer.byteLength(app) / 1024).toFixed(1)} KB) e intro.js`);
