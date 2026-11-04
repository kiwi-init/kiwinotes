// As camadas do Kiwi-cat para a intro (T3720): separa a cabeça inteira (camadas/cabeca-inteira.webp, do pose.ts ou das
// camadas do T3705) nas peças que a animação mexe, e escreve o contrato que o docs/brand/intro/gerar.ts lê.
//
// Entrada, em camadas/ (o espaço da foto, 512×640, alfa reto, tudo em 0,0): luz.webp, corpo.webp, cabeca-inteira.webp.
// Saída, na mesma pasta e no mesmo espaço:
// - cabeca.webp: a cabeça preta sem as orelhas (o que fica abaixo da base delas), com o preto por baixo do aro;
// - orelha-esquerda.webp e orelha-direita.webp: cada orelha com 40 px de sobra para dentro da cabeça;
// - aro.webp: o que tem cor na cabeça (o arco prismático e o halo ciano das laterais), para acender à parte;
// - luz-cabeca.webp: a luz só da cabeça (a silhueta borrada), para o começo, antes de o corpo existir;
// - camadas.json: o tamanho, os olhos, os pivôs das orelhas e o contorno da cabeça (o clip das orelhas, um path SVG).
// O cabeca.webp + orelhas + aro empilhados com "over" dão o cabeca-inteira.webp.
//
// O ctx.filter do canvas não faz nada no WebKit headless: blur e máscaras são em JS.
// Uso: bun docs/brand/kiwi-cat/camadas.ts   (precisa do `cwebp` e do Playwright do app/)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, "camadas");

/** O espaço da foto e os pontos medidos nela (recortar-referencia.ts do T3151). */
export const ESPACO = { w: 512, h: 640 } as const;
export const OLHOS = [
  { x: 201, y: 320, r: 17 },
  { x: 311, y: 320, r: 17 },
] as const;
/** As orelhas: o contorno de fora (0–2) e a base, onde encostam na cabeça (3–6). A direita é a da foto, não o espelho. */
const ORELHA_ESQ = [[100, 150], [140, 140], [268, 196], [232, 222], [196, 246], [168, 286], [118, 300]];
const ORELHA_DIR = [[262, 192], [390, 150], [420, 170], [410, 280], [372, 286], [338, 240], [300, 214]];
const SOBRA = 40;

function split(src: Record<string, string>, P: { w: number; h: number; earL: number[][]; earR: number[][]; sobra: number; olhos: { x: number; y: number; r: number }[] }) {
  return new Promise<Record<string, string>>((resolve) => {
    const { w, h } = P, N = w * h;
    const canvas = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const load = (url: string) => new Promise<ImageData>((ok) => { const i = new Image(); i.onload = () => { const c = canvas(); const x = c.getContext("2d")!; x.drawImage(i, 0, 0); ok(x.getImageData(0, 0, w, h)); }; i.src = url; });
    load(src.cabeca).then((head) => {
      const d = head.data;
      const A = new Float32Array(N), C = new Float32Array(N * 3), CH = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        // O preto da foto (#101010) deu alfa 0,934 no pose.ts: aqui o miolo vira opaco, senão a luz vaza 7% pelas
        // orelhas quando elas passam na frente do halo (B2–B3).
        A[p] = Math.min(1, d[p * 4 + 3] / 255 / 0.934);
        // Os olhos da foto são brancos e viraram buracos no alfa; a cabeça por baixo dos olhos (que são vetor) é preta.
        for (const e of P.olhos) { const x = p % w, y = (p - x) / w; const dd = Math.hypot(x - e.x, y - e.y); if (dd < e.r + 4) { const t = sm((e.r + 4 - dd) / 3); A[p] = A[p] + (1 - A[p]) * t; d[p * 4] = d[p * 4] + (16 - d[p * 4]) * t; d[p * 4 + 1] = d[p * 4 + 1] + (16 - d[p * 4 + 1]) * t; d[p * 4 + 2] = d[p * 4 + 2] + (16 - d[p * 4 + 2]) * t; } }
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
      const cutL = poly(region(P.earL, 0), 2), cutR = poly(region(P.earR, 0), 2);
      const fullL = poly(region(P.earL, P.sobra), 2), fullR = poly(region(P.earR, P.sobra), 2);
      // O aro: o que tem cor. Onde ele está, a cabeça por baixo fica preta.
      // O aro é o que tem cor e, fora do miolo sólido, também o que é claro (o halo lavanda das bochechas, que não
      // é cabeça): na cabeça preta não pode sobrar pixel claro.
      const solid = (p: number) => sm((A[p] - 0.55) / 0.35);
      const aroW = new Float32Array(N);
      for (let p = 0; p < N; p++) { const lum = 0.2126 * C[p * 3] + 0.7152 * C[p * 3 + 1] + 0.0722 * C[p * 3 + 2]; aroW[p] = Math.max(sm((CH[p] - 0.08) / 0.1), sm((lum - 0.25) / 0.2) * (1 - solid(p))); }
      const DARK = [16 / 255, 16 / 255, 16 / 255];
      const layer = (alpha: (p: number) => number, rgb: (p: number) => number[]) => {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) { const a = alpha(p); if (a <= 0.002) continue; const v = rgb(p); id.data[p * 4] = v[0] * 255; id.data[p * 4 + 1] = v[1] * 255; id.data[p * 4 + 2] = v[2] * 255; id.data[p * 4 + 3] = a * 255; }
        x.putImageData(id, 0, 0); return c.toDataURL("image/png");
      };
      const rgbAt = (p: number) => [C[p * 3], C[p * 3 + 1], C[p * 3 + 2]];
      const under = (p: number) => { const t = Math.min(1, aroW[p] * 3); const v = rgbAt(p); return [v[0] + (DARK[0] - v[0]) * t, v[1] + (DARK[1] - v[1]) * t, v[2] + (DARK[2] - v[2]) * t]; };
      const out: Record<string, string> = {};
      // A cabeça por baixo do aro é sólida: na foto o aro tem alfa ~0,6 (cor sobre o cinza), e sem isso a luz vazaria
      // pela faixa antes de o aro acender. "Dentro" é onde a vizinhança é sólida. Fora do miolo (o halo ciano das
      // laterais), a cor é só do aro: a cabeça não repete o pixel por baixo.
      const nearA = boxBlur(A, 6);
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
      out.aro = layer((p) => Math.min(1, A[p] * aroW[p] * 1.25), rgbAt);
      // A luz só da cabeça, sem as orelhas (elas ainda não levantaram) e sem o miolo (a cabeça ainda não existe: é o
      // círculo de vidro, e a luz é só o halo em volta), com a mesma receita do pose.ts (raios 28 e 70, ganho 1,15).
      const semOrelhas = new Float32Array(N); for (let p = 0; p < N; p++) semOrelhas[p] = headA(p) * (1 - Math.min(1, cutL[p] + cutR[p]));
      const near = boxBlur(semOrelhas, 28), wide = boxBlur(semOrelhas, 70), LAV = [0.74, 0.72, 0.82];
      out["luz-cabeca"] = layer((p) => Math.min(1, 1.15 * (0.9 * near[p] + 0.9 * wide[p])) * (1 - sm((semOrelhas[p] - 0.2) / 0.5)), () => LAV);
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
      const simp = rdp([...pts, pts[0]], 1.2).slice(0, -1);
      const clip = `M${simp.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
      const pivot = (ear: number[][]) => { const b = ear.slice(3); return [Math.round(b.reduce((s, q) => s + q[0], 0) / b.length), Math.round(b.reduce((s, q) => s + q[1], 0) / b.length)]; };
      out.__json = JSON.stringify({ pivots: { earLeft: pivot(P.earL), earRight: pivot(P.earR) }, headClip: clip, points: simp.length });
      // Conferência: cabeca + orelhas + aro com "over" tem que dar a cabeça inteira (a diferença máxima por pixel).
      const imgs = ["cabeca", "orelha-esquerda", "orelha-direita", "aro"].map((n) => { const i = new Image(); i.src = out[n]; return i; });
      Promise.all(imgs.map((i) => new Promise((ok) => (i.onload = ok)))).then(() => {
        const c = canvas(); const x = c.getContext("2d")!; for (const i of imgs) x.drawImage(i, 0, 0);
        const q = x.getImageData(0, 0, w, h).data; let worst = 0;
        // Só onde a pilha fica MENOS opaca que a inteira (um vão); mais opaca é de propósito (o preto sob o aro).
        let wp = 0; for (let p = 0; p < N; p++) { const diff = d[p * 4 + 3] - q[p * 4 + 3]; if (diff > worst) { worst = diff; wp = p; } }
        out.__worst = `${worst} em (${wp % w}, ${Math.floor(wp / w)})`;
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
const uri = (f: string) => `data:image/webp;base64,${readFileSync(path.join(dir, f)).toString("base64")}`;
const r: Record<string, string> = await page.evaluate(
  `(${split.toString()})(${JSON.stringify({ cabeca: uri("cabeca-inteira.webp") })}, ${JSON.stringify({ ...ESPACO, earL: ORELHA_ESQ, earR: ORELHA_DIR, sobra: SOBRA, olhos: OLHOS })})`,
);
await browser.close();
let total = 0;
for (const n of ["cabeca", "orelha-esquerda", "orelha-direita", "aro", "luz-cabeca"]) {
  const tmp = path.join(dir, `${n}.png`), file = path.join(dir, `${n}.webp`);
  writeFileSync(tmp, Buffer.from(r[n].split(",")[1]!, "base64"));
  const res = spawnSync("cwebp", ["-quiet", "-q", "92", "-alpha_q", "100", "-exact", tmp, "-o", file]);
  rmSync(tmp);
  if (res.status !== 0) throw new Error(`camadas: cwebp falhou em ${n}`);
  total += statSync(file).size;
}
const meta = JSON.parse(r.__json);
if (r.__dbg) console.log("camadas: pior pixel:", r.__dbg);
const json = {
  espaco: ESPACO,
  olhos: OLHOS,
  pivos: meta.pivots,
  /** O encaixe no palco de 1024: a foto ×1,6, com o meio dos olhos (256, 320) em (512, 414). */
  encaixe: { escala: 1.6, dx: 512 - 256 * 1.6, dy: 414 - 320 * 1.6 },
  camadas: ["luz", "luz-cabeca", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"],
  clipCabeca: meta.headClip,
};
writeFileSync(path.join(dir, "camadas.json"), JSON.stringify(json, null, 2) + "\n");
console.log(`camadas: 5 camadas novas (${(total / 1024).toFixed(0)} KB), clip com ${meta.points} pontos; a pilha cabeça+orelhas+aro tem no máximo ${r.__worst}/255 de alfa a menos que a inteira (vão)`);
