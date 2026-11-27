// O painel do Kiwi à direita do Calendário (T32156, spec #32129), como no protótipo do harry: a sugestão da vez ("quer
// que eu te lembre?", pelas regras locais de `calendar-kiwi.ts`, sem chamar o agente), o Hoje e as pendências sem data,
// que se arrastam para a grade. Ele lê o próprio período (`panelRange`), à parte da vista, e escreve pelo mesmo
// `CalendarStore` da tela.

import "./kiwi-panel.css";

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type CalendarItem, type CalendarItems, type CalendarUpdate } from "../../src/shared/calendar.ts";
import { suggestion } from "../../src/shared/calendar-kiwi.ts";
import { useT } from "../src/i18n.ts";
import { dismissedStore, dropStart, panelRange, todayItems } from "./kiwi-panel.ts";
import type { CalendarStore } from "./source.ts";
import { HOUR_PX } from "./views.tsx";

const DRAG_START_PX = 4;

interface Carry {
  item: CalendarItem;
  x: number;
  y: number;
  moved: boolean;
}

/** Onde a pendência cai: a coluna das horas dá a hora; a faixa do dia todo, o Mês e a Agenda dão o dia. */
function dropAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
  const day = el?.dataset.day;
  if (!el || !day || !el.closest(".kn-cal-main")) return null;
  if (!el.classList.contains("kn-cal-col")) return dropStart(day, null);
  return dropStart(day, ((y - el.getBoundingClientRect().top) / HOUR_PX) * 60);
}

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function KiwiPanel({
  source,
  today,
  now,
  face,
  save,
  storage: given,
  initial = null,
}: {
  source: CalendarStore;
  today: string;
  now: number;
  face: string | null;
  /** O mesmo `save` da tela: grava pelo main, e o conflito vira o aviso de cima. */
  save(u: CalendarUpdate): Promise<void>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Os itens já lidos (os testes desenhados e o print); sem eles, o painel lê sozinho. */
  initial?: CalendarItems | null;
}) {
  const { t, locale } = useT();
  const [data, setData] = useState<CalendarItems | null>(initial);
  const [dismissed] = useState(() => dismissedStore(given === undefined ? storage() : given));
  const [hidden, setHidden] = useState(() => dismissed.keys());
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => panelRange(today), [today]);

  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    source.items(range.from, range.to).then(
      (d) => mine === seq.current && setData(d),
      (e) => console.error("[calendar] kiwi", e),
    );
  }, [source, range.from, range.to]);
  useEffect(() => {
    reload();
    return source.onChanged(reload);
  }, [reload, source]);

  const items = data?.items ?? [];
  const sug = useMemo(() => (data ? suggestion(items, now, locale, hidden) : null), [data, items, now, locale, hidden]);
  const day = useMemo(() => todayItems(items, today), [items, today]);
  const undated = data?.undated ?? [];

  const accept = async () => {
    if (!sug || busy) return;
    setBusy(true);
    try {
      await save({ id: sug.itemId, ...sug.accept.patch });
    } finally {
      setBusy(false);
      reload();
    }
  };
  const dismiss = () => {
    if (!sug) return;
    dismissed.add(sug.key);
    setHidden(dismissed.keys());
  };

  // ---------------------------------------------------------------- arrastar a pendência sem data para a grade

  const carry = useRef<Carry | null>(null);
  const [ghost, setGhost] = useState<Carry | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const pick = (e: ReactPointerEvent<HTMLElement>, item: CalendarItem) => {
    if (e.button !== 0) return;
    e.preventDefault();
    carry.current = { item, x: e.clientX, y: e.clientY, moved: false };
  };

  useEffect(() => {
    const over = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>(".kn-cal-main [data-day]") ?? null;
    const move = (e: PointerEvent) => {
      const c = carry.current;
      if (!c) return;
      if (!c.moved && Math.hypot(e.clientX - c.x, e.clientY - c.y) < DRAG_START_PX) return;
      const next = { ...c, x: e.clientX, y: e.clientY, moved: true };
      carry.current = next;
      setGhost(next);
      setTarget(over(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const c = carry.current;
      carry.current = null;
      setGhost(null);
      setTarget(null);
      if (!c?.moved) return;
      const start = dropAt(e.clientX, e.clientY);
      if (start) void save({ id: c.item.id, start }).finally(reload);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
  }, [save, reload]);

  // O lugar onde a pendência vai cair se acende (o atributo, para a tela e os roteiros).
  useEffect(() => {
    if (!target) return;
    target.dataset.dropTarget = "";
    return () => {
      delete target.dataset.dropTarget;
    };
  }, [target]);

  const notifyLine = (i: CalendarItem) =>
    i.readOnly || i.notify === "none" ? (i.project ?? "") : t("calendarKiwi.panel.notify", { when: t(`calendar.notify.${i.notify}`) });

  return (
    <div className="kn-cal-kiwi" aria-label={t("calendarKiwi.panel.aria")} data-dragging={ghost ? "" : undefined}>
      {sug ? (
        <section className="kn-cal-kiwi-card kn-cal-kiwi-sug" data-rule={sug.rule} data-item={sug.itemId}>
          <div className="kn-cal-kiwi-q">
            {face ? <img src={face} alt="" /> : null}
            <p>{sug.text}</p>
          </div>
          <div className="kn-cal-kiwi-actions">
            <button type="button" className="kn-cal-btn kn-cal-primary" data-action="accept" disabled={busy} onClick={() => void accept()}>
              {sug.accept.label}
            </button>
            <button type="button" className="kn-cal-btn" data-action="dismiss" onClick={dismiss}>
              {sug.dismissLabel}
            </button>
          </div>
        </section>
      ) : null}
      <section className="kn-cal-kiwi-card kn-cal-kiwi-today">
        <h4>{t("calendarKiwi.panel.today")}</h4>
        {day.length ? (
          <ul>
            {day.map((i) => (
              <li key={i.id} data-kind={i.kind} data-id={i.id} data-done={i.done ? "" : undefined}>
                <span className="kn-cal-kiwi-tm">{i.allDay ? t("calendar.allDay") : i.start.slice(11, 16)}</span>
                <i className="kn-cal-kiwi-dot" />
                <span className="kn-cal-kiwi-name">
                  {i.title}
                  {notifyLine(i) ? <small>{notifyLine(i)}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kn-cal-kiwi-empty">{data ? t("calendarKiwi.panel.todayEmpty") : t("calendar.loading")}</p>
        )}
      </section>
      <section className="kn-cal-kiwi-card kn-cal-kiwi-undated">
        <h4>{t("calendarKiwi.panel.undated")}</h4>
        {undated.length ? (
          <>
            <ul>
              {undated.map((i) => (
                <li key={i.id} data-id={i.id} data-kind={i.kind} onPointerDown={(e) => pick(e, i)} data-carried={ghost?.item.id === i.id ? "" : undefined}>
                  <span className="kn-cal-kiwi-chk" aria-hidden="true" />
                  <span className="kn-cal-kiwi-name">{i.project ? t("calendarKiwi.panel.inProject", { project: i.project, title: i.title }) : i.title}</span>
                </li>
              ))}
            </ul>
            <p className="kn-cal-kiwi-hint">{t("calendarKiwi.panel.dragHint")}</p>
          </>
        ) : (
          <p className="kn-cal-kiwi-empty">{data ? t("calendarKiwi.panel.undatedEmpty") : t("calendar.loading")}</p>
        )}
      </section>
      {ghost ? (
        <div className="kn-cal-kiwi-ghost" data-kind={ghost.item.kind} style={{ left: ghost.x + 10, top: ghost.y + 8 }} aria-hidden="true">
          {ghost.item.title}
        </div>
      ) : null}
    </div>
  );
}
