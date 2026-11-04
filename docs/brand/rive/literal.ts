// A pose aprovada do Kiwi-cat (T3151, #3634/#3636: "a 3"): a referência LITERAL sobre preto. Os pixels da foto como
// estão (a = quanto tapa o fundo, F = a cor própria), o cinza do fundo trocado por uma luz que só existe perto do gato,
// o corpo endireitado (as linhas abaixo do queixo deslizam para o centro) e esticado até o perímetro que o harry
// desenhou (literal/rabisco-harry.png). Cabeça, orelhas, olhos e aro não mudam.
//
// Saída em literal/ (espaço da foto, 512×640, tudo em 0,0, alfa reto): luz.webp (atrás), corpo.webp, cabeca.webp (com
// orelhas e aro; as orelhas se separam com o recorte do recortar-referencia.ts), e os olhos são vetor: (201,320) e
// (311,320), r=17, branco. Empilhadas com "over" sobre preto dão exatamente a imagem aprovada (literal/conferencia.png).
// previa.png é o que o harry viu (referência | 3 | 3 no perímetro | com o rabisco dele).
//
// O ctx.filter do canvas não faz nada no WebKit headless: o blur da luz é um box blur em JS.
// Uso: bun docs/brand/rive/literal.ts [SX=1.6] [SY=1.3]   (precisa do `cwebp`)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const OUT = path.dirname(new URL(import.meta.url).pathname);
const WT = OUT;
const APP = path.join(OUT, "../../../app");

function render(src: string, marked: string, SX: number, SY: number): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = 512, h = 640, N = w * h;
      const canvas = (W = w, H = h) => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
      const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
      const c0 = canvas(); const x0 = c0.getContext("2d")!; x0.drawImage(img, 0, 0, w, h);
      const ph = x0.getImageData(0, 0, w, h).data;
      const bg = [0, 0, 0];
      for (const [cx, cy] of [[4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5]]) { const i = (cy * w + cx) * 4; for (let k = 0; k < 3; k++) bg[k] += ph[i + k] / 4 / 255; }
      const lum = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      const A = new Float32Array(N), F = new Float32Array(N * 3);
      for (let p = 0; p < N; p++) {
        const c = [ph[p * 4] / 255, ph[p * 4 + 1] / 255, ph[p * 4 + 2] / 255];
        const chroma = Math.max(...c) - Math.min(...c), neutral = sm((chroma - 0.05) / 0.08);
        let a = 0; for (let k = 0; k < 3; k++) if (c[k] < bg[k]) a = Math.max(a, (bg[k] - c[k]) / bg[k]);
        const aL = Math.max(0, 1 - lum(c) / lum(bg)); a = aL + (a - aL) * neutral; a *= sm((a - 0.03) / 0.07);
        A[p] = a; for (let k = 0; k < 3; k++) F[p * 3 + k] = Math.max(0, c[k] - bg[k] * (1 - a)) * neutral;
      }
      const boxBlur = (src: Float32Array, r: number) => {
        let a = Float32Array.from(src), b = new Float32Array(N);
        for (let pass = 0; pass < 3; pass++) {
          for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) { b[y * w + x] = acc / (2 * r + 1); acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
          for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
        }
        return a;
      };
      // O corpo reto (#3581): abaixo do queixo, cada linha desliza para o centroide do alfa ficar em x=256.
      const straighten = (A: Float32Array, F: Float32Array) => {
        const shift = new Float32Array(h);
        for (let y = 0; y < h; y++) { let s = 0, m = 0; for (let x = 0; x < w; x++) { s += A[y * w + x] * x; m += A[y * w + x]; } shift[y] = m > 5 ? 256 - s / m : 0; }
        const sh = new Float32Array(h); // suave, e só abaixo de y=380 (acima, a cabeça fica como está)
        for (let y = 0; y < h; y++) { let s = 0, n = 0; for (let k = -25; k <= 25; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += shift[yy]; n++; } sh[y] = (s / n) * sm((y - 380) / 90); }
        const A2 = new Float32Array(N), F2 = new Float32Array(N * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const xs = x - sh[y], x0 = Math.floor(xs), t = xs - x0;
          const q0 = y * w + Math.min(w - 1, Math.max(0, x0)), q1 = y * w + Math.min(w - 1, Math.max(0, x0 + 1));
          A2[y * w + x] = A[q0] * (1 - t) + A[q1] * t;
          for (let k = 0; k < 3; k++) F2[(y * w + x) * 3 + k] = F[q0 * 3 + k] * (1 - t) + F[q1 * 3 + k] * t;
        }
        return { A: A2, F: F2 };
      };
      const draw = (A: Float32Array, F: Float32Array, light: (p: number) => number[], into: CanvasRenderingContext2D, ox: number) => {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) { const L = light(p); for (let k = 0; k < 3; k++) id.data[p * 4 + k] = Math.min(255, (L[k] * (1 - A[p]) + F[p * 3 + k]) * 255); id.data[p * 4 + 3] = 255; }
        x.putImageData(id, 0, 0);
        x.fillStyle = "#fff"; for (const ex of [201, 311]) { x.beginPath(); x.arc(ex, 320, 17, 0, Math.PI * 2); x.fill(); }
        into.drawImage(c, ox, 0);
      };
      const GRAY = bg, LAV = [0.74, 0.72, 0.82];
      // 1. Vinheta: o cinza da foto em volta do gato, sumindo para o preto longe dele.
      const vin = (p: number) => { const x = p % w, y = (p - x) / w; const d = Math.hypot(x - 256, (y - 360) * 0.85); const g = 1 - sm((d - 230) / 170); return GRAY.map((v) => v * g); };
      // 2. Luz C literal: o cinza-lavanda só onde a silhueta borrada chega (raios 28 e 70).
      const near = boxBlur(A, 28), wide = boxBlur(A, 70);
      const luz = (p: number) => { const g = Math.min(1, 1.15 * (0.9 * near[p] + 0.9 * wide[p])); return LAV.map((v) => v * g); };
      // 3. Luz C literal com o corpo reto.
      const st = straighten(A, F);
      const near3 = boxBlur(st.A, 28), wide3 = boxBlur(st.A, 70);
      const luz3 = (p: number) => { const g = Math.min(1, 1.15 * (0.9 * near3[p] + 0.9 * wide3[p])); return LAV.map((v) => v * g); };
      // 3b. O corpo no perímetro que o harry desenhou (#3634): abaixo dos olhos a névoa é esticada (largura até SX, e
      //     para baixo até SY), com a mesma textura; cabeça, orelhas, olhos e aro ficam como estão.
      const warp = (A: Float32Array, F: Float32Array) => {
        const A2 = new Float32Array(N), F2 = new Float32Array(N * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const t = sm((y - 350) / 150);
          const sy = 350 + (y - 350) / (1 + (SY - 1) * t), sx = 256 + (x - 256) / (1 + (SX - 1) * t);
          const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
          const q = (xx: number, yy: number) => Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx));
          const q00 = q(x0, y0), q10 = q(x0 + 1, y0), q01 = q(x0, y0 + 1), q11 = q(x0 + 1, y0 + 1);
          const bl = (v: Float32Array, k = 0, n = 1) => (v[q00 * n + k] * (1 - tx) + v[q10 * n + k] * tx) * (1 - ty) + (v[q01 * n + k] * (1 - tx) + v[q11 * n + k] * tx) * ty;
          A2[y * w + x] = bl(A);
          for (let k = 0; k < 3; k++) F2[(y * w + x) * 3 + k] = bl(F, k, 3);
        }
        return { A: A2, F: F2 };
      };
      const wp = warp(st.A, st.F);
      const near4 = boxBlur(wp.A, 28), wide4 = boxBlur(wp.A, 70);
      const luz4 = (p: number) => { const g = Math.min(1, 1.15 * (0.9 * near4[p] + 0.9 * wide4[p])); return LAV.map((v) => v * g); };
      // 4. A inversão que o harry descreveu (#3622): a rampa escuro→claro da foto vira claro→escuro. O miolo fica preto,
      //    o fundo fica preto, e a transição (a névoa) acende: lum = K·4a(1-a), máxima no meio da rampa.
      const inv = (p: number) => { const a = Math.min(1, A[p] / 0.9); const g = Math.min(1, 1.1 * 4 * a * (1 - a)); return LAV.map((v) => (v * g) / Math.max(1e-3, 1 - A[p])); };
      const out = canvas(w * 4, h); const ox = out.getContext("2d")!;
      ox.fillStyle = "#000"; ox.fillRect(0, 0, out.width, out.height);
      ox.drawImage(img, 0, 0, w, h);
      draw(st.A, st.F, luz3, ox, w); draw(wp.A, wp.F, luz4, ox, w * 2); draw(wp.A, wp.F, luz4, ox, w * 3);
      // O rabisco do harry (os pixels vermelhos do painel 3 da imagem marcada) por cima do painel 3.
      // As camadas para o Rive (espaço da foto, 512×640, todas em 0,0), em alfa reto: luz (atrás), cabeca (a referência
      // acima dos olhos, com orelhas e aro, cor = F/a), corpo (a névoa esticada), e os olhos como vetor no Rive.
      // Empilhadas com "over" sobre preto, dão exatamente o painel 3: luz·(1-a) + F.
      const layers: Record<string, string> = {};
      const toLayer = (name: string, Aa: Float32Array, Ff: Float32Array, weight: (p: number) => number) => {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) {
          const a = Aa[p] * weight(p); if (a <= 0.002) continue;
          for (let k = 0; k < 3; k++) id.data[p * 4 + k] = Math.min(255, (Ff[p * 3 + k] / Math.max(1e-3, Aa[p])) * 255);
          id.data[p * 4 + 3] = a * 255;
        }
        x.putImageData(id, 0, 0); layers[name] = c.toDataURL("image/png");
      };
      const ramp = (p: number) => sm(((p - (p % w)) / w - 340) / 60);
      // Duas camadas com "over" só reproduzem o alfa a se a de cima compensar: b = a·r / (1 − a·(1−r)).
      toLayer("cabeca", A, F, (p) => 1 - ramp(p));
      const bodyW = (p: number) => { const r = ramp(p), a = wp.A[p]; return a > 0 ? Math.min(1, (a * r) / Math.max(1e-3, 1 - a * (1 - r))) / a : 0; };
      toLayer("corpo", wp.A, wp.F, bodyW);
      {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) { const L = luz4(p); const g = L[0] / LAV[0]; id.data[p * 4] = LAV[0] * 255; id.data[p * 4 + 1] = LAV[1] * 255; id.data[p * 4 + 2] = LAV[2] * 255; id.data[p * 4 + 3] = g * 255; }
        x.putImageData(id, 0, 0); layers["luz"] = c.toDataURL("image/png");
      }
      // Conferência: as camadas empilhadas com "over" sobre preto, com os olhos.
      const chk = canvas(); const cx = chk.getContext("2d")!; cx.fillStyle = "#000"; cx.fillRect(0, 0, w, h);
      const imgs = ["luz", "corpo", "cabeca"].map((n) => { const i = new Image(); i.src = layers[n]; return i; });
      const mk = new Image();
      mk.onload = () => {
        for (const i of imgs) cx.drawImage(i, 0, 0);
        cx.fillStyle = "#fff"; for (const ex of [201, 311]) { cx.beginPath(); cx.arc(ex, 320, 17, 0, Math.PI * 2); cx.fill(); }
        layers["__check"] = chk.toDataURL("image/png");
        const mc = canvas(w, h); const mx = mc.getContext("2d")!; mx.drawImage(mk, w * 3, 0, w, h, 0, 0, w, h);
        const md = mx.getImageData(0, 0, w, h).data;
        const od = ox.getImageData(w * 3, 0, w, h);
        for (let p = 0; p < N; p++) if (md[p * 4] > 180 && md[p * 4 + 1] < 140 && md[p * 4 + 2] < 140) { od.data[p * 4] = 255; od.data[p * 4 + 1] = 80; od.data[p * 4 + 2] = 70; }
        ox.putImageData(od, w * 3, 0);
        ox.font = "bold 20px -apple-system, Helvetica"; ox.textAlign = "center";
        for (const [i, t] of ["referência", "3 (a escolhida)", "3 · corpo no seu perímetro", "3 · com o seu rabisco por cima"].entries()) { ox.fillStyle = i ? "#fff" : "#000"; ox.fillText(t, w * i + w / 2, h - 16); }
        layers["__previa"] = out.toDataURL("image/png");
        resolve(layers);
      };
      mk.src = marked;
    };
    img.src = src;
  });
}
// O playwright-core do app; numa worktree sem node_modules, o do checkout principal (kiwinotes/app).
const { existsSync } = await import("node:fs");
const pw = [path.join(APP, "node_modules/playwright-core/index.mjs"), path.join(OUT, "../../../../kiwinotes/app/node_modules/playwright-core/index.mjs")].find((f) => existsSync(f));
if (!pw) throw new Error("literal: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(pw);
const browser = await webkit.launch(); const page = await browser.newPage();
const src = `data:image/jpeg;base64,${readFileSync(path.join(WT, "referencia.jpg")).toString("base64")}`;
const marked = `data:image/png;base64,${readFileSync(path.join(OUT, "literal/rabisco-harry.png")).toString("base64")}`;
const SX = Number(process.argv[2] ?? 1.6), SY = Number(process.argv[3] ?? 1.3);
const r: Record<string, string> = await page.evaluate(`(${render.toString()})(${JSON.stringify(src)}, ${JSON.stringify(marked)}, ${SX}, ${SY})`);
writeFileSync(path.join(OUT, "literal/previa.png"), Buffer.from(r.__previa.split(",")[1]!, "base64"));
const { spawnSync } = await import("node:child_process"); const { mkdirSync, rmSync, statSync } = await import("node:fs");
const L = path.join(OUT, "literal"); mkdirSync(L, { recursive: true });
writeFileSync(path.join(L, "conferencia.png"), Buffer.from(r.__check.split(",")[1]!, "base64"));
for (const n of ["luz", "corpo", "cabeca"]) {
  const tmp = path.join(L, `${n}.png`); writeFileSync(tmp, Buffer.from(r[n].split(",")[1]!, "base64"));
  const res = spawnSync("cwebp", ["-quiet", "-q", "92", "-alpha_q", "100", "-exact", tmp, "-o", path.join(L, `${n}.webp`)]); rmSync(tmp);
  if (res.status !== 0) throw new Error(`cwebp ${n}`); console.log(n, (statSync(path.join(L, `${n}.webp`)).size / 1024).toFixed(0), "KB");
}
await browser.close(); console.log("ok");
