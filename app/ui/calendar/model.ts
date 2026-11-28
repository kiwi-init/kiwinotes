// O lado puro da aba Calendário (T32155, spec #32129): o período de cada vista, a posição dos itens na grade das horas
// (com as sobreposições lado a lado), e a conta do arrastar e do esticar em passos de 15 min. A tela (Calendar.tsx)
// só desenha o que sai daqui; os testes ficam em model.test.ts.

import { addDays, CALENDAR_LIMITS, type CalendarItem, dayOf, dayTimeOf, toMs } from "../../src/shared/calendar.ts";

export const CALENDAR_VIEWS = ["day", "week", "month", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const isCalendarView = (v: unknown): v is CalendarView => (CALENDAR_VIEWS as readonly unknown[]).includes(v);

/** O passo do arrastar e do esticar, e a menor duração de um item. */
export const SNAP_MIN = 15;
/** O item sem fim ocupa meia hora na grade (o contrato: `end` null). */
export const DEFAULT_MIN = 30;
/** Quantos dias a Agenda mostra a partir do dia âncora. */
export const AGENDA_DAYS = 14;

const MIN = 60_000;
const DAY_MIN = 24 * 60;

/** O dia da semana de um `AAAA-MM-DD`, 0 = domingo. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getDay();
}

/** A segunda-feira da semana do dia (a semana começa na segunda, como a da Início). */
export const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

/** Os dias que uma vista mostra, do primeiro ao último, e o `to` (exclusivo) que vai ao `calendar.items`. */
export function viewRange(view: CalendarView, anchor: string): { days: string[]; from: string; to: string } {
  let from: string;
  let n: number;
  if (view === "day") [from, n] = [anchor, 1];
  else if (view === "week") [from, n] = [mondayOf(anchor), 7];
  else if (view === "agenda") [from, n] = [anchor, AGENDA_DAYS];
  else {
    // O Mês: 6 semanas a partir da segunda que abre a semana do dia 1 (as bordas dos meses vizinhos aparecem).
    from = mondayOf(`${anchor.slice(0, 7)}-01`);
    n = 42;
  }
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  return { days, from, to: addDays(from, n) };
}

/**
 * O dia que o "+ Novo" sugere: no Dia, o dia à vista; hoje, se ele está no período à vista;
 * senão, o 1º dia do período. No Mês, o período é o mês, não a grade: as bordas cinza dos
 * meses vizinhos não contam (#491).
 */
export function newItemDay(view: CalendarView, anchor: string, today: string): string {
  if (view === "day") return anchor;
  if (view === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    return today.slice(0, 7) === anchor.slice(0, 7) ? today : first;
  }
  const { from, to } = viewRange(view, anchor);
  return today >= from && today < to ? today : from;
}

/** O próximo período (‹ ›): um dia, uma semana, um mês, ou a Agenda inteira. */
export function stepAnchor(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  if (view === "agenda") return addDays(anchor, AGENDA_DAYS * dir);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  return dayOf(new Date(y, m - 1 + dir, 1, 12).getTime());
}

/** Começo e fim do item em ms; o sem fim dura `DEFAULT_MIN`, o de dia todo vai da meia-noite à meia-noite. */
export function spanOf(item: Pick<CalendarItem, "start" | "end" | "allDay">): { start: number; end: number } {
  if (item.allDay) {
    const start = toMs(item.start.slice(0, 10));
    return { start, end: toMs(addDays(item.start.slice(0, 10), 1)) };
  }
  const start = toMs(item.start);
  const end = item.end ? toMs(item.end) : start + DEFAULT_MIN * MIN;
  return { start, end: Math.max(end, start + SNAP_MIN * MIN) };
}

/** Se o item aparece no dia (o que passa da meia-noite aparece nos dois). */
export function onDay(item: Pick<CalendarItem, "start" | "end" | "allDay">, day: string): boolean {
  const { start, end } = spanOf(item);
  return start < toMs(addDays(day, 1)) && end > toMs(day);
}

/**
 * Quanto a caixa de cima da cascata fica abaixo do começo da de baixo, no mínimo, em minutos (#466): as duas linhas
 * dela, o título e a hora (uns 35 px, com a hora de 48 px), e um respiro. Começando antes disso, a de cima cobria a hora
 * da de baixo.
 */
export const NEAR_MIN = 50;
/** A altura mínima que sobra a uma caixa empurrada, em minutos: a caixa curta da grade (18 px). */
export const MIN_SHOWN_MIN = 23;

/** Um item na grade de um dia: o começo e o fim em minutos desde a meia-noite (cortados no dia), e a coluna. */
export interface Placed {
  item: CalendarItem;
  top: number;
  /**
   * Onde a caixa começa na grade, em minutos: o `top`, ou mais abaixo quando ela começa logo depois de uma caixa que
   * ela cobre (#466), para a hora da de baixo continuar à vista. O fim não muda.
   */
  shownTop: number;
  bottom: number;
  col: number;
  cols: number;
}

/**
 * Os itens com hora de um dia, na grade. Os que se cruzam ganham uma profundidade (`col`): a tela os desenha em
 * cascata, o mais fundo por cima e um pouco deslocado, para os dois continuarem legíveis (lead #32229). `cols` é a
 * profundidade do grupo.
 */
export function layoutDay(items: CalendarItem[], day: string): Placed[] {
  const d0 = toMs(day);
  const timed = items
    .filter((i) => !i.allDay && onDay(i, day))
    .map((item) => {
      const { start, end } = spanOf(item);
      const top = Math.max(0, (start - d0) / MIN);
      return { item, top, shownTop: top, bottom: Math.min(DAY_MIN, (end - d0) / MIN), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.item.id.localeCompare(b.item.id));
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...group.map((p) => p.col + 1));
    for (const p of group) p.cols = cols;
    group = [];
  };
  const ends: number[] = [];
  for (const p of timed) {
    if (p.top >= groupEnd && group.length) {
      close();
      ends.length = 0;
    }
    let col = ends.findIndex((e) => e <= p.top);
    if (col < 0) col = ends.length;
    ends[col] = p.bottom;
    p.col = col;
    // A caixa desce até abaixo das duas linhas de cada caixa mais funda que ela cobre (#466), sem passar do próprio fim.
    for (const q of group) if (q.col < col && q.bottom > p.top) p.shownTop = Math.max(p.shownTop, q.shownTop + NEAR_MIN);
    p.shownTop = Math.min(p.shownTop, Math.max(p.top, p.bottom - MIN_SHOWN_MIN));
    group.push(p);
    groupEnd = Math.max(groupEnd, p.bottom);
  }
  if (group.length) close();
  return timed;
}

/** Os itens de dia todo de um dia, e os de cada dia na ordem da Agenda e do Mês (dia todo primeiro, depois a hora). */
export function itemsOfDay(items: CalendarItem[], day: string): CalendarItem[] {
  return items
    .filter((i) => onDay(i, day))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

/**
 * Arrastar: o item vai `deltaMin` minutos (em passos de 15) e `deltaDays` dias; a duração não muda. Devolve o
 * `start`/`end` do `calendar.update`, ou `null` se nada mudou.
 */
export function moveItem(item: CalendarItem, deltaMin: number, deltaDays: number): { start: string; end: string | null } | null {
  const dm = snap(deltaMin);
  if (!dm && !deltaDays) return null;
  if (item.allDay) {
    if (!deltaDays) return null;
    return { start: addDays(item.start.slice(0, 10), deltaDays), end: null };
  }
  const shift = (v: string) => {
    const [day, time] = v.split("T") as [string, string];
    return dayTimeOf(toMs(`${addDays(day, deltaDays)}T${time}`) + dm * MIN);
  };
  return { start: shift(item.start), end: item.end ? shift(item.end) : null };
}

/**
 * Esticar a borda de baixo: o fim vai `deltaMin` minutos (em passos de 15), com 15 min de duração no mínimo e 24 h no
 * máximo, o teto do `calendar.update` (#480): passou disso, o esticar para no teto, na prévia e ao soltar.
 */
export function resizeItem(item: CalendarItem, deltaMin: number): { end: string } | null {
  if (item.allDay) return null;
  const { start, end } = spanOf(item);
  const next = Math.min(start + CALENDAR_LIMITS.spanHours * 60 * MIN, Math.max(start + SNAP_MIN * MIN, end + snap(deltaMin) * MIN));
  return next === end && item.end ? null : { end: dayTimeOf(next) };
}

/** Os minutos do agora desde a meia-noite, se `day` é hoje; `null` em outro dia. */
export function nowMinutes(day: string, now: number): number | null {
  return dayOf(now) === day ? (now - toMs(day)) / MIN : null;
}

/** A linha 1-based da nota de onde o item veio (o `source.line` do contrato é 0-based). */
export const noteLine = (item: Pick<CalendarItem, "source">): number | undefined =>
  item.source?.line == null ? undefined : item.source.line + 1;
