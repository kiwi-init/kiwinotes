// A tela de Início (spec #15728, T15839): a escolhida pelo harry (#15805). O app abre nela.
// - O gato no meio. Com o agente ligado, é o gato do canto, que vem para cá (um gato só, lead #15867): o hub mede o
//   lugar dele aqui (`.kn-home-cat`) e o leva, com os balões. Com o agente desligado, o gato dorme (um quadro parado do
//   kiwicat-v2), e o clique leva a ligar o agente nos Ajustes.
// - A saudação pela hora e uma frase de uma lista local, que muda a cada abertura (`greeting.ts`): nada chama o agente.
// - A busca ⌘K: abre a busca das Notas.
// - O dia (`home.today`, T15847): o "Continuar de onde parou", as notas e os ditados de hoje e a última reunião.
import "./home.css";
import "./views.css";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { HomeToday } from "../../src/shared/home.ts";
import { shortcutLabel } from "../../src/shared/shortcuts.ts";
import { ago, hour, today, when } from "./format.ts";
import { greeting, nextPhraseKey } from "./greeting.ts";
import { useT } from "../src/i18n.ts";
import { useHomeToday } from "./data.ts";
import type { InicioView } from "./InicioMenu.tsx";
import { Pendencias } from "./Pendencias.tsx";
import { Semana } from "./Semana.tsx";
import { ChevronIcon, MeetingIcon, MicIcon, NoteIcon, SearchIcon } from "./icons.tsx";
import sleepingLight from "./gato-dormindo-claro.webp";
import sleepingDark from "./gato-dormindo-escuro.webp";

/** O gato da Início: `live`, o do canto vem para cá; `asleep`, o agente está desligado; `none`, o gato está escondido. */
export type HomeCat = "live" | "asleep" | "none";

export interface HomeProps {
  active: boolean;
  cat: HomeCat;
  /** O atalho da busca das Notas (`command+k`), como a pessoa escolheu. */
  searchShortcut: string;
  onSearch(): void;
  /** `internal`: a nota está na pasta das reuniões; `false`, na pasta aberta. */
  onOpenNote(path: string, internal: boolean): void;
  onDictation(): void;
  onAgentSettings(): void;
  /** A tela que o menu da aba escolheu (T15875): o dia, as Pendências ou a Semana. */
  view?: InicioView;
}

/** A caixa do gato do canto (`.kn-kiwicat`: 96 × 120, a 12 px da borda de baixo e da direita do hub). */
const CAT = { w: 96, h: 120, edge: 12 };

/**
 * Leva o gato do canto ao lugar dele na Início: põe no `.kn-hub` o `data-cat-at="home"` e o deslocamento
 * (`--kn-cat-dx`, `--kn-cat-dy`), que o gato, o clique e os balões somam (`hub.css`). A cada rolagem e mudança de
 * tamanho, mede de novo. Se o lugar sai da área da seção (a página rolou) ou some (outra vista), o gato volta ao canto.
 * O `el` vem de um ref de callback: o efeito acompanha o lugar montar e desmontar.
 */
function useCatAnchor(el: HTMLElement | null, on: boolean) {
  useLayoutEffect(() => {
    const hub = el?.closest<HTMLElement>(".kn-hub");
    const pane = el?.closest<HTMLElement>(".kn-hub-pane");
    if (!on || !el || !hub || !pane) return;
    const clear = () => {
      delete hub.dataset.catAt;
      hub.style.removeProperty("--kn-cat-dx");
      hub.style.removeProperty("--kn-cat-dy");
    };
    const place = () => {
      const h = hub.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      if (s.top < p.top || s.bottom > p.bottom) return clear();
      hub.style.setProperty("--kn-cat-dx", `${Math.round(s.left - (h.right - CAT.edge - CAT.w))}px`);
      hub.style.setProperty("--kn-cat-dy", `${Math.round(s.top - (h.bottom - CAT.edge - CAT.h))}px`);
      hub.dataset.catAt = "home";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(hub);
    ro.observe(pane);
    pane.addEventListener("scroll", place, { passive: true });
    return () => {
      ro.disconnect();
      pane.removeEventListener("scroll", place);
      clear();
    };
  }, [on, el]);
}

export function Home({ active, cat, searchShortcut, onSearch, onOpenNote, onDictation, onAgentSettings, view = "inicio" }: HomeProps) {
  const { t, locale } = useT();
  // A frase é uma por abertura (a chave fica guardada); a saudação e a data seguem a língua quando ela troca.
  const [phrase] = useState(() => nextPhraseKey(safeStorage()));
  const top = useMemo(() => ({ hello: greeting(new Date()), phrase: t(phrase), date: today(Date.now()) }), [locale, phrase]);
  const data = useHomeToday(active);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  // Fora da vista Início não há o lugar do gato: ele fica no canto, como nas outras abas (lead #16013).
  useCatAnchor(slot, active && cat === "live" && view === "inicio");
  if (view === "pendencias") return <Pendencias onOpen={onOpenNote} />;
  if (view === "semana") return <Semana onOpen={onOpenNote} />;
  return (
    <div className="kn-home" data-cat={cat}>
      <div className="kn-home-hero">
        {cat === "live" ? <div className="kn-home-cat" ref={setSlot} aria-hidden="true" /> : null}
        {cat === "asleep" ? <SleepingCat onAgentSettings={onAgentSettings} /> : null}
        <p className="kn-home-date">{top.date}</p>
        <h1 className="kn-home-title">{top.hello}.</h1>
        <p className="kn-home-phrase">{top.phrase}</p>
        <button type="button" className="kn-home-search" onClick={onSearch}>
          <SearchIcon size={18} />
          <span>{t("home.search")}</span>
          <kbd>{shortcutLabel(searchShortcut)}</kbd>
        </button>
      </div>
      {data ? <Day data={data} onOpenNote={onOpenNote} onDictation={onDictation} /> : null}
    </div>
  );
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** O gato dormindo (o agente desligado): o clique abre um menu com "Ligar o agente". */
function SleepingCat({ onAgentSettings }: { onAgentSettings(): void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="kn-home-cat kn-home-asleep" ref={box}>
      <button type="button" className="kn-home-asleep-hit" aria-label={t("home.agentOff")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <img className="kn-home-asleep-light" src={sleepingLight} alt="" draggable={false} />
        <img className="kn-home-asleep-dark" src={sleepingDark} alt="" draggable={false} />
      </button>
      {open ? (
        <div className="kn-home-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="kn-home-menu-item"
            onClick={() => {
              setOpen(false);
              onAgentSettings();
            }}
          >
            {t("home.agentTurnOn")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Day({ data, onOpenNote, onDictation }: { data: HomeToday; onOpenNote(path: string, internal: boolean): void; onDictation(): void }) {
  const { t, locale } = useT();
  const now = useMemo(() => Date.now(), [data, locale]);
  const { continue: last, editedToday, dictationsToday, lastMeeting } = data;
  const left = editedToday.length > 0 || dictationsToday.length > 0;
  if (!last && !left && !lastMeeting) {
    return <p className="kn-home-empty">{t("home.empty")}</p>;
  }
  return (
    <>
      {last ? (
        <button type="button" className="kn-home-card kn-home-continue" onClick={() => onOpenNote(last.path, false)}>
          <span className="kn-home-continue-icon"><NoteIcon size={18} /></span>
          <span className="kn-home-continue-text">
            <span className="kn-home-kicker">{t("home.continue")}</span>
            <span className="kn-home-continue-title">{last.title}</span>
            {last.excerpt ? <span className="kn-home-muted kn-home-clip">{last.excerpt}</span> : null}
          </span>
          <span className="kn-home-meta">{[last.folder, ago(last.editedAt, now)].filter(Boolean).join(" · ")}</span>
          <ChevronIcon />
        </button>
      ) : null}
      <div className="kn-home-cols" data-single={!left || !lastMeeting ? "true" : undefined}>
        {left ? (
          <div>
            {editedToday.length > 0 ? (
              <section className="kn-home-block">
                <h2 className="kn-home-label">{t("home.editedToday")}</h2>
                <ul className="kn-home-list">
                  {editedToday.map((n) => (
                    <li key={n.path}>
                      <button type="button" onClick={() => onOpenNote(n.path, false)}>
                        <span className="kn-home-ico"><NoteIcon /></span>
                        <span className="kn-home-clip">{n.title}</span>
                        {n.folder ? <span className="kn-home-muted kn-home-folder">{n.folder}</span> : null}
                        <span className="kn-home-meta">{hour(n.editedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {dictationsToday.length > 0 ? (
              <section className="kn-home-block">
                <h2 className="kn-home-label">{t("home.dictationsToday")}</h2>
                <ul className="kn-home-list">
                  {dictationsToday.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={onDictation}>
                        <span className="kn-home-ico"><MicIcon /></span>
                        <span className="kn-home-clip">{d.text}</span>
                        <span className="kn-home-meta">{[d.app, hour(d.at)].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
        {lastMeeting ? (
          <section className="kn-home-block">
            <h2 className="kn-home-label">{t("home.lastMeeting")}</h2>
            <div className="kn-home-card kn-home-meeting">
              <button type="button" className="kn-home-meeting-head" onClick={() => onOpenNote(lastMeeting.path, true)}>
                <span className="kn-home-ico"><MeetingIcon /></span>
                <b className="kn-home-clip">{lastMeeting.title}</b>
              </button>
              <p className="kn-home-muted kn-home-meeting-meta">
                {[when(lastMeeting.startedAt, now), lastMeeting.durationMin != null ? t("home.minutes", { min: String(lastMeeting.durationMin) }) : null, lastMeeting.people.join(", ") || null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {lastMeeting.summary.length > 0 ? (
                <ul className="kn-home-summary">
                  {lastMeeting.summary.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              ) : null}
              {lastMeeting.minutesPath ? (
                <button type="button" className="kn-home-link" onClick={() => onOpenNote(lastMeeting.minutesPath!, lastMeeting.minutesInternal)}>
                  {t("home.openMinutes")} <ChevronIcon size={12} />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
