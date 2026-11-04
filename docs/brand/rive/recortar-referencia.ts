// A imagem de referência do harry em camadas para o Rive (T3151, #3562/#3563): "literalmente pegar aquela imagem e
// animar". Nada é redesenhado: cada camada é um pedaço da própria referencia.jpg, sem o fundo cinza, para animar com
// ossos e malha no Rive sobre o palco preto.
//
// - O fundo sai por "cor para alfa" (como o do GIMP): cada pixel vira a cor que, por cima do cinza do fundo, dá o pixel
//   da foto, com o menor alfa possível. O preto fica preto e opaco; o brilho colorido e a névoa ficam translúcidos.
// - Sobre o preto (escolha C do harry, #3570), uma camada "luz" atrás do gato: a silhueta borrada em lavanda e cinza.
//   Ela aparece onde o gato é translúcido (a névoa, a borda macia) e passa um pouco da borda, como o fundo claro faz na
//   referência, sem virar contorno. As cores do gato ficam as da referência.
// - As camadas saem por máscaras nas coordenadas da referência (512 × 640), com a borda macia para a emenda não aparecer
//   quando uma parte gira: orelhas (polígono), brilho (pela saturação), névoa de baixo (degradê) e a cabeça (o resto).
// - Os olhos são tapados com o preto da cabeça: no Rive eles são círculos brancos vetoriais, nítidos como na referência.
//
// Uso: bun docs/brand/rive/recortar-referencia.ts   (escreve docs/brand/rive/referencia/*.webp e a prévia sobre preto)

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "referencia");

/** Os pontos da referência (512 × 640), medidos na imagem com uma grade. */
export const REF = {
  w: 512,
  h: 640,
  eyes: [
    { x: 201, y: 320, r: 17 },
    { x: 311, y: 320, r: 17 },
  ],
  /** As orelhas: do contorno de fora até onde encostam no topo da cabeça. */
  earLeft: [[100, 150], [140, 140], [268, 196], [232, 222], [196, 246], [168, 286], [118, 300]],
  earRight: [[262, 192], [390, 150], [420, 170], [410, 280], [372, 286], [338, 240], [300, 214]],
  /** O gato de frente (#3581): a metade esquerda da foto, espelhada no meio dos olhos. */
  mirrorX: 256,
  /** A orelha com sobra para dentro da cabeça (#3583): girada, a emenda não aparece. */
  earLeftOver: [[100, 150], [140, 140], [268, 196], [262, 250], [214, 292], [176, 330], [118, 320]],
  /** A névoa de baixo começa a pesar mais que a cabeça nesta faixa. */
  mistFrom: 410,
  mistTo: 480,
} as const;

/** O que roda na página: recebe a imagem e devolve as camadas em PNG (data URL). */
function cut(src: string, ref: typeof REF, bodySrc: string, bodyBox: { x: number; y: number; w: number; h: number }): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const img = new Image();
    const body = new Image();
    let loaded = 0;
    const ready = () => ++loaded === 2 && go();
    img.onload = ready;
    body.onload = ready;
    const go = () => {
      const { w, h } = ref;
      const canvas = (draw?: (c: CanvasRenderingContext2D) => void) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d")!;
        draw?.(x);
        return c;
      };
      // Blur feito à mão: o WebKit não tem o `filter` do canvas 2D (ele é ignorado em silêncio). Três passadas de média
      // (box blur), na horizontal e na vertical, ficam perto de uma gaussiana de desvio ~ r.
      const blur = (src: Float32Array, r: number): Float32Array => {
        let a = Float32Array.from(src);
        let b = new Float32Array(w * h);
        const k = Math.max(1, Math.round(r));
        for (let pass = 0; pass < 3; pass++) {
          for (const [len, n, step, lineStep] of [[w, h, 1, w], [h, w, w, 1]] as const) {
            for (let line = 0; line < n; line++) {
              const base = line * lineStep;
              let sum = 0;
              for (let i = -k; i <= k; i++) sum += a[base + Math.min(len - 1, Math.max(0, i)) * step]!;
              for (let i = 0; i < len; i++) {
                b[base + i * step] = sum / (2 * k + 1);
                sum += a[base + Math.min(len - 1, i + k + 1) * step]! - a[base + Math.max(0, i - k) * step]!;
              }
            }
            [a, b] = [b, a];
          }
        }
        return a;
      };
      const photo = canvas((x) => x.drawImage(img, 0, 0, w, h)).getContext("2d")!.getImageData(0, 0, w, h).data;
      const mx = ref.mirrorX;
      const mirror = (pts: readonly (readonly number[])[]) => pts.map(([px, py]) => [2 * mx - 1 - px, py]);
      // O cinza do fundo: a média dos quatro cantos.
      const bg = [0, 0, 0];
      for (const [cx, cy] of [[4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5]]) {
        const i = (cy * w + cx) * 4;
        for (let k = 0; k < 3; k++) bg[k] += photo[i + k] / 4 / 255;
      }
      // Cor para alfa: o menor alfa que explica o pixel por cima do fundo.
      const fg = new Float32Array(w * h * 4);
      const chroma = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) {
        const c = [photo[p * 4] / 255, photo[p * 4 + 1] / 255, photo[p * 4 + 2] / 255];
        let a = 0;
        // Pixel quase neutro (croma < 0,05) é preto translúcido: o alfa vem da luminância e a cor é a do gato. Dividir um
        // canal um pouco mais baixo pelo alfa fazia o ruído de croma do JPEG virar pontos claros na borda (#3583).
        const neutral = Math.max(...c) - Math.min(...c) < 0.05;
        if (neutral) {
          const L = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
          a = Math.max(0, (L(bg) - L(c)) / L(bg));
        } else for (let k = 0; k < 3; k++) a = Math.max(a, c[k] > bg[k] ? (c[k] - bg[k]) / (1 - bg[k]) : (bg[k] - c[k]) / bg[k]);
        // O preto da foto chega a ~0,93 de alfa (o cinza do JPEG): sem o empurrão, a luz de trás vaza e a orelha fica
        // cinza (#3590). Quase preto vira opaco.
        a = Math.min(1, a / 0.9);
        // O que é mais claro que o fundo e sem cor é o halo do JPEG em volta do escuro, não o gato: sai.
        const lum = (v: number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        if (lum(c) > lum(bg) && Math.max(...c) - Math.min(...c) < 0.08) a = 0;
        // Ruído de JPEG no fundo vira transparência, com um corte macio (um corte seco deixava a borda pontilhada).
        const cut = Math.min(1, Math.max(0, (a - 0.03) / 0.07));
        a *= cut * cut * (3 - 2 * cut);
        for (let k = 0; k < 3; k++) fg[p * 4 + k] = neutral ? 0.07 : a > 0 ? Math.min(1, Math.max(0, (c[k] - bg[k]) / a + bg[k])) : 0;
        // Com alfa baixo, dividir por ele amplia o ruído do JPEG em pontos claros na borda. Ali a cor vai para o escuro
        // do gato, devagar: com alfa de 0,35 para cima, fica a cor que a conta deu (o brilho colorido mora acima disso).
        const keep = Math.min(1, Math.max(0, (a - 0.08) / 0.27));
        const sm = keep * keep * (3 - 2 * keep);
        for (let k = 0; k < 3; k++) fg[p * 4 + k] = 0.07 + (fg[p * 4 + k] - 0.07) * sm;
        fg[p * 4 + 3] = a;
        const r = fg[p * 4], g = fg[p * 4 + 1], b = fg[p * 4 + 2];
        chroma[p] = a > 0 ? Math.max(r, g, b) - Math.min(r, g, b) : 0;
      }
      // O alfa passa por um blur leve (um bloco de JPEG é 8 × 8): o corte pixel a pixel (halo do JPEG, ruído) deixava
      // pontos soltos na borda.
      {
        const alpha = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) alpha[p] = fg[p * 4 + 3];
        const soft = blur(alpha, 2);
        for (let p = 0; p < w * h; p++) fg[p * 4 + 3] = soft[p];
      }
      // Uma máscara macia: um polígono (ou um desenho), com blur na borda.
      const mask = (draw: (c: CanvasRenderingContext2D) => void, soft: number) => {
        const m = canvas((x) => {
          x.fillStyle = "#fff";
          draw(x);
        });
        const d = m.getContext("2d")!.getImageData(0, 0, w, h).data;
        const out = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) out[p] = d[p * 4 + 3] / 255;
        return blur(out, soft);
      };
      const poly = (pts: readonly (readonly number[])[]) => (x: CanvasRenderingContext2D) => {
        x.beginPath();
        pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
        x.closePath();
        x.fill();
      };
      const earL = mask(poly(ref.earLeft), 3);
      const earR = mask(poly(mirror(ref.earLeft)), 3);
      const earLOver = mask(poly(ref.earLeftOver), 3);
      const earROver = mask(poly(mirror(ref.earLeftOver)), 3);
      // A névoa: 0 em cima, 1 embaixo, numa faixa macia.
      const mist = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const t = Math.min(1, Math.max(0, (y - ref.mistFrom) / (ref.mistTo - ref.mistFrom)));
        const s = t * t * (3 - 2 * t);
        for (let x = 0; x < w; x++) mist[y * w + x] = s;
      }
      // O brilho: o que tem cor (saturação), fora o miolo preto. A saturação pixel a pixel de um JPEG é ruidosa (deixava
      // pontos soltos na borda): a máscara passa por um blur leve antes.
      const glowRaw = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) {
        const t = Math.min(1, Math.max(0, (chroma[p] - 0.12) / 0.25));
        glowRaw[p] = t * t * (3 - 2 * t) * fg[p * 4 + 3];
      }
      const glowSoft = blur(glowRaw, 2);
      const glow = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) glow[p] = fg[p * 4 + 3] > 0.001 ? Math.min(1, glowSoft[p] / fg[p * 4 + 3]) : 0;
      // De frente e com o corpo reto (#3581): a metade direita vira o espelho da esquerda, no meio dos olhos (x = mx).
      // O brilho espelha de outro jeito: na foto a cabeça está virada, e o topo do arco fica à direita do meio dos olhos.
      // Espelhar em mx deixava o arco com uma ponta no meio; a metade esquerda do arco, até o topo dele, é esticada até
      // mx antes de espelhar, e o topo fica redondo. À direita, a cor gira do ciano para o púrpura, como na referência.
      // O topo do arco pela linha do meio da faixa (a média do brilho em cada coluna), não pelo primeiro pixel: um
      // pixel solto em cima jogava o topo para o lado e deixava uma ponta (#3606).
      let apex = mx;
      {
        let best = h;
        for (let x = mx - 40; x < Math.min(w, mx + 120); x++) {
          let sum = 0, ys = 0;
          for (let y = 120; y < 330; y++) {
            const g = glowRaw[y * w + x]!;
            if (g > 0.15) {
              sum += g;
              ys += g * y;
            }
          }
          if (sum > 2 && ys / sum < best) [best, apex] = [ys / sum, x];
        }
      }
      const side = (x: number) => (x < mx ? x : 2 * mx - 1 - x);
      const glowHalo = (() => {
        const a = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fg[(y * w + side(x)) * 4 + 3]!;
        return blur(a, 2);
      })();
      const fgM = new Float32Array(w * h * 4);
      const glowM = new Float32Array(w * h);
      const glowC = new Float32Array(w * h * 3);
      const hue = (rgb: number[], deg: number) => {
        // Rotação de matiz em RGB (a matriz do feColorMatrix hueRotate).
        const r = (deg * Math.PI) / 180, c = Math.cos(r), s2 = Math.sin(r);
        const m = [
          0.213 + c * 0.787 - s2 * 0.213, 0.715 - c * 0.715 - s2 * 0.715, 0.072 - c * 0.072 + s2 * 0.928,
          0.213 - c * 0.213 + s2 * 0.143, 0.715 + c * 0.285 + s2 * 0.14, 0.072 - c * 0.072 - s2 * 0.283,
          0.213 - c * 0.213 - s2 * 0.787, 0.715 - c * 0.715 + s2 * 0.715, 0.072 + c * 0.928 + s2 * 0.072,
        ];
        return [0, 1, 2].map((i) => Math.min(1, Math.max(0, m[i * 3]! * rgb[0]! + m[i * 3 + 1]! * rgb[1]! + m[i * 3 + 2]! * rgb[2]!)));
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const sb = y * w + side(x);
          for (let k = 0; k < 4; k++) fgM[p * 4 + k] = fg[sb * 4 + k]!;
          // O brilho sem espelhar (como sugeriu o #3606) perdia a metade direita do arco na cabeça de frente: fica o
          // esticado. Só vale dentro da cabeça espelhada (o alfa dela, com folga para o halo): some o fio solto acima
          // da cabeça, entre as orelhas.
          const sg = y * w + Math.min(w - 1, Math.round((side(x) * apex) / mx));
          // Dentro da cabeça de verdade (alfa espelhado de 0,3 a 0,75): com folga de halo, a franja do arco acima do topo
          // da cabeça, entre as orelhas, passava como dois pontos claros. O halo das laterais vem das manchas da névoa.
          const hi = Math.min(1, Math.max(0, (glowHalo[p]! - 0.3) / 0.45));
          const inside = hi * hi * (3 - 2 * hi);
          glowM[p] = glow[sg]! * inside;
          const col = [fg[sg * 4]!, fg[sg * 4 + 1]!, fg[sg * 4 + 2]!];
          const turn = x < mx ? 0 : 95 * Math.min(1, (x - mx) / 170);
          const out = turn ? hue(col, turn) : col;
          for (let k = 0; k < 3; k++) glowC[p * 3 + k] = out[k]!;
          // Brilho sem cor é a franja cinza da foto (os pontinhos acima da cabeça): sai.
          const sat = Math.max(...out) - Math.min(...out);
          const st = Math.min(1, Math.max(0, (sat - 0.12) / 0.18));
          glowM[p] = glowM[p]! * st * st * (3 - 2 * st);
        }
      // O topo do arco: no meio, onde as duas metades se encontram, um blur horizontal arredonda a ponta (#3606).
      {
        const soft = blur(glowM, 8);
        for (let y = 0; y < h; y++)
          for (let x = mx - 70; x < mx + 70; x++) {
            const t = 1 - Math.abs(x - mx) / 70;
            const p = y * w + x;
            glowM[p] = glowM[p]! + (soft[p]! - glowM[p]!) * t;
          }
      }
      // Dali em diante, tudo usa a versão de frente.
      fg.set(fgM);
      const layer = (weight: (p: number) => number, eyesOut = false) => {
        const c = canvas();
        const x = c.getContext("2d")!;
        const id = x.createImageData(w, h);
        for (let p = 0; p < w * h; p++) {
          const a = fg[p * 4 + 3] * weight(p);
          // A base é o preto do gato: a cor fica toda no brilho (a base espelhada ainda tinha o arco com a ponta).
          for (let k = 0; k < 3; k++) id.data[p * 4 + k] = 0.07 * 255;
          id.data[p * 4 + 3] = a * 255;
        }
        x.putImageData(id, 0, 0);
        if (eyesOut) {
          // Os olhos tapados com o preto da cabeça em volta deles.
          x.fillStyle = "rgb(17,17,17)";
          for (const e of ref.eyes) {
            x.beginPath();
            x.arc(e.x, e.y, e.r + 3, 0, Math.PI * 2);
            x.fill();
          }
        }
        return c.toDataURL("image/png");
      };
      // O brilho vai por cima, como luz: a base (cabeça e orelhas) fica inteira e opaca embaixo dele. Tirar o brilho da
      // base deixava a orelha translúcida e o brilho "dentro" dela (#3590).
      // O preto da base: opaco onde é cabeça ou orelha (alfa alto), e some onde é só o halo colorido em volta.
      const notGlow = (p: number) => {
        const a = fg[p * 4 + 3]!;
        return 1 - glowM[p]! * (1 - a ** 4);
      };
      // A luz atrás do gato: o alfa da silhueta, borrado, em lavanda-acinzentado.
      // A luz atrás de cada peça (#3583): cada uma vai no mesmo osso da sua peça, atrás dela, e acompanha o giro. Uma luz
      // só, parada, deixava um buraco quando a orelha gira.
      const glowOf = (sil: Float32Array) => {
        // Duas passadas: uma larga (o ar em volta) e uma mais justa (a borda), como o cinza da referência.
        const wide = blur(sil, 26);
        const near = blur(sil, 10);
        const out = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) out[p] = 1 - (1 - wide[p]! * 0.9) * (1 - near[p]! * 0.55);
        return out;
      };
      const paintLuz = (alpha: (p: number) => number) => {
        const c = canvas();
        const x = c.getContext("2d")!;
        const id = x.createImageData(w, h);
        for (let p = 0; p < w * h; p++) {
          id.data[p * 4] = 186;
          id.data[p * 4 + 1] = 178;
          id.data[p * 4 + 2] = 214;
          id.data[p * 4 + 3] = alpha(p) * 255;
        }
        x.putImageData(id, 0, 0);
        return c.toDataURL("image/png");
      };
      const withEyes = (sil: Float32Array) => {
        for (const e of ref.eyes)
          for (let y = e.y - e.r - 4; y <= e.y + e.r + 4; y++)
            for (let x = e.x - e.r - 4; x <= e.x + e.r + 4; x++) if ((x - e.x) ** 2 + (y - e.y) ** 2 <= (e.r + 4) ** 2) sil[y * w + x] = 1;
        return sil;
      };
      // O corpo (a névoa do earnest-walrus, docs/brand/rive/nevoa/corpo.webp) no espaço da foto: a luz da cabeça e a do
      // corpo saem da silhueta inteira (cabeça ∪ corpo) e se dividem na faixa da névoa, para não vazar nem dobrar no
      // queixo, onde a cabeça se desfaz no corpo (#3601).
      const bodyA = (() => {
        const d = canvas((x) => x.drawImage(body, bodyBox.x, bodyBox.y, bodyBox.w, bodyBox.h)).getContext("2d")!.getImageData(0, 0, w, h).data;
        const out = new Float32Array(w * h);
        for (let p = 0; p < w * h; p++) out[p] = d[p * 4 + 3]! / 255;
        return out;
      })();
      // A cabeça perde só a orelha de verdade; a orelha leva a sobra para dentro da cabeça (#3583). Na emenda, as duas
      // são o mesmo preto, então a sobra não aparece parada e tapa o buraco quando a orelha gira.
      const head = (p: number) => (1 - earL[p]!) * (1 - earR[p]!) * (1 - mist[p]!);
      const earLw = (p: number) => earLOver[p]! * (1 - mist[p]!);
      const earRw = (p: number) => earROver[p]! * (1 - mist[p]!);
      resolve({
        "orelha-esquerda": layer((p) => notGlow(p) * earLw(p)),
        "orelha-direita": layer((p) => notGlow(p) * earRw(p)),
        cabeca: layer((p) => notGlow(p) * head(p), true),
        brilho: (() => {
          const c = canvas();
          const x = c.getContext("2d")!;
          const id = x.createImageData(w, h);
          for (let p = 0; p < w * h; p++) {
            for (let k = 0; k < 3; k++) id.data[p * 4 + k] = glowC[p * 3 + k]! * 255;
            id.data[p * 4 + 3] = glowM[p]! * fg[p * 4 + 3]! * 255;
          }
          x.putImageData(id, 0, 0);
          return c.toDataURL("image/png");
        })(),
        ...(() => {
          const union = new Float32Array(w * h);
          for (let p = 0; p < w * h; p++) union[p] = Math.max(fg[p * 4 + 3]! * head(p), bodyA[p]!);
          const all = glowOf(withEyes(union));
          const ear = (m: Float32Array) => {
            const sil = new Float32Array(w * h);
            for (let p = 0; p < w * h; p++) sil[p] = fg[p * 4 + 3]! * m[p]! * (1 - mist[p]!);
            return glowOf(sil);
          };
          const l = ear(earL), r = ear(earR);
          return {
            "luz-cabeca": paintLuz((p) => all[p]! * (1 - mist[p]!)),
            // A luz do corpo some antes do fim da foto (y = 640): cortada ali, virava uma linha reta no palco.
            "luz-corpo": paintLuz((p) => {
              const t = Math.min(1, Math.max(0, (h - 8 - Math.floor(p / w)) / 90));
              return all[p]! * mist[p]! * t * t * (3 - 2 * t);
            }),
            "luz-orelha-esquerda": paintLuz((p) => l[p]!),
            "luz-orelha-direita": paintLuz((p) => r[p]!),
          };
        })(),
        inteira: layer(() => 1, true),
      });
    };
    img.src = src;
    body.src = bodySrc;
  });
}

async function main() {
  mkdirSync(out, { recursive: true });
  const { webkit } = await import(path.join(here, "../../../app/node_modules/playwright-core/index.mjs"));
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const src = `data:image/jpeg;base64,${readFileSync(path.join(here, "referencia.jpg")).toString("base64")}`;
  // O corpo vem da névoa do earnest-walrus (nevoa.ts), no mesmo espaço da foto.
  const nevoa = path.join(here, "nevoa");
  const box = (JSON.parse(readFileSync(path.join(nevoa, "manifest.json"), "utf8")) as { name: string; x: number; y: number; w: number; h: number }[]).find((m) => m.name === "corpo")!;
  const bodySrc = `data:image/webp;base64,${readFileSync(path.join(nevoa, "corpo.webp")).toString("base64")}`;
  const layers: Record<string, string> = await page.evaluate(`(${cut.toString()})(${JSON.stringify(src)}, ${JSON.stringify(REF)}, ${JSON.stringify(bodySrc)}, ${JSON.stringify(box)})`);
  let total = 0;
  for (const [name, url] of Object.entries(layers)) {
    const tmp = path.join(out, `${name}.png`);
    const file = path.join(out, `${name}.webp`);
    writeFileSync(tmp, Buffer.from(url.split(",")[1]!, "base64"));
    // Sem perda no alfa e alta no RGB: a borda macia do recorte não pode ganhar degraus.
    const r = spawnSync("cwebp", ["-quiet", "-q", "90", "-alpha_q", "100", "-exact", tmp, "-o", file]);
    rmSync(tmp);
    if (r.status !== 0) throw new Error(`recortar-referencia: cwebp falhou em ${name}`);
    total += statSync(file).size;
    console.log(`recortar-referencia: ${name}.webp (${(statSync(file).size / 1024).toFixed(1)} KB)`);
  }
  // A prévia: as camadas juntas sobre o preto, com os olhos brancos, para comparar com a referência.
  const prev = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const img = (n: string) => `<img src="data:image/webp;base64,${readFileSync(path.join(out, `${n}.webp`)).toString("base64")}" style="position:absolute;inset:0">`;
  const manifest = JSON.parse(readFileSync(path.join(nevoa, "manifest.json"), "utf8")) as { name: string; x: number; y: number; w: number; h: number }[];
  const sprites = manifest.map((m) => `<img src="data:image/webp;base64,${readFileSync(path.join(nevoa, `${m.name}.webp`)).toString("base64")}" style="position:absolute;left:${m.x}px;top:${m.y}px;width:${m.w}px;height:${m.h}px">`).join("");
  const eyes = REF.eyes.map((e) => `<div style="position:absolute;left:${e.x - e.r}px;top:${e.y - e.r}px;width:${e.r * 2}px;height:${e.r * 2}px;border-radius:50%;background:#fff"></div>`).join("");
  await prev.setContent(`<body style="margin:0;display:flex;background:#000">
    <div style="position:relative;width:512px;height:640px;background:#000">${["luz-corpo", "luz-cabeca", "luz-orelha-esquerda", "luz-orelha-direita"].map(img).join("")}${sprites}${["orelha-esquerda", "orelha-direita", "cabeca", "brilho"].map(img).join("")}${eyes}</div>
    <img src="data:image/jpeg;base64,${readFileSync(path.join(here, "referencia.jpg")).toString("base64")}" style="width:512px;height:640px"></body>`);
  await prev.screenshot({ path: path.join(out, "previa.png") });
  await browser.close();
  console.log(`recortar-referencia: ${Object.keys(layers).length} camadas, ${(total / 1024).toFixed(0)} KB; prévia em referencia/previa.png`);
}

if (import.meta.main) await main();
