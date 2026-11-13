// O hub (T2121, spec #2100): a janela principal do Kiwi Notes. Com o T2502 (#2457 ponto 2, versão C · Foco), as seções
// (Notas, Reuniões, Ditado, Configurações e Sobre) viram abas numa barra de cima, como no Channels; a barra lateral
// saiu. Dos lados das abas, a seção na tela põe os botões dela (`TopBar`, por portal). Uma seção visitada fica
// montada (só escondida), para a nota em edição e o autosave não se perderem ao trocar de seção.
import "./hub.css";
import { DoubtCard } from "./DoubtCard";
import { KiwiCat } from "./KiwiCat";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { HUB_SECTIONS, type HubSection, isHubSection } from "../../src/shared/ui-contract.ts";
import { History } from "../history/History.tsx";
import { NotesApp } from "../notes/NotesApp.tsx";
import { About } from "./About.tsx";
import { Meetings } from "../meetings/Meetings.tsx";
import { Settings } from "../settings/Settings.tsx";
import { api, has } from "../src/api.ts";
import { HubBarContext } from "../src/topbar.tsx";
import { mount } from "../src/kit/index.tsx";

const LABELS: Record<HubSection, string> = {
  notes: "Notas",
  meetings: "Reuniões",
  dictation: "Ditado",
  settings: "Configurações",
  about: "Sobre",
};

/** Seção que ainda não existe: aparece na barra, sem abrir nada. Reuniões chegou com o R6 (T4947). */
const SOON: ReadonlySet<HubSection> = new Set([]);

/** Abrir uma nota nas Notas a partir de outra seção (Reuniões, T4947): `n` muda a cada pedido, mesmo para a mesma nota. */
export interface OpenRequest {
  path: string;
  internal?: boolean;
  n: number;
}

/** `active`: a seção está na tela. As outras ficam montadas e escondidas (o estado não se perde ao trocar). */
function Pane({ section, active, openRequest, onOpenNote }: { section: HubSection; active: boolean; openRequest: OpenRequest | null; onOpenNote(path: string): void }) {
  switch (section) {
    case "notes":
      return <NotesApp active={active} openRequest={openRequest} />;
    case "dictation":
      return <History />;
    case "settings":
      return <Settings />;
    case "about":
      return <About />;
    case "meetings":
      return <Meetings onOpen={onOpenNote} />;
  }
}

/** A seleção acompanha só a seção ativa; o hover da aba muda apenas a cor do texto (T4535, #4521). */
function Tabs({ section, onGo }: { section: HubSection; onGo(s: HubSection): void }) {
  const group = useRef<HTMLDivElement>(null);
  const pillEl = useRef<HTMLSpanElement>(null);
  const measured = useRef(false);
  useLayoutEffect(() => {
    const measure = (resized = false) => {
      const tab = group.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
      const pill = pillEl.current;
      if (!tab || !pill) return;
      // A primeira medida e o resize não deslizam; uma nova seleção usa o --glide do Channels.
      pill.dataset.moving = String(measured.current && !resized);
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      measured.current = true;
    };
    measure();
    // A primeira notificação do observer só confirma o layout; não interrompe uma seleção em movimento.
    let observed = false;
    const ro = new ResizeObserver(() => {
      if (observed) measure(true);
      observed = true;
    });
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
          onClick={() => onGo(s)}
        >
          {LABELS[s]}
          {SOON.has(s) ? <span className="kn-tab-soon">breve</span> : null}
        </button>
      ))}
    </div>
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
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const openNote = (path: string) => {
    setOpenRequest((r) => ({ path, internal: true, n: (r?.n ?? 0) + 1 }));
    go("notes");
  };
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
      {/* A pergunta na dúvida do guardrail (spec #9873): por cima das seções, em qualquer aba. */}
      <DoubtCard />
      <KiwiCat />
      <div className="kn-hub-main">
        {HUB_SECTIONS.filter((s) => visited.has(s)).map((s) => (
          <section key={s} className="kn-hub-pane" hidden={s !== section} aria-label={LABELS[s]}>
            <HubBarContext.Provider value={{ start, end, active: s === section }}>
              <Pane section={s} active={s === section} openRequest={openRequest} onOpenNote={openNote} />
            </HubBarContext.Provider>
          </section>
        ))}
      </div>
    </div>
  );
}

mount(<Hub />);
