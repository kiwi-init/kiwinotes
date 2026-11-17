// A barra de cima do hub (T2502, spec #2457 ponto 2, versão C): os semáforos, as abas no meio e, dos lados, o que a
// seção na tela pede (as Notas põem o caminho da nota à esquerda e Nova nota e Buscar à direita). O hub dá os dois
// lugares da barra por contexto; a seção põe os botões ali por portal. Fora do hub (a janela Notas avulsa), não há
// contexto, e a seção desenha a própria barra.

import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export interface HubBar {
  start: HTMLElement | null;
  end: HTMLElement | null;
  /** A seção deste painel está na tela: só ela põe botões na barra. */
  active: boolean;
}

export const HubBarContext = createContext<HubBar | null>(null);

/**
 * Os botões de uma seção na barra de cima. No hub, vão para os lugares da barra, e só os da seção na tela. Fora do
 * hub, numa barra própria (`kn-bar`), com espaço para os semáforos.
 */
export function TopBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  const hub = useContext(HubBarContext);
  if (hub) {
    if (!hub.active) return null;
    return (
      <>
        {hub.start && start ? createPortal(start, hub.start) : null}
        {hub.end && end ? createPortal(end, hub.end) : null}
      </>
    );
  }
  return (
    <header className="kn-bar electrobun-webkit-app-region-drag">
      <div className="kn-bar-start electrobun-webkit-app-region-no-drag">{start}</div>
      <div className="kn-bar-end electrobun-webkit-app-region-no-drag">{end}</div>
    </header>
  );
}

/** Estamos dentro do hub (a barra de cima é dele). */
export const useInHub = () => useContext(HubBarContext) !== null;
