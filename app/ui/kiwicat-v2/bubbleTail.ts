// O rabo do balão do KiwiCat (T14933, spec #14896): o SVG do `KiwiSpeechBubble` do pacote, com as cores pela CSS
// (`bubble.css`). Uma string, para o overlay (DOM) e o hub (React) usarem o mesmo desenho.
//
// T16754 (harry #16786): o rabo sai da quina do balão mais perto do gato, e o balão se põe para a ponta encostar no
// gato. O `TailSide` é essa quina; `TAIL_TIP` e `CAT_BODY` são as medidas que o hub, o overlay e os checks dividem.

/** A quina da casca de onde o rabo sai: a mais perto do gato. */
export type TailSide = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/**
 * A ponta do rabo, contada da quina da casca (pelo lado de fora do contorno de 2 px): 7,5 px para dentro, na
 * horizontal, e 17,5 px para fora, na vertical. No SVG de 34 × 24, a ponta do traço está em (28,5; 19,5), e o SVG
 * encosta na borda de dentro do contorno (`right: 0` e `bottom: -24px` em `bubble.css`).
 */
export const TAIL_TIP = { x: 7.5, y: 17.5 } as const;

/**
 * O corpo do gato v2 no quadro dele (96 × 120 no hub, 192 × 240 vezes a escala no overlay), em frações da largura e da
 * altura: a silhueta, das orelhas ao pé, sem a névoa. O quadro tem espaço em cima para os emotes, por isso o corpo
 * começa em 44 % da altura. Medido no print do hub (T16754); o `bubble-tail-check` confere de novo no gato desenhado.
 */
export const CAT_BODY = { x0: 0.28, x1: 0.74, y0: 0.44, y1: 0.77 } as const;

export const TAIL_SVG_INNER =
  '<path class="kn-tail-shadow" d="M 2 1 L 2 6 Q 11 16, 29.5 20.5 Q 24 12, 19.5 6 L 19.5 1 Z"/>' +
  '<path class="kn-tail-fill" d="M 4 -2 L 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1 L 18 -2 Z"/>' +
  '<path class="kn-tail-line" d="M 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1"/>';

/** O `<svg>` do rabo, pronto para pôr dentro da casca. */
export function tailSvg(side: TailSide): string {
  return `<svg class="kn-bubble-tail" data-side="${side}" width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">${TAIL_SVG_INNER}</svg>`;
}

/**
 * A quina do balão para um gato num quadro `cat` dentro de uma área `area` (as duas na mesma origem): o balão fica à
 * esquerda e em cima do gato (a quina de baixo à direita, o padrão), e passa para a direita ou para baixo quando o
 * balão (`bubble`, a largura e a altura que ele pode ter) não cabe daquele lado.
 */
export function tailSideFor(
  cat: { left: number; top: number; width: number; height: number },
  area: { left: number; top: number; right: number; bottom: number },
  bubble: { width: number; height: number },
): TailSide {
  const tipLeft = cat.left + cat.width * CAT_BODY.x0;
  const tipRight = cat.left + cat.width * CAT_BODY.x1;
  const roomLeft = tipLeft + TAIL_TIP.x - area.left;
  const roomRight = area.right - (tipRight - TAIL_TIP.x);
  const roomUp = cat.top + cat.height * CAT_BODY.y0 - TAIL_TIP.y - area.top;
  const roomDown = area.bottom - (cat.top + cat.height * CAT_BODY.y1 + TAIL_TIP.y);
  const right = roomLeft < bubble.width && roomRight > roomLeft;
  const down = roomUp < bubble.height && roomDown > roomUp;
  return `${down ? "top" : "bottom"}-${right ? "left" : "right"}`;
}
