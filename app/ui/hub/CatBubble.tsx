// O balão do gato (spec #9495, T10832): a resposta do agente num balão de quadrinho ao lado do gato, no canto da
// janela principal. Quem decide o que aparece é o `BubbleFeed` (bubble-state.ts); aqui só a tela.
//
// - O balão é clicável (fecha); o resto do canto continua deixando o clique passar.
// - Nunca tira o foco: o mousedown não move o foco, e nada recebe `focus()`. Quem digita numa nota continua digitando.
// - [Ver mais] abre o balão grande, com a resposta inteira e rolagem; fecha com um clique fora ou com Esc. O Esc só é
//   ouvido enquanto o balão grande está aberto.
// - Leitor de tela: a resposta é anunciada uma vez, no fim, inteira.
// - O markdown (spec #17679, T17986): o pequeno mostra o texto corrido, sem símbolos, que o `BubbleFeed` já corta
//   limpo (`bubblePlain`, T17984); o grande, formatado
//   (títulos, listas, código, tabela que rola de lado), pelo mesmo montador do overlay. Um link só abre no clique.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BubbleLink } from "../../src/shared/ui-contract";
import { api } from "../src/api";
import { BUBBLE_LINES, BubbleFeed, type BubbleView, type ChunkLink } from "./bubble-state";
import { BubblePresence } from "./BubblePresence";
import { BubbleTail } from "./BubbleTail";
import { MdView, openMdLink } from "./bubbleMd";

/**
 * O texto do trecho com as notas e os arquivos (spec #17683) clicáveis. Enquanto o trecho se digita, só o pedaço do
 * link que já apareceu. O clique abre no app e não fecha o balão.
 */
function withLinks(text: string, links: readonly ChunkLink[] | undefined): React.ReactNode {
  if (!links?.length) return text;
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const l of links) {
    if (l.from >= text.length) break;
    const to = Math.min(l.to, text.length);
    out.push(text.slice(at, l.from));
    out.push(
      <span key={l.from} className="kn-md-link kn-md-file" data-path={l.path} title={l.path}
        onClick={(e) => {
          e.stopPropagation();
          void api.notes.openPath(l.path).catch(() => {});
        }}
      >
        {text.slice(l.from, to)}
      </span>,
    );
    at = to;
  }
  out.push(text.slice(at));
  return out;
}

const sameLinks = (a: readonly BubbleLink[], b: readonly BubbleLink[]) => a === b || JSON.stringify(a) === JSON.stringify(b);

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
  const [saidLinks, setSaidLinks] = useState<readonly BubbleLink[]>([]);
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
      setSaidLinks((old) => (sameLinks(old, f.links()) ? old : f.links()));
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
    // A fala pelo Control (spec #9876): o texto entendido aparece no balão quando o pedido começa, se veio.
    const offVoice = api.agent.onVoice((v) => {
      // Sem o texto ("Mostrar o que eu falei" desligado, spec #26055), o balão espera a resposta.
      if (v.phase !== "asked" || !v.text) return;
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
              <div className="kn-bubble-ghost">{view.full}</div>
              <div className="kn-bubble-typed">{withLinks(view.text, view.links)}</div>
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
        <div className="kn-bubble-big kn-bubble-wide" ref={big} onMouseDown={keepFocus} onClick={(e) => openMdLink(e.target)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && openMdLink(e.target)) e.preventDefault();
          }}
          aria-label="A resposta do agente"
        >
          <MdView className="kn-bubble-big-text" text={said} links={saidLinks} />
        </div>
      ) : null}
      <div className="kn-visually-hidden" aria-live="polite">
        {announce}
      </div>
    </>
  );
}
