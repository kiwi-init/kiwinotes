// O balão do gato (spec #9495, T10832): a resposta do agente num balão de quadrinho ao lado do gato, no canto da
// janela principal. Quem decide o que aparece é o `BubbleFeed` (bubble-state.ts); aqui só a tela.
//
// - O balão é clicável (fecha); o resto do canto continua deixando o clique passar.
// - Nunca tira o foco: o mousedown não move o foco, e nada recebe `focus()`. Quem digita numa nota continua digitando.
// - [Ver mais] abre o balão grande, com a resposta inteira e rolagem; fecha com um clique fora ou com Esc. O Esc só é
//   ouvido enquanto o balão grande está aberto.
// - Leitor de tela: a resposta é anunciada uma vez, no fim, inteira.

import { useEffect, useRef, useState } from "react";

import { api } from "../src/api";
import { BUBBLE_LINES, BubbleFeed, type BubbleView } from "./bubble-state";
import { renderLite } from "./bubbleText";

/** Mede no mesmo estilo do balão: o texto cabe em 280 px e 3 linhas? */
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

export function CatBubble({ reduced, hidden = false, onShown }: { reduced: boolean; hidden?: boolean; onShown?: (shown: boolean) => void }) {
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
  useEffect(() => onShown?.(showing), [showing]);

  return (
    <>
      {/* Com o balão grande aberto, o pequeno espera embaixo dele (não é fechado) e volta quando o grande fecha. */}
      {view && !bigOpen && !hidden ? (
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
            <div className="kn-bubble-ghost">{renderLite(view.full)}</div>
            <div className="kn-bubble-typed">{renderLite(view.text)}</div>
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
        </div>
      ) : null}
      {bigOpen && !hidden ? (
        <div className="kn-bubble-big" ref={big} onMouseDown={keepFocus} aria-label="A resposta do agente">
          <div className="kn-bubble-big-text">{renderLite(said)}</div>
        </div>
      ) : null}
      <div className="kn-visually-hidden" aria-live="polite">
        {announce}
      </div>
    </>
  );
}
