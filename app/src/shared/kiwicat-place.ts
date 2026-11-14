// Onde o Kiwi Cat aparece por cima dos apps, e o tamanho dele (spec #12949). O helper monta a janela com isso
// (`CatPlacement` em native/Sources/KiwiHelperCore/CatOverlayModel.swift, os mesmos nomes e limites).

/** As seis posições, na ordem dos controles. O padrão é o centro, como antes. */
export const CAT_POSITIONS = [
  { id: "center", label: "Centro" },
  { id: "bottom-center", label: "Centro, embaixo" },
  { id: "top-left", label: "Canto superior esquerdo" },
  { id: "top-right", label: "Canto superior direito" },
  { id: "bottom-left", label: "Canto inferior esquerdo" },
  { id: "bottom-right", label: "Canto inferior direito" },
] as const;
export type CatPosition = (typeof CAT_POSITIONS)[number]["id"];
export const DEFAULT_CAT_POSITION: CatPosition = "center";

export const isCatPosition = (v: unknown): v is CatPosition => CAT_POSITIONS.some((p) => p.id === v);

/** O tamanho, em vezes o de hoje (192 × 240 é o 1×), de 0,6 a 1,6, de 0,1 em 0,1. */
export const CAT_SIZE = { min: 0.6, max: 1.6, step: 0.1, default: 1 } as const;

export const isCatSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= CAT_SIZE.min && v <= CAT_SIZE.max;

/** Um tamanho de fora (um arquivo mexido à mão) fica no limite mais perto, em passos de 0,1. */
export function catSize(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return CAT_SIZE.default;
  return Math.round(Math.min(Math.max(v, CAT_SIZE.min), CAT_SIZE.max) * 10) / 10;
}

/** O tamanho como a tela mostra: "1×", "1,3×". */
export const catSizeLabel = (v: number) => `${catSize(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;

/** A tela de exemplo da prévia: 1440 × 900, com a barra de menus (25) e o Dock (70). */
const SCREEN = { w: 1440, h: 900, menu: 25, dock: 70 } as const;
/** A distância da borda da área útil, a mesma do helper (`CatPlacement.margin`). */
export const CAT_MARGIN = 24;

/**
 * Onde o gato fica na prévia pequena da tela (o onboarding e os Ajustes), em % da tela de exemplo, com a mesma conta do
 * helper: nos cantos, a `CAT_MARGIN` da área útil; no centro, o gato no meio dela.
 */
export function catPreviewRect(posicao: CatPosition, tamanho: number): { left: number; top: number; width: number; height: number } {
  const s = catSize(tamanho);
  const w = Math.round(192 * s), h = Math.round(240 * s);
  const area = { left: 0, top: SCREEN.menu, right: SCREEN.w, bottom: SCREEN.h - SCREEN.dock };
  const left = posicao.endsWith("left") ? area.left + CAT_MARGIN : posicao.endsWith("right") ? area.right - CAT_MARGIN - w : (area.left + area.right - w) / 2;
  const top = posicao.startsWith("top") ? area.top + CAT_MARGIN : posicao.startsWith("bottom") ? area.bottom - CAT_MARGIN - h : (area.top + area.bottom - h) / 2;
  const pct = (v: number, of: number) => Math.round((v / of) * 1000) / 10;
  return { left: pct(left, SCREEN.w), top: pct(top, SCREEN.h), width: pct(w, SCREEN.w), height: pct(h, SCREEN.h) };
}

/** A barra de menus e o Dock da prévia, em % da altura da tela de exemplo. */
export const PREVIEW_BARS = { menu: (SCREEN.menu / SCREEN.h) * 100, dock: (SCREEN.dock / SCREEN.h) * 100 } as const;
