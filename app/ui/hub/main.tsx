// O hub (T2121, spec #2100): a janela principal do Kiwi Notes. Com o T2502 (#2457 ponto 2, versão C · Foco), as seções
// (Notas, Reuniões, Ditado e Configurações) viram abas numa barra de cima, como no Channels; a barra lateral
// saiu. O Sobre virou um assunto de Configurações (spec #11966): a seção `about` do contrato abre Ajustes › Sobre. Dos lados das abas, a seção na tela põe os botões dela (`TopBar`, por portal). Uma seção visitada fica
// montada (só escondida), para a nota em edição e o autosave não se perderem ao trocar de seção.
import "../kiwicat-v2/bubble.css";
import "../kiwicat-v2/bubble-md.css";
import "./hub.css";
import { DoubtCard } from "./DoubtCard";
import { GooLayer } from "./Goo.tsx";
import { tabsClip, tabsScrollToShow } from "./tabs-fit.ts";
import { KiwiCat, useAgentCat } from "./KiwiCat";
import { Onboarding } from "./onboarding/Onboarding.tsx";
import { Welcome } from "./onboarding/Welcome.tsx";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { HUB_SECTIONS, type HubSection, isHubSection } from "../../src/shared/ui-contract.ts";
import { History } from "../history/History.tsx";
import { Home, type HomeCat } from "../home/Home.tsx";
import { INICIO_VIEWS, InicioMenu, InicioTabLabel, type InicioView } from "../home/InicioMenu.tsx";
import { DEFAULT_SHORTCUTS, matchesKeyEvent } from "../../src/shared/shortcuts.ts";
import { NotesApp } from "../notes/NotesApp.tsx";
import { Meetings } from "../meetings/Meetings.tsx";
import { Calendar } from "../calendar/Calendar.tsx";
import { Settings } from "../settings/Settings.tsx";
import { api, has } from "../src/api.ts";
import { HubNavContext, type SettingsRequest } from "../src/hubNav.ts";
import { watchSlowFrames } from "../src/slowFrames.ts";
import type { SettingsTopic } from "../settings/topics.ts";
import { HubBarContext } from "../src/topbar.tsx";
import { mount } from "../src/kit/index.tsx";
import { useT } from "../src/i18n.ts";
import type { TextKey } from "../../src/shared/i18n/index.ts";

/** O nome de cada aba, no catálogo (spec #28171). */
const LABELS: Record<HubSection, TextKey> = {
  home: "hub.tab.home",
  notes: "hub.tab.notes",
  meetings: "hub.tab.meetings",
  dictation: "hub.tab.dictation",
  calendar: "hub.tab.calendar",
  settings: "hub.tab.settings",
  about: "hub.tab.about",
};

/** As abas da barra de cima. O `about` do contrato (o menu da barra, `?section=about`) abre Ajustes › Sobre. */
const TABS = HUB_SECTIONS.filter((s): s is Exclude<HubSection, "about"> => s !== "about");
type Tab = (typeof TABS)[number];
/** As abas em que o ⌘K abre a busca por cima, sem trocar de aba (spec #16821). */
const SEARCH_OVER: ReadonlySet<Tab> = new Set<Tab>(["home", "meetings", "dictation"]);

/** Seção que ainda não existe: aparece na barra, sem abrir nada. Reuniões chegou com o R6 (T4947). */
const SOON: ReadonlySet<HubSection> = new Set([]);

/** Abrir uma nota nas Notas a partir de outra seção (Reuniões, T4947): `n` muda a cada pedido, mesmo para a mesma nota. */
export interface OpenRequest {
  path: string;
  internal?: boolean;
  n: number;
  /** A linha do arquivo (1-based) em que a nota abre (o Calendário, T32155). */
  line?: number;
}

/** O que a Início pede ao hub (spec #15728): abrir uma nota, a busca das Notas, o Ditado e os Ajustes do agente. */
interface HomeNav {
  cat: HomeCat;
  view: InicioView;
  searchShortcut: string;
  onSearch(): void;
  onDictation(): void;
  onAgentSettings(): void;
  onCalendar(): void;
}

/** `active`: a seção está na tela. As outras ficam montadas e escondidas (o estado não se perde ao trocar). */
function Pane({ section, active, openRequest, searchRequest, searchSeen, onShowNotes, settingsRequest, onOpenNote, home, catColor }: { section: Tab; catColor?: unknown; active: boolean; openRequest: OpenRequest | null; searchRequest: number; searchSeen: { current: number }; onShowNotes(): void; settingsRequest: SettingsRequest | null; onOpenNote(path: string, internal?: boolean, line?: number): void; home: HomeNav }) {
  switch (section) {
    case "home":
      return <Home active={active} onOpenNote={onOpenNote} {...home} />;
    case "notes":
      return <NotesApp active={active} openRequest={openRequest} searchRequest={searchRequest} searchSeen={searchSeen} onShow={onShowNotes} />;
    case "dictation":
      return <History />;
    case "settings":
      return <Settings request={settingsRequest} />;
    case "meetings":
      return <Meetings onOpen={onOpenNote} />;
    case "calendar":
      return <Calendar active={active} catColor={catColor} onOpenNote={(path, internal, line) => onOpenNote(path, internal, line)} />;
  }
}

/** A seleção acompanha só a seção ativa; o hover da aba muda apenas a cor do texto (T4535, #4521). */
function Tabs({ section, onGo, homeView, onHomeView }: { section: Tab; onGo(s: Tab): void; homeView: InicioView; onHomeView(v: InicioView): void }) {
  const { t } = useT();
  const group = useRef<HTMLDivElement>(null);
  /** O menu da aba Início (T15875): abre pela seta, pelo clique na aba já aberta ou pela ↓ nela. */
  const [menu, setMenu] = useState(false);
  const homeTab = useRef<HTMLButtonElement>(null);
  const pillEl = useRef<HTMLSpanElement>(null);
  const trackEl = useRef<HTMLDivElement>(null);
  const measured = useRef(false);
  useLayoutEffect(() => {
    const track = trackEl.current;
    // Na janela estreita (#496), a faixa rola e a aba escolhida fica à vista; a borda que esconde abas esmaece.
    const clip = () => {
      if (!track) return;
      const c = tabsClip(track.scrollLeft, track.clientWidth, track.scrollWidth);
      if (c) track.dataset.clip = c;
      else delete track.dataset.clip;
    };
    const fit = (tab: HTMLElement) => {
      if (!track) return;
      // Mede sem rolar (`data-clip` liga o overflow): cabendo tudo, a faixa volta ao começo e não rola.
      if (track.scrollWidth <= track.clientWidth + 1) {
        track.scrollLeft = 0;
        return clip();
      }
      track.dataset.clip ??= "end";
      track.scrollLeft = tabsScrollToShow(tab.offsetLeft, tab.offsetWidth, track.scrollLeft, track.clientWidth, track.scrollWidth);
      clip();
    };
    const measure = (resized = false) => {
      const tab = group.current?.querySelector<HTMLElement>(`[data-section="${section}"]`);
      const pill = pillEl.current;
      if (!tab || !pill) return;
      // A primeira medida e o resize não deslizam; uma nova seleção usa o --glide do Channels.
      pill.dataset.moving = String(measured.current && !resized);
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      measured.current = true;
      fit(tab);
    };
    measure();
    // A primeira notificação do observer só confirma o layout; não interrompe uma seleção em movimento.
    let observed = false;
    const ro = new ResizeObserver(() => {
      if (observed) measure(true);
      observed = true;
    });
    if (group.current) ro.observe(group.current);
    track?.addEventListener("scroll", clip, { passive: true });
    return () => {
      ro.disconnect();
      track?.removeEventListener("scroll", clip);
    };
  }, [section, homeView]);
  const move = (dir: 1 | -1) => {
    const i = TABS.indexOf(section);
    const next = TABS[(i + dir + TABS.length) % TABS.length]!;
    onGo(next);
    group.current?.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  };
  return (
    <div
      className="kn-tabs electrobun-webkit-app-region-no-drag"
      role="tablist"
      aria-label={t("hub.tabs.aria")}
      ref={group}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          move(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      {/* A faixa das abas: rola de lado só quando a barra é estreita demais para elas (#496). */}
      <div className="kn-tabs-track" role="none" ref={trackEl}>
        <span className="kn-tabs-pill" ref={pillEl} aria-hidden="true" />
        {TABS.map((s) => (
          <button
            type="button"
            role="tab"
            key={s}
            data-section={s}
            aria-selected={s === section}
            tabIndex={s === section ? 0 : -1}
            className="kn-tab"
            ref={s === "home" ? homeTab : undefined}
            {...(s === "home" ? { "aria-haspopup": "menu" as const, "aria-expanded": menu, "data-view": homeView } : {})}
            onClick={(e) => {
              if (s !== "home") return onGo(s);
              // A seta abre o menu de qualquer aba; o clique na Início já aberta também.
              const onChevron = (e.target as Element).closest(".kn-home-v-chevron");
              if (section === "home" || onChevron) setMenu((m) => !m);
              onGo(s);
            }}
            onKeyDown={(e) => {
              if (s === "home" && e.key === "ArrowDown") {
                e.preventDefault();
                onGo(s);
                setMenu(true);
              }
            }}
          >
            {s === "home" ? <InicioTabLabel view={homeView} /> : t(LABELS[s])}
            {SOON.has(s) ? <span className="kn-tab-soon">{t("hub.tab.soon")}</span> : null}
          </button>
        ))}
      </div>
      {menu ? (
        <InicioMenu
          view={homeView}
          anchor={homeTab.current}
          onPick={(v) => {
            setMenu(false);
            onHomeView(v);
            onGo("home");
          }}
          onClose={() => setMenu(false)}
        />
      ) : null}
    </div>
  );
}

/** A seção inicial: `?section=` (a CLI e o print) ou a Início (spec #15728). O `about` é Ajustes › Sobre. */
function initialSection(): HubSection {
  const q = new URLSearchParams(location.search).get("section");
  return isHubSection(q) ? q : "home";
}

function Hub() {
  const { t } = useT();
  const [section, setSection] = useState<Tab>(() => {
    const s = initialSection();
    return s === "about" ? "settings" : s;
  });
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([section]));
  /** O assunto de Ajustes que um link (ou o `about`) pediu; `n` muda a cada pedido. */
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest | null>(() => (initialSection() === "about" ? { topic: "about", n: 1 } : null));
  const [entry, setEntry] = useState(1);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  /** A tela da aba Início (T15875): começa no dia; `?home=` abre outra (a CLI e o print). */
  const [homeView, setHomeView] = useState<InicioView>(() => {
    const q = new URLSearchParams(location.search).get("home");
    return (INICIO_VIEWS as readonly string[]).includes(q ?? "") ? (q as InicioView) : "inicio";
  });
  /** `internal`: a nota está na pasta das reuniões (o padrão); `false`, na pasta aberta (a Início, as Pendências e a Semana). */
  const openNote = (path: string, internal = true, line?: number) => {
    setOpenRequest((r) => ({ path, internal, n: (r?.n ?? 0) + 1, ...(line ? { line } : {}) }));
    go("notes");
  };
  /**
   * A busca das Notas por cima da aba da frente (spec #16821): o número muda a cada pedido, e o `searchSeen` guarda o
   * último que as Notas já abriram (as Notas que montam agora, escondidas, ainda atendem o pedido).
   */
  const [searchRequest, setSearchRequest] = useState(0);
  const searchSeen = useRef(0);
  const openSearch = () => {
    setVisited((v) => (v.has("notes") ? v : new Set(v).add("notes")));
    setSearchRequest((n) => n + 1);
  };
  const { status: agentStatus, settings } = useAgentCat();
  const catShown = !!agentStatus?.enabled && settings?.kiwicat?.show === true && agentStatus.onboarding?.state !== "open";
  const homeCat: HomeCat = catShown ? "live" : agentStatus && !agentStatus.enabled ? "asleep" : "none";
  const searchShortcut = settings?.shortcuts?.palette ?? DEFAULT_SHORTCUTS.palette!;
  // O ⌘K na Início, nas Reuniões e no Ditado abre a busca das Notas ali mesmo (spec #16821). Nas Notas, quem atende é
  // a própria seção; nas Configurações, o ⌘K não abre nada.
  const searchKey = useRef({ section, searchShortcut });
  searchKey.current = { section, searchShortcut };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!SEARCH_OVER.has(searchKey.current.section) || e.defaultPrevented || !matchesKeyEvent(searchKey.current.searchShortcut, e)) return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const ref = useRef<HTMLDivElement>(null);

  const go = (s: HubSection) => {
    if (s === "about") return openSettings("about");
    setSection(s);
    setVisited((v) => (v.has(s) ? v : new Set(v).add(s)));
  };
  const openSettings = (topic: SettingsTopic, row?: string) => {
    setSettingsRequest((r) => ({ topic, row, n: (r?.n ?? 0) + 1 }));
    go("settings");
  };

  // O que o menu da barra pediu: antes de abrir (`hub.section`) e com o hub aberto (`hub.navigate`). Com `path` (o
  // clique num arquivo do balão do gato, spec #17683), as Notas abrem nele, na pasta aberta.
  useEffect(() => {
    const follow = (section: unknown, path?: string) => {
      if (section === "notes" && typeof path === "string" && path) openNote(path, false);
      else if (isHubSection(section)) go(section);
    };
    if (has("hub.section")) {
      api.hub.section().then(
        (r) => r.section && follow(r.section, r.path),
        () => {},
      );
    }
    return api.hub.onNavigate((e) => follow(e.section, e.path));
  }, []);

  // O quadro travado depois de um clique ou tecla vai para o log local (spec #12918), com a tela: a seção, ou o
  // onboarding quando ele está por cima.
  const sectionNow = useRef(section);
  sectionNow.current = section;
  useEffect(() => {
    if (!has("diagnostics.slowFrame")) return;
    const where = () => (document.querySelector(".kn-onb") ? "onboarding" : sectionNow.current);
    return watchSlowFrames(where, (w, ms) => void api.diagnostics.slowFrame(w, ms).catch(() => {}));
  }, []);

  // O título é o do app, e a entrada ao voltar para a frente é a do hub inteiro (cada seção tem a sua, de janela).
  useEffect(() => {
    document.title = "Kiwi Notes";
    window.__kiwiEnter = () => {
      // Segurado para a intro e aberto por outro caminho: entra igual, sem esperar a página se ver visível.
      if (ref.current?.dataset.entering === "hold") return window.__kiwiReveal?.();
      if (document.visibilityState === "visible") setEntry((n) => n + 1);
    };
    // O fim da intro (T16769): a moldura dela já é esta janela, no mesmo lugar e na mesma cor de fundo. O hub fica
    // escondido e transparente por dentro até aparecer, e aí só o conteúdo esmaece para dentro, sem o `window-in`.
    window.__kiwiHold = () => {
      if (ref.current) ref.current.dataset.entering = "hold";
    };
    window.__kiwiReveal = () => {
      window.__kiwiHeld = false;
      const el = ref.current;
      if (!el) return;
      el.dataset.entering = "false";
      void el.offsetWidth;
      el.dataset.entering = "reveal";
    };
    // Segurado antes de o React montar (T23565): o `__kiwiHold` ainda não existia, e a marca ficou na janela.
    if (window.__kiwiHeld && ref.current?.dataset.entering !== "reveal") window.__kiwiHold();
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
  const [bar, setBar] = useState<HTMLElement | null>(null);
  // A primeira abertura (T20795, spec #20780): a boas-vindas do Kiwi Cat por cima do hub, se o `firstRun` está `pending`
  // quando o hub abre. Fica até o fim do caminho dela: o `FirstRunSetup` grava `done` no meio, antes do consentimento.
  const [firstRun, setFirstRun] = useState<"open" | "closed" | null>(null);
  useEffect(() => {
    if (firstRun === null && settings) setFirstRun(settings.firstRun === "pending" ? "open" : "closed");
  }, [settings, firstRun]);

  return (
    <HubNavContext.Provider value={{ openSettings }}>
      <div className="kn-hub" data-entering="true" ref={ref}>
        <header className="kn-hub-top electrobun-webkit-app-region-drag" ref={setBar}>
          {/* A gota (spec #17725): os botões de cada lado brotam da pílula de abas e voltam para ela. */}
          <GooLayer bar={bar} start={start} end={end} />
          <div className="kn-hub-slot kn-hub-start" ref={setStart} />
          <Tabs section={section} onGo={go} homeView={homeView} onHomeView={setHomeView} />
          <div className="kn-hub-slot kn-hub-end" ref={setEnd} />
        </header>
        {/* A pergunta na dúvida do guardrail (spec #9873): por cima das seções, em qualquer aba. */}
        <DoubtCard />
        <KiwiCat status={agentStatus} settings={settings} atHome={section === "home"} />
        {/* O onboarding do agente (spec #11955): por cima de tudo, na primeira vez que o agente liga. */}
        <Onboarding />
        {firstRun === "open" && settings ? <Welcome settings={settings} onClosed={() => setFirstRun("closed")} /> : null}
        <div className="kn-hub-main">
          {TABS.filter((s) => visited.has(s)).map((s) => (
            <section key={s} className="kn-hub-pane" data-section={s} hidden={s !== section} aria-label={t(LABELS[s])}>
              <HubBarContext.Provider value={{ start, end, active: s === section }}>
                <Pane
                  section={s}
                  active={s === section}
                  openRequest={openRequest}
                  searchRequest={searchRequest}
                  searchSeen={searchSeen}
                  onShowNotes={() => go("notes")}
                  settingsRequest={settingsRequest}
                  onOpenNote={openNote}
                  catColor={settings?.kiwicat?.cor}
                  home={{ cat: homeCat, view: homeView, searchShortcut, onSearch: openSearch, onDictation: () => go("dictation"), onAgentSettings: () => openSettings("agent"), onCalendar: () => go("calendar") }}
                />
              </HubBarContext.Provider>
            </section>
          ))}
        </div>
      </div>
    </HubNavContext.Provider>
  );
}

mount(<Hub />);
