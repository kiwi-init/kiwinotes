// O rostinho da etiqueta do cursor do Kiwi (T20869, spec #20843): a marca do gato v2 (`docs/design/kiwicat-v2/icone/
// kiwi-cat-marca.png`), na cor escolhida nos Ajustes. O rosto 3D do `drawCatFace` some a 16 px (olhos de 1 px, #21371);
// aqui vai o desenho da marca, plano e enquadrado: as orelhas escuras, a cabeça com a névoa dos `prismStops`, os olhos
// grandes e a boca em ω, nas proporções dela. Desenhado uma vez por cor, e cada etiqueta usa a imagem pronta.

import { catPalette } from "../../../src/shared/kiwicat-colors.ts";

/** O quadro do desenho, em unidades; a imagem sai a 4× (nítida a 2× numa etiqueta de até 32 px). */
const SIZE = 64;
const SCALE = 4;
const cache = new Map<string, string>();

/** A silhueta: as duas orelhas e a cabeça, num caminho só (o contorno passa por fora das três). */
function silhouette(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  // As orelhas, como na marca: a ponta no canto de cima, a base entrando na cabeça.
  ctx.moveTo(3, 5);
  ctx.lineTo(27, 19);
  ctx.lineTo(9, 36);
  ctx.closePath();
  ctx.moveTo(61, 5);
  ctx.lineTo(37, 19);
  ctx.lineTo(55, 36);
  ctx.closePath();
  ctx.ellipse(32, 38, 29, 24, 0, 0, Math.PI * 2);
}

/** A imagem do rosto (data URL) na paleta `cor`; `""` quando o canvas não existe (o teste sem DOM). */
export function kiwiFaceUrl(cor: unknown): string {
  const id = catPalette(cor).id;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    const p = catPalette(cor);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE * SCALE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const [c0, c1, c2] = p.prismStops;
      // A borda da névoa em volta da silhueta: o gato se destaca em fundo claro, escuro ou na cor da etiqueta.
      silhouette(ctx);
      const rim = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      rim.addColorStop(0, c0);
      rim.addColorStop(0.5, c1);
      rim.addColorStop(1, c2);
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = rim;
      ctx.stroke();
      ctx.fillStyle = p.silhouetteColor;
      ctx.fill("nonzero");
      // A cabeça com a névoa por dentro, mais forte no meio, como na marca.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(32, 38, 29, 24, 0, 0, Math.PI * 2);
      ctx.clip();
      const glow = ctx.createRadialGradient(32, 36, 2, 32, 40, 32);
      glow.addColorStop(0, c1);
      glow.addColorStop(0.55, c2);
      glow.addColorStop(1, p.silhouetteColor);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();
      // Os olhos: grandes, como na marca (cerca de 60% da largura entre as bordas de fora).
      ctx.fillStyle = p.eyeColor;
      for (const x of [19.5, 44.5]) {
        ctx.beginPath();
        ctx.ellipse(x, 37, 5.6, 6.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // A boca em ω.
      ctx.strokeStyle = p.eyeColor;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(26, 47);
      ctx.quadraticCurveTo(29, 51.5, 32, 48);
      ctx.quadraticCurveTo(35, 51.5, 38, 47);
      ctx.stroke();
      url = canvas.toDataURL("image/png");
    }
  } catch {
    url = "";
  }
  cache.set(id, url);
  return url;
}

/** A etiqueta: a imagem do rosto, ou um ponto na cor dele quando não há canvas. */
export function kiwiFaceElement(cor: unknown): HTMLElement {
  const url = kiwiFaceUrl(cor);
  if (url) {
    const img = document.createElement("img");
    img.className = "kn-kiwi-face";
    img.src = url;
    img.alt = "";
    img.draggable = false;
    return img;
  }
  const dot = document.createElement("span");
  dot.className = "kn-kiwi-face";
  return dot;
}
