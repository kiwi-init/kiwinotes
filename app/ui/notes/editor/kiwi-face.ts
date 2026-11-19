// O rostinho da etiqueta do cursor do Kiwi (T20869, T21806, spec #20843): o gato do app de verdade, o `createKiwiCat`
// (o `ByteKiwiCat` do pacote aprovado no #14755), parado, na paleta dos Ajustes e no fundo do tema. Nada redesenhado:
// o gato sai grande num canvas fora da tela, as camadas dele (a névoa com a máscara e o rosto) se juntam numa imagem só,
// e ela é recortada na cabeça, com as orelhas. A 16 px o quadro inteiro do gato some (olhos de 1 px, #21371): sem a
// névoa fraca de volta, a cabeça enche a etiqueta. Uma imagem por paleta e tema, feita uma vez.

import type { SymbolBackground } from "../../kiwicat/cat.ts";
import { catPalette } from "../../../src/shared/kiwicat-colors.ts";

/** O gato que se desenha, em CSS px (a 2×, 320 px de canvas). */
export const RENDER_SIZE = 160;
/** O que conta como gato no recorte: a opacidade mínima (0 a 255), para a névoa fraca das bordas ficar de fora. */
export const HEAD_ALPHA = 96;
/** A imagem final: 64 px, nítida numa etiqueta de até 32 CSS px em 2×. */
export const FACE_PX = 64;

const cache = new Map<string, Promise<string>>();
const done = new Map<string, string>();

const theme = (): SymbolBackground => (typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark");
const keyOf = (cor: unknown, bg: SymbolBackground) => `${catPalette(cor).id}|${bg}`;

/**
 * O quadrado da cabeça: a caixa dos pixels com opacidade de pelo menos `HEAD_ALPHA` (as orelhas, a cabeça e a névoa
 * forte em volta), com o lado da maior das duas medidas, centrado na caixa e preso ao quadro.
 */
export function headSquare(data: Uint8ClampedArray, w: number, h: number): { left: number; top: number; side: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! < HEAD_ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const side = Math.min(w, h, Math.max(x1 - x0, y1 - y0) + 1);
  const clamp = (v: number, max: number) => Math.round(Math.max(0, Math.min(max - side, v)));
  return { left: clamp((x0 + x1 + 1 - side) / 2, w), top: clamp((y0 + y1 + 1 - side) / 2, h), side };
}

/** A névoa como a tela a mostra: a opacidade e a máscara radial do `fogLayer` (`cat.ts`), num canvas só. */
function maskedFog(fog: HTMLCanvasElement, layer: HTMLElement): HTMLCanvasElement {
  const w = fog.width;
  const out = document.createElement("canvas");
  out.width = out.height = w;
  const ctx = out.getContext("2d")!;
  ctx.globalAlpha = Number(layer.style.opacity || 1);
  ctx.drawImage(fog, 0, 0);
  ctx.globalAlpha = 1;
  // `radial-gradient(circle at 50% 53%, …)`: o raio vai até o canto mais longe.
  const cx = w * 0.5, cy = w * 0.53, r = Math.hypot(w * 0.5, w * 0.53);
  const stop = (name: string, fallback: number) => Math.min(1, (parseFloat(layer.style.getPropertyValue(name)) || fallback) / 100);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(stop("--fog-core", 43), "rgba(0,0,0,1)");
  g.addColorStop(stop("--fog-mid", 67), "rgba(0,0,0,0.84)");
  g.addColorStop(stop("--fog-mist", 85), "rgba(0,0,0,0.28)");
  g.addColorStop(stop("--fog-edge", 96), "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  return out;
}

async function render(cor: unknown, bg: SymbolBackground): Promise<string> {
  const { createKiwiCat } = await import("../../kiwicat/cat.ts");
  const root = document.createElement("div");
  const cat = await createKiwiCat(root, {
    mode: "capture", width: RENDER_SIZE, height: RENDER_SIZE, background: bg, seed: 17,
    inputs: { estado: "repouso", cor: catPalette(cor).id, voz: null, parado: true },
  });
  try {
    cat.capture(2.5);
    const [fog, face] = [...root.querySelectorAll("canvas")] as HTMLCanvasElement[];
    const fogLayer = fog?.parentElement;
    if (!fog || !face || !fogLayer || !face.width) return "";
    const w = face.width;
    const all = document.createElement("canvas");
    all.width = all.height = w;
    const ctx = all.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    ctx.drawImage(maskedFog(fog, fogLayer), 0, 0);
    ctx.drawImage(face, 0, 0);
    // O recorte: a cabeça inteira, com as orelhas, sem a névoa fraca de volta (que só ocupa lugar a 16 px).
    const head = headSquare(ctx.getImageData(0, 0, w, w).data, w, w);
    if (!head) return "";
    const { left, top, side } = head;
    // A redução em metades, com a suavização alta, para os olhos e a boca não serrilharem.
    let src: HTMLCanvasElement = all, sx = left, sy = top, sw = side;
    while (sw > FACE_PX) {
      const next = Math.max(FACE_PX, Math.round(sw / 2));
      const c = document.createElement("canvas");
      c.width = c.height = next;
      const x = c.getContext("2d")!;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.drawImage(src, sx, sy, sw, sw, 0, 0, next, next);
      src = c; sx = sy = 0; sw = next;
    }
    return src.toDataURL("image/png");
  } finally {
    await cat.dispose();
  }
}

/** A imagem do rosto (data URL) na paleta `cor` e no tema de agora; `""` sem canvas (o teste sem DOM) ou se falhar. */
export function kiwiFace(cor: unknown, bg: SymbolBackground = theme()): Promise<string> {
  const key = keyOf(cor, bg);
  let hit = cache.get(key);
  if (!hit) {
    hit = (typeof document === "undefined" ? Promise.resolve("") : render(cor, bg).catch(() => "")).then((url) => {
      done.set(key, url);
      return url;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** O rosto já pronto, sem esperar; `""` enquanto ele ainda se desenha (e o pedido sai). */
export function kiwiFaceUrl(cor: unknown, bg: SymbolBackground = theme()): string {
  const key = keyOf(cor, bg);
  if (!done.has(key)) void kiwiFace(cor, bg);
  return done.get(key) ?? "";
}

/** A etiqueta: a imagem do rosto; um ponto na cor dele enquanto o rosto não está pronto, ou sem canvas. */
export function kiwiFaceElement(cor: unknown): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "kn-kiwi-face";
  const show = (url: string): HTMLElement => {
    if (!url) return dot;
    const img = document.createElement("img");
    img.className = "kn-kiwi-face";
    img.src = url;
    img.alt = "";
    img.draggable = false;
    return img;
  };
  const now = kiwiFaceUrl(cor);
  if (now) return show(now);
  void kiwiFace(cor).then((url) => {
    if (url && dot.isConnected) dot.replaceWith(show(url));
  });
  return dot;
}
