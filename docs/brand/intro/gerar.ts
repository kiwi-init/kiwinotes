// Gera o intro.html (T2113): o modelo intro.template.html com o Kiwi-cat Aura (T2025) embutido.
//
// A animação do gato não muda (os mesmos @keyframes, tempos e ids). Muda onde o que é borrado é desenhado:
// - **A aura:** no SVG do zip, o blur (desvio de 38 a 62 px) é refeito a cada frame enquanto ela gira e esmaece. Aqui
//   cada grupo vira uma camada HTML com o blur já assado num bitmap, e a camada gira e esmaece por cima, na GPU
//   (#2085). As camadas têm os ids dos grupos (#aura-intro, #aura-orbit…), então o CSS original as anima sem mudar
//   nada; só a origem das rotações vai para as coordenadas do palco (a área segura do ícone está a 80%).
// - **A luz de borda e a borda de vidro** (o fx-rim): no zip, o filtro está no #cat e é refeito a cada frame enquanto
//   as partes se mexem. Medido no WebKit headless: a morfologia da borda de vidro custa ~1,4 s por frame, e a luz de
//   borda ~120 ms; mesmo parado, o filtro trava um frame de 3,4 s quando aparece. Aqui a luz sai assada, e a borda de
//   vidro e o contorno escuro saem em vetor (traços com máscara), na pose final. São duas camadas paradas que acendem
//   quando a parte delas termina de se formar: o corpo e a cabeça (4,8 s), e o rabo (6,0 s), que balança com o
//   #tail-wrap.
//
// Duas saídas (T2308): o intro.html (o protótipo, um arquivo só, com o script dentro) e a janela `intro` do app, em
// app/ui/intro/ (index.html + intro.js): lá a CSP das views não deixa script inline, o fundo é transparente (a janela
// não tem fundo; o palco é o ícone) e não há o "De novo".
//
//   bun docs/brand/intro/gerar.ts [--aura 8]      (usa o Playwright do app/: rode `bun install` em app/ antes)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const svg = readFileSync(path.join(here, "../kiwi-cat-familia/kiwi-cat-1-aura-intro.svg"), "utf8");
const template = readFileSync(path.join(here, "intro.template.html"), "utf8");
const script = readFileSync(path.join(here, "intro.js"), "utf8");
const appDir = path.join(here, "../../../app/ui/intro");

const OUTLINE = "#14161f"; // o contorno escuro do T2025
/**
 * O bitmap cobre o palco com 128 px de folga em volta (-128…1152), menor que ele: o blur é suave. A luz de borda
 * (desvio de 20) vai a 1/5 (256 px). A aura (desvio de 38 a 62) vai a 1/8 (160 px): a 1/12 o quadro parado a 2x tinha
 * degraus em cima da cabeça (revisão do T2113), e a 1/6 não muda nada a olho. Custa +37 KB (T2308). `--aura N` escolhe 1/N.
 */
const auraArg = process.argv.indexOf("--aura");
const BAKE = { stage: 1280, aura: 1 / (auraArg > 0 ? Number(process.argv[auraArg + 1]) : 8), rim: 0.2 };
if (!(BAKE.aura > 0 && BAKE.aura <= 1)) throw new Error("gerar: --aura N, com N de 1 a 12");

function take(source: string, re: RegExp): [string, string] {
  const m = re.exec(source);
  if (!m) throw new Error(`gerar: não achei ${re}`);
  return [m[1] ?? m[0], source.slice(0, m.index) + source.slice(m.index + m[0].length)];
}

/** Renderiza cada camada sozinha (fundo transparente) no WebKit do Playwright e devolve os PNG em data URI. */
async function bake(layers: Record<string, [svg: string, scale: number]>, defs: string): Promise<Record<string, string>> {
  const { webkit } = await import(path.join(here, "../../../app/node_modules/playwright-core/index.mjs"));
  const browser = await webkit.launch();
  try {
    const out: Record<string, string> = {};
    for (const [name, [layerSvg, scale]] of Object.entries(layers)) {
      const page = await browser.newPage({ viewport: { width: BAKE.stage, height: BAKE.stage }, deviceScaleFactor: scale });
      await page.route(/^https?:/, (r: { abort(): void }) => r.abort());
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;background:transparent}</style>` +
          `<svg width="0" height="0" style="position:absolute"><defs>${defs}</defs></svg>` +
          `<div style="position:absolute;left:128px;top:128px;width:1024px;height:1024px">${layerSvg}</div>`,
      );
      await page.waitForTimeout(200);
      const png: Buffer = await page.screenshot({ omitBackground: true });
      out[name] = `data:image/png;base64,${png.toString("base64")}`;
      console.log(`gerar: ${name}: ${(png.length / 1024).toFixed(1)} KB`);
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}

let cat = svg;
let style: string, defs: string, aura: string;
[style, cat] = take(cat, /\s*<style>([\s\S]*?)<\/style>/);
[defs, cat] = take(cat, /\s*<defs>([\s\S]*?)<\/defs>/);
[aura, cat] = take(cat, /\s*<g id="aura">([\s\S]*?)<\/g>\s*(?=<g id="cat-float">)/);
// O preto do fundo é a base do palco; o comentário de estrutura e o título ficam no arquivo do gato.
[, cat] = take(cat, /\s*<rect id="bg"[^>]*\/>/);
[, cat] = take(cat, /\s*<!--[\s\S]*?-->/);
[, cat] = take(cat, /\s*<title[^>]*>[^<]*<\/title>/);
cat = cat.replace(/ role="img" aria-labelledby="kiwi-cat-title"/, ' aria-hidden="true"').replace(/ xmlns:c2pa="[^"]*"/, "");
if (!cat.includes('<g id="cat" filter="url(#fx-rim)">')) throw new Error("gerar: o #cat mudou");
cat = cat.replace('<g id="cat" filter="url(#fx-rim)">', '<g id="cat">');

// As camadas: um svg do tamanho do palco com a área segura (o viewBox aninhado do ícone) dentro.
const layer = (inner: string) =>
  `<svg viewBox="0 0 1024 1024" width="1024" height="1024" overflow="visible"><svg x="0" y="0" width="1024" height="1024" viewBox="-128 -128 1280 1280" overflow="visible">${inner}</svg></svg>`;
// O bitmap assado, de volta no lugar: -128…1152 do palco é -288…1312 da área segura.
const image = (uri: string, extra = "") => `<image href="${uri}" x="-288" y="-288" width="1600" height="1600" preserveAspectRatio="none"${extra}/>`;

const [intro] = take(aura, /<g id="aura-intro-spread"[^>]*>([\s\S]*?)<\/g>/);
const [blobs] = take(aura, /<g id="aura-orbit">([\s\S]*?)<\/g>/);
const [shape] = take(aura, /<g id="aura-shape">([\s\S]*?)<\/g>/);

// A luz de borda do fx-rim sozinha (sem o SourceGraphic, a borda de vidro e o contorno escuro).
const [rimFilter] = take(defs, /(<filter id="fx-rim"[\s\S]*?<\/filter>)/);
const lightFilter = rimFilter
  .replace('id="fx-rim"', 'id="fx-rim-light"')
  .replace(/<feMorphology[\s\S]*?result="glassEdge"\/>/, "")
  .replace(/<feMerge><feMergeNode in="darkEdge"\/>[^\n]*<\/feMerge>/, '<feMerge><feMergeNode in="rimFinal"/></feMerge>');
if (/Morphology|darkEdge|glassEdge|SourceGraphic"\/><\/feMerge>/.test(lightFilter)) throw new Error("gerar: o fx-rim mudou");

// A pose final, em vetor: a silhueta (cabeça, orelhas e corpo) e o rabo, um traço de 50.
const SIL = '<use href="#shape-silhouette"';
const TAIL = '<use href="#shape-tail" fill="none" stroke-linecap="round"';
const silFill = (c: string) => `${SIL} fill="${c}"/>`;
const silStroke = (c: string, w: number) => `${SIL} fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
const tail = (c: string, w: number) => `${TAIL} stroke="${c}" stroke-width="${w}"/>`;
const pose = silFill("#000") + tail("#000", 50);
const mask = (id: string, inner: string) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="-288" y="-288" width="1600" height="1600">${inner}</mask>`;
const everything = '<rect x="-288" y="-288" width="1600" height="1600" fill="#fff"/>';
const masks = [
  // O corpo e o rabo separados: o rabo balança, o resto fica parado. A faixa de 120 em volta do rabo é dele.
  mask("m-tail-band", tail("#fff", 120) + silFill("#000")),
  mask("m-body-band", everything + tail("#000", 120) + silFill("#fff")),
  mask("m-tail-shape", tail("#fff", 50)),
  // A borda de vidro: 6 px por dentro da união (o traço de 12 da silhueta, só a metade de dentro, e onde o rabo não cobre).
  mask("m-glass-body", silStroke("#fff", 12) + `<g clip-path="url(#clip-outside-sil)">${everything.replace("#fff", "#000")}</g>` + tail("#000", 50)),
  mask("m-glass-tail", tail("#fff", 50) + tail("#000", 38) + silFill("#000")),
  // O contorno escuro: 12 px por fora da união.
  mask("m-dark-body", silStroke("#fff", 24) + silFill("#000") + tail("#000", 50)),
  mask("m-dark-tail", tail("#fff", 74) + tail("#000", 50) + silFill("#000")),
].join("\n    ");
// O lado de fora da silhueta (para cortar a metade de fora do traço): o palco inteiro menos ela, pela regra evenodd.
const silPath = (/<path id="shape-silhouette" d="([^"]+)"/.exec(defs) ?? [])[1];
if (!silPath) throw new Error("gerar: sem o #shape-silhouette");
const outside = `<clipPath id="clip-outside-sil"><path clip-rule="evenodd" d="M-288,-288 H1312 V1312 H-288 Z ${silPath}"/></clipPath>`;
defs += `\n    <clipPath id="clip-sil">${SIL}/></clipPath>\n    ${outside}\n    ${masks}`;
const paint = (m: string, color: string, opacity: number) =>
  `<rect x="-288" y="-288" width="1600" height="1600" fill="${color}" fill-opacity="${opacity}" mask="url(#${m})"/>`;

const baked = await bake(
  {
    "aura-intro": [layer(`<g filter="url(#fx-orbit)">${intro}</g>`), BAKE.aura],
    "aura-blobs": [layer(`<g filter="url(#fx-blob)">${blobs}</g>`), BAKE.aura],
    "aura-shape": [layer(shape), BAKE.aura],
    "rim-light-body": [layer(`<g mask="url(#m-body-band)"><g filter="url(#fx-rim-light)">${pose}</g></g>`), BAKE.rim],
    "rim-light-tail": [layer(`<g mask="url(#m-tail-band)"><g filter="url(#fx-rim-light)">${pose}</g></g>`), BAKE.rim],
  },
  `${defs}\n    ${lightFilter}`,
);

const auraHtml = [
  `<div id="aura-intro" class="L"><div id="aura-intro-spin" class="L"><div id="aura-intro-spread" class="L">${layer(image(baked["aura-intro"]!))}</div></div></div>`,
  `<div id="aura-blobs" class="L"><div id="aura-grow" class="L"><div id="aura-orbit" class="L">${layer(image(baked["aura-blobs"]!))}</div></div></div>`,
  `<div id="aura-shape" class="L">${layer(image(baked["aura-shape"]!))}</div>`,
].join("\n      ");
const rimHtml = [
  `<div id="rim-body" class="L">${layer(image(baked["rim-light-body"]!, ' clip-path="url(#clip-sil)"') + paint("m-dark-body", OUTLINE, 0.6) + paint("m-glass-body", "#fff", 0.85))}</div>`,
  `<div id="rim-tail" class="L">${layer(`<g mask="url(#m-tail-shape)">${image(baked["rim-light-tail"]!)}</g>` + paint("m-dark-tail", OUTLINE, 0.6) + paint("m-glass-tail", "#fff", 0.85))}</div>`,
].join("\n      ");

// Os ids que o CSS do gato anima e que não estão mais no SVG têm que existir como camada.
for (const id of ["aura-intro", "aura-intro-spin", "aura-intro-spread", "aura-blobs", "aura-grow", "aura-orbit", "aura-shape"]) {
  if (!auraHtml.includes(`id="${id}"`)) throw new Error(`gerar: falta a camada #${id}`);
}

// Os filtros que ninguém mais usa saem (o da aura e o fx-rim viraram bitmap e vetor).
const usedDefs = defs.replace(/\s*<filter id="fx-(?:aura|orbit|blob|rim)"[\s\S]*?<\/filter>/g, "");
const defsSvg = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${usedDefs}</defs></svg>`;
const html = template
  .replace("</style>", `\n  /* ---- o Kiwi-cat Aura (T2025), sem mudança ---- */\n${style.replace(/^ {4}/gm, "  ")}\n</style>`)
  .replace("<!--AURA-->", auraHtml)
  .replace("<!--CAT-->", `${cat.trim().replace(/\n/g, "\n      ")}\n      ${rimHtml}`)
  .replace("<!--DEFS-->", defsSvg)
  // O comentário longo fica no modelo e no README; o gerado só aponta para eles.
  .replace(/<!--\n  A intro do Kiwi Notes[\s\S]*?-->\n/, "<!-- A intro do Kiwi Notes (T2113). Gerado por gerar.ts a partir de intro.template.html: leia o README.md e edite o modelo. -->\n");
if (html.includes("A intro do Kiwi Notes (T2113), spec")) throw new Error("gerar: o comentário do modelo mudou");

const docs = html.replace("<!--SCRIPT-->", `<script>\n${script.replace(/^(?=.)/gm, "  ")}</script>`);
writeFileSync(path.join(here, "intro.html"), docs);
console.log(`gerar: docs/brand/intro/intro.html (${(Buffer.byteLength(docs) / 1024).toFixed(1)} KB)`);

// A janela do app: o script num arquivo do pack (a VIEWS_CSP não deixa inline), sem fundo e sem o "De novo".
const appCss = `\n  /* ---- a janela \`intro\` do app (T2308): sem fundo (só o ícone, no meio da tela) e sem o "De novo" ---- */\n  html, body { background: transparent; }\n  #again { display: none; }\n</style>`;
const app = html
  .replace(/<\/style>(?![\s\S]*<\/style>)/, appCss)
  .replace("<!--SCRIPT-->", '<script type="module" src="./rive.ts"></script>\n<script type="module" src="./intro.js"></script>')
  .replace("<title>Kiwi Notes: intro</title>", "<title>Kiwi Notes</title>");
if (/<script>/.test(app)) throw new Error("gerar: sobrou script inline na janela do app");
mkdirSync(appDir, { recursive: true });
writeFileSync(path.join(appDir, "index.html"), app);
writeFileSync(path.join(appDir, "intro.js"), `// Gerado por docs/brand/intro/gerar.ts a partir de docs/brand/intro/intro.js: edite lá.\n${script}`);
console.log(`gerar: app/ui/intro/index.html (${(Buffer.byteLength(app) / 1024).toFixed(1)} KB) e intro.js`);
