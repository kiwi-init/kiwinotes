// A silhueta do Kiwi-cat em vetor, traçada do alfa da própria referência (T3151, #3583 item 4, condição do lead em
// #3584): nada é redesenhado. O contorno sai do alfa (nível 0,5) da metade esquerda espelhada no meio dos olhos
// (x=256, de frente, #3581), simplificado (Ramer-Douglas-Peucker) e suavizado em cúbicas (Catmull-Rom).
//
// - `silhueta.svg`: 512×640 (o espaço da foto), com três paths em #101010: `head`, `ear-left` e `ear-right`. Cada
//   orelha tem 40 px de sobra para dentro da cabeça e o pivô na base (`data-pivot`), para girar mascarada pela cabeça
//   (B3 do roteiro). A cabeça é inteira por baixo das orelhas.
// - Para que serve: o clip das orelhas, a malha e os ossos, e uma cabeça nítida em qualquer escala. A borda macia da
//   referência (uns 8 px de rampa) NÃO existe aqui, e o feather do Rive não roda no canvas do app: a borda macia fica
//   com a camada raster, por cima. `silhueta.png` mostra o raster e o vetor lado a lado sobre preto.
//
// Uso: bun docs/brand/rive/silhueta.ts   (escreve docs/brand/rive/silhueta.svg e silhueta.png)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

/** As orelhas na foto (de recortar-referencia.ts): o contorno de fora (0–2) e a base, onde encostam na cabeça (3–6). */
const EAR_L = [[100, 150], [140, 140], [268, 196], [232, 222], [196, 246], [168, 286], [118, 300]];
const EXTEND = 40;

function trace(src: string, P: { EAR_L: number[][]; EXTEND: number }) {
  return new Promise<{ svg: string; png: string }>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 512, H = 640, N = W * H;
      const canvas = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
      const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
      const c0 = canvas(); const x0 = c0.getContext("2d")!; x0.drawImage(img, 0, 0, W, H);
      const ph = x0.getImageData(0, 0, W, H).data;
      const bg = [0, 0, 0];
      for (const [cx, cy] of [[4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5]]) { const i = (cy * W + cx) * 4; for (let k = 0; k < 3; k++) bg[k] += ph[i + k] / 4 / 255; }
      const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lb = lum(bg[0], bg[1], bg[2]);
      // O alfa (pela luminância: o que é mais escuro que o fundo), da metade esquerda espelhada.
      const A = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const xs = x < 256 ? x : 511 - x, q = (y * W + xs) * 4;
        let a = Math.max(0, 1 - lum(ph[q] / 255, ph[q + 1] / 255, ph[q + 2] / 255) / lb);
        a *= sm((a - 0.03) / 0.07);
        A[y * W + x] = a;
      }
      // A cabeça da referência termina no queixo; abaixo de y≈470 é só névoa, que não entra na silhueta.
      const head = (p: number) => A[p] * (1 - sm(((p - (p % W)) / W - 440) / 40));
      const poly = (pts: number[][]) => {
        const c = canvas(); const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.beginPath();
        pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill();
        const d = x.getImageData(0, 0, W, H).data; const m = new Uint8Array(N);
        for (let p = 0; p < N; p++) m[p] = d[p * 4 + 3] > 127 ? 1 : 0;
        return m;
      };
      const mirror = (pts: number[][]) => pts.map(([x, y]) => [511 - x, y]);
      const extend = (pts: number[][]) => pts.map(([x, y], i) => (i >= 3 ? [x, y + P.EXTEND] : [x, y]));
      const earL = P.EAR_L, earR = mirror(P.EAR_L);
      const cutL = poly(earL), cutR = poly(earR), fullL = poly(extend(earL)), fullR = poly(extend(earR));
      const bin = (w: (p: number) => number) => { const m = new Uint8Array(N); for (let p = 0; p < N; p++) m[p] = w(p) > 0.5 ? 1 : 0; return m; };
      const mHead = bin((p) => head(p) * (1 - cutL[p]) * (1 - cutR[p]));
      const mEarL = bin((p) => head(p) * fullL[p]);
      const mEarR = bin((p) => head(p) * fullR[p]);
      // O contorno de uma máscara binária (Moore, sentido horário), do maior componente: começa no 1º pixel de cima.
      const contour = (m: Uint8Array) => {
        const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
        let sx = -1, sy = -1;
        for (let y = 0; y < H && sx < 0; y++) for (let x = 0; x < W; x++) if (at(x, y)) { sx = x; sy = y; break; }
        if (sx < 0) return [] as number[][];
        const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        const pts: number[][] = [[sx, sy]];
        let cx = sx, cy = sy, d = 6; // começa olhando para cima (o pixel de cima é fundo)
        for (let n = 0; n < 20000; n++) {
          let found = false;
          for (let k = 0; k < 8; k++) {
            const dd = (d + 6 + k) % 8, nx = cx + dirs[dd][0], ny = cy + dirs[dd][1];
            if (at(nx, ny)) { cx = nx; cy = ny; d = dd; found = true; break; }
          }
          if (!found) break;
          if (cx === sx && cy === sy) break;
          pts.push([cx, cy]);
        }
        return pts;
      };
      const rdp = (pts: number[][], eps: number): number[][] => {
        if (pts.length < 3) return pts;
        const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
        let imax = 0, dmax = 0;
        for (let i = 1; i < pts.length - 1; i++) {
          const [px, py] = pts[i]; const L = Math.hypot(bx - ax, by - ay);
          const d = L ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay);
          if (d > dmax) { dmax = d; imax = i; }
        }
        if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
        return [...rdp(pts.slice(0, imax + 1), eps).slice(0, -1), ...rdp(pts.slice(imax), eps)];
      };
      // Catmull-Rom fechado → cúbicas, com os cantos vivos (ângulo < 100°) preservados como vértices de bico.
      const pathOf = (pts: number[][]) => {
        const n = pts.length; if (n < 3) return "";
        const f = (v: number) => (Math.round(v * 10) / 10).toString();
        const sharp = pts.map((_, i) => {
          const [px, py] = pts[(i - 1 + n) % n], [cx, cy] = pts[i], [nx, ny] = pts[(i + 1) % n];
          const a = Math.atan2(py - cy, px - cx) - Math.atan2(ny - cy, nx - cx);
          const deg = Math.abs(((a * 180) / Math.PI + 540) % 360 - 180);
          return deg < 100;
        });
        let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
        for (let i = 0; i < n; i++) {
          const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
          const c1 = sharp[i] ? p1 : [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
          const c2 = sharp[(i + 1) % n] ? p2 : [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
          d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
        }
        return d + " Z";
      };
      const simplify = (m: Uint8Array) => rdp([...contour(m), contour(m)[0]], 1.4).slice(0, -1);
      const pHead = pathOf(simplify(mHead)), pEarL = pathOf(simplify(mEarL)), pEarR = pathOf(simplify(mEarR));
      const pivot = (ear: number[][]) => { const b = ear.slice(3); const x = b.reduce((s, p) => s + p[0], 0) / b.length, y = b.reduce((s, p) => s + p[1], 0) / b.length; return [Math.round(x), Math.round(y)]; };
      const [plx, ply] = pivot(earL), [prx, pry] = pivot(earR);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640" viewBox="0 0 512 640">
  <!-- A silhueta do Kiwi-cat, traçada do alfa da referência (docs/brand/rive/silhueta.ts). Espaço da foto: os olhos em
       (201, 320) e (311, 320), r=17; o meio em x=256. As orelhas têm ${P.EXTEND} px de sobra para dentro da cabeça e o
       pivô na base (data-pivot). Sem borda macia: ela fica com a camada raster. -->
  <path id="head" fill="#101010" d="${pHead}"/>
  <path id="ear-left" fill="#101010" data-pivot="${plx} ${ply}" d="${pEarL}"/>
  <path id="ear-right" fill="#101010" data-pivot="${prx} ${pry}" d="${pEarR}"/>
</svg>
`;
      // A prévia: o raster (o alfa espelhado, em #101010) e o vetor, lado a lado sobre preto, com os olhos.
      const prev = canvas(W * 2 + 16, H); const px = prev.getContext("2d")!;
      px.fillStyle = "#000"; px.fillRect(0, 0, prev.width, prev.height);
      const ras = px.createImageData(W, H);
      for (let p = 0; p < N; p++) { ras.data[p * 4] = ras.data[p * 4 + 1] = ras.data[p * 4 + 2] = 16; ras.data[p * 4 + 3] = head(p) * 255; }
      px.putImageData(ras, 0, 0);
      const vec = new Image();
      vec.onload = () => {
        px.drawImage(vec, W + 16, 0);
        px.fillStyle = "#fff";
        for (const dx of [0, W + 16]) for (const ex of [201, 311]) { px.beginPath(); px.arc(dx + ex, 320, 17, 0, Math.PI * 2); px.fill(); }
        px.font = "bold 18px -apple-system, Helvetica"; px.textAlign = "center";
        px.fillText("raster (alfa da referência, espelhado)", W / 2, H - 16);
        px.fillText("vetor (silhueta.svg, sem borda macia)", W + 16 + W / 2, H - 16);
        resolve({ svg, png: prev.toDataURL("image/png") });
      };
      vec.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    };
    img.src = src;
  });
}

const { webkit } = await import(path.join(here, "../../../app/node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const page = await browser.newPage();
const src = `data:image/jpeg;base64,${readFileSync(path.join(here, "referencia.jpg")).toString("base64")}`;
const r: { svg: string; png: string } = await page.evaluate(`(${trace.toString()})(${JSON.stringify(src)}, ${JSON.stringify({ EAR_L, EXTEND })})`);
await browser.close();
writeFileSync(path.join(here, "silhueta.svg"), r.svg);
writeFileSync(path.join(here, "silhueta.png"), Buffer.from(r.png.split(",")[1]!, "base64"));
console.log(`silhueta: ${r.svg.length} bytes em silhueta.svg; prévia em silhueta.png`);
