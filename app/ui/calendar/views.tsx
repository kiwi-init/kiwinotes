// As vistas da aba Calendário (T32155): a grade das horas (Dia e Semana), o Mês e a Agenda. Cada item é uma caixa
// arredondada só com o fundo na cor do tipo, sem barra de cor do lado (harry #32145). O hover, o arrastar e o painel
// largo são da tela (Calendar.tsx); aqui só se desenha.

import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { useT } from "../src/i18n.ts";
import { agendaHead, dayHead, timeRange, weekdayNames } from "./format.ts";
import { itemsOfDay, layoutDay, nowMinutes } from "./model.ts";

/** A altura de uma hora na grade, em px. */
export const HOUR_PX = 48;
/** Quantos itens cabem num dia do Mês antes do "+n". */
const MONTH_MAX = 3;

export type DragMode = "move" | "resize";

/** O que as vistas avisam à tela. */
export interface ItemHandlers {
  onEnter(item: CalendarItem, el: HTMLElement): void;
  onLeave(): void;
  onPointerDown(e: ReactPointerEvent<HTMLElement>, item: CalendarItem, mode: DragMode): void;
  onOpen(item: CalendarItem, el: HTMLElement): void;
}

export interface ItemState {
  openId: string | null;
  dragId: string | null;
  pulseId: string | null;
  kiwiFace: string | null;
}

function ItemBox({ item, h, s, style, children, className = "" }: { item: CalendarItem; h: ItemHandlers; s: ItemState; style?: React.CSSProperties; children: ReactNode; className?: string }) {
  const { t } = useT();
  const line = item.source?.line;
  return (
    <div
      className={`kn-cal-item ${className}`}
      role="button"
      tabIndex={0}
      data-id={item.id}
      data-kind={item.kind}
      data-path={item.source?.path}
      data-line={line == null ? undefined : line + 1}
      data-open={s.openId === item.id ? "" : undefined}
      data-dragging={s.dragId === item.id ? "" : undefined}
      data-pulse={s.pulseId === item.id ? "" : undefined}
      data-done={item.done ? "" : undefined}
      data-readonly={item.readOnly ? "" : undefined}
      aria-label={`${t(`calendar.kind.${item.kind}`)}: ${item.title}`}
      style={style}
      onMouseEnter={(e) => h.onEnter(item, e.currentTarget)}
      onMouseLeave={() => h.onLeave()}
      onFocus={(e) => h.onEnter(item, e.currentTarget)}
      onBlur={() => h.onLeave()}
      onPointerDown={(e) => h.onPointerDown(e, item, "move")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          h.onOpen(item, e.currentTarget);
        }
      }}
    >
      {children}
      {item.notify !== "none" && s.kiwiFace ? <img className="kn-cal-kiwi-mark" src={s.kiwiFace} alt="" /> : null}
    </div>
  );
}

/** A grade das horas: os dias em colunas, a faixa do dia todo em cima e a linha vermelha do agora. */
export function TimeGrid({ days, items, today, now, h, s }: { days: string[]; items: CalendarItem[]; today: string; now: number; h: ItemHandlers; s: ItemState }) {
  const { t, locale } = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` };
  // Abre rolada para o começo do dia útil (ou para perto do agora, se for mais tarde).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nowMin = nowMinutes(today, now);
    const first = days.includes(today) && nowMin !== null ? Math.max(7 * 60, nowMin - 120) : 7 * 60 + 30;
    el.scrollTop = Math.min(first, 17 * 60) * (HOUR_PX / 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0]]);
  const nowMin = nowMinutes(today, now);
  return (
    <div className="kn-cal-time" data-days={days.length}>
      <div className="kn-cal-head" style={cols}>
        <span />
        {days.map((d) => {
          const head = dayHead(d, locale);
          return (
            <span key={d} className="kn-cal-dayhead" data-day={d} data-today={d === today ? "" : undefined}>
              <b>{head.n}</b>
              {head.weekday}
            </span>
          );
        })}
      </div>
      <div className="kn-cal-allday" style={cols}>
        <span className="kn-cal-allday-label">{t("calendar.allDay")}</span>
        {days.map((d) => (
          <div key={d} className="kn-cal-allday-cell" data-day={d}>
            {itemsOfDay(items, d)
              .filter((i) => i.allDay)
              .map((i) => (
                <ItemBox key={i.id} item={i} h={h} s={s} className="kn-cal-chip">
                  <b>{i.title}</b>
                </ItemBox>
              ))}
          </div>
        ))}
      </div>
      <div className="kn-cal-scroll" ref={scroller}>
        <div className="kn-cal-hours" style={{ ...cols, height: 24 * HOUR_PX }}>
          <div className="kn-cal-gutter">
            {Array.from({ length: 24 }, (_, hr) => (
              <span key={hr} className="kn-cal-hour" style={{ top: hr * HOUR_PX }}>
                {hr ? `${String(hr).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="kn-cal-col" data-day={d} data-today={d === today ? "" : undefined}>
              {layoutDay(items, d).map((p) => {
                const top = (p.top / 60) * HOUR_PX;
                const height = Math.max(18, ((p.bottom - p.top) / 60) * HOUR_PX - 3);
                const short = height < 34;
                return (
                  <ItemBox
                    key={p.item.id}
                    item={p.item}
                    h={h}
                    s={s}
                    className={short ? "kn-cal-block kn-cal-short" : "kn-cal-block"}
                    style={{ top, height, left: `calc(${(p.col / p.cols) * 100}% + 3px)`, width: `calc(${100 / p.cols}% - 6px)` }}
                  >
                    <b>{p.item.title}</b>
                    {short ? null : <span>{timeRange(p.item, t("calendar.allDay"))}{p.item.project ? ` · ${p.item.project}` : ""}</span>}
                    {p.item.readOnly ? null : (
                      <i
                        className="kn-cal-resize"
                        aria-label={t("calendar.resize")}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          h.onPointerDown(e, p.item, "resize");
                        }}
                      />
                    )}
                  </ItemBox>
                );
              })}
              {d === today && nowMin !== null ? <div className="kn-cal-now" style={{ top: (nowMin / 60) * HOUR_PX }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** O Mês: 6 semanas, de segunda a domingo, com até 3 itens por dia e o "+n". */
export function MonthGrid({ days, anchor, items, today, h, s, onDay }: { days: string[]; anchor: string; items: CalendarItem[]; today: string; h: ItemHandlers; s: ItemState; onDay(day: string): void }) {
  const { t, locale } = useT();
  const month = anchor.slice(0, 7);
  return (
    <div className="kn-cal-month">
      <div className="kn-cal-month-head">
        {weekdayNames(locale).map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="kn-cal-month-grid">
        {days.map((d) => {
          const list = itemsOfDay(items, d);
          return (
            <div key={d} className="kn-cal-cell" data-day={d} data-today={d === today ? "" : undefined} data-out={d.slice(0, 7) !== month ? "" : undefined}>
              <button type="button" className="kn-cal-cell-n" onClick={() => onDay(d)}>
                {Number(d.slice(8))}
              </button>
              {list.slice(0, MONTH_MAX).map((i) => (
                <ItemBox key={i.id} item={i} h={h} s={s} className="kn-cal-chip">
                  <b>{i.title}</b>
                  {i.allDay ? null : <small>{i.start.slice(11, 16)}</small>}
                </ItemBox>
              ))}
              {list.length > MONTH_MAX ? (
                <button type="button" className="kn-cal-cell-more" onClick={() => onDay(d)}>
                  {t("calendar.more", { n: list.length - MONTH_MAX })}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A Agenda: os próximos dias em lista, só os que têm algo. */
export function AgendaList({ days, items, today, h, s }: { days: string[]; items: CalendarItem[]; today: string; h: ItemHandlers; s: ItemState }) {
  const { t, locale } = useT();
  const withItems = days.map((d) => [d, itemsOfDay(items, d)] as const).filter(([, l]) => l.length);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => first.current?.scrollIntoView?.({ block: "nearest" }), []);
  if (!withItems.length) return <p className="kn-cal-empty">{t("calendar.agendaEmpty")}</p>;
  return (
    <div className="kn-cal-agenda">
      {withItems.map(([d, list], n) => (
        <section key={d} className="kn-cal-agenda-day" data-day={d} data-today={d === today ? "" : undefined} ref={n ? undefined : first}>
          <h3>{agendaHead(d, locale)}</h3>
          {list.map((i) => (
            <ItemBox key={i.id} item={i} h={h} s={s} className="kn-cal-row">
              <span className="kn-cal-row-time">{timeRange(i, t("calendar.allDay"))}</span>
              <b>{i.title}</b>
              {i.project ? <small>{i.project}</small> : null}
            </ItemBox>
          ))}
        </section>
      ))}
    </div>
  );
}
