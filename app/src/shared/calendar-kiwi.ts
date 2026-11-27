// O Kiwi no Calendário (spec #32129, T32156), a parte que a tela e o main dividem: as horas e os dias como o Kiwi diz,
// e as regras locais da sugestão do painel ("quer que eu te lembre?"). Puro, sem chamar o agente: a sugestão sai só dos
// itens que a tela já leu pelo `calendar.items`.
//
// As regras, na ordem em que valem (uma sugestão por vez, a primeira que couber):
// 1. **Atrasada:** uma pendência ou um lembrete aberto cuja hora já passou. Oferece passar para amanhã, 9h.
// 2. **Prazo sem aviso:** uma pendência dos próximos 3 dias sem aviso nenhum. Oferece o aviso (na véspera, ou 30 min
//    antes, ou na hora, conforme o tempo que falta).
// 3. **Reunião amanhã cedo:** uma reunião de amanhã antes das 10h com aviso menor que 30 min. Oferece 30 min antes.
// O "Agora não" guarda a chave da sugestão (a tela guarda), e a mesma não volta.

import type { CalendarKind, CalendarNotify } from "./calendar.ts";
import { type Locale, translate } from "./i18n/index.ts";

export type CalendarKiwiKind = CalendarKind;
export type CalendarKiwiNotify = CalendarNotify;

/** O que a sugestão usa do `CalendarItem` (src/shared/calendar.ts, T32154). */
export interface SuggestItem {
  id: string;
  kind: CalendarKiwiKind;
  title: string;
  /** ISO local: `2026-11-27T10:00`, ou `2026-11-27` no dia todo. */
  start: string;
  allDay: boolean;
  done?: boolean;
  notify: CalendarKiwiNotify;
  readOnly?: boolean;
  source: { path: string } | null;
}

/** A mudança que o botão da sugestão manda ao `calendar.update`. */
export interface SuggestPatch {
  start?: string;
  notify?: CalendarKiwiNotify;
}

export type SuggestRule = "overdue" | "deadline" | "meetingTomorrow";

export interface Suggestion {
  rule: SuggestRule;
  /** A chave do "Agora não": a regra e o item pela nota, o título e a hora (não muda com uma linha nova acima). */
  key: string;
  itemId: string;
  text: string;
  /** O botão de aceitar: o texto e a mudança. O outro botão é sempre o "Agora não" (`dismissLabel`). */
  accept: { label: string; patch: SuggestPatch };
  dismissLabel: string;
}

/** Até quantos dias à frente um prazo sem aviso vira sugestão. */
export const DEADLINE_DAYS = 3;
/** A hora para onde vai a atrasada, e o limite da "reunião cedo". */
export const MOVE_TO_HOUR = 9;
export const EARLY_MEETING_HOUR = 10;

const DAY = 86_400_000;

/** O começo do item em ms, na hora local. O dia todo começa à meia-noite. */
export function startMs(start: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(start);
  if (!m) return Number.NaN;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
}

/** A hora como se fala: `9h`, `9h30` em português; `9 AM`, `9:30 AM` em inglês. */
export function spokenTime(ms: number, locale: Locale): string {
  const d = new Date(ms);
  const h = d.getHours();
  const min = d.getMinutes();
  if (locale === "en") {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${h}h${min ? String(min).padStart(2, "0") : ""}`;
}

/** A meia-noite do dia de `ms`, na hora local. */
export const dayOf = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Quantos dias de calendário de `from` a `to` (a troca do horário de verão não muda a conta). */
export const daysBetween = (from: number, to: number): number => Math.round((dayOf(to) - dayOf(from)) / DAY);

/** O dia como se fala: "hoje", "amanhã", "ontem", o dia da semana até 6 dias, depois "27/11" (ou "Nov 27"). */
export function spokenDay(ms: number, now: number, locale: Locale): string {
  const diff = daysBetween(now, ms);
  if (diff === 0) return translate(locale, "calendarKiwi.day.today");
  if (diff === 1) return translate(locale, "calendarKiwi.day.tomorrow");
  if (diff === -1) return translate(locale, "calendarKiwi.day.yesterday");
  const d = new Date(ms);
  if (Math.abs(diff) <= 6) {
    const name = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", { weekday: "long" }).format(d);
    // "segunda-feira" se fala "segunda".
    return locale === "en" ? name : name.replace(/-feira$/, "");
  }
  if (locale === "en") return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** O ISO local de um ms: `2026-11-27T09:00`, ou só a data no dia todo. */
export function isoLocal(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return allDay ? date : `${date}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const keyOf = (rule: SuggestRule, i: SuggestItem) => `${rule}|${i.source?.path ?? i.id}|${i.title}|${i.start}`;
const open = (i: SuggestItem) => !i.done && !i.readOnly;

/** Já passou: a hora, ou o dia inteiro no dia todo. */
function overdue(i: SuggestItem, now: number): boolean {
  const s = startMs(i.start);
  return i.allDay ? dayOf(s) < dayOf(now) : s < now;
}

/** O aviso que cabe no tempo que falta: na véspera com mais de um dia, 30 min antes com mais de 30 min, senão na hora. */
export function fittingNotify(i: SuggestItem, now: number): CalendarKiwiNotify {
  const left = startMs(i.start) - now;
  if (left > DAY) return "dayBefore";
  if (!i.allDay && left > 30 * 60_000) return "30m";
  return "atTime";
}

/** A sugestão da vez, ou `null`. `dismissed`: as chaves que a pessoa já respondeu com "Agora não". */
export function suggestion(items: readonly SuggestItem[], now: number, locale: Locale, dismissed: ReadonlySet<string> = new Set()): Suggestion | null {
  const byStart = [...items].filter((i) => Number.isFinite(startMs(i.start))).sort((a, b) => startMs(a.start) - startMs(b.start));
  const dismissLabel = translate(locale, "calendarKiwi.suggest.dismiss");
  const free = (rule: SuggestRule, i: SuggestItem) => !dismissed.has(keyOf(rule, i));

  // 1. Atrasada: a mais recente primeiro (a mais velha a pessoa já deixou de lado).
  const late = byStart.filter((i) => (i.kind === "task" || i.kind === "reminder") && open(i) && overdue(i, now) && free("overdue", i)).at(-1);
  if (late) {
    const tomorrow = dayOf(now) + DAY;
    const target = late.allDay ? tomorrow : new Date(tomorrow).setHours(MOVE_TO_HOUR, 0, 0, 0);
    return {
      rule: "overdue",
      key: keyOf("overdue", late),
      itemId: late.id,
      text: translate(locale, "calendarKiwi.suggest.overdue", {
        title: late.title,
        day: spokenDay(startMs(late.start), now, locale),
        time: spokenTime(new Date(tomorrow).setHours(MOVE_TO_HOUR, 0, 0, 0), locale),
      }),
      accept: { label: translate(locale, "calendarKiwi.suggest.move"), patch: { start: isoLocal(target, late.allDay) } },
      dismissLabel,
    };
  }

  // 2. Prazo sem aviso nos próximos dias.
  const deadline = byStart.find(
    (i) => i.kind === "task" && open(i) && i.notify === "none" && !overdue(i, now) && daysBetween(now, startMs(i.start)) <= DEADLINE_DAYS && free("deadline", i),
  );
  if (deadline) {
    const s = startMs(deadline.start);
    const day = spokenDay(s, now, locale);
    return {
      rule: "deadline",
      key: keyOf("deadline", deadline),
      itemId: deadline.id,
      text: deadline.allDay
        ? translate(locale, "calendarKiwi.suggest.deadlineDay", { title: deadline.title, day })
        : translate(locale, "calendarKiwi.suggest.deadline", { title: deadline.title, day, time: spokenTime(s, locale) }),
      accept: { label: translate(locale, "calendarKiwi.suggest.remind"), patch: { notify: fittingNotify(deadline, now) } },
      dismissLabel,
    };
  }

  // 3. Reunião amanhã cedo, com aviso curto ou nenhum.
  const early = byStart.find((i) => {
    if (i.kind !== "meeting" || i.allDay || !open(i) || !free("meetingTomorrow", i)) return false;
    const s = startMs(i.start);
    return daysBetween(now, s) === 1 && new Date(s).getHours() < EARLY_MEETING_HOUR && (i.notify === "none" || i.notify === "atTime" || i.notify === "10m");
  });
  if (early) {
    return {
      rule: "meetingTomorrow",
      key: keyOf("meetingTomorrow", early),
      itemId: early.id,
      text: translate(locale, "calendarKiwi.suggest.meetingTomorrow", { title: early.title, time: spokenTime(startMs(early.start), locale) }),
      accept: { label: translate(locale, "calendarKiwi.suggest.notify30"), patch: { notify: "30m" } },
      dismissLabel,
    };
  }
  return null;
}
