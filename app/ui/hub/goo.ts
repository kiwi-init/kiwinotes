// A gota da barra do Hub (spec #17725, T18646): a parte sem DOM. Cada lado da barra (o `start`, à esquerda das abas, e
// o `end`, à direita) anda por quatro fases: sem botões (`hidden`), a gota brotando da pílula de abas até virar os
// botões (`entering`), os botões na barra (`shown`) e a gota voltando para a pílula (`leaving`). Quem muda a fase é a
// seção, ao pôr ou tirar os botões dela (o portal do `TopBar`), e o fim da animação da gota.

export type GooPhase = "hidden" | "entering" | "shown" | "leaving";
export type GooSide = "start" | "end";

/** O tempo máximo de uma ida ou de uma volta: se o `animationend` não vier (a aba escondida, uma animação trocada),
 *  a fase anda sozinha e a barra nunca fica presa no meio. */
export const GOO_FALLBACK_MS = 900;

/** A seção pôs (`true`) ou tirou (`false`) os botões deste lado. A primeira medida não anima (`first`). */
export function gooOnButtons(phase: GooPhase, has: boolean, first = false): GooPhase {
  if (first) return has ? "shown" : "hidden";
  if (has) return phase === "hidden" || phase === "leaving" ? "entering" : phase;
  return phase === "shown" || phase === "entering" ? "leaving" : phase;
}

/** A animação da gota acabou: a ida vira os botões, a volta some na pílula. */
export function gooOnAnimationEnd(phase: GooPhase): GooPhase {
  if (phase === "entering") return "shown";
  if (phase === "leaving") return "hidden";
  return phase;
}

export interface GooRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O que `gooRect` lê de um elemento: a caixa do layout, sem transform. */
export interface GooBox {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
  offsetParent: Element | null;
}

/**
 * O retângulo de `el` na barra, em px inteiros, ou `null` sem nada na tela. Pela caixa do layout (`offset*`, subindo até
 * a barra), e não pelo `getBoundingClientRect`: a janela do Hub entra com uma escala, e uma medida no meio dela ficava
 * torta para sempre (o `ResizeObserver` não vê transform).
 */
export function gooRect(el: GooBox, bar: Element): GooRect | null {
  if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return null;
  let x = 0;
  let y = 0;
  let at: GooBox | null = el;
  while (at && at !== (bar as unknown)) {
    x += at.offsetLeft;
    y += at.offsetTop;
    at = at.offsetParent as GooBox | null;
  }
  // A barra não está entre os pais posicionados: não há como medir dentro dela.
  if (!at) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) };
}

/** As variáveis de CSS de um retângulo (`--goo-tabs-x`…). */
export function gooVars(name: "tabs" | GooSide, r: GooRect): Record<string, string> {
  return { [`--goo-${name}-x`]: `${r.x}px`, [`--goo-${name}-y`]: `${r.y}px`, [`--goo-${name}-w`]: `${r.w}px`, [`--goo-${name}-h`]: `${r.h}px` };
}

/**
 * Os botões que o `ResizeObserver` passa a olhar (`add`) e os que saíram da barra e ele larga (`drop`). Sem o `drop`,
 * cada troca de seção deixava os botões antigos observados até a barra sumir (revisão do T18646, T18917).
 */
export function gooWatchDiff<T>(watched: ReadonlySet<T>, now: Iterable<T>): { add: T[]; drop: T[] } {
  const current = new Set(now);
  return { add: [...current].filter((c) => !watched.has(c)), drop: [...watched].filter((c) => !current.has(c)) };
}
