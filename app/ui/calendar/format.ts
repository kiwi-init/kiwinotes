// As datas da aba Calendário na língua do app (T32155): o título do período, a cabeça de cada dia e a hora dos itens.

import { CALENDAR_REPEATS, type CalendarItem, type CalendarRepeat, type CalendarRepeatPreset, repeatRule } from "../../src/shared/calendar.ts";
import type { Params, TextKey } from "../../src/shared/i18n/index.ts";
import type { CalendarView } from "./model.ts";

type Locale = "pt" | "en";
const tag = (l: Locale) => (l === "pt" ? "pt-BR" : "en-US");
const at = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
/** Sem o ponto do "nov." e com a primeira maiúscula onde abre a frase. */
const clean = (s: string) => s.replace(/\./g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const fmt = (l: Locale, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag(l), o);

/** "23 – 29 nov", "26 nov – 2 dez", "Novembro de 2026", "Quinta, 26 de novembro". */
export function periodTitle(view: CalendarView, days: string[], anchor: string, l: Locale): string {
  if (view === "month") return cap(fmt(l, { month: "long", year: "numeric" }).format(at(anchor)));
  if (view === "day") return cap(fmt(l, { weekday: "long", day: "numeric", month: "long" }).format(at(anchor)));
  const a = at(days[0]!);
  const b = at(days[days.length - 1]!);
  const dm = fmt(l, { day: "numeric", month: "short" });
  if (a.getMonth() === b.getMonth()) {
    const month = clean(fmt(l, { month: "short" }).format(b));
    return l === "pt" ? `${a.getDate()} – ${b.getDate()} ${month}` : `${cap(month)} ${a.getDate()} – ${b.getDate()}`;
  }
  return `${clean(dm.format(a))} – ${clean(dm.format(b))}`;
}

/** A cabeça de um dia: "Seg" e 23. */
export function dayHead(day: string, l: Locale): { weekday: string; n: number } {
  return { weekday: cap(clean(fmt(l, { weekday: "short" }).format(at(day)))), n: Number(day.slice(8)) };
}

/** Os nomes curtos dos dias, de segunda a domingo (a cabeça do Mês). */
export const weekdayNames = (l: Locale) =>
  ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].map((d) => dayHead(d, l).weekday);

const hm = (v: string) => v.slice(11, 16);

/** O fim cai noutro dia que o começo (22:00–02:00, ou o item de 24 h, 11:00–11:00). */
const endsNextDay = (item: Pick<CalendarItem, "start" | "end">) => !!item.end && item.end.slice(0, 10) > item.start.slice(0, 10);

/**
 * "10:00–11:00", "10:00", ou o "dia todo" que a tela passa. Quando o fim cai no dia seguinte, o `nextDay` que a tela
 * passa ("(+1 dia)") vem depois, senão o item de 24 h parecia ter duração zero (#480). O teto de 24 h
 * (`CALENDAR_LIMITS.spanHours`) faz o fim cair, no máximo, no dia seguinte.
 */
export function timeRange(item: Pick<CalendarItem, "start" | "end" | "allDay">, allDay: string, nextDay: string): string {
  if (item.allDay) return allDay;
  if (!item.end) return hm(item.start);
  return `${hm(item.start)}–${hm(item.end)}${endsNextDay(item) ? ` ${nextDay}` : ""}`;
}

/** "Qui, 26 nov · 10:00–11:00", ou "Sex, 27 nov · 11:00–11:00 (+1 dia)". */
export function whenLine(item: Pick<CalendarItem, "start" | "end" | "allDay">, l: Locale, allDay: string, nextDay: string): string {
  const day = cap(clean(fmt(l, { weekday: "short", day: "numeric", month: "short" }).format(at(item.start.slice(0, 10)))));
  return `${day} · ${timeRange(item, allDay, nextDay)}`;
}

/** A cabeça de um dia na Agenda: "Quinta, 26 de novembro". */
export const agendaHead = (day: string, l: Locale) => cap(fmt(l, { weekday: "long", day: "numeric", month: "long" }).format(at(day)));

/** Os dias da semana numa lista: "seg, qua e sex", "Mon, Wed and Fri" (0 = domingo). */
function weekdayList(days: readonly number[], l: Locale, and: string): string {
  const names = days.map((d) => clean(fmt(l, { weekday: "short" }).format(at(`2026-11-${String(22 + d).padStart(2, "0")}`))));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}` : (names[0] ?? "");
}

/** "26 nov 2026": o dia do fim de uma repetição. */
const shortDate = (day: string, l: Locale) => clean(fmt(l, { day: "numeric", month: "short", year: "numeric" }).format(at(day)));

/**
 * Como a tela diz uma repetição (T34775): "toda semana", "nos dias úteis", "a cada 2 semanas, seg e qua, até 31 dez
 * 2026", "every 3 days, 10 times". `t` é o tradutor da tela.
 */
export function repeatLabel(rep: CalendarRepeat, l: Locale, t: (key: TextKey, params?: Params) => string): string {
  if ((CALENDAR_REPEATS as readonly string[]).includes(rep)) return t(`calendar.repeat.${rep as CalendarRepeatPreset}`);
  const r = repeatRule(rep);
  if (!r) return rep;
  const parts = [t(`calendar.repeat.every.${r.unit}`, { n: r.every })];
  if (r.days.length) parts.push(weekdayList(r.days, l, t("calendar.repeat.and")));
  if (r.until) parts.push(t("calendar.repeat.until", { date: shortDate(r.until, l) }));
  else if (r.count !== null) parts.push(t("calendar.repeat.times", { n: r.count }));
  return parts.join(", ");
}
