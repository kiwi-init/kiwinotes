// As camadas do Kiwi-cat para a intro (T3720): decompõe a IMAGEM APROVADA achatada (a v2 da T3705 sobre preto, ou a
// referencia-final.png) nas peças que a animação mexe, e escreve o contrato que o docs/brand/intro/gerar.ts lê.
//
// A regra é física, e a pilha reproduz a imagem: o gato é uma silhueta preta (S, com a borda macia que a própria foto
// tem) por cima de uma luz (L). Onde a silhueta cobre, L = pixel / (1 − S): "over" devolve o pixel. Dentro do gato
// (S = 1) a luz não existe. O arco prismático é o que tem cor dentro da silhueta; ele acende por cima do preto.
//
// Entrada (uma pasta, padrão gerada/): a imagem achatada (`imagem` do json, padrão kiwi-cat-candidata-v2.png) e o
// json de contrato (entrada.json ou camadas.json): { espaco {w,h}, olhos [{x,y,r}], orelhaEsquerda, orelhaDireita
// (polígonos: os 3 primeiros pontos são o contorno de fora, os demais a base), sobra (px para dentro da cabeça),
// queixoY (a linha onde a cabeça vira corpo; padrão 0,66·h), saidaAltura (a altura das camadas exportadas; padrão
// 1280, o palco com a imagem 4:5 na largura dele), imagem (o nome do arquivo) }.
// Saída, em camadas/, no espaço exportado:
// - luz: a luz inteira, com a borda compensada e o lugar do corpo preenchido (a névoa aparece antes de o corpo
//   existir; o corpo cobre depois); luz-anel: a névoa em volta do círculo de vidro, sintetizada, para o começo;
// - corpo, cabeca (sem as orelhas), orelha-esquerda e orelha-direita (com a sobra para dentro da cabeça): pretas;
// - aro: o que tem cor dentro da silhueta (o arco e os brilhos da base das orelhas);
// - camadas.json: o espaço, os olhos, os pivôs das orelhas, o encaixe no palco e o contorno da cabeça (o clip);
// - conferencia.png: a pilha sobre preto, com os olhos (o script mede o erro contra a imagem).
//
// O ctx.filter do canvas não faz nada no WebKit headless: blur e máscaras são em JS.
// Uso: bun docs/brand/kiwi-cat/camadas.ts [PASTA_DE_ENTRADA]   (padrão gerada/; provisoria/ é a do pose.ts;
//      precisa do `cwebp` e do Playwright do app/)

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
  /** O índice do primeiro ponto da base nos polígonos das orelhas (os anteriores são o contorno de fora). */
  baseDesde?: number;
  queixoY?: number;
  saidaAltura?: number;
  imagem?: string;
}
const entradaDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, "gerada");
const ENT: Entrada = (() => {
  const own = path.join(entradaDir, "entrada.json");
  if (existsSync(own)) return JSON.parse(readFileSync(own, "utf8"));
  // O contrato da T3705 (gerada/camadas.json): os polígonos são máscaras de separação, com a base descendo até perto
  // dos olhos. Aqui a orelha é o triângulo acima da linha da base: ponta de fora, ponta, base de dentro, base de fora.
  const c = JSON.parse(readFileSync(path.join(entradaDir, "camadas.json"), "utf8"));
  const L = c.orelhaEsquerda, R = c.orelhaDireita;
  return { espaco: c.espaco, olhos: c.olhos, orelhaEsquerda: [L[0], L[1], L[2], L[5]], orelhaDireita: [R[2], R[1], R[0], R[3]], sobra: c.sobra, baseDesde: 2 };
})();
const IMAGEM = ENT.imagem ?? "kiwi-cat-candidata-v2.png";
/** O fator de redução: tudo é feito já no espaço exportado (o palco tem 1024 px; 1280 de altura chega para o 2x). */
const F = Math.min(1, (ENT.saidaAltura ?? 1280) / ENT.espaco.h);

interface P {
  w: number;
  h: number;
  baseDesde: number;
  olhos: { x: number; y: number; r: number }[];
  earL: number[][];
  earR: number[][];
  sobra: number;
  queixoY: number;
}

function decompor(src: string, P: P) {
  return new Promise<Record<string, string>>((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const { w, h } = P, N = w * h, k = w / 512; // k: raios e margens medidos no espaço de 512
      const canvas = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
      const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
      const c0 = canvas(); const x0 = c0.getContext("2d")!; x0.imageSmoothingQuality = "high"; x0.drawImage(img, 0, 0, w, h);
      const d = x0.getImageData(0, 0, w, h).data;
      const C = new Float32Array(N * 3), LUM = new Float32Array(N), CH = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        const r = d[p * 4] / 255, g = d[p * 4 + 1] / 255, b = d[p * 4 + 2] / 255;
        C[p * 3] = r; C[p * 3 + 1] = g; C[p * 3 + 2] = b;
        LUM[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b; CH[p] = Math.max(r, g, b) - Math.min(r, g, b);
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
      const dilate = (s: Float32Array, r: number) => { // o máximo num quadrado de ±r, separável
        const t = new Float32Array(N), o = new Float32Array(N);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let dd = -r; dd <= r; dd++) { const xx = x + dd; if (xx >= 0 && xx < w && s[y * w + xx] > m) m = s[y * w + xx]; } t[y * w + x] = m; }
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = 0; for (let dd = -r; dd <= r; dd++) { const yy = y + dd; if (yy >= 0 && yy < h && t[yy * w + x] > m) m = t[yy * w + x]; } o[y * w + x] = m; }
        return o;
      };
      // 1. O escuro, e o gato: o componente de escuro ligado ao ponto entre os olhos (o resto escuro é o fundo).
      //    Os olhos (brancos) entram no gato. A silhueta S tem a rampa de luminância da própria foto na borda.
      const dark = new Float32Array(N); for (let p = 0; p < N; p++) dark[p] = 1 - sm((LUM[p] - 0.1) / 0.1);
      for (const e of P.olhos) { for (let y = Math.max(0, Math.floor(e.y - e.r - 4 * k)); y < Math.min(h, e.y + e.r + 4 * k); y++) for (let x = Math.max(0, Math.floor(e.x - e.r - 4 * k)); x < Math.min(w, e.x + e.r + 4 * k); x++) { const dd = Math.hypot(x - e.x, y - e.y); const t = sm((e.r + 4 * k - dd) / (3 * k)); const p = y * w + x; dark[p] = dark[p] + (1 - dark[p]) * t; } }
      const comp = new Uint8Array(N);
      // Sementes: entre os olhos e as pontas das orelhas (o arco e o brilho da base separam a orelha do preto da
      // cabeça; sem a semente dela, a orelha ficava fora de todas as camadas).
      const centro = (pts: number[][]) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
      { const seeds = [[(P.olhos[0].x + P.olhos[1].x) / 2, (P.olhos[0].y + P.olhos[1].y) / 2], centro(P.earL), centro(P.earR)].map(([x, y]) => Math.round(y) * w + Math.round(x)).filter((q) => dark[q] > 0.5);
        const stack = [...seeds]; for (const q of seeds) comp[q] = 1;
        while (stack.length) { const p = stack.pop()!; const x = p % w, y = (p - x) / w;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (!comp[q] && dark[q] > 0.5) { comp[q] = 1; stack.push(q); } } } }
      const compF = Float32Array.from(comp, (v) => v);
      const perto = dilate(compF, Math.round(10 * k));
      // O arco prismático fica por dentro do contorno da cabeça (preto em cima e embaixo dele), mas é claro: um
      // fechamento morfológico (dilata e erode 20·k px) tapa o vão dele na silhueta; os brilhos da base das orelhas,
      // fora do contorno, ficam de fora. A silhueta é preta por baixo do arco, e o aro acende por cima.
      const erode = (s: Float32Array, r: number) => { const inv = dilate(Float32Array.from(s, (v) => 1 - v), r); return Float32Array.from(inv, (v) => 1 - v); };
      const fechado = erode(dilate(compF, Math.round(20 * k)), Math.round(20 * k));
      const olhoY = (P.olhos[0].y + P.olhos[1].y) / 2;
      const S = new Float32Array(N); for (let p = 0; p < N; p++) { const y = (p - (p % w)) / w; const topo = 1 - sm((y - olhoY) / (20 * k)); /* o arco passa pela base das orelhas, logo acima dos olhos */ S[p] = Math.max(dark[p] * perto[p], fechado[p] * topo); }
      // 2. A cabeça vira corpo numa rampa no queixo; as orelhas pelos polígonos, com a sobra para dentro.
      const ramp = (p: number) => sm(((p - (p % w)) / w - (P.queixoY - 30 * k)) / (60 * k));
      const poly = (pts: number[][], soft: number) => {
        const c = canvas(); const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.beginPath();
        pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill();
        const m = x.getImageData(0, 0, w, h).data; const out = new Float32Array(N);
        for (let p = 0; p < N; p++) out[p] = m[p * 4 + 3] / 255;
        return soft ? boxBlur(out, soft) : out;
      };
      const region = (ear: number[][], ext: number) => ear.map(([x, y], i) => (i >= P.baseDesde ? [x, y + ext] : [x, y]));
      const soft = Math.max(1, Math.round(2 * k));
      const cutL = poly(region(P.earL, 0), soft), cutR = poly(region(P.earR, 0), soft);
      const fullL = poly(region(P.earL, P.sobra), soft), fullR = poly(region(P.earR, P.sobra), soft);
      const Shead = new Float32Array(N), Sbody = new Float32Array(N);
      for (let p = 0; p < N; p++) { const r = ramp(p); Shead[p] = S[p] * (1 - r); Sbody[p] = r > 0 ? Math.max(0, (S[p] - Shead[p]) / Math.max(1e-3, 1 - Shead[p])) : 0; }
      const compOver = (a: number, e: number) => (e >= 0.999 ? 0 : Math.max(0, (a - e) / (1 - e)));
      const earA = (cut: Float32Array, full: Float32Array) => (p: number) => Shead[p] * Math.min(1, cut[p] + Math.max(0, full[p] - cut[p]) * sm((S[p] - 0.6) / 0.3));
      const eL = earA(cutL, fullL), eR = earA(cutR, fullR);
      const headA = (p: number) => { const c = Math.min(1, cutL[p] + cutR[p]); const a = Shead[p]; return a * (1 - c) + c * compOver(a, Math.min(0.999, eL(p) + eR(p))); };
      // 3. O aro: o que tem cor dentro (ou colado) da silhueta. Fora dela a cor é luz.
      const dentro = dilate(fechado, Math.round(3 * k));
      const aroW = new Float32Array(N); for (let p = 0; p < N; p++) aroW[p] = sm((CH[p] - 0.08) / 0.1) * dentro[p];
      const rgbAt = (p: number) => [C[p * 3], C[p * 3 + 1], C[p * 3 + 2]];
      const maxc = (p: number) => Math.max(C[p * 3], C[p * 3 + 1], C[p * 3 + 2]);
      // 4. A luz: tudo o que não é gato, com a borda compensada, L = pixel / (1 − S); dentro do corpo, preenchida
      //    com o máximo da vizinhança (a névoa aparece inteira antes de o corpo existir; o corpo cobre depois).
      const Lp = new Float32Array(N * 3), La = new Float32Array(N);
      for (let p = 0; p < N; p++) { const s = Math.min(0.97, S[p]); const f = 1 / (1 - s); let m = 0; for (let kk = 0; kk < 3; kk++) { const v = Math.min(1, C[p * 3 + kk] * f * (1 - aroW[p])); Lp[p * 3 + kk] = v; if (v > m) m = v; } La[p] = S[p] > 0.97 ? 0 : m; }
      const bodyBin = Float32Array.from(Sbody, (v) => (v > 0.5 ? 1 : 0));
      const bodyZone = boxBlur(bodyBin, Math.round(6 * k));
      // A média da luz em volta (convolução normalizada: só os pixels fora do corpo contam), para preencher o corpo.
      const numA = boxBlur(Float32Array.from(La, (v, p) => v * (1 - bodyBin[p])), Math.round(40 * k));
      const den = boxBlur(Float32Array.from(bodyBin, (v) => 1 - v), Math.round(40 * k));
      const numC = [0, 1, 2].map((kk) => boxBlur(Float32Array.from(Lp, (_v, i) => (i % 3 === kk ? 1 : 0)).length ? Float32Array.from({ length: N }, (_v, p) => Lp[p * 3 + kk] * (1 - bodyBin[p])) : new Float32Array(N), Math.round(40 * k)));
      const fill = Float32Array.from({ length: N }, (_v, p) => (den[p] > 0.02 ? Math.min(1, numA[p] / den[p]) : 0));
      const fillRgb = (p: number) => { const a = numA[p]; if (a <= 1e-4) return [0.74, 0.72, 0.82]; return [numC[0][p] / a, numC[1][p] / a, numC[2][p] / a]; };
      const borda = (p: number) => { const x = p % w, y = (p - x) / w; const m = 0.14 * w; return sm(x / m) * sm((w - 1 - x) / m) * sm(y / m) * sm((h - 1 - y) / m); };
      const layer = (alpha: (p: number) => number, rgb: (p: number) => number[]) => {
        const c = canvas(); const x = c.getContext("2d")!; const id = x.createImageData(w, h);
        for (let p = 0; p < N; p++) { const a = alpha(p); if (a <= 0.002) continue; const v = rgb(p); id.data[p * 4] = v[0] * 255; id.data[p * 4 + 1] = v[1] * 255; id.data[p * 4 + 2] = v[2] * 255; id.data[p * 4 + 3] = a * 255; }
        x.putImageData(id, 0, 0); return c.toDataURL("image/png");
      };
      const out: Record<string, string> = {};
      const LAV = [0.74, 0.72, 0.82];
      const luzRgb = (p: number) => { const a = La[p]; if (a > 0.002) return [Lp[p * 3] / a, Lp[p * 3 + 1] / a, Lp[p * 3 + 2] / a]; return LAV; };
      out.luz = layer((p) => (La[p] + (fill[p] - La[p]) * bodyZone[p]) * borda(p), (p) => { const z = bodyZone[p]; if (z <= 0.01) return luzRgb(p); const a = luzRgb(p), b = fillRgb(p); return [0, 1, 2].map((kk) => a[kk] + (b[kk] - a[kk]) * z); });
      const PRETO = [0, 0, 0]; { let n = 0; for (let p = 0; p < N; p++) if (comp[p] && CH[p] < 0.03) { for (let kk = 0; kk < 3; kk++) PRETO[kk] += C[p * 3 + kk]; n++; } for (let kk = 0; kk < 3; kk++) PRETO[kk] = n ? PRETO[kk] / n : 0; }
      out.corpo = layer((p) => Sbody[p], () => PRETO);
      out.cabeca = layer(headA, () => PRETO);
      out["orelha-esquerda"] = layer(eL, () => PRETO);
      out["orelha-direita"] = layer(eR, () => PRETO);
      // O aro acende sobre o preto: alfa = brilho do pixel, cor = pixel / brilho, então alfa·cor = pixel.
      out.aro = layer((p) => aroW[p] * maxc(p), (p) => { const m = maxc(p); const v = rgbAt(p); return m > 0 ? v.map((x) => x / m) : v; });
      // 5. O anel: a névoa em volta do círculo de vidro (B2–B3), do ciano à esquerda ao azul à direita (a roda de cor
      //    do roteiro começa assim; os quadros 02–04 da prancha).
      const meio = [(P.olhos[0].x + P.olhos[1].x) / 2, (P.olhos[0].y + P.olhos[1].y) / 2];
      const R = (225 / 1024) * w, cyR = meio[1] + 0.07 * R;
      const disco = new Float32Array(N); for (let p = 0; p < N; p++) { const x = p % w, y = (p - x) / w; disco[p] = 1 - sm((Math.hypot(x - meio[0], y - cyR) - R) / (0.04 * R)); }
      const dNear = boxBlur(disco, Math.round(16 * k)), dWide = boxBlur(disco, Math.round(40 * k));
      const CIANO = [0x3f / 255, 0xd8 / 255, 1], AZUL = [0x2e / 255, 0x9b / 255, 1];
      out["luz-anel"] = layer((p) => Math.min(0.75, 1.3 * (0.4 * dNear[p] + 0.6 * dWide[p])) * (1 - disco[p]) * borda(p), (p) => { const t = sm(((p % w) - meio[0]) / (2 * R) + 0.5); return [0, 1, 2].map((kk) => CIANO[kk] + (AZUL[kk] - CIANO[kk]) * t); });
      // 6. O contorno da cabeça inteira (nível 0,5 de Shead), para o clip das orelhas: Moore + RDP.
      // A máscara do contorno é a cabeça borrada (3·k) e dilatada (2·k): sem o borrão, o ruído da foto fazia o contorno
      // ziguezaguear em mais de mil pontos, e o clip-path não valia.
      const mB = boxBlur(Shead, Math.round(3 * k));
      const mD = dilate(Float32Array.from(mB, (v) => (v > 0.35 ? 1 : 0)), Math.max(1, Math.round(2 * k)));
      const m = new Uint8Array(N); for (let p = 0; p < N; p++) m[p] = mD[p] > 0.5 ? 1 : 0;
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
      // O traçado começa no pixel mais à esquerda da linha dos olhos (um trecho sólido): começar na ponta de uma
      // orelha fazia o traçado voltar ao início cedo, pelo estreito da base, e deixar o resto de fora.
      let sx = -1, sy = Math.round(olhoY);
      { const run = Math.round(10 * k); for (let x = 0; x < w - run && sx < 0; x++) { let ok = true; for (let i = 0; i < run; i++) if (!at(x + i, sy)) { ok = false; break; } if (ok) sx = x; } }
      if (sx < 0) { for (let y = 0; y < h && sx < 0; y++) for (let x = 0; x < w; x++) if (at(x, y)) { sx = x; sy = y; break; } }
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const pts: number[][] = [[sx, sy]]; let cx = sx, cy = sy, dd = 0; // o fundo está à esquerda: a busca começa por cima (dd+6 = 6)
      let d0 = -1;
      for (let n = 0; n < 60000; n++) { let found = false; for (let q = 0; q < 8; q++) { const z = (dd + 6 + q) % 8, nx = cx + dirs[z][0], ny = cy + dirs[z][1]; if (at(nx, ny)) { cx = nx; cy = ny; dd = z; found = true; break; } } if (!found) break; if (n === 0) d0 = dd; else if (cx === sx && cy === sy && dd === d0) break; pts.push([cx, cy]); }
      const rdp = (a: number[][], eps: number): number[][] => { if (a.length < 3) return a; const [ax, ay] = a[0], [bx, by] = a[a.length - 1]; let im = 0, dm = 0; for (let i = 1; i < a.length - 1; i++) { const [px, py] = a[i]; const L = Math.hypot(bx - ax, by - ay); const dist = L ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay); if (dist > dm) { dm = dist; im = i; } } if (dm <= eps) return [a[0], a[a.length - 1]]; return [...rdp(a.slice(0, im + 1), eps).slice(0, -1), ...rdp(a.slice(im), eps)]; };
      const simp = rdp([...pts, pts[0]], 2 * k).slice(0, -1);
      const pivot = (ear: number[][]) => { const b = ear.slice(P.baseDesde); return [Math.round(b.reduce((s, q) => s + q[0], 0) / b.length), Math.round(b.reduce((s, q) => s + q[1], 0) / b.length)]; };
      out.__json = JSON.stringify({ pivots: { earLeft: pivot(P.earL), earRight: pivot(P.earR) }, headClip: `M${simp.map(([x, y]) => `${x} ${y}`).join(" L")} Z`, points: simp.length });
      // 7. Conferência: a pilha luz → corpo → cabeca → orelhas → aro + olhos sobre preto, contra a imagem.
      const imgs = ["luz", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"].map((n) => { const i = new Image(); i.src = out[n]; return i; });
      await Promise.all(imgs.map((i) => new Promise((ok) => (i.complete ? ok(0) : (i.onload = ok)))));
      const c = canvas(); const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillRect(0, 0, w, h); for (const i of imgs) x.drawImage(i, 0, 0);
      x.fillStyle = "#fff"; for (const e of P.olhos) { x.beginPath(); x.arc(e.x, e.y, e.r, 0, Math.PI * 2); x.fill(); }
      const q = x.getImageData(0, 0, w, h).data; let worst = 0, sum = 0, n = 0, wp = 0;
      for (let p = 0; p < N; p++) { let eye = false; for (const e of P.olhos) if (Math.hypot((p % w) - e.x, Math.floor(p / w) - e.y) < e.r + 4 * k) eye = true; if (eye) continue; for (let kk = 0; kk < 3; kk++) { const diff = Math.abs(q[p * 4 + kk] - d[p * 4 + kk]); sum += diff; n++; if (diff > worst) { worst = diff; wp = p; } } }
      out.__check = JSON.stringify({ max: worst, mean: Math.round((sum / n) * 100) / 100, em: [wp % w, Math.floor(wp / w)] });
      { const p = wp; out.__dbg = JSON.stringify({ C: rgbAt(p), lum: LUM[p], ch: CH[p], dark: dark[p], comp: comp[p], S: S[p], Shead: Shead[p], Sbody: Sbody[p], aroW: aroW[p], La: La[p], Lp: [Lp[p * 3], Lp[p * 3 + 1], Lp[p * 3 + 2]], headA: headA(p), eL: eL(p), eR: eR(p), stack: [q[p * 4], q[p * 4 + 1], q[p * 4 + 2]] }); }
      out.__conf = c.toDataURL("image/png");
      resolve(out);
    };
    img.src = src;
  });
}

const APP = [path.join(here, "../../../app"), path.join(here, "../../../../../kiwinotes/app")].find((d) => existsSync(path.join(d, "node_modules/playwright-core/index.mjs")));
if (!APP) throw new Error("camadas: playwright-core não encontrado; rode `bun install` em app/");
const { webkit } = await import(path.join(APP, "node_modules/playwright-core/index.mjs"));
const browser = await webkit.launch();
const page = await browser.newPage();
const imgFile = path.join(entradaDir, IMAGEM);
if (!existsSync(imgFile)) throw new Error(`camadas: falta a imagem ${imgFile}`);
const src = `data:image/${imgFile.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(imgFile).toString("base64")}`;
const sc = (v: number) => Math.round(v * F * 10) / 10;
const P: P = {
  w: Math.round(ENT.espaco.w * F), h: Math.round(ENT.espaco.h * F),
  olhos: ENT.olhos.map((o) => ({ x: sc(o.x), y: sc(o.y), r: sc(o.r) })),
  earL: ENT.orelhaEsquerda.map(([x, y]) => [sc(x), sc(y)]), earR: ENT.orelhaDireita.map(([x, y]) => [sc(x), sc(y)]),
  sobra: sc(ENT.sobra), queixoY: sc(ENT.queixoY ?? 0.66 * ENT.espaco.h), baseDesde: ENT.baseDesde ?? 3,
};
const r: Record<string, string> = await page.evaluate(`(${decompor.toString()})(${JSON.stringify(src)}, ${JSON.stringify(P)})`);
await browser.close();
mkdirSync(dir, { recursive: true });
let total = 0;
// As camadas grandes e borradas (luz, anel) vão com menos qualidade: não se vê, e pesa metade.
const Q: Record<string, string> = { luz: "80", "luz-anel": "80" };
for (const n of ["luz", "luz-anel", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"]) {
  const tmp = path.join(dir, `${n}.png`), file = path.join(dir, `${n}.webp`);
  writeFileSync(tmp, Buffer.from(r[n].split(",")[1]!, "base64"));
  const res = spawnSync("cwebp", ["-quiet", "-q", Q[n] ?? "90", "-alpha_q", "100", "-exact", tmp, "-o", file]);
  rmSync(tmp);
  if (res.status !== 0) throw new Error(`camadas: cwebp falhou em ${n}`);
  total += statSync(file).size;
}
writeFileSync(path.join(dir, "conferencia.png"), Buffer.from(r.__conf.split(",")[1]!, "base64"));
const meta = JSON.parse(r.__json);
if (r.__dbg) console.log("camadas: pior pixel:", r.__dbg);
const escala = 1024 / P.w;
const meioX = (P.olhos[0]!.x + P.olhos[1]!.x) / 2, olhoY = (P.olhos[0]!.y + P.olhos[1]!.y) / 2;
const json = {
  espaco: { w: P.w, h: P.h },
  olhos: P.olhos,
  pivos: meta.pivots,
  /** O encaixe no palco de 1024 ("cover"): a largura do palco, o meio dos olhos em (512, 414). A luz termina nas bordas do palco. */
  encaixe: { escala: Math.round(escala * 1e4) / 1e4, dx: Math.round((512 - meioX * escala) * 100) / 100, dy: Math.round((414 - olhoY * escala) * 100) / 100 },
  camadas: ["luz", "luz-anel", "corpo", "cabeca", "orelha-esquerda", "orelha-direita", "aro"],
  clipCabeca: meta.headClip,
};
writeFileSync(path.join(dir, "camadas.json"), JSON.stringify(json, null, 2) + "\n");
console.log(`camadas: 7 camadas em ${P.w}×${P.h} (${(total / 1024).toFixed(0)} KB), clip com ${meta.points} pontos; a pilha contra a imagem: ${r.__check} (erro por canal, 0–255, fora dos olhos)`);
