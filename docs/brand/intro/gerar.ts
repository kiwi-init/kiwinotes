// T3720: empacota as camadas da prancha aprovada em DOM/WAAPI, sem renderizar ao vivo.
// Os bitmaps vêm de `bun docs/brand/kiwi-cat/camadas.ts`; a geometria é a da T3747.
// Gera docs/brand/intro/intro.html e app/ui/intro/{index.html,intro.js}.
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
  pivos: Record<string, number[]>;
  camadas: string[];
  mascara: string;
  recortes: Record<string, number[]>;
}
const cam: Camadas = JSON.parse(readFileSync(path.join(camDir, "camadas.json"), "utf8"));
if (cam.espaco.w !== 1024 || cam.espaco.h !== 1024) throw new Error("gerar: esperado o palco 1024 da prancha aprovada");
let total = 0;
const img = (name: string) => {
  if (!cam.camadas.includes(name)) throw new Error(`gerar: camada ausente: ${name}`);
  const bytes = readFileSync(path.join(camDir, `${name}.webp`));
  total += bytes.length;
  return `<img class="K" alt="" draggable="false" src="data:image/webp;base64,${bytes.toString("base64")}">`;
};
const layer = (name: string, id = name, extra = "") => {
  const [x,y,right,bottom]=cam.recortes[name];
  return `<div id="${id}" class="L ${extra}" data-y="${y}" style="left:${x}px;top:${y}px;width:${right-x}px;height:${bottom-y}px">${img(name)}</div>`;
};
const origin=(name: string, point: number[])=>point.map((v,i)=>`${v-cam.recortes[name][i]}px`).join(" ");
const catHtml = `<div id="cat-float" class="L"><div id="cat-settle" class="L">
  <div id="cat-inicial" class="L">
    ${layer("luz-anel")}
    ${layer("luz-cabeca")}
    ${layer("corpo", "corpo", "body-reveal")}
    ${layer("fundo-cabeca")}
    ${layer("orelha-esquerda")}${layer("orelha-direita")}
    ${layer("vidro")}
    <div id="cabeca" class="L">${layer("cabeca-complemento")}${layer("cabeca", "cabeca-base")}</div>
  </div>
  <div id="cat-final" class="L">
    ${layer("final-fundo")}${layer("final-corpo", "corpo-final", "body-reveal")}
  </div>
  <div id="olhos" class="L">${cam.olhos.map((_eye, i) => `<b class="olho" id="olho-${i ? "dir" : "esq"}"></b>`).join("")}</div>
</div></div>`;
const handoff = layer("vidro", "handoff");
const px = (value: number) => `${Math.round(value*1e4)/1e4}px`;
const mask = readFileSync(path.join(camDir, cam.mascara)).toString("base64");
const geometry = `
  .K { position:absolute; inset:0; width:100%; height:100%; user-select:none; -webkit-user-drag:none; }
  #cat-final { background:#000; }
  #luz-anel { transform-origin:${origin("luz-anel",[512,430])}; }
  #handoff { transform-origin:${origin("vidro",[512,430])}; }
  #orelha-esquerda { transform-origin:${origin("orelha-esquerda",cam.pivos["orelha-esquerda"])}; }
  #orelha-direita { transform-origin:${origin("orelha-direita",cam.pivos["orelha-direita"])}; }
  .body-reveal {
    -webkit-mask-image:url(data:image/png;base64,${mask}); mask-image:url(data:image/png;base64,${mask});
    -webkit-mask-size:100% 2048px; mask-size:100% 2048px;
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
  }
  .olho { position:absolute; border-radius:50%; background:#fff; transform-origin:center; will-change:transform; }
  ${cam.olhos.map((eye, i) => `#olho-${i ? "dir" : "esq"} { left:${px(eye.x-eye.r)}; top:${px(eye.y-eye.r)}; width:${px(eye.r*2)}; height:${px(eye.r*2)}; }`).join("\n  ")}
</style>`;
const html = template.replace("</style>", geometry).replace("<!--CAT-->", catHtml)
  .replace("<!--HANDOFF-->", handoff).replace("<!--DEFS-->", "");
for (const id of ["cat-inicial", "cat-final", "corpo", "corpo-final", "cabeca", "orelha-esquerda", "orelha-direita", "vidro", "handoff", "olhos"]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`gerar: falta ${id}`);
}
writeFileSync(path.join(here, "intro.html"), html.replace("<!--SCRIPT-->", `<script>\n${script}\n</script>`));
const appCss = "html,body{background:transparent} #again{display:none}</style>";
const app = html.replace(/<\/style>(?![\s\S]*<\/style>)/, appCss)
  .replace("<!--SCRIPT-->", '<script type="module" src="./intro.js"></script>')
  .replace("<title>Kiwi Notes: intro</title>", "<title>Kiwi Notes</title>");
if (/<script>/.test(app)) throw new Error("gerar: script inline na janela do app");
mkdirSync(appDir, { recursive: true });
writeFileSync(path.join(appDir, "index.html"), app);
writeFileSync(path.join(appDir, "intro.js"), `// Gerado por docs/brand/intro/gerar.ts; edite docs/brand/intro/intro.js.\n${script}`);
console.log(`gerar: ${(total/1024).toFixed(0)} KB de bitmaps; janela ${(Buffer.byteLength(app)/1024).toFixed(1)} KB`);
