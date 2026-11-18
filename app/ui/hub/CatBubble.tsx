// O balão do gato (spec #9495, T10832): a resposta do agente num balão de quadrinho ao lado do gato, no canto da
// janela principal. Quem decide o que aparece é o `BubbleFeed` (bubble-state.ts); aqui só a tela.
//
// - O balão é clicável (fecha); o resto do canto continua deixando o clique passar.
// - Nunca tira o foco: o mousedown não move o foco, e nada recebe `focus()`. Quem digita numa nota continua digitando.
// - [Ver mais] abre o balão grande, com a resposta inteira e rolagem; fecha com um clique fora ou com Esc. O Esc só é
//   ouvido enquanto o balão grande está aberto.
// - Leitor de tela: a resposta é anunciada uma vez, no fim, inteira.
// - O markdown (spec #17679, T17986): o pequeno mostra o texto corrido, sem símbolos (`plainMarkdown`); o grande, formatado
//   (títulos, listas, código, tabela que rola de lado), pelo mesmo montador do overlay. Um link só abre no clique.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "../src/api";
import { BUBBLE_LINES, BubbleFeed, type BubbleView } from "./bubble-state";
import { BubblePresence } from "./BubblePresence";
import { BubbleTail } from "./BubbleTail";
import { plainMarkdown } from "../src/bubbleMarkdown";
import { MdView, openMdLink } from "./bubbleMd";

/** Mede no mesmo estilo do balão: o texto cabe em 320 px (a casca do pacote) e 3 linhas? */
function measurer(): { fits: (s: string) => boolean; dispose: () => void } {
  const el = document.createElement("div");
  el.className = "kn-bubble-measure";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return {
    fits: (s) => {
      el.textContent = s;
      const line = parseFloat(getComputedStyle(el).lineHeight) || 18;
      return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= line * BUBBLE_LINES + 1;
    },
    dispose: () => el.remove(),
  };
}

/**
 * `drop`: o pedido mandado pelo campo tira do canto a resposta de antes, no mesmo render em que a pergunta fica (T15377).
 * Sem isso, ela voltava ao lado da pergunta (o `hidden` cai quando o campo fecha) e ainda ficava à espera do pedido novo.
 */
export function CatBubble({ reduced, hidden = false, onShown, drop }: { reduced: boolean; hidden?: boolean; onShown?: (shown: boolean) => void; drop?: { current: (() => void) | null } }) {
  const [view, setView] = useState<BubbleView | null>(null);
  /** O balão grande do [Ver mais], aberto. Ele mostra o texto inteiro do pedido, e acompanha o que ainda chega. */
  const [bigOpen, setBigOpen] = useState(false);
  const [said, setSaid] = useState("");
  const [announce, setAnnounce] = useState("");
  const feed = useRef<BubbleFeed | null>(null);
  const tick = useRef<() => void>(() => {});
  const big = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = measurer();
    const f = new BubbleFeed(m.fits, reduced);
    feed.current = f;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const now = performance.now();
      setView(f.view(now));
      setSaid(f.all());
      const a = f.takeAnnouncement();
      if (a) setAnnounce(a);
      const next = f.nextWake(now);
      if (Number.isFinite(next)) timer = setTimeout(refresh, Math.max(0, next - now));
    };
    tick.current = refresh;
    if (drop) drop.current = () => { f.close(); refresh(); };
    const off = api.agent.onTurn((e) => {
      if (e.type === "started") {
        setBigOpen(false);
        setAnnounce("");
      }
      f.event(e, performance.now());
      refresh();
    });
    // A fala pelo Control (spec #9876): o texto entendido aparece no balão quando o pedido começa.
    const offVoice = api.agent.onVoice((v) => {
      if (v.phase !== "asked") return;
      f.heard(v.id, v.text, performance.now());
      refresh();
    });
    return () => {
      off();
      offVoice();
      clearTimeout(timer);
      m.dispose();
      feed.current = null;
      if (drop) drop.current = null;
    };
  }, []);

  useEffect(() => {
    feed.current?.setReduced(reduced);
    tick.current();
  }, [reduced]);

  // O balão grande: um clique fora ou o Esc fecha. Os dois só são ouvidos com ele aberto.
  useEffect(() => {
    if (!bigOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setBigOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (big.current && !big.current.contains(e.target as Node)) setBigOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [bigOpen]);

  const keepFocus = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();
  // Quem mais usa o canto (a proposta da reunião, spec #8360) espera o balão da resposta sair.
  const showing = !!view || bigOpen;
  // No layout effect, e não no `useEffect` (T16835): o `setState` do dono entra antes da pintura, então a proposta monta
  // na mesma pintura em que a resposta começa a sair. Com o `useEffect`, ela vinha numa tarefa depois, e com a máquina
  // ocupada a resposta esmaecia sozinha antes (o canto chegava a 0,12 de opacidade).
  useLayoutEffect(() => onShown?.(showing), [showing]);

  return (
    <>
      {/* Com o balão grande aberto, o pequeno espera embaixo dele (não é fechado) e volta quando o grande fecha. */}
      {/* A troca entre os trechos e os balões (spec #11652): cada trecho novo é um balão novo (`view.key`). */}
      <BubblePresence itemKey={view && !bigOpen && !hidden ? `resposta-${view.key}` : null} reduced={reduced}>
        {view ? (
          <div
            className="kn-bubble-shell kn-bubble"
            data-error={view.error || undefined}
            title={view.error ? view.full : undefined}
            data-reduced={reduced || undefined}
            onMouseDown={keepFocus}
            onClick={() => {
              feed.current?.close();
              tick.current();
            }}
          >
            {/* O trecho inteiro, invisível, segura o tamanho do balão enquanto a digitação anda. */}
            <div className="kn-bubble-text" aria-hidden="true">
              <div className="kn-bubble-ghost">{plainMarkdown(view.full)}</div>
              <div className="kn-bubble-typed">{plainMarkdown(view.text)}</div>
            </div>
            {view.more ? (
              <button
                type="button"
                className="kn-bubble-more"
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={(e) => {
                  e.stopPropagation();
                  setBigOpen(true);
                }}
              >
                Ver mais
              </button>
            ) : null}
            <BubbleTail />
          </div>
        ) : null}
      </BubblePresence>
      {bigOpen && !hidden ? (
        <div className="kn-bubble-big" ref={big} onMouseDown={keepFocus} onClick={(e) => openMdLink(e.target)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && openMdLink(e.target)) e.preventDefault();
          }}
          aria-label="A resposta do agente"
        >
          <MdView className="kn-bubble-big-text" text={said} />
        </div>
      ) : null}
      <div className="kn-visually-hidden" aria-live="polite">
        {announce}
      </div>
    </>
  );
}
