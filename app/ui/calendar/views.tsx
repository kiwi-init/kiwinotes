// As vistas da aba Calendário (T32155): a grade das horas (Dia e Semana), o Mês e a Agenda. Cada item é uma caixa
// arredondada só com o fundo na cor do tipo, sem barra de cor do lado (harry #32145). O hover, o arrastar e o painel
// largo são da tela (Calendar.tsx); aqui só se desenha.

import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { useT } from "../src/i18n.ts";
import { agendaHead, dayHead, timeRange, weekdayNames } from "./format.ts";
import { allDayFit, fitColumns, itemsOfDay, layoutDay, type MoreRun, nowMinutes } from "./model.ts";

/** A altura de uma hora na grade, em px. */
export const HOUR_PX = 48;
/** A largura mínima de um item lado a lado, em px: com menos, o grupo mostra um "+N" no lugar das últimas colunas. */
export const MIN_ITEM_PX = 44;

/**
 * Onde um item fica na coluna do dia: as `cols` colunas do grupo dividem a largura, e ele ocupa `span` delas a partir
 * da `col`. Sozinho (1 coluna), a largura cheia. Os 3 px de cada lado e o 1 px entre vizinhos são o respiro.
 */
export function columnStyle(col: number, cols: number, span = 1): CSSProperties {
  const w = 100 / cols;
  return { left: `calc(${+(w * col).toFixed(4)}% + 3px)`, width: `calc(${+(w * span).toFixed(4)}% - ${cols > 1 && col + span < cols ? 4 : 6}px)` };
}

/** Quantas colunas de item cabem num dia de `px` de largura (sem medida ainda, todas). */
export const columnsThatFit = (px: number | null) => (px == null ? Infinity : Math.max(2, Math.floor((px - 6) / MIN_ITEM_PX)));

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

function ItemBox({ item, h, s, style, children, className = "" }: { item: CalendarItem; h: ItemHandlers; s: ItemState; style?: CSSProperties; children: ReactNode; className?: string }) {
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
  // A faixa do dia todo abre inteira pelo "+N" de qualquer dia, e fecha pelo "Mostrar menos" (10.8).
  const [allOpen, setAllOpen] = useState(false);
  const allDay = days.map((d) => itemsOfDay(items, d).filter((i) => i.allDay));
  const allFolds = allDay.some((list) => allDayFit(list, false).hidden > 0);
  // Abre rolada para o começo do dia útil (ou para perto do agora, se for mais tarde).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nowMin = nowMinutes(today, now);
    const first = days.includes(today) && nowMin !== null ? Math.max(7 * 60, nowMin - 120) : 7 * 60 + 30;
    el.scrollTop = Math.min(first, 17 * 60) * (HOUR_PX / 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0]]);
  // A largura de um dia, para saber quantos itens lado a lado cabem antes do "+N".
  const hours = useRef<HTMLDivElement>(null);
  const [colPx, setColPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = hours.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setColPx((el.clientWidth - 52) / days.length);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);
  const fit = columnsThatFit(colPx);
  const [openMore, setOpenMore] = useState<string | null>(null);
  const nowMin = nowMinutes(today, now);
  return (
    <div className="kn-cal-time" data-days={days.length}>
      <div className="kn-cal-head" style={cols}>
        <span />
        {days.map((d) => {
          const head = dayHead(d, locale);
          return (
            <span key={d} className="kn-cal-dayhead" data-day={d} data-today={d === today ? "" : undefined}>
              <span className="kn-cal-dayhead-in">
                <b>{head.n}</b>
                <span className="kn-cal-dayname">{head.weekday}</span>
              </span>
            </span>
          );
        })}
      </div>
      <div className="kn-cal-allday" style={cols}>
        <span className="kn-cal-allday-label">{t("calendar.allDay")}</span>
        {days.map((d, di) => {
          const fit = allDayFit(allDay[di]!, allOpen);
          return (
            <div key={d} className="kn-cal-allday-cell" data-day={d}>
              {fit.shown.map((i) => (
                <ItemBox key={i.id} item={i} h={h} s={s} className="kn-cal-chip">
                  <b>{i.title}</b>
                </ItemBox>
              ))}
              {fit.hidden ? (
                <button type="button" className="kn-cal-cell-more kn-cal-allday-more" aria-label={t("calendar.allDayMore", { n: fit.hidden })} onClick={() => setAllOpen(true)}>
                  {t("calendar.more", { n: fit.hidden })}
                </button>
              ) : null}
              {allOpen && allFolds && di === days.length - 1 ? (
                <button type="button" className="kn-cal-cell-more kn-cal-allday-less" onClick={() => setAllOpen(false)}>
                  {t("calendar.allDayLess")}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="kn-cal-scroll" ref={scroller}>
        <div className="kn-cal-hours" ref={hours} style={{ ...cols, height: 24 * HOUR_PX }}>
          <div className="kn-cal-gutter">
            {Array.from({ length: 24 }, (_, hr) => (
              <span key={hr} className="kn-cal-hour" style={{ top: hr * HOUR_PX }}>
                {hr ? `${String(hr).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d} className="kn-cal-col" data-day={d} data-today={d === today ? "" : undefined}>
              <DayColumn day={d} items={items} fit={fit} last={di === days.length - 1} h={h} s={s} openMore={openMore} setOpenMore={setOpenMore} />
              {d === today && nowMin !== null ? <div className="kn-cal-now" style={{ top: (nowMin / 60) * HOUR_PX }} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Os itens com hora de um dia: lado a lado quando se cruzam, e o "+N" quando o dia é estreito demais para todos. */
function DayColumn({ day, items, fit, last, h, s, openMore, setOpenMore }: { day: string; items: CalendarItem[]; fit: number; last: boolean; h: ItemHandlers; s: ItemState; openMore: string | null; setOpenMore(key: string | null): void }) {
  const { t } = useT();
  const { shown, more } = fitColumns(layoutDay(items, day), fit);
  return (
    <>
      {shown.map((p) => {
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
            style={{ top, height, ...columnStyle(p.col, p.cols, p.span) }}
          >
            <b>{p.item.title}</b>
            {short ? null : <span>{timeRange(p.item, t("calendar.allDay"), t("calendar.nextDay"))}{p.item.project ? ` · ${p.item.project}` : ""}</span>}
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
      {more.map((r) => {
        const key = `${day}@${r.top}`;
        return <MoreSlot key={key} run={r} open={openMore === key || r.items.some((i) => i.id === s.dragId)} last={last} h={h} s={s} onToggle={(on) => setOpenMore(on ? key : null)} />;
      })}
    </>
  );
}

/** O "+N" de uma faixa com itens escondidos: abre a lista deles, cada um com o cartão e o arrastar de sempre. */
/** A largura da lista do "+N" e o respiro dela até o "+N" e até a borda da grade. */
const LIST_PX = 220;
const LIST_GAP = 4;

function MoreSlot({ run, open, last, h, s, onToggle }: { run: MoreRun; open: boolean; last: boolean; h: ItemHandlers; s: ItemState; onToggle(on: boolean): void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.(".kn-cal-card")) onToggle(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onToggle(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A lista abre do lado pedido, mas sempre dentro da grade (a área que rola): medida ao abrir, ela encosta na borda
  // e fica mais estreita se a grade não tem 220 px (o Dia estreito, revisão do T34737).
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    const grid = slot?.closest(".kn-cal-scroll");
    if (!open || !slot || !grid) return setPlace(null);
    const a = slot.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    const w = Math.min(LIST_PX, g.width - 2 * LIST_GAP);
    const want = last ? a.left - LIST_GAP - w : a.right + LIST_GAP;
    const left = Math.max(g.left + LIST_GAP, Math.min(want, g.right - LIST_GAP - w));
    setPlace({ left: left - a.left, right: "auto", width: w });
  }, [open, last]);
  const top = (run.top / 60) * HOUR_PX;
  const height = Math.max(18, ((run.bottom - run.top) / 60) * HOUR_PX - 3);
  return (
    <div ref={ref} className="kn-cal-more" style={{ top, height, ...columnStyle(run.col, run.cols) }} data-open={open ? "" : undefined}>
      <button type="button" className="kn-cal-more-btn" aria-expanded={open} aria-label={t("calendar.moreHidden", { n: run.items.length })} onClick={() => onToggle(!open)}>
        {t("calendar.more", { n: run.items.length })}
      </button>
      {open ? (
        <div className="kn-cal-more-list" role="group" data-side={last ? "left" : "right"} style={place ?? undefined}>
          {run.items.map((i) => (
            <ItemBox key={i.id} item={i} h={h} s={s} className="kn-cal-row kn-cal-more-item">
              <b>{i.title}</b>
              <small>{timeRange(i, t("calendar.allDay"), t("calendar.nextDay"))}</small>
            </ItemBox>
          ))}
        </div>
      ) : null}
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
              <span className="kn-cal-row-time">{timeRange(i, t("calendar.allDay"), t("calendar.nextDay"))}</span>
              <b>{i.title}</b>
              {i.project ? <small>{i.project}</small> : null}
            </ItemBox>
          ))}
        </section>
      ))}
    </div>
  );
}
