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

/**
 * As abas, como as do Channels: um grupo que flutua, com a seleção deslizando de uma aba para a outra. ←/→ trocam,
 * como num `tablist`.
 */
function Tabs({ section, onGo }: { section: HubSection; onGo(s: HubSection): void }) {
  const group = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = group.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // A fonte e o zoom do Tamanho do texto mudam a largura das abas.
    const ro = new ResizeObserver(measure);
    if (group.current) ro.observe(group.current);
    return () => ro.disconnect();
  }, [section]);
  const move = (dir: 1 | -1) => {
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
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          move(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      {pill ? <span className="kn-tabs-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" /> : null}
      {HUB_SECTIONS.map((s) => (
        <button
          type="button"
          role="tab"
          key={s}
          data-section={s}
          aria-selected={s === section}
          tabIndex={s === section ? 0 : -1}
          className="kn-tab"
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
