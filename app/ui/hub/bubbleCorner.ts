// A quina do balão do gato no hub (T16754, harry #16786): o balão abre à esquerda e em cima do gato, com o rabo na quina
// de baixo à direita, encostado nele. Quando não cabe ali (a janela pequena, ou o gato no meio da Início perto do
// topo), passa para o outro lado. O hub mede o gato a cada mudança de tamanho e de lugar e põe a quina no `.kn-hub`
// (`data-bubble`): a CSS põe os balões no lugar (hub.css) e o rabo lê a quina daqui (`BubbleTail`).
import { createContext, useContext, useLayoutEffect, useState, type RefObject } from "react";
import { tailSideFor, type TailSide } from "../kiwicat-v2/bubbleTail";

export const BubbleCornerContext = createContext<TailSide>("bottom-right");
export const useBubbleCorner = () => useContext(BubbleCornerContext);

/** O maior balão do canto (o da rotina, 320 px) e uma altura de quatro linhas com os botões. */
const ROOM = { width: 320, height: 180 };

/** Acompanha o gato (`catRef`, o `.kn-kiwicat`) dentro do hub e devolve a quina; tira o `data-bubble` ao sair. */
export function useCatCorner(catRef: RefObject<HTMLElement | null>): TailSide {
  const [side, setSide] = useState<TailSide>("bottom-right");
  useLayoutEffect(() => {
    const cat = catRef.current;
    const hub = cat?.closest<HTMLElement>(".kn-hub");
    if (!cat || !hub) return;
    const place = () => {
      const c = cat.getBoundingClientRect();
      const h = hub.getBoundingClientRect();
      const next = tailSideFor(c, h, ROOM);
      hub.dataset.bubble = next;
      setSide(next);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(hub);
    // A Início leva o gato ao meio pelo `data-cat-at` e pelo deslocamento no `style` do hub (Home.tsx).
    const mo = new MutationObserver(place);
    mo.observe(hub, { attributes: true, attributeFilter: ["style", "data-cat-at"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      delete hub.dataset.bubble;
    };
  }, [catRef]);
  return side;
}
