// O hub (T2121, spec #2100): a janela principal do Kiwi Notes. É onde o app abre, com uma barra de seções à esquerda
// (Notas, Reuniões, Ditado e Configurações) e, à direita, a mesma UI de cada janela de hoje. Uma seção visitada fica
// montada (só escondida), para a nota em edição e o autosave não se perderem ao trocar de seção.
import "./hub.css";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { HUB_SECTIONS, type HubSection, isHubSection } from "../../src/shared/ui-contract.ts";
import { History } from "../history/History.tsx";
import { NotesApp } from "../notes/NotesApp.tsx";
import { Settings } from "../settings/Settings.tsx";
import { api, has } from "../src/api.ts";
import { Empty, mount } from "../src/kit/index.tsx";

const LABELS: Record<HubSection, string> = {
  notes: "Notas",
  meetings: "Reuniões",
  dictation: "Ditado",
  settings: "Configurações",
};

/** Seção que ainda não existe: aparece na barra, sem abrir nada. */
const SOON: ReadonlySet<HubSection> = new Set(["meetings"]);

function Icon({ section }: { section: HubSection }) {
  const paths: Record<HubSection, ReactNode> = {
    notes: <path d="M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3M6.5 8.5h4M6.5 11h4" />,
    meetings: <path d="M2.5 4.5h7v7h-7zM9.5 7l4-2.5v7l-4-2.5" />,
    dictation: <path d="M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5" />,
    settings: <path d="M3 4.5h10M3 8h10M3 11.5h10M6 3v3M10 6.5v3M5 10v3" />,
  };
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[section]}
    </svg>
  );
}

function Pane({ section }: { section: HubSection }) {
  switch (section) {
    case "notes":
      return <NotesApp />;
    case "dictation":
      return <History />;
    case "settings":
      return <Settings />;
    case "meetings":
      return (
        <div className="kn-hub-soon">
          <Empty title="Reuniões, em breve">Gravar e resumir reuniões no Mac, sem nada sair dele.</Empty>
        </div>
      );
  }
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

  return (
    <div className="kn-hub" data-entering="true" ref={ref}>
      <nav className="kn-hub-rail" aria-label="Seções">
        <div className="kn-hub-drag electrobun-webkit-app-region-drag" />
        <ul>
          {HUB_SECTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="kn-hub-item"
                aria-current={s === section ? "page" : undefined}
                onClick={() => go(s)}
              >
                <Icon section={s} />
                <span>{LABELS[s]}</span>
                {SOON.has(s) ? <span className="kn-hub-soon-tag">em breve</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="kn-hub-main">
        {HUB_SECTIONS.filter((s) => visited.has(s)).map((s) => (
          <section key={s} className="kn-hub-pane" hidden={s !== section} aria-label={LABELS[s]}>
            <Pane section={s} />
          </section>
        ))}
      </div>
    </div>
  );
}

mount(<Hub />);
