// O rabo do balão do KiwiCat (T14933, spec #14896): o SVG do `KiwiSpeechBubble` do pacote, com as cores pela CSS
// (`bubble.css`). Uma string, para o overlay (DOM) e o hub (React) usarem o mesmo desenho.

export type TailSide = "right" | "left" | "up" | "down";

export const TAIL_SVG_INNER =
  '<path class="kn-tail-shadow" d="M 2 1 L 2 6 Q 11 16, 29.5 20.5 Q 24 12, 19.5 6 L 19.5 1 Z"/>' +
  '<path class="kn-tail-fill" d="M 4 -2 L 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1 L 18 -2 Z"/>' +
  '<path class="kn-tail-line" d="M 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1"/>';

/** O `<svg>` do rabo, pronto para pôr dentro da casca. */
export function tailSvg(side: TailSide): string {
  return `<svg class="kn-bubble-tail" data-side="${side}" width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">${TAIL_SVG_INNER}</svg>`;
}
