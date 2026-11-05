// O hub (T2121, spec #2100): a janela principal do Kiwi Notes. Com o T2502 (#2457 ponto 2, versão C · Foco), as seções
// (Notas, Reuniões, Ditado, Configurações e Sobre) viram abas numa barra de cima, como no Channels; a barra lateral
// saiu. Dos lados das abas, a seção na tela põe os botões dela (`TopBar`, por portal). Uma seção visitada fica
// montada (só escondida), para a nota em edição e o autosave não se perderem ao trocar de seção.
import "./hub.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { HUB_SECTIONS, type HubSection, isHubSection } from "../../src/shared/ui-contract.ts";
import { History } from "../history/History.tsx";
import { NotesApp } from "../notes/NotesApp.tsx";
import { About } from "./About.tsx";
import { type Box, type PillState, pillMove, settled, stepPill } from "./pill.ts";
import { Settings } from "../settings/Settings.tsx";
import { api, has } from "../src/api.ts";
import { HubBarContext } from "../src/topbar.tsx";
import { Empty, mount } from "../src/kit/index.tsx";

const LABELS: Record<HubSection, string> = {
  notes: "Notas",
  meetings: "Reuniões",
  dictation: "Ditado",
  settings: "Configurações",
  about: "Sobre",
};

/** Seção que ainda não existe: aparece na barra, sem abrir nada. */
const SOON: ReadonlySet<HubSection> = new Set(["meetings"]);

/** `active`: a seção está na tela. As outras ficam montadas e escondidas (o estado não se perde ao trocar). */
function Pane({ section, active }: { section: HubSection; active: boolean }) {
  switch (section) {
    case "notes":
      return <NotesApp active={active} />;
    case "dictation":
      return <History />;
    case "settings":
      return <Settings />;
    case "about":
      return <About />;
    case "meetings":
      return (
        <div className="kn-hub-soon">
          <Empty icon={<MeetingIcon />} title="Reuniões, em breve">
            Gravar e resumir reuniões no Mac, sem nada sair dele.
          </Empty>
        </div>
      );
  }
}

/** O "Reduzir movimento" do sistema ou dos Ajustes. */
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";

/** Quanto a pílula leva para sumir antes de reaparecer na aba ativa (T4380): a transição de opacidade do hub.css. */
export const PILL_FADE_MS = 120;

/**
 * Quanto a pílula espera para voltar à aba escolhida quando o mouse sai: o `--hover-out-delay` dos tokens (T3821), e
 * zero no "Reduzir movimento" (do sistema ou dos Ajustes).
 */
export function hoverOutMs(el: Element | null): number {
  if (reducedMotion() || !el) return 0;
  const v = getComputedStyle(el).getPropertyValue("--hover-out-delay").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : 0;
}

/**
 * As abas, como as do Channels: um grupo que flutua, com a seleção deslizando de uma aba para a outra. ←/→ trocam,
 * como num `tablist`. No hover (T3821), a pílula desliza até a aba sob o mouse e volta para a escolhida quando ele sai.
 */
function Tabs({ section, onGo }: { section: HubSection; onGo(s: HubSection): void }) {
  const group = useRef<HTMLDivElement>(null);
  const pillEl = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState<HubSection | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** O mouse saiu da faixa (e não foi o teclado): a volta para a ativa some e reaparece em vez de atravessar. */
  const leftStrip = useRef(false);
  const target = hovered ?? section;
  // A pílula (T4380): uma mola só, em rAF, que escreve o estilo direto (sem re-render a cada frame).
  const anim = useRef<{ s: PillState | null; to: Box | null; raf: number; last: number; fade: ReturnType<typeof setTimeout> | null }>({
    s: null,
    to: null,
    raf: 0,
    last: 0,
    fade: null,
  });
  const paint = (b: Box) => {
    const el = pillEl.current;
    if (!el) return;
    el.style.transform = `translateX(${b.x}px)`;
    el.style.width = `${b.w}px`;
  };
  const bounds = () => {
    const tabs = group.current?.querySelectorAll<HTMLElement>(".kn-tab");
    if (!tabs?.length) return { lo: -Infinity, hi: Infinity };
    const last = tabs[tabs.length - 1]!;
    return { lo: tabs[0]!.offsetLeft, hi: last.offsetLeft + last.offsetWidth };
  };
  const frame = (now: number) => {
    const a = anim.current;
    if (!a.s || !a.to) return;
    const dt = Math.min(0.05, a.last ? (now - a.last) / 1000 : 1 / 60);
    a.last = now;
    a.s = stepPill(a.s, a.to, dt, bounds());
    if (settled(a.s, a.to)) {
      a.s = { ...a.to, vx: 0, vw: 0 };
      a.raf = 0;
    } else a.raf = requestAnimationFrame(frame);
    paint(a.s);
  };
  const go = (to: Box, resized: boolean) => {
    const a = anim.current;
    const el = pillEl.current;
    if (a.fade) clearTimeout(a.fade);
    a.fade = null;
    if (el) el.style.opacity = "";
    const how = pillMove({ first: !a.s, reduced: reducedMotion(), resized, leftStrip: leftStrip.current, from: a.s ?? to, to });
    leftStrip.current = false;
    a.to = to;
    if (how === "snap" || !el) {
      if (a.raf) cancelAnimationFrame(a.raf);
      a.raf = 0;
      a.s = { ...to, vx: 0, vw: 0 };
      return paint(to);
    }
    if (how === "fade") {
      // Some onde está, aparece na ativa: a opacidade é a única transição CSS da pílula (hub.css).
      if (a.raf) cancelAnimationFrame(a.raf);
      a.raf = 0;
      el.style.opacity = "0";
      a.fade = setTimeout(() => {
        a.fade = null;
        a.s = { ...to, vx: 0, vw: 0 };
        paint(to);
        el.style.opacity = "";
      }, PILL_FADE_MS);
      return;
    }
    // Desliza a partir da posição e da velocidade de agora: um alvo novo no meio do caminho não recomeça nada.
    if (!a.raf) {
      a.last = 0;
      a.raf = requestAnimationFrame(frame);
    }
  };
  useLayoutEffect(() => {
    let first = true;
    const measure = () => {
      const el = group.current?.querySelector<HTMLElement>(`[data-section="${target}"]`);
      if (el) go({ x: el.offsetLeft, w: el.offsetWidth }, !first);
      first = false;
    };
    measure();
    // A fonte e o zoom do Tamanho do texto mudam a largura das abas: aí ela vai direto ao lugar. O observer chama uma
    // vez logo ao começar (sem mudança nenhuma), e essa primeira chamada não conta: senão toda troca de aba virava salto.
    let observed = false;
    const ro = new ResizeObserver(() => {
      if (observed) measure();
      observed = true;
    });
    if (group.current) ro.observe(group.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  useEffect(
    () => () => {
      if (leaving.current) clearTimeout(leaving.current);
      if (anim.current.fade) clearTimeout(anim.current.fade);
      if (anim.current.raf) cancelAnimationFrame(anim.current.raf);
    },
    [],
  );
  const hover = (s: HubSection | null, now = false) => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
    if (s) return setHovered(s);
    leftStrip.current = !now;
    const delay = now ? 0 : hoverOutMs(group.current);
    if (!delay) return setHovered(null);
    // Sai com um atraso curto: cruzar o grupo de passagem não faz a pílula ir e voltar.
    leaving.current = setTimeout(() => setHovered(null), delay);
  };
  const move = (dir: 1 | -1) => {
    // O teclado manda: a pílula vai para a aba escolhida, mesmo com o mouse parado em outra (revisão #3940).
    hover(null, true);
    const i = HUB_SECTIONS.indexOf(section);
    const next = HUB_SECTIONS[(i + dir + HUB_SECTIONS.length) % HUB_SECTIONS.length]!;
    onGo(next);
    group.current?.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  };
  return (
    <div
      className="kn-tabs electrobun-webkit-app-region-no-drag"
      role="tablist"
      aria-label="Seções"
      ref={group}
      onMouseLeave={() => hover(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          move(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <span className="kn-tabs-pill" ref={pillEl} aria-hidden="true" />
      {HUB_SECTIONS.map((s) => (
        <button
          type="button"
          role="tab"
          key={s}
          data-section={s}
          aria-selected={s === section}
          tabIndex={s === section ? 0 : -1}
          className="kn-tab"
          data-hover={hovered === s || undefined}
          onMouseEnter={() => hover(s)}
          onClick={() => onGo(s)}
        >
          {LABELS[s]}
          {SOON.has(s) ? <span className="kn-tab-soon">breve</span> : null}
        </button>
      ))}
    </div>
  );
}

/** O glifo do vazio de Reuniões, no tom dos outros vazios (o do Ditado): 44 px, na cor de destaque (T2778). */
function MeetingIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--accent)" }}>
      <circle cx="12" cy="13" r="4.5" />
      <circle cx="24" cy="13" r="4.5" />
      <path d="M4.5 28c.8-4.6 3.8-7 7.5-7s6.7 2.4 7.5 7M16.5 28c.8-4.6 3.8-7 7.5-7s6.7 2.4 7.5 7" />
    </svg>
  );
}

/** A seção inicial: `?section=` (a CLI e o print) ou Notas. */
function initialSection(): HubSection {
  const q = new URLSearchParams(location.search).get("section");
  return isHubSection(q) ? q : "notes";
}

function Hub() {
  const [section, setSection] = useState<HubSection>(initialSection);
  const [visited, setVisited] = useState<Set<HubSection>>(() => new Set([section]));
  const [entry, setEntry] = useState(1);
  const ref = useRef<HTMLDivElement>(null);

  const go = (s: HubSection) => {
    setSection(s);
    setVisited((v) => (v.has(s) ? v : new Set(v).add(s)));
  };

  // O que o menu da barra pediu: antes de abrir (`hub.section`) e com o hub aberto (`hub.navigate`).
  useEffect(() => {
    if (has("hub.section")) {
      api.hub.section().then(
        (r) => r.section && go(r.section),
        () => {},
      );
    }
    return api.hub.onNavigate((e) => isHubSection(e.section) && go(e.section));
  }, []);

  // O título é o do app, e a entrada ao voltar para a frente é a do hub inteiro (cada seção tem a sua, de janela).
  useEffect(() => {
    document.title = "Kiwi Notes";
    window.__kiwiEnter = () => {
      if (document.visibilityState === "visible") setEntry((n) => n + 1);
    };
  }, [section]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || entry <= 1) return;
    el.dataset.entering = "false";
    void el.offsetWidth;
    el.dataset.entering = "true";
  }, [entry]);

  // Os dois lados da barra, para a seção na tela pôr os botões dela.
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);

  return (
    <div className="kn-hub" data-entering="true" ref={ref}>
      <header className="kn-hub-top electrobun-webkit-app-region-drag">
        <div className="kn-hub-slot kn-hub-start" ref={setStart} />
        <Tabs section={section} onGo={go} />
        <div className="kn-hub-slot kn-hub-end" ref={setEnd} />
      </header>
      <div className="kn-hub-main">
        {HUB_SECTIONS.filter((s) => visited.has(s)).map((s) => (
          <section key={s} className="kn-hub-pane" hidden={s !== section} aria-label={LABELS[s]}>
            <HubBarContext.Provider value={{ start, end, active: s === section }}>
              <Pane section={s} active={s === section} />
            </HubBarContext.Provider>
          </section>
        ))}
      </div>
    </div>
  );
}

mount(<Hub />);
