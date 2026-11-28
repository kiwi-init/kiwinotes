// As abas do hub numa janela estreita (#496, T34348). O hub não tem largura mínima: quando a barra não cabe as abas e
// os botões da seção, os botões ficam do tamanho deles e as abas rolam de lado, dentro da pílula (`.kn-tabs-track`),
// sem barra de rolagem. A borda que esconde abas esmaece (`data-clip`), e a aba escolhida fica sempre à vista, fora do
// esmaecido. Com espaço, nada disso: a faixa não rola e não tem `data-clip`.

/** A largura do esmaecido em cada borda que esconde abas (px); o hub.css usa o mesmo número. */
export const TABS_FADE = 24;

/** Quais bordas da faixa escondem abas: "" (cabe tudo), "start", "end" ou "start end". */
export function tabsClip(scrollLeft: number, clientWidth: number, scrollWidth: number): string {
  if (scrollWidth <= clientWidth + 1) return "";
  const sides: string[] = [];
  if (scrollLeft > 1) sides.push("start");
  if (scrollLeft + clientWidth < scrollWidth - 1) sides.push("end");
  return sides.join(" ");
}

/**
 * O `scrollLeft` que mostra a aba inteira (`left` e `width` na faixa), longe do esmaecido das bordas. Se ela já está à
 * vista, não mexe; a faixa nunca passa do começo nem do fim.
 */
export function tabsScrollToShow(left: number, width: number, scrollLeft: number, clientWidth: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  let next = scrollLeft;
  if (left - TABS_FADE < next) next = left - TABS_FADE;
  else if (left + width + TABS_FADE > next + clientWidth) next = left + width + TABS_FADE - clientWidth;
  return Math.round(Math.min(max, Math.max(0, next)));
}
