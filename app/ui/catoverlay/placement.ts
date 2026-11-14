// A posição e o tamanho do gato no overlay (spec #12949), como a página lê da URL que o helper monta
// (`CatPlacement.query` em native/Sources/KiwiHelperCore/CatOverlayModel.swift). A janela é a do helper: o gato
// (192 × 240 vezes a escala) e o balão, sempre com 300 × 112, em cima do gato ou embaixo dele (os cantos de cima).

export const CAT_W = 192;
export const CAT_H = 240;
export const BUBBLE_W = 300;
export const BUBBLE_H = 112;
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;

export interface OverlayPlacement {
  scale: number;
  catW: number;
  catH: number;
  winW: number;
  winH: number;
  /** De que lado da janela o gato e o balão encostam. */
  lado: "left" | "center" | "right";
  /** O balão em cima do gato, ou embaixo (os cantos de cima). */
  balao: "acima" | "abaixo";
}

/** O que a URL diz; o que falta ou está fora dos limites fica como antes (1×, no centro, o balão em cima). */
export function overlayPlacement(query: URLSearchParams): OverlayPlacement {
  const raw = Number(query.get("escala") ?? "1");
  const scale = Number.isFinite(raw) ? Math.min(Math.max(raw, MIN_SCALE), MAX_SCALE) : 1;
  const catW = Math.round(CAT_W * scale);
  const catH = Math.round(CAT_H * scale);
  const l = query.get("lado");
  const lado = l === "left" || l === "right" ? l : "center";
  const balao = query.get("balao") === "abaixo" ? "abaixo" : "acima";
  return { scale, catW, catH, winW: Math.max(catW, BUBBLE_W), winH: catH + BUBBLE_H, lado, balao };
}
