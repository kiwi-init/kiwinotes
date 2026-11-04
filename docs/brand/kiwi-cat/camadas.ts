// As camadas do Kiwi-cat para a intro (T3720): separa a cabeça inteira nas peças que a animação mexe e escreve o
// contrato que o docs/brand/intro/gerar.ts lê. Serve para as camadas provisórias (pose.ts, 512×640) e para as da
// T3705 (2048×2560): o que muda está no entrada.json da pasta de entrada.
//
// Entrada (uma pasta, padrão camadas/): luz, corpo e cabeca-inteira (.webp ou .png; alfa reto, tudo em 0,0) e
// entrada.json: { espaco {w,h}, olhos [{x,y,r}], orelhaEsquerda, orelhaDireita (polígonos: os 3 primeiros pontos
// são o contorno de fora, os demais a base, onde a orelha encosta na cabeça), sobra (px para dentro da cabeça),
// pretoDaFoto (o alfa do preto da foto, 0,934 nas provisórias; omitido = 1), encaixeEscala (quanto o espaço escala
// para o palco de 1024: 1,6 para 512, 0,4 para 2048), saidaAltura (a altura das camadas exportadas; padrão 1280) }.
// Saída, em camadas/, no espaço exportado (reduzido para saidaAltura, porque o palco tem 1024 px):
// - luz, corpo (as entradas, reduzidas), cabeca (sem as orelhas, com o preto por baixo do aro), orelha-esquerda e
//   orelha-direita (cada uma com a sobra para dentro da cabeça), aro (o que tem cor), luz-cabeca (a luz só da cabeça,
//   sem miolo, para o começo), todas WebP;
// - camadas.json: o espaço, os olhos, os pivôs das orelhas, o encaixe no palco e o contorno da cabeça (o clip das
//   orelhas, um path SVG).
// cabeca + orelhas + aro empilhados com "over" dão a cabeca-inteira (o script mede o vão).
//
// O ctx.filter do canvas não faz nada no WebKit headless: blur e máscaras são em JS.
// Uso: bun docs/brand/kiwi-cat/camadas.ts [PASTA_DE_ENTRADA]   (precisa do `cwebp` e do Playwright do app/)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, "camadas");

interface Entrada {
  espaco: { w: number; h: number };
  olhos: { x: number; y: number; r: number }[];
  orelhaEsquerda: number[][];
  orelhaDireita: number[][];
  sobra: number;
  pretoDaFoto?: number;
  encaixeEscala: number;
  saidaAltura?: number;
  /** O ganho do aro (1,25 nas provisórias: sobre o preto ele perde o cinza que, na foto, aparecia por trás). */
  aroGanho?: number;
}
const entradaDir = process.argv[2] ? path.resolve(process.argv[2]) : dir;
const ENT: Entrada = (() => {
  const own = path.join(entradaDir, "entrada.json");
  if (existsSync(own)) return JSON.parse(readFileSync(own, "utf8"));
  // A pasta da T3705 (docs/brand/kiwi-cat/gerada) traz o contrato dela em camadas.json: os mesmos campos, com o
  // encaixe em `encaixe.escala`; o preto já é opaco e o aro já está certo.
  const c = JSON.parse(readFileSync(path.join(entradaDir, "camadas.json"), "utf8"));
  return { espaco: c.espaco, olhos: c.olhos, orelhaEsquerda: c.orelhaEsquerda, orelhaDireita: c.orelhaDireita, sobra: c.sobra, encaixeEscala: c.encaixe.escala };
})();
const ESPACO = ENT.espaco, OLHOS = ENT.olhos;
const ORELHA_ESQ = ENT.orelhaEsquerda, ORELHA_DIR = ENT.orelhaDireita, SOBRA = ENT.sobra;
/** O fator de redução das camadas exportadas (o palco tem 1024 px; 1280 de altura chega para o 2x). */
const F = Math.min(1, (ENT.saidaAltura ?? 1280) / ESPACO.h);

function split(src: Record<string, string>, P: { w: number; h: number; earL: number[][]; earR: number[][]; sobra: number; olhos: { x: number; y: number; r: number }[]; preto: number; f: number; aroGanho: number }) {
  return new Promise<Record<string, string>>((resolve) => {
    const { w, h } = P, N = w * h, k = w / 512; // k: os raios e as margens, medidos no espaço de 512
    const canvas = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const load = (url: string) => new Promise<ImageData>((ok) => { const i = new Image(); i.onload = () => { const c = canvas(); const x = c.getContext("2d")!; x.drawImage(i, 0, 0); ok(x.getImageData(0, 0, w, h)); }; i.src = url; });
    load(src.cabeca).then(async (head) => {
      const d = head.data;
      const A = new Float32Array(N), C = new Float32Array(N * 3), CH = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        // O preto da foto (#101010) deu alfa 0,934 no pose.ts: aqui o miolo vira opaco, senão a luz vaza 7% pelas
        // orelhas quando elas passam na frente do halo (B2–B3).
        A[p] = Math.min(1, d[p * 4 + 3] / 255 / P.preto);
        // Os olhos da foto são brancos e viraram buracos no alfa; a cabeça por baixo dos olhos (que são vetor) é preta.
        for (const e of P.olhos) { const x = p % w, y = (p - x) / w; const dd = Math.hypot(x - e.x, y - e.y); if (dd < e.r + 4 * k) { const t = sm((e.r + 4 * k - dd) / (3 * k)); A[p] = A[p] + (1 - A[p]) * t; d[p * 4] = d[p * 4] + (16 - d[p * 4]) * t; d[p * 4 + 1] = d[p * 4 + 1] + (16 - d[p * 4 + 1]) * t; d[p * 4 + 2] = d[p * 4 + 2] + (16 - d[p * 4 + 2]) * t; } }
        const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255;
        C[p * 3] = r; C[p * 3 + 1] = g; C[p * 3 + 2] = b;
        CH[p] = Math.max(r, g, b) - Math.min(r, g, b);
      }
      const boxBlur = (s: Float32Array, r: number) => {
        let a = Float32Array.from(s), b = new Float32Array(N);
        for (let pass = 0; pass < 3; pass++) {
          for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) { b[y * w + x] = acc / (2 * r + 1); acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
          for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
        }
        return a;
      };
      // Uma máscara macia de um polígono (rasterizada no canvas, borda borrada em JS).
      const poly = (pts: number[][], soft: number) => {
        const c = canvas(); const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.beginPath();
        pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill();
        const m = x.getImageData(0, 0, w, h).data; const out = new Float32Array(N);
        for (let p = 0; p < N; p++) out[p] = m[p * 4 + 3] / 255;
        return soft ? boxBlur(out, soft) : out;
      };
      const region = (ear: number[][], ext: number) => ear.map(([x, y], i) => (i >= 3 ? [x, y + ext] : [x, y]));
      const soft = Math.max(1, Math.round(2 * k));
      const cutL = poly(region(P.earL, 0), soft), cutR = poly(region(P.earR, 0), soft);
      const fullL = poly(region(P.earL, P.sobra), soft), fullR = poly(region(P.earR, P.sobra), soft);
      // O aro: o que tem cor. Onde ele está, a cabeça por baixo fica preta.
      // O aro é o que tem cor. A luz de transição que a cabeça traz nas bordas (as camadas da T3705) fica na cabeça.
      const solid = (p: number) => sm((A[p] - 0.55) / 0.35);
      const aroW = new Float32Array(N);
      for (let p = 0; p < N; p++) aroW[p] = sm((CH[p] - 0.08) / 0.1);
      // O preto da cabeça: a cor média dos pixels sólidos e sem cor (é o que fica por baixo do aro; um #101010 fixo
      // sobre uma cabeça #000 aparecia como uma faixa cinza no lugar do aro antes de ele acender).
      const DARK = [0, 0, 0]; { let n = 0; for (let p = 0; p < N; p++) if (A[p] > 0.98 && CH[p] < 0.03) { for (let k = 0; k < 3; k++) DARK[k] += C[p * 3 + k]; n++; } for (let k = 0; k < 3; k++) DARK[k] = n ? DARK[k] / n : 0; }
      const layer = (alpha: (p: number) => number, rgb: (p: number) => number[]) => {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) { const a = alpha(p); if (a <= 0.002) continue; const v = rgb(p); id.data[p * 4] = v[0] * 255; id.data[p * 4 + 1] = v[1] * 255; id.data[p * 4 + 2] = v[2] * 255; id.data[p * 4 + 3] = a * 255; }
        x.putImageData(id, 0, 0); return c.toDataURL("image/png");
      };
      // As camadas exportadas, reduzidas por f (o palco tem 1024 px). As entradas luz e corpo passam por aqui também.
      const shrink = (url: string) => new Promise<string>((ok) => { if (P.f >= 1) return ok(url); const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = Math.round(w * P.f); c.height = Math.round(h * P.f); const x = c.getContext("2d")!; x.imageSmoothingQuality = "high"; x.drawImage(i, 0, 0, c.width, c.height); ok(c.toDataURL("image/png")); }; i.src = url; });
      const rgbAt = (p: number) => [C[p * 3], C[p * 3 + 1], C[p * 3 + 2]];
      const under = (p: number) => { const t = Math.min(1, aroW[p] * 3); const v = rgbAt(p); return [v[0] + (DARK[0] - v[0]) * t, v[1] + (DARK[1] - v[1]) * t, v[2] + (DARK[2] - v[2]) * t]; };
      const out: Record<string, string> = {};
      // A cabeça por baixo do aro é sólida: na foto o aro tem alfa ~0,6 (cor sobre o cinza), e sem isso a luz vazaria
      // pela faixa antes de o aro acender. "Dentro" é onde a vizinhança é sólida. Fora do miolo (o halo ciano das
      // laterais), a cor é só do aro: a cabeça não repete o pixel por baixo.
      // O queixo se desfaz (#3771): a cabeça inteira termina na divisa com o corpo, num corte que só o corpo cobre.
      // Na intro a cabeça existe sozinha (f130–f300), então ela cai a zero numa rampa de 60·k px acima do corte, e o
      // corpo recebe, nessa faixa, os pixels da cabeça com o alfa que compensa (b = (a − h) / (1 − h)): a pilha
      // corpo → cabeça continua dando a cabeça inteira.
      let corte = 0; for (let y = 0; y < h; y++) { let m = 0; for (let x = 0; x < w; x++) if (A[y * w + x] > m) m = A[y * w + x]; if (m > 0.1) corte = y; }
      const RAMPA = Math.round(60 * k), rampaTopo = corte - RAMPA;
      const fade = (p: number) => 1 - sm(((p - (p % w)) / w - rampaTopo) / RAMPA);
      const Afull = Float32Array.from(A);
      for (let p = 0; p < N; p++) A[p] *= fade(p);
      const nearA = boxBlur(A, Math.round(6 * k));
      const inside = (p: number) => sm((nearA[p] - 0.55) / 0.25);
      const headA = (p: number) => { const a = A[p] * (1 - aroW[p] * (1 - solid(p))); return a + (1 - a) * Math.min(1, aroW[p] * 3) * inside(p); };
      // A orelha: inteira acima da base (o polígono "cut") e, na sobra por dentro da cabeça, só o que é sólido (nos
      // pixels macios, orelha e cabeça somadas com "over" ficariam mais escuras que a inteira).
      // A cabeça: acima da base, só o que a orelha não cobre (a compensação do "over": juntas dão exatamente a inteira;
      // quando a orelha levanta, o lugar dela fica vazio); abaixo da base, inteira.
      const earA = (cut: Float32Array, full: Float32Array) => (p: number) => headA(p) * (cut[p] + Math.max(0, full[p] - cut[p]) * solid(p));
      const eL = earA(cutL, fullL), eR = earA(cutR, fullR);
      out["orelha-esquerda"] = layer(eL, under);
      out["orelha-direita"] = layer(eR, under);
      const comp = (a: number, e: number) => (e >= 0.999 ? 0 : Math.max(0, (a - e) / (1 - e)));
      out.cabeca = layer((p) => { const a = headA(p), c = Math.min(1, cutL[p] + cutR[p]); return a * (1 - c) + c * comp(a, Math.min(0.999, eL(p) + eR(p))); }, under);
      // O aro um pouco mais forte: sobre o preto ele perde o cinza que, na foto, aparecia por trás dele.
      out.aro = layer((p) => Math.min(1, A[p] * aroW[p] * P.aroGanho), rgbAt);
      // A luz só da cabeça, sem as orelhas (elas ainda não levantaram) e sem o miolo (a cabeça ainda não existe: é o
      // círculo de vidro, e a luz é só o halo em volta), com a mesma receita do pose.ts (raios 28 e 70, ganho 1,15).
      const semOrelhas = new Float32Array(N); for (let p = 0; p < N; p++) semOrelhas[p] = sm((headA(p) - 0.55) / 0.3) * (1 - Math.min(1, cutL[p] + cutR[p]));
      const near = boxBlur(semOrelhas, Math.round(28 * k)), wide = boxBlur(semOrelhas, Math.round(70 * k)), LAV = [0.74, 0.72, 0.82];
      // As luzes caem a alfa 0 antes da borda da imagem (ela não cobre o palco inteiro; sem isso a luz termina numa
      // caixa, #3766 item 1): uma janela macia de 14% da largura.
      const borda = (p: number) => { const x = p % w, y = (p - x) / w; const m = 0.14 * w; return sm(x / m) * sm((w - 1 - x) / m) * sm(y / m) * sm((h - 1 - y) / m); };
      out["luz-cabeca"] = layer((p) => Math.min(1, 1.15 * (0.9 * near[p] + 0.9 * wide[p])) * (1 - sm((semOrelhas[p] - 0.2) / 0.5)) * borda(p), () => LAV);
      // A luz de entrada passa pela mesma janela.
      const luzIn = await load(src.luz); const L = luzIn.data;
      out.luz = layer((p) => (L[p * 4 + 3] / 255) * borda(p), (p) => [L[p * 4] / 255, L[p * 4 + 1] / 255, L[p * 4 + 2] / 255]);
      // O contorno da cabeça inteira (nível 0,5), para o clip das orelhas: Moore + RDP, path fechado.
      const m = new Uint8Array(N); for (let p = 0; p < N; p++) m[p] = A[p] > 0.5 ? 1 : 0;
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
      let sx = -1, sy = -1;
      for (let y = 0; y < h && sx < 0; y++) for (let x = 0; x < w; x++) if (at(x, y)) { sx = x; sy = y; break; }
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const pts: number[][] = [[sx, sy]];
      let cx = sx, cy = sy, dd = 6;
      for (let n = 0; n < 20000; n++) {
        let found = false;
        for (let k = 0; k < 8; k++) { const q = (dd + 6 + k) % 8, nx = cx + dirs[q][0], ny = cy + dirs[q][1]; if (at(nx, ny)) { cx = nx; cy = ny; dd = q; found = true; break; } }
        if (!found || (cx === sx && cy === sy)) break;
        pts.push([cx, cy]);
      }
      const rdp = (a: number[][], eps: number): number[][] => {
        if (a.length < 3) return a;
        const [ax, ay] = a[0], [bx, by] = a[a.length - 1]; let im = 0, dm = 0;
        for (let i = 1; i < a.length - 1; i++) { const [px, py] = a[i]; const L = Math.hypot(bx - ax, by - ay); const dist = L ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay); if (dist > dm) { dm = dist; im = i; } }
        if (dm <= eps) return [a[0], a[a.length - 1]];
        return [...rdp(a.slice(0, im + 1), eps).slice(0, -1), ...rdp(a.slice(im), eps)];
      };
      const simp = rdp([...pts, pts[0]], 1.2 * k).slice(0, -1);
      const clip = `M${simp.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
      const pivot = (ear: number[][]) => { const b = ear.slice(3); return [Math.round(b.reduce((s, q) => s + q[0], 0) / b.length), Math.round(b.reduce((s, q) => s + q[1], 0) / b.length)]; };
      out.__json = JSON.stringify({ pivots: { earLeft: pivot(P.earL), earRight: pivot(P.earR) }, headClip: clip, points: simp.length });
      // Conferência: cabeca + orelhas + aro com "over" tem que dar a cabeça inteira (a diferença máxima por pixel).
      const imgs = ["cabeca", "orelha-esquerda", "orelha-direita", "aro"].map((n) => { const i = new Image(); i.src = out[n]; return i; });
      Promise.all(imgs.map((i) => new Promise((ok) => (i.onload = ok)))).then(async () => {
        const c = canvas(); const x = c.getContext("2d")!; for (const i of imgs) x.drawImage(i, 0, 0);
        const q = x.getImageData(0, 0, w, h).data; let worst = 0;
        // Só onde a pilha fica MENOS opaca que a inteira (um vão); mais opaca é de propósito (o preto sob o aro).
        let wp = 0; for (let p = 0; p < N; p++) { if ((p - (p % w)) / w >= rampaTopo) continue; const diff = d[p * 4 + 3] - q[p * 4 + 3]; if (diff > worst) { worst = diff; wp = p; } }
        out.__worst = `${worst} em (${wp % w}, ${Math.floor(wp / w)})`;
        // O corpo: a entrada, mais a faixa do queixo (os pixels da cabeça com o alfa de compensação) por cima.
        const corpoIn = await load(src.corpo); const B = corpoIn.data;
        out.corpo = layer((p) => { const hA = A[p], fa = hA < 0.999 ? Math.max(0, (Afull[p] - hA) / (1 - hA)) : 0; const ca = B[p * 4 + 3] / 255; return fa + ca * (1 - fa); },
          (p) => { const hA = A[p], fa = hA < 0.999 ? Math.max(0, (Afull[p] - hA) / (1 - hA)) : 0; const ca = B[p * 4 + 3] / 255, a = fa + ca * (1 - fa); if (a <= 0) return [0, 0, 0]; return [0, 1, 2].map((kk) => (C[p * 3 + kk] * fa + (B[p * 4 + kk] / 255) * ca * (1 - fa)) / a); });
        Promise.all(["cabeca", "orelha-esquerda", "orelha-direita", "aro", "luz-cabeca", "luz", "corpo"].map((n) => shrink(out[n]).then((u) => { out[n] = u; }))).then(() => resolve(out));
        return;
        { const p = wp; out.__dbg = JSON.stringify({ A: A[p], d: d[p * 4 + 3] / 255, aroW: aroW[p], solid: solid(p), inside: inside(p), headA: headA(p), cut: cutL[p] + cutR[p], eL: eL(p), eR: eR(p), stack: q[p * 4 + 3] / 255, C: rgbAt(p) }); }
        resolve(out);
      });
    });
  });
}

const APP = [path.join(here, "../../../app"), path.join(here, "../../../../../kiwinotes/app")].find((d) => existsSync(path.join(d, "node_modules/playwright-core/index.mjs")));
if (!APP) throw new Error("camadas: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const page = await browser.newPage();
const uri = (name: string) => {
  const f = ["webp", "png"].map((e) => path.join(entradaDir, `${name}.${e}`)).find((f) => existsSync(f));
  if (!f) throw new Error(`camadas: falta ${name}.webp/.png em ${entradaDir}`);
  return `data:image/${f.endsWith("png") ? "png" : "webp"};base64,${readFileSync(f).toString("base64")}`;
};
const r: Record<string, string> = await page.evaluate(
  `(${split.toString()})(${JSON.stringify({ cabeca: uri("cabeca-inteira"), luz: uri("luz"), corpo: uri("corpo") })}, ${JSON.stringify({ ...ESPACO, earL: ORELHA_ESQ, earR: ORELHA_DIR, sobra: SOBRA, olhos: OLHOS, preto: ENT.pretoDaFoto ?? 1, f: F, aroGanho: ENT.aroGanho ?? 1 })})`,
);
await browser.close();
let total = 0;
mkdirSync(dir, { recursive: true });
for (const n of ["luz", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro", "luz-cabeca"]) {
  const tmp = path.join(dir, `${n}.png`), file = path.join(dir, `${n}.webp`);
  writeFileSync(tmp, Buffer.from(r[n].split(",")[1]!, "base64"));
  const res = spawnSync("cwebp", ["-quiet", "-q", "92", "-alpha_q", "100", "-exact", tmp, "-o", file]);
  rmSync(tmp);
  if (res.status !== 0) throw new Error(`camadas: cwebp falhou em ${n}`);
  total += statSync(file).size;
}
const meta = JSON.parse(r.__json);
if (r.__dbg) console.log("camadas: pior pixel:", r.__dbg);
const sc = (v: number) => Math.round(v * F * 10) / 10;
const espacoSaida = { w: Math.round(ESPACO.w * F), h: Math.round(ESPACO.h * F) };
const escala = ENT.encaixeEscala / F;
const olhos = OLHOS.map((o) => ({ x: sc(o.x), y: sc(o.y), r: sc(o.r) }));
const meioX = (olhos[0]!.x + olhos[1]!.x) / 2, olhoY = (olhos[0]!.y + olhos[1]!.y) / 2;
const json = {
  espaco: espacoSaida,
  olhos,
  pivos: { earLeft: meta.pivots.earLeft.map(sc), earRight: meta.pivots.earRight.map(sc) },
  /** O encaixe no palco de 1024: o meio dos olhos em (512, 414). */
  encaixe: { escala: Math.round(escala * 1e4) / 1e4, dx: Math.round((512 - meioX * escala) * 100) / 100, dy: Math.round((414 - olhoY * escala) * 100) / 100 },
  camadas: ["luz", "luz-cabeca", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"],
  clipCabeca: (meta.headClip as string).replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${sc(Number(x))} ${sc(Number(y))}`),
};
writeFileSync(path.join(dir, "camadas.json"), JSON.stringify(json, null, 2) + "\n");
console.log(`camadas: 7 camadas em ${espacoSaida.w}×${espacoSaida.h} (${(total / 1024).toFixed(0)} KB), clip com ${meta.points} pontos; a pilha cabeça+orelhas+aro tem no máximo ${r.__worst}/255 de alfa a menos que a inteira (vão)`);
