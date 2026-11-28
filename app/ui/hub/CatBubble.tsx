// O balão do gato (spec #9495, T10832): a resposta do agente num balão de quadrinho ao lado do gato, no canto da
// janela principal. Quem decide o que aparece é o `BubbleFeed` (bubble-state.ts); aqui só a tela.
//
// - O clique no balão nunca fecha (spec #32534, Cena 3): ele recomeça a espera do relógio (`bubble-clock.ts`). Quem
//   fecha é o × do balão, o Esc (com o mouse no Kiwi ou no balão, ou o foco no Kiwi) e o relógio: 45 s parado, a
//   pergunta, mais 15 s. O mouse em cima segura. Depois que ele saiu, o mouse no Kiwi traz a última resposta de volta
//   (o `recall`), até o próximo pedido. O resto do canto continua deixando o clique passar.
// - Nunca tira o foco: o mousedown não move o foco, e nada recebe `focus()`. Quem digita numa nota continua digitando.
// - [Ver mais] abre o balão grande, com a resposta inteira e rolagem; fecha com um clique fora ou com Esc. O Esc só é
//   ouvido enquanto o balão grande está aberto.
// - Leitor de tela: a resposta é anunciada uma vez, no fim, inteira.
// - Enquanto o agente trabalha (spec #32534, Cena 2, T33177): o passo atual, com o [Parar], que cancela o pedido, e em
//   cima, pequeno e apagado, o que a pessoa falou.
// - O markdown (spec #17679, T17986): o pequeno mostra o texto corrido, sem símbolos, que o `BubbleFeed` já corta
//   limpo (`bubblePlain`, T17984); o grande, formatado
//   (títulos, listas, código, tabela que rola de lado), pelo mesmo montador do overlay. Um link só abre no clique.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BubbleLink } from "../../src/shared/ui-contract";
import { api } from "../src/api";
import { appLocale } from "../src/i18n";
import { BUBBLE_LINES, BubbleFeed, type BubbleView, type ChunkLink, readingMs } from "./bubble-state";
import { BubbleClock } from "./bubble-clock";
import { BubblePresence } from "./BubblePresence";
import { BubbleTail } from "./BubbleTail";
import { MdView, openMdLink } from "./bubbleMd";
import { useT } from "../src/i18n.ts";

/**
 * O resumo com as notas e os arquivos (spec #17683) clicáveis; um link cortado pelo "…", só o pedaço que aparece. O
 * clique abre no app e não fecha o balão.
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
 *
 * `yieldTo` (T28350): um balão com ação (a memória, a rotina, a proposta) espera a resposta sair. Desde o balão único ela
 * só saía no clique, e o resultado do pedido ficava escondido. Agora ela fica o tempo de leitura (`readingMs`) e dá
 * lugar a ele. Com o [Ver mais] aberto, espera fechar.
 */
/**
 * `hovering` (spec #32534): o mouse em cima do Kiwi ou de um balão; segura o relógio e arma o Esc. `recall`: o Kiwi pede a
 * última resposta de volta (o mouse chegou nele depois que o balão saiu).
 */
export function CatBubble({ reduced, hidden = false, onShown, drop, yieldTo = false, hovering = false, recall, onAsk }: { reduced: boolean; hidden?: boolean; onShown?: (shown: boolean) => void; drop?: { current: (() => void) | null }; yieldTo?: boolean; hovering?: boolean; recall?: { current: (() => boolean) | null }; onAsk?: () => void }) {
  const { t } = useT();
  const [view, setView] = useState<BubbleView | null>(null);
  /** O balão grande do [Ver mais], aberto. Ele mostra o texto inteiro do pedido, e acompanha o que ainda chega. */
  const [bigOpen, setBigOpen] = useState(false);
  const [said, setSaid] = useState("");
  const [saidLinks, setSaidLinks] = useState<readonly BubbleLink[]>([]);
  const [announce, setAnnounce] = useState("");
  const feed = useRef<BubbleFeed | null>(null);
  const tick = useRef<() => void>(() => {});
  const big = useRef<HTMLDivElement>(null);
  /** A pergunta "Precisa de mais alguma coisa?" no balão (o relógio, spec #32534). */
  const [asking, setAsking] = useState(false);
  /** O balão na tela é o do fim do pedido: o relógio corre. */
  const [settled, setSettled] = useState(false);
  const clock = useRef<BubbleClock | null>(null);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  useEffect(() => {
    const m = measurer();
    const f = new BubbleFeed(m.fits, reduced, Date.now, () => appLocale().locale);
    feed.current = f;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // O relógio do balão (spec #32534): no fim, ele sai como no ×; a resposta fica para o `recall`.
    // A pergunta é texto novo: o Kiwi acende a marca, se o mouse está longe (`onAsk`).
    clock.current = new BubbleClock({ ask: (on) => { setAsking(on); if (on) onAskRef.current?.(); }, leave: () => { f.close(); refresh(); } });
    const refresh = () => {
      clearTimeout(timer);
      const now = performance.now();
      setView(f.view(now));
      setSettled(f.settled(now));
      setSaid(f.all());
      setSaidLinks((old) => (sameLinks(old, f.links()) ? old : f.links()));
      const a = f.takeAnnouncement();
      if (a) setAnnounce(a);
      const next = f.nextWake(now);
      if (Number.isFinite(next)) timer = setTimeout(refresh, Math.max(0, next - now));
    };
    tick.current = refresh;
    // O pedido novo pelo campo esquece a resposta de antes: ela não volta mais com o mouse.
    if (drop) drop.current = () => { f.close(false); refresh(); };
    if (recall) recall.current = () => { const back = f.recall(); if (back) refresh(); return back; };
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
      clock.current?.stop();
      clock.current = null;
      feed.current = null;
      if (drop) drop.current = null;
      if (recall) recall.current = null;
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

  // O relógio (spec #32534): corre com a resposta (ou o erro) na tela; o mouse em cima ou o [Ver mais] aberto seguram.
  // Escondido (o campo de texto aberto, o Kiwi no overlay), ele também espera.
  const viewKey = view?.key;
  useEffect(() => {
    if (settled && viewKey !== undefined) clock.current?.start();
    else clock.current?.stop();
  }, [settled, viewKey]);
  useEffect(() => { clock.current?.hold(hovering || bigOpen || hidden); }, [hovering, bigOpen, hidden]);

  /**
   * O × do balão e o Esc: fecha agora; a resposta fica para voltar com o mouse no Kiwi. Com o pedido ainda correndo
   * (decisão #33542), os dois fazem o mesmo que o [Parar], como no overlay: o `done` cancelado tira o balão.
   */
  const closeBubble = () => {
    if (feed.current?.working()) {
      void api.agent.cancel().catch(() => {});
      return;
    }
    feed.current?.close();
    tick.current();
  };
  // O Esc com o balão pequeno na tela (spec #32534): com o mouse no Kiwi ou no balão, ou com o foco no Kiwi (o teclado).
  // Com o grande aberto, quem ouve o Esc é ele (fecha o grande primeiro).
  useEffect(() => {
    if (!view || bigOpen || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const kiwiFocused = document.activeElement instanceof Element && !!document.activeElement.closest(".kn-kiwicat-hit");
      if (!hovering && !kiwiFocused) return;
      e.preventDefault();
      e.stopPropagation();
      closeBubble();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [!!view, bigOpen, hidden, hovering]);

  const keepFocus = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();
  // Quem mais usa o canto (a proposta da reunião, spec #8360) espera o balão da resposta sair.
  const showing = !!view || bigOpen;
  // No layout effect, e não no `useEffect` (T16835): o `setState` do dono entra antes da pintura, então a proposta monta
  // na mesma pintura em que a resposta começa a sair. Com o `useEffect`, ela vinha numa tarefa depois, e com a máquina
  // ocupada a resposta esmaecia sozinha antes (o canto chegava a 0,12 de opacidade).
  useLayoutEffect(() => onShown?.(showing), [showing]);
  // Um balão com ação esperando (T28350): a resposta fica o tempo de leitura e sai. O relógio conta da resposta na tela,
  // ou da hora em que o balão com ação chegou, se ela já estava lá.
  const viewFull = view?.full ?? "";
  useEffect(() => {
    if (!yieldTo || !view || bigOpen || hidden) return;
    const t = setTimeout(() => {
      feed.current?.close();
      tick.current();
    }, readingMs(viewFull));
    return () => clearTimeout(t);
  }, [yieldTo, view?.key, bigOpen, hidden]);

  return (
    <>
      {/* Com o balão grande aberto, o pequeno espera embaixo dele (não é fechado) e volta quando o grande fecha. */}
      {/* A troca entre os balões (spec #11652): a linha de estado, a resposta e o erro têm cada um a sua `view.key`. */}
      <BubblePresence itemKey={view && !bigOpen && !hidden ? `resposta-${view.key}` : null} reduced={reduced}>
        {view ? (
          <div
            className="kn-bubble-shell kn-bubble"
            data-error={view.error || undefined}
            title={view.error ? view.full : undefined}
            data-reduced={reduced || undefined}
            data-ask={(asking && settled) || undefined}
            onMouseDown={keepFocus}
            // O clique nunca fecha (spec #32534): segura o Kiwi e recomeça a espera.
            onClick={() => clock.current?.touch()}
          >
            {/* O que a pessoa falou (T33177): a linha pequena em cima do andamento, até a resposta. */}
            {view.heard ? (
              <div className="kn-bubble-heard" aria-hidden="true" title={t("hub.bubble.heard")}>
                {view.heard}
              </div>
            ) : null}
            {/* O resumo entra inteiro, sem digitar (spec #27881): o fantasma e o texto são o mesmo, e o fantasma segura o tamanho. */}
            <div className="kn-bubble-text" aria-hidden="true">
              <div className="kn-bubble-ghost">{view.full}</div>
              <div className="kn-bubble-typed">{withLinks(view.text, view.links)}</div>
            </div>
            {asking && settled ? <div className="kn-bubble-ask" aria-hidden="true">{t("hub.bubble.ask")}</div> : null}
            <button
              type="button"
              className="kn-bubble-close"
              tabIndex={-1}
              aria-label={t("hub.bubble.close")}
              onMouseDown={keepFocus}
              onClick={(e) => {
                e.stopPropagation();
                closeBubble();
              }}
            >
              ×
            </button>
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
                {t("hub.bubble.more")}
              </button>
            ) : null}
            {/* O [Parar] (T33177): cancela o pedido em andamento (o `agent.cancel`), sem passar pelo clique do balão. */}
            {view.stop ? (
              <button
                type="button"
                className="kn-bubble-more kn-bubble-stop"
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={(e) => {
                  e.stopPropagation();
                  void api.agent.cancel().catch(() => {});
                }}
              >
                {t("hub.bubble.stop")}
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
          aria-label={t("hub.bubble.answer")}
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
