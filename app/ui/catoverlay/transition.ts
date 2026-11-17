// Portado de docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx (o `ByteKiwiOverlay` na transição `materializacao-nevoa`),
// T14885, spec #14813. Mudanças: só a névoa, e como estilos puros que a página do overlay aplica no gato.
//
// A entrada e a saída do gato no overlay: ele condensa da névoa (desfoque, escala 0,54 e 18 px abaixo) em 420 ms, e
// some subindo e desfocando em 280 ms. Com reduzir movimento, aparece e some sem passagem.

export const ENTRY_MS = 420;
export const EXIT_MS = 280;
/** O `overlaySpringBounce` do pacote (68 %) na curva da entrada. */
const BOUNCE = 1 + (68 / 100) * 0.48;

export interface CatTransitionStyle {
  transform: string;
  opacity: string;
  filter: string;
  transition: string;
}

/** O gato antes de entrar: sem passagem, para a entrada partir dele. */
export const HIDDEN_STYLE: CatTransitionStyle = {
  transform: "translate3d(0px, 18px, 0) scale(0.54)", opacity: "0", filter: "blur(10px)", transition: "none",
};

export function shownStyle(reduced: boolean): CatTransitionStyle {
  return {
    transform: "translate3d(0px, 0px, 0) scale(1)", opacity: "1", filter: "blur(0px)",
    transition: reduced ? "none" :
      `transform ${ENTRY_MS}ms cubic-bezier(0.22, ${BOUNCE.toFixed(2)}, 0.36, 1), ` +
      `opacity ${Math.round(ENTRY_MS * 0.6)}ms ease-out, filter ${Math.round(ENTRY_MS * 0.7)}ms ease-out`,
  };
}

export function exitStyle(reduced: boolean): CatTransitionStyle {
  return {
    transform: "translate3d(0px, -12px, 0) scale(0.62)", opacity: "0", filter: "blur(8px)",
    transition: reduced ? "none" :
      `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 0.7, 0.25), opacity ${Math.round(EXIT_MS * 0.82)}ms ease-in, ` +
      `filter ${EXIT_MS}ms ease-in`,
  };
}
