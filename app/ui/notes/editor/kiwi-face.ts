// O rostinho da etiqueta do cursor do Kiwi (T20869, spec #20843): o gato v2 parado, na cor escolhida nos Ajustes.
// O rosto (orelhas, olhos e boca) é o `drawCatFace` do kiwicat-v2, num quadro do `repouso`; a névoa vira um disco escuro
// com o anel dos `prismStops`, porque numa etiqueta de 18 px o WebGL da névoa não aparece. Desenhado uma vez por cor,
// e cada etiqueta usa a imagem pronta.

import { CAT_CONFIG } from "../../kiwicat-v2/cat-config.ts";
import { CatMotion, seededRandom } from "../../kiwicat-v2/cat-motion.ts";
import { drawCatFace } from "../../kiwicat-v2/cat-face.ts";
import { catPalette } from "../../../src/shared/kiwicat-colors.ts";

const SIZE = 64;
const cache = new Map<string, string>();

/** A imagem do rosto (data URL) na paleta `cor`; `""` quando o canvas não existe (o teste sem DOM). */
export function kiwiFaceUrl(cor: unknown): string {
  const id = catPalette(cor).id;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    const p = catPalette(cor);
    const dpr = 2;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // O anel e o disco: o corpo escuro do gato.
      const ring = ctx.createLinearGradient(0, 0, SIZE, SIZE);
      p.prismStops.forEach((c, i) => ring.addColorStop(i / 2, c));
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.silhouetteColor;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      const frame = new CatMotion("repouso", seededRandom(1)).step(0.05, { state: "repouso", emote: "auto", audio: null });
      // Olhos abertos: o quadro parado nunca pega a piscada.
      const open = { ...frame, blinkAmount: 0 };
      const ears = document.createElement("canvas");
      ctx.save();
      // O rosto um pouco menor e mais baixo, para as orelhas caberem no disco.
      ctx.translate(SIZE * 0.08, SIZE * 0.12);
      ctx.scale(0.84, 0.84);
      // As cores da paleta sobre o CAT_CONFIG, como o `catConfigFor` do gato (sem importar o gato inteiro na janela).
      drawCatFace(ctx, ears, open, { ...CAT_CONFIG, prismStops: p.prismStops, accentColor: p.accentColor, eyeColor: p.eyeColor }, SIZE, dpr);
      ctx.restore();
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
