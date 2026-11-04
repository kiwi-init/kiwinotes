// A névoa nova do Kiwi-cat (T3151, #3581): o corpo reto e centrado sob a cabeça, se desfazendo embaixo, e as tintas da
// aura nas posições do roteiro. Sai no espaço da foto (512×640, olhos em x=256), como as camadas de `referencia/`, para
// empilhar no Rive sem conta de posição: `nevoa/manifest.json` tem x, y, w, h de cada sprite nesse espaço.
//
// Como é feito: o corpo é UM sprite de densidade (soma de gaussianas; miolo #0A0A0F, borda lavanda vinda da densidade
// total), porque sprites separados empilhados com "over" viram bolas; o Rive anima ele por mesh e escala, e a vida
// interna vem das tintas (manchas soltas, uma cor cada) por cima, cada uma com órbita própria. A prévia empilha os
// sprites com "over", igual ao Rive, então o que ela mostra é o que o arquivo mostra. A cabeça e o brilho da prévia
// são só para ver a pose: as camadas da cabeça são as de `recortar-referencia.ts`.
//
// O `ctx.filter` do canvas não faz nada no WebKit headless; o blur da luz é um box blur em 3 passadas, em JS.
//
// Uso: bun docs/brand/rive/nevoa.ts   (escreve docs/brand/rive/nevoa/*.webp, manifest.json, pose.png e previa.png;
// precisa do `cwebp`)
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WT = HERE;
const APP = path.join(HERE, "../../../app");
const OUT = path.join(HERE, "nevoa");

/** A referência (512×640) no palco (1024): escala 1,6 com o centro da cabeça em (512, 430). */
export const FIT = { s: 1.6, dx: 512 - 256 * 1.6, dy: 430 - 330 * 1.6 };
export const EYES = [
  { x: 201, y: 320, r: 17 },
  { x: 311, y: 320, r: 17 },
].map((e) => ({ x: FIT.dx + e.x * FIT.s, y: FIT.dy + e.y * FIT.s, r: e.r * FIT.s }));
/** As orelhas na referência, do contorno de fora até a base (medidas do recortar-referencia.ts). */
const EAR_L = [[100, 150], [140, 140], [268, 196], [232, 222], [196, 246], [168, 286], [118, 300]];
const EAR_R = [[262, 192], [390, 150], [420, 170], [410, 280], [372, 286], [338, 240], [300, 214]];

/** Os sprites da névoa, no palco. Cada um é uma mancha gaussiana (sigma = r/2) de uma cor, com opacidade. */
export const NEVOA = [
  // O corpo escuro, reto sob a cabeça: um sprite só, porque a borda lavanda vem da densidade total (sprites separados
  // com "over" viram bolas empilhadas). O Rive anima ele por mesh e escala; a vida interna vem das tintas por cima.
  { name: "corpo", blobs: [
    { x: 512, y: 560, r: 200, a: 1.3 }, { x: 512, y: 660, r: 160, a: 1.1 },
    { x: 512, y: 750, r: 135, a: 1 }, { x: 512, y: 830, r: 115, a: 0.9 }, { x: 512, y: 895, r: 95, a: 0.7 },
    { x: 462, y: 720, r: 85, a: 0.6 }, { x: 562, y: 720, r: 85, a: 0.6 },
  ] },
] as const;
export const COR = [
  // A aura da referência nas posições do roteiro, por cima do corpo e nas bordas dele: ciano nas laterais da
  // cabeça, violeta e púrpura à direita, ameixa embaixo à esquerda, lavanda na base.
  { name: "cor-ciano-esq", x: 350, y: 500, r: 85, cor: "#3FD8FF", a: 0.3 },
  { name: "cor-ciano-dir", x: 674, y: 500, r: 85, cor: "#3FD8FF", a: 0.2 },
  { name: "cor-violeta", x: 628, y: 650, r: 100, cor: "#8B5CFF", a: 0.22 },
  { name: "cor-purpura", x: 626, y: 770, r: 95, cor: "#A245E0", a: 0.2 },
  { name: "cor-ameixa", x: 405, y: 790, r: 95, cor: "#D35FC9", a: 0.2 },
  { name: "cor-lavanda", x: 512, y: 880, r: 140, cor: "#8C84B0", a: 0.25 },
  { name: "cor-lavanda-2", x: 390, y: 660, r: 80, cor: "#8C84B0", a: 0.16 },
] as const;

function build(src: string, P: { FIT: typeof FIT; EYES: typeof EYES; EAR_L: number[][]; EAR_R: number[][]; NEVOA: typeof NEVOA; COR: typeof COR }) {
  return new Promise<Record<string, string>>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 1024, H = 1024, N = W * H;
      const canvas = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
      const hex = (s: string) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
      const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
      const boxBlur = (src: Float32Array, w: number, h: number, r: number) => {
        let a = Float32Array.from(src), b = new Float32Array(w * h);
        for (let pass = 0; pass < 3; pass++) {
          for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) { b[y * w + x] = acc / (2 * r + 1); acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
          for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
        }
        return a;
      };
      // 1. A referência no palco, reamostrada pelo browser (bilinear: a borda macia não ganha blocos).
      const ref = canvas();
      const rx = ref.getContext("2d")!;
      rx.imageSmoothingEnabled = true; rx.imageSmoothingQuality = "high";
      rx.drawImage(img, P.FIT.dx, P.FIT.dy, 512 * P.FIT.s, 640 * P.FIT.s);
      const ph = rx.getImageData(0, 0, W, H).data;
      const bg = [0, 0, 0];
      for (const [cx, cy] of [[P.FIT.dx + 6, 6], [P.FIT.dx + 512 * P.FIT.s - 7, 6]]) {
        const i = (Math.round(cy) * W + Math.round(cx)) * 4;
        for (let k = 0; k < 3; k++) bg[k] += ph[i + k] / 2 / 255;
      }
      const inRef = (p: number) => { const x = p % W, y = (p - x) / W; return x >= P.FIT.dx && x < P.FIT.dx + 512 * P.FIT.s && y >= P.FIT.dy && y < P.FIT.dy + 640 * P.FIT.s; };
      const A = new Float32Array(N), F = new Float32Array(N * 3);
      const lum = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      const midX = P.FIT.dx + 256 * P.FIT.s;
      for (let p = 0; p < N; p++) {
        if (!inRef(p)) continue;
        // De frente (#3581): a metade esquerda espelhada no meio dos olhos.
        let q = p; { const x = p % W; if (x > midX) q = p - x + Math.round(2 * midX - x); }
        const c = [ph[p * 4] / 255, ph[p * 4 + 1] / 255, ph[p * 4 + 2] / 255];
        const cm = [ph[q * 4] / 255, ph[q * 4 + 1] / 255, ph[q * 4 + 2] / 255];
        const chroma = Math.max(...c) - Math.min(...c);
        const neutral = sm((chroma - 0.05) / 0.08);
        let a = 0;
        for (let k = 0; k < 3; k++) if (c[k] < bg[k]) a = Math.max(a, (bg[k] - c[k]) / bg[k]);
        const aL = Math.max(0, 1 - lum(c) / lum(bg));
        a = aL + (a - aL) * neutral;
        a *= sm((a - 0.03) / 0.07);
        // A silhueta (o que é preto) vem espelhada; o brilho colorido fica como na referência.
        // De frente (#3581): a silhueta vem da metade esquerda espelhada; o brilho fica como na referência.
        let am = Math.max(0, 1 - lum(cm) / lum(bg)); am *= sm((am - 0.03) / 0.07);
        A[p] = am;
        // O brilho só dentro da cabeça espelhada ou onde a cor é forte (o halo ciano das laterais): sem isso a borda
        // da orelha direita original fica como um fio fantasma onde a cabeça espelhada não cobre.
        const keep = Math.max(sm((am - 0.3) / 0.3), sm((chroma - 0.15) / 0.1));
        for (let k = 0; k < 3; k++) F[p * 3 + k] *= keep;
        for (let k = 0; k < 3; k++) F[p * 3 + k] = Math.max(0, c[k] - bg[k] * (1 - a)) * neutral;
      }
      // 2. A cabeça: só a parte de cima da referência (o queixo se desfaz no corpo novo), cor chapada #101010.
      const chin = (p: number) => 1 - sm(((p - (p % W)) / W - 580) / 90);
      const polyMask = (pts: number[][], extend: number, soft: number) => {
        const c = canvas(); const x = c.getContext("2d")!;
        x.fillStyle = "#fff"; x.beginPath();
        pts.forEach(([px, py], i) => { const X = P.FIT.dx + px * P.FIT.s, Y = P.FIT.dy + py * P.FIT.s + (i >= 3 ? extend : 0); i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
        x.closePath(); x.fill();
        const d = x.getImageData(0, 0, W, H).data; const m = new Float32Array(N);
        for (let p = 0; p < N; p++) m[p] = d[p * 4 + 3] / 255;
        return soft ? boxBlur(m, W, H, soft) : m;
      };
      const earLcut = polyMask(P.EAR_L, 0, 3), earRcut = polyMask(P.EAR_R, 0, 3);
      const earLfull = polyMask(P.EAR_L, 70, 3), earRfull = polyMask(P.EAR_R, 70, 3);
      // 3. Os sprites: cada um é um PNG do tamanho da mancha; a pose empilha todos com "over".
      const stage = canvas(); const sx = stage.getContext("2d")!;
      const layers: Record<string, string> = {};
      const manifest: { name: string; x: number; y: number; w: number; h: number }[] = [];
      const manifestKind: Record<string, string> = {};
      const addImage = (name: string, data: Float32Array, w: number, h: number, ox: number, oy: number, exportIt = true, target: CanvasRenderingContext2D = sx) => {
        const c = canvas(w, h); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let i = 0; i < w * h; i++) { id.data[i * 4] = data[i * 4] * 255; id.data[i * 4 + 1] = data[i * 4 + 1] * 255; id.data[i * 4 + 2] = data[i * 4 + 2] * 255; id.data[i * 4 + 3] = data[i * 4 + 3] * 255; }
        x.putImageData(id, 0, 0);
        target.drawImage(c, ox, oy);
        if (!exportIt) return;
        // Exporta no espaço da foto (512×640, 1/1,6 do palco), como as camadas do kind-koala (#3591).
        const s = P.FIT.s, pw = Math.round(w / s), ph2 = Math.round(h / s);
        const e = canvas(pw, ph2); const ex = e.getContext("2d")!; ex.imageSmoothingQuality = "high"; ex.drawImage(c, 0, 0, pw, ph2);
        layers[name] = e.toDataURL("image/png");
        manifest.push({ name, x: Math.round(((ox - P.FIT.dx) / s) * 10) / 10, y: Math.round(((oy - P.FIT.dy) / s) * 10) / 10, w: pw, h: ph2 });
      };
      const blob = (b: { name: string; x: number; y: number; r: number; cor: string; a: number }, fade: (y: number) => number) => {
        const size = Math.ceil(b.r * 3.2 / 2) * 2, s = b.r / 2, c = hex(b.cor);
        const d = new Float32Array(size * size * 4);
        for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
          const dx = i - size / 2, dy = j - size / 2;
          const g = Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
          const q = (j * size + i) * 4;
          d[q] = c[0]; d[q + 1] = c[1]; d[q + 2] = c[2]; d[q + 3] = b.a * g * fade(b.y - size / 2 + j);
        }
        addImage(b.name, d, size, size, Math.round(b.x - size / 2), Math.round(b.y - size / 2));
      };
      const bottomFade = (y: number) => 1 - sm((y - 770) / 180);
      // A luz atrás de tudo (opção C): a silhueta (cabeça + corpo) borrada, lavanda-cinza, só fora do gato.
      const sil = new Float32Array(N);
      for (let p = 0; p < N; p++) sil[p] = A[p] * chin(p);
      // O corpo primeiro só para ter o alfa dele: a luz é da silhueta inteira (cabeça ∪ corpo), senão ela vaza no queixo.
      const bodyFirst = canvas(); const bodyCtx = bodyFirst.getContext("2d")!;
      const RIM = hex("#6E6888"), DARK = hex("#0A0A0F");
      const bodyA = new Float32Array(N);
      for (const g of P.NEVOA) {
        const x0 = Math.floor(Math.min(...g.blobs.map((b) => b.x - b.r * 1.6))), x1 = Math.ceil(Math.max(...g.blobs.map((b) => b.x + b.r * 1.6)));
        const y0 = Math.floor(Math.min(...g.blobs.map((b) => b.y - b.r * 1.6))), y1 = Math.ceil(Math.max(...g.blobs.map((b) => b.y + b.r * 1.6)));
        const w = x1 - x0, h = y1 - y0, d = new Float32Array(w * h * 4);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const X = x0 + i, Y = y0 + j; let D = 0;
          for (const b of g.blobs) { const s = b.r / 2; D += b.a * Math.exp(-((X - b.x) ** 2 + (Y - b.y) ** 2) / (2 * s * s)); }
          const alpha = Math.min(1, 1.4 * D) * bottomFade(Y), t = sm((D - 0.12) / 0.75);
          const q = (j * w + i) * 4;
          for (let k = 0; k < 3; k++) d[q + k] = RIM[k] + (DARK[k] - RIM[k]) * t;
          d[q + 3] = alpha;
          if (X >= 0 && X < W && Y >= 0 && Y < H) bodyA[Y * W + X] = Math.max(bodyA[Y * W + X], alpha);
        }
        addImage(g.name, d, w, h, x0, y0, true, bodyCtx);
      }
      const headOnly = new Float32Array(N); for (let p = 0; p < N; p++) headOnly[p] = Math.max(A[p] * chin(p), bodyA[p]);
      const luz = (name: string, m: Float32Array, exportIt: boolean) => {
        const near = boxBlur(m, W, H, 20), wide = boxBlur(m, W, H, 56);
        const lz = hex("#8F8AA8"); const d = new Float32Array(N * 4);
        for (let p = 0; p < N; p++) { const g = Math.min(1, 0.9 * near[p] + 0.9 * wide[p]); d[p * 4] = lz[0]; d[p * 4 + 1] = lz[1]; d[p * 4 + 2] = lz[2]; d[p * 4 + 3] = g * 0.8; }
        addImage(name, d, W, H, 0, 0, exportIt);
      };
      luz("luz-cabeca", headOnly, false);
      sx.drawImage(bodyFirst, 0, 0);
      for (const b of P.COR) blob(b, bottomFade);
      // A cabeça e as orelhas (as orelhas com 70 px de sobra para dentro da cabeça, e a cabeça inteira por baixo).
      const head = hex("#101010");
      const part = (name: string, w: (p: number) => number, exportIt = true) => {
        const d = new Float32Array(N * 4);
        for (let p = 0; p < N; p++) { d[p * 4] = head[0]; d[p * 4 + 1] = head[1]; d[p * 4 + 2] = head[2]; d[p * 4 + 3] = A[p] * chin(p) * w(p); }
        addImage(name, d, W, H, 0, 0, exportIt);
      };
      part("cabeca", () => 1, false);
      part("orelha-esquerda", (p) => earLfull[p], false);
      part("orelha-direita", (p) => earRfull[p], false);
      // O brilho da referência (o arco prismático e o halo ciano das laterais), por cima da cabeça.
      {
        const d = new Float32Array(N * 4);
        for (let p = 0; p < N; p++) { const a = Math.min(1, Math.max(F[p * 3], F[p * 3 + 1], F[p * 3 + 2]) * 1.15) * chin(p); if (a <= 0) continue; d[p * 4] = Math.min(1, F[p * 3] / a); d[p * 4 + 1] = Math.min(1, F[p * 3 + 1] / a); d[p * 4 + 2] = Math.min(1, F[p * 3 + 2] / a); d[p * 4 + 3] = a; }
        addImage("brilho", d, W, H, 0, 0, false);
      }
      // Os olhos: vetor branco, sem efeito.
      sx.fillStyle = "#fff";
      for (const e of P.EYES) { sx.beginPath(); sx.arc(e.x, e.y, e.r, 0, Math.PI * 2); sx.fill(); }
      // A prévia: o palco (quadrado preto de cantos 224) e a referência ao lado, na mesma escala da cabeça.
      const prev = canvas(W + 820 + 32, H); const px = prev.getContext("2d")!;
      px.fillStyle = "#111"; px.fillRect(0, 0, prev.width, prev.height);
      px.save(); px.beginPath(); px.roundRect(0, 0, W, H, 224); px.clip(); px.fillStyle = "#000"; px.fillRect(0, 0, W, H); px.drawImage(stage, 0, 0); px.restore();
      px.drawImage(img, W + 32, 0, 512 * P.FIT.s, 640 * P.FIT.s);
      // O palco sozinho, com fundo transparente fora do quadrado.
      const alone = canvas(); const ax = alone.getContext("2d")!;
      ax.beginPath(); ax.roundRect(0, 0, W, H, 224); ax.clip(); ax.fillStyle = "#000"; ax.fillRect(0, 0, W, H); ax.drawImage(stage, 0, 0);
      resolve({ ...layers, "__previa": prev.toDataURL("image/png"), "__pose": alone.toDataURL("image/png"), "__manifest": JSON.stringify(manifest) });
    };
    img.src = src;
  });
}

const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const page = await browser.newPage();
const src = `data:image/jpeg;base64,${readFileSync(path.join(WT, "referencia.jpg")).toString("base64")}`;
const r: Record<string, string> = await page.evaluate(`(${build.toString()})(${JSON.stringify(src)}, ${JSON.stringify({ FIT, EYES, EAR_L, EAR_R, NEVOA, COR })})`);
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "previa.png"), Buffer.from(r.__previa.split(",")[1]!, "base64"));
writeFileSync(path.join(OUT, "pose.png"), Buffer.from(r.__pose.split(",")[1]!, "base64"));
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(JSON.parse(r.__manifest), null, 2) + "\n");
let total = 0;
for (const [name, url] of Object.entries(r)) {
  if (name.startsWith("__")) continue;
  const tmp = path.join(OUT, `${name}.png`), file = path.join(OUT, `${name}.webp`);
  writeFileSync(tmp, Buffer.from(url.split(",")[1]!, "base64"));
  const res = spawnSync("cwebp", ["-quiet", "-q", "90", "-alpha_q", "100", "-exact", tmp, "-o", file]);
  rmSync(tmp);
  if (res.status !== 0) throw new Error(`cwebp falhou em ${name}`);
  total += statSync(file).size;
}
console.log(`nevoa: ${Object.keys(r).length - 3} sprites, ${(total / 1024).toFixed(0)} KB em ${OUT}; prévia em nevoa/previa.png`);
