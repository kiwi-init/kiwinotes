// Os textos da parte "Rotinas" em Ajustes › Agente (spec #12150, T12191), pelo catálogo (`routines.*`, T29272). Puros,
// para o teste.

import { formatTime } from "../../src/shared/i18n/index.ts";
import type { TextKey } from "../../src/shared/i18n/index.ts";
import type { AgentRoutine, CustomRoutine, RoutineDays, RoutineKind } from "../../src/shared/ui-contract.ts";
import { appLocale, t } from "../src/i18n.ts";

export const routinesTitle = () => t("routines.title");
export const routinesHint = () => t("routines.hint");

export const routineTitle = (kind: RoutineKind) => t(kind === "daily" ? "routines.daily" : "routines.weekly");

/** O que cada rotina faz, e o aviso do modo econômico quando ele está ligado. */
export function routineHint(kind: RoutineKind, economy: boolean): string {
  const what = t(kind === "daily" ? "routines.daily.what" : "routines.weekly.what");
  return t("routines.cost", { what, economy: economy ? t("routines.economy") : "" });
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** O dia pelo nome inteiro ("Segunda" / "Monday"), de 0 (domingo) a 6. */
export const weekday = (d: number) => t(`routines.day.${d}` as TextKey);
/** O dia curto ("Seg" / "Mon"). */
export const weekdayShort = (d: number) => t(`routines.short.${d}` as TextKey);
export const weekdayOptions = () => DAYS.map((i) => ({ value: String(i), label: weekday(i) }));

/**
 * A hora "18:00" (como a rotina guarda) no costume da língua: "18:00" em português, "6:00 PM" em inglês. Uma hora que
 * não se lê fica como veio.
 */
export function clock(hhmm: string): string {
  const { locale } = appLocale();
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (locale === "pt" || !m) return hhmm;
  return formatTime(locale, new Date(2000, 0, 1, Number(m[1]), Number(m[2])));
}

/** As horas da lista, de meia em meia hora, e a de agora se ela não cair numa delas. */
export function timeOptions(current: string): { value: string; label: string }[] {
  const all = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  if (!all.includes(current)) all.push(current);
  return all.sort().map((v) => ({ value: v, label: clock(v) }));
}

const two = (n: number) => String(n).padStart(2, "0");

/** A última vez que rodou, pelo relógio do Mac: hoje, ontem ou a data ("09/11" / "11/9"). */
export function lastRunLine(r: Pick<AgentRoutine, "lastRun">, now: Date): string {
  if (!r.lastRun) return t("routines.never");
  const d = new Date(r.lastRun);
  const time = clock(`${two(d.getHours())}:${two(d.getMinutes())}`);
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day(d) === day(now)) return t("routines.ranToday", { time });
  if (day(d) === day(yesterday)) return t("routines.ranYesterday", { time });
  const date = appLocale().locale === "pt" ? `${two(d.getDate())}/${two(d.getMonth() + 1)}` : `${d.getMonth() + 1}/${d.getDate()}`;
  return t("routines.ranOn", { date, time });
}

/** Quando ela roda, numa frase: "Todo dia às 18:00" ou "Toda segunda às 09:00" (o gênero do dia vem no catálogo). */
export function scheduleLine(kind: RoutineKind, r: Pick<AgentRoutine, "time" | "weekday">): string {
  const when = kind === "daily" ? t("routines.everyDay") : t(`routines.every.${r.weekday ?? 1}` as TextKey);
  return t("routines.at", { when, time: clock(r.time) });
}

// As rotinas novas (spec #12944).

/** Os dois caminhos, embaixo do título (spec #12944): o botão e o pedido ao gato. */
export const routinesPaths = () => t("routines.paths");
export const newRoutine = () => t("routines.new");
export const editRoutine = () => t("routines.edit");
export const adjustRoutine = () => t("routines.adjust");
export const routineNameLabel = () => t("routines.name");
export const routinePromptLabel = () => t("routines.prompt");
export const routinePromptPlaceholder = () => t("routines.promptPlaceholder");
export const routineCreatedOff = () => t("routines.createdOff");

/** A escolha dos dias no cartão: todo dia, os dias úteis, ou os dias marcados. */
export type DaysChoice = "every" | "weekdays" | "chosen";
export const daysOptions = (): { value: DaysChoice; label: string }[] => [
  { value: "every", label: t("routines.days.every") },
  { value: "weekdays", label: t("routines.days.weekdays") },
  { value: "chosen", label: t("routines.days.chosen") },
];
export const daysChoice = (d: RoutineDays): DaysChoice => (Array.isArray(d) ? "chosen" : d);

/** Quando uma rotina nova roda, numa frase: "Todo dia às 18:00", "Dias úteis às 09:00", "Toda quarta às 08:30", "Seg, qua e sex às 08:30". */
export function customScheduleLine(r: Pick<CustomRoutine, "time" | "days">): string {
  const at = (when: string) => t("routines.at", { when, time: clock(r.time) });
  if (r.days === "every") return at(t("routines.everyDay"));
  if (r.days === "weekdays") return at(t("routines.weekdays"));
  if (r.days.length === 1) return scheduleLine("weekly", { time: r.time, weekday: r.days[0]! });
  if (r.days.length === 7) return at(t("routines.everyDay"));
  // Em português o dia vai em minúscula no meio da lista ("Seg, qua e sex"); em inglês, sempre com a maiúscula.
  const pt = appLocale().locale === "pt";
  const names = r.days.map((d) => (pt ? weekdayShort(d).toLowerCase() : weekdayShort(d)));
  const list = `${names.slice(0, -1).join(", ")}${t("routines.and")}${names.at(-1)}`;
  return at(`${list.charAt(0).toUpperCase()}${list.slice(1)}`);
}

/** A mesma frase no meio de outra ("…: todo dia às 18:00."): a primeira letra em minúscula, menos um dia em inglês. */
export function customScheduleMid(r: Pick<CustomRoutine, "time" | "days">): string {
  const line = customScheduleLine(r);
  const startsWithDay = appLocale().locale === "en" && Array.isArray(r.days) && r.days.length > 1 && r.days.length < 7;
  return startsWithDay ? line : line.replace(/^\p{L}/u, (c) => c.toLowerCase());
}

/** A linha de uma rotina nova: o pedido, e o aviso do gasto (e do modo econômico). */
export function customHint(r: Pick<CustomRoutine, "prompt" | "folder">, economy: boolean): string {
  return t("routines.customHint", { prompt: r.prompt, folder: r.folder, economy: economy ? t("routines.economy") : "" });
}
