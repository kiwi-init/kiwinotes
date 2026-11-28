// Editar à mão (T34745, spec #34706, pontos 3 e 4): os campos de data e hora do cartão e do painel largo viram o
// `start`, o `end` e o `allDay` do `calendar.update`. Sem React, para os testes.

import { addDays, type CalendarItem, type CalendarUpdate, isDay } from "../../src/shared/calendar.ts";

/** O que os campos mostram: o dia, a hora de início e a de fim (`""` sem hora) e o dia todo. */
export interface WhenFields {
  day: string;
  from: string;
  to: string;
  allDay: boolean;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A hora que um item ganha quando sai do dia todo. */
export const DEFAULT_FROM = "09:00";

export function fieldsOf(item: Pick<CalendarItem, "start" | "end" | "allDay">): WhenFields {
  const allDay = item.allDay || item.start.length === 10;
  return {
    day: item.start.slice(0, 10),
    from: allDay ? "" : item.start.slice(11, 16),
    to: allDay || !item.end || item.end.length === 10 ? "" : item.end.slice(11, 16),
    allDay,
  };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00`) - Date.parse(`${a}T12:00`)) / 86_400_000);

/**
 * O pedaço do `calendar.update` dos campos, ou `null` se eles não fecham (dia que não existe, hora pela metade, o fim
 * igual ao início). Um fim antes do início é no dia seguinte (uma reunião até 00:30). Sem nada mudado, `{}`.
 * O dia todo de vários dias leva o fim junto, pelo mesmo tanto.
 */
export function whenPatch(item: Pick<CalendarItem, "start" | "end" | "allDay">, f: WhenFields): Pick<CalendarUpdate, "start" | "end" | "allDay"> | null {
  if (!isDay(f.day)) return null;
  const was = fieldsOf(item);
  if (f.allDay) {
    const end = was.allDay && item.end && item.end.length === 10 ? addDays(item.end, daysBetween(was.day, f.day)) : null;
    if (was.allDay && f.day === was.day) return {};
    return { start: f.day, end, allDay: true };
  }
  const from = f.from || DEFAULT_FROM;
  if (!HM.test(from) || (f.to && !HM.test(f.to))) return null;
  if (f.to === from) return null;
  const start = `${f.day}T${from}`;
  const end = f.to ? `${f.to > from ? f.day : addDays(f.day, 1)}T${f.to}` : null;
  if (!was.allDay && start === item.start && end === (item.end ?? null)) return {};
  return { start, end, allDay: false };
}

/** Os tipos que uma linha pode ter: a nota com `agenda:` é sempre nota. */
export const LINE_KINDS = ["meeting", "reminder", "task", "focus"] as const;

/** O que se pode mudar em cada item: a reunião gravada nada; a nota com `agenda:` só a data, o aviso e o texto. */
export function editable(item: Pick<CalendarItem, "id" | "readOnly">): { any: boolean; line: boolean } {
  if (item.readOnly || item.id.startsWith("m:")) return { any: false, line: false };
  return { any: true, line: item.id.startsWith("n:") };
}

/** Uma vez de uma repetição (o id com `~AAAA-MM-DD`): o apagar pergunta se é só ela ou a série. */
export const isOccurrence = (id: string) => /~\d{4}-\d{2}-\d{2}$/.test(id);

/** O alvo da tecla Delete: nunca quando o foco está num campo de texto, onde ela apaga letras. */
export function typing(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).closest !== "function") return false;
  const e = el as HTMLElement;
  return !!e.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}
