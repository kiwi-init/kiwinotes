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

/** Um item na grade de um dia: o começo e o fim em minutos desde a meia-noite (cortados no dia), e onde ele fica. */
export interface Placed {
  item: CalendarItem;
  top: number;
  bottom: number;
  /** A coluna do item no grupo dele, a contar da esquerda. */
  col: number;
  /** Quantas colunas o grupo tem: a largura do dia se divide por elas. 1 é a largura cheia. */
  cols: number;
  /** Quantas colunas o item ocupa: ele se estica para a direita enquanto nada do grupo cruza com ele ali. */
  span: number;
  /** O grupo de sobreposição (os que se cruzam, direto ou em cadeia), contado na ordem do dia. */
  group: number;
}

/**
 * Os itens com hora de um dia, na grade. Os que se cruzam ficam lado a lado, dividindo a largura do dia, como no Teams
 * e no Google Agenda (ponto 9 do spec #34706): cada grupo de sobreposição (A cruza B, B cruza C) tem as colunas dele, e
 * cada item fica na primeira coluna livre na hora em que começa. O que não cruza com nada tem a largura cheia.
 */
export function layoutDay(items: CalendarItem[], day: string): Placed[] {
  const d0 = toMs(day);
  const timed: Placed[] = items
    .filter((i) => !i.allDay && onDay(i, day))
    .map((item) => {
      const { start, end } = spanOf(item);
      return { item, top: Math.max(0, (start - d0) / MIN), bottom: Math.min(DAY_MIN, (end - d0) / MIN), col: 0, cols: 1, span: 1, group: 0 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.item.id.localeCompare(b.item.id));
  let group: Placed[] = [];
  let groupEnd = -1;
  let n = 0;
  const ends: number[] = [];
  const close = () => {
    const cols = Math.max(1, ...group.map((p) => p.col + 1));
    for (const p of group) {
      p.cols = cols;
      // Estica para a direita pelas colunas onde nada do grupo cruza com ele.
      while (p.col + p.span < cols && !group.some((q) => q.col === p.col + p.span && q.top < p.bottom && q.bottom > p.top)) p.span++;
    }
    group = [];
    ends.length = 0;
    n++;
  };
  for (const p of timed) {
    if (p.top >= groupEnd && group.length) close();
    let col = ends.findIndex((e) => e <= p.top);
    if (col < 0) col = ends.length;
    ends[col] = p.bottom;
    p.col = col;
    p.group = n;
    group.push(p);
    groupEnd = Math.max(groupEnd, p.bottom);
  }
  if (group.length) close();
  return timed;
}

/** O "+N" de um grupo que não cabe: a faixa de horas dos itens escondidos, na última coluna à vista. */
export interface MoreRun {
  top: number;
  bottom: number;
  col: number;
  cols: number;
  items: CalendarItem[];
}

/**
 * Quando o dia é estreito demais para as colunas de um grupo (`max` é quantas cabem), as primeiras `max - 1` ficam à
 * vista e a última vira um "+N" para cada faixa de horas que tem item escondido. O grupo que cabe não muda.
 */
export function fitColumns(placed: Placed[], max: number): { shown: Placed[]; more: MoreRun[] } {
  const fit = Math.max(2, Math.floor(max));
  const shown: Placed[] = [];
  const more: MoreRun[] = [];
  const hidden = new Map<number, Placed[]>();
  for (const p of placed) {
    if (p.cols <= fit) {
      shown.push(p);
      continue;
    }
    const keep = fit - 1;
    if (p.col < keep) shown.push({ ...p, cols: fit, span: Math.min(p.span, keep - p.col) });
    else hidden.set(p.group, [...(hidden.get(p.group) ?? []), p]);
  }
  for (const list of hidden.values()) {
    let run: MoreRun | null = null;
    for (const p of [...list].sort((a, b) => a.top - b.top)) {
      if (run && p.top < run.bottom) {
        run.bottom = Math.max(run.bottom, p.bottom);
        run.items.push(p.item);
      } else {
        run = { top: p.top, bottom: p.bottom, col: fit - 1, cols: fit, items: [p.item] };
        more.push(run);
      }
    }
  }
  return { shown, more };
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
 * O "Adiar" (o cartão e o painel largo): o item vai para o dia seguinte, na mesma hora. Numa vez de repetição, só aquela
 * vez anda (`only`, #485); sem isso, o `calendar.update` mudava o começo da série inteira (#530).
 */
export function snoozePatch(item: CalendarItem): { start: string; end: string | null; only?: true } | null {
  const m = moveItem(item, 0, 1);
  if (!m) return null;
  return item.repeat ? { ...m, only: true } : m;
}

/** A série de um item: o id sem o `~AAAA-MM-DD` da vez (as vezes de uma repetição dividem a série). */
export const seriesOf = (id: string) => id.replace(/~\d{4}-\d{2}-\d{2}$/, "");

/**
 * As Ligações da mesma nota: os outros itens dela, uma linha por série. As vezes de uma repetição no período à vista
 * não se repetem, e a série do próprio item não entra (#532).
 */
export function sameNote(item: CalendarItem, items: CalendarItem[]): CalendarItem[] {
  if (!item.source) return [];
  const seen = new Set([seriesOf(item.id)]);
  return items.filter((i) => {
    if (i.source?.path !== item.source!.path || seen.has(seriesOf(i.id))) return false;
    seen.add(seriesOf(i.id));
    return true;
  });
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
