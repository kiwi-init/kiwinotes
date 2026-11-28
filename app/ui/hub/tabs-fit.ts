// As abas do hub numa janela estreita (#496, T34348). O hub não tem largura mínima: quando a barra não cabe as abas e
// os botões da seção, os botões ficam do tamanho deles e as abas rolam de lado, dentro da pílula (`.kn-tabs-track`),
// sem barra de rolagem. A borda que esconde abas esmaece (`data-clip`), e a aba escolhida fica sempre à vista, fora do
// esmaecido. Com espaço, nada disso: a faixa não rola e não tem `data-clip`.

/** A largura do esmaecido em cada borda que esconde abas (px); o hub.css usa o mesmo número como padrão. */
export const TABS_FADE = 24;

/**
 * O esmaecido para a aba escolhida: os 24 px, ou menos quando a faixa não cabe a aba e as duas bordas (o Ditado a 480 px
 * deixa ~100 px para as abas). Assim a escolhida cabe inteira fora do esmaecido enquanto couber na faixa.
 */
export function tabsFade(clientWidth: number, tabWidth: number): number {
  return Math.max(0, Math.min(TABS_FADE, Math.floor((clientWidth - tabWidth) / 2)));
}

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
export function tabsScrollToShow(left: number, width: number, scrollLeft: number, clientWidth: number, scrollWidth: number, fade = TABS_FADE): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  let next = scrollLeft;
  if (left - fade < next) next = left - fade;
  else if (left + width + fade > next + clientWidth) next = left + width + fade - clientWidth;
  return Math.round(Math.min(max, Math.max(0, next)));
}
