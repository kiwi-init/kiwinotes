// O pedido de agenda lido pelo Kiwi (spec #34706, T34753): "me lembra às 10h e me avisa 50 min antes" é **um** item às
// 10:00 com o aviso de 50 min, nunca um item das 9:10 às 10:00. O Kiwi lê, sem modelo, a hora, o dia e a antecedência do
// texto do pedido, e manda uma linha curta junto com o cartão do agendar: o agente não precisa fazer a conta, e não
// confunde o aviso com o começo ou o fim.
//
// Só o que o texto diz com certeza: sem hora nem aviso no pedido, a linha não vai. O dia sem hora fica de fora (o
// agente decide), e a hora sem dia é a próxima: hoje, se ainda não passou, senão amanhã.

import { addDays, type CalendarNotify, dayOf, notifyOfMinutes, NOTIFY_MAX_MINUTES } from "./calendar.ts";

export interface CalendarAsk {
  /** `AAAA-MM-DDTHH:MM`, ou `AAAA-MM-DD` sem hora no pedido. `null` sem hora nem dia. */
  start: string | null;
  notify: CalendarNotify | null;
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

const NUM: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, meia: 0.5, an: 1, a: 1, one: 1, two: 2, three: 3, half: 0.5 };
const NUM_WORD = Object.keys(NUM).join("|");

/** A antecedência: "50 min antes", "meia hora antes", "2 horas antes", "um dia antes", "na véspera", "na hora". */
function leadOf(t: string): { notify: CalendarNotify; at: [number, number] } | null {
  const lead = new RegExp(`\\b(\\d{1,4}|${NUM_WORD})\\s*(min(?:uto|ute)?s?|h(?:ora)?s?|hours?|dias?|days?)(\\s+e\\s+meia|\\s+and a half)?\\s+(?:de\\s+)?(?:antes|antecedencia|before|earlier|ahead)\\b`).exec(t);
  if (lead) {
    const n = /^\d/.test(lead[1]!) ? Number(lead[1]) : NUM[lead[1]!]!;
    const unit = lead[2]![0] === "m" ? 1 : lead[2]![0] === "h" ? 60 : 24 * 60;
    const half = lead[3] ? (unit === 60 ? 30 : unit === 1 ? 0.5 : 12 * 60) : 0;
    const min = Math.round(n * unit + half);
    if (min > 0 && min <= NOTIFY_MAX_MINUTES) return { notify: notifyOfMinutes(min), at: [lead.index, lead.index + lead[0].length] };
  }
  const named = /\b(na vespera|no dia anterior|the day before|na hora( (exata|certa|marcada))?|on time|at the time|sem aviso|nao (precisa|precisas|quero) (de )?avis\w*|no reminder)\b/.exec(t);
  if (!named) return null;
  const w = named[1]!;
  const notify: CalendarNotify = /vespera|anterior|day before/.test(w) ? "dayBefore" : /sem aviso|nao|no reminder/.test(w) ? "none" : "atTime";
  return { notify, at: [named.index, named.index + named[0].length] };
}

/** A hora: "às 10h", "10h30", "10:30", "às 15", "meio-dia", "at 3pm", com "da tarde/da noite" depois das 12. */
function timeOf(t: string): { h: number; m: number } | null {
  if (/\bmeio[- ]dia\b|\bnoon\b/.test(t)) return { h: 12, m: 0 };
  if (/\bmeia[- ]noite\b|\bmidnight\b/.test(t)) return { h: 0, m: 0 };
  const re = /(?:\b(?:as|a|at|pelas|para as|pras)\s+)?\b(\d{1,2})(?:(?::|h)(\d{2})|\s*(h|horas?|hrs?|am|pm)\b(?:\s*(\d{2})\b)?)/g;
  const at = /\b(?:as|at|pelas|pras)\s+(\d{1,2})\b(?!\s*(?:min|dias?|days?|de\b|\/|-\d))/;
  for (const m of t.matchAll(re)) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? m[4] ?? 0);
    const suf = m[3] ?? "";
    if (h > 23 || min > 59) continue;
    if (suf === "pm" && h < 12) h += 12;
    if (suf === "am" && h === 12) h = 0;
    return { h: pm(t, h), m: min };
  }
  const bare = at.exec(t);
  if (bare && Number(bare[1]) <= 23) return { h: pm(t, Number(bare[1])), m: 0 };
  return null;
}

/** "da tarde", "da noite": a hora de 1 a 11 passa para depois do meio-dia. */
const pm = (t: string, h: number) => (h >= 1 && h < 12 && /\b(da tarde|a tarde|de tarde|da noite|a noite|de noite|in the (afternoon|evening)|tonight)\b/.test(t) ? h + 12 : h);

const WEEK = [/\bdomingo\b|\bsunday\b/, /\bsegunda\b|\bmonday\b/, /\bterca\b|\btuesday\b/, /\bquarta\b|\bwednesday\b/, /\bquinta\b|\bthursday\b/, /\bsexta\b|\bfriday\b/, /\bsabado\b|\bsaturday\b/];

/** O dia: hoje, amanhã, depois de amanhã, um dia da semana (o próximo), "dia 5" (o próximo dia 5). */
function dayIn(t: string, now: Date): string | null {
  const today = dayOf(now.getTime());
  if (/\bdepois de amanha\b|\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\bamanha\b|\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\bhoje\b|\btoday\b|\btonight\b|\bhoje a noite\b/.test(t)) return today;
  for (let wd = 0; wd < 7; wd++) {
    if (!WEEK[wd]!.test(t)) continue;
    const ahead = (wd - now.getDay() + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  const dia = /\bdia (\d{1,2})\b/.exec(t);
  if (dia) {
    const n = Number(dia[1]);
    if (n < 1 || n > 31) return null;
    for (let k = 0; k < 2; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() + k, n, 12);
      if (d.getDate() === n && dayOf(d.getTime()) >= today) return dayOf(d.getTime());
    }
  }
  return null;
}

/** Daqui a um tempo: "em 2 horas", "daqui a 20 min", "in 2 hours". A hora certa, contada de agora. */
function relativeOf(t: string, now: Date): { start: string; at: [number, number] } | null {
  const m = new RegExp(`\\b(?:em|daqui a|daqui|dentro de|in)\\s+(\\d{1,4}|${NUM_WORD})\\s*(min(?:uto|ute)?s?|h(?:ora)?s?|hours?)(\\s+e\\s+meia|\\s+and a half)?\\b`).exec(t);
  if (!m) return null;
  const n = /^\d/.test(m[1]!) ? Number(m[1]) : NUM[m[1]!]!;
  const unit = m[2]![0] === "m" ? 1 : 60;
  const min = Math.round(n * unit + (m[3] ? unit / 2 : 0));
  if (min <= 0 || min > 7 * 24 * 60) return null;
  const at = new Date(now.getTime() + min * 60_000);
  const start = `${dayOf(at.getTime())}T${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return { start, at: [m.index, m.index + m[0].length] };
}

const cut = (t: string, at: [number, number]) => `${t.slice(0, at[0])} ${t.slice(at[1])}`;

/**
 * A duração não é hora (#34842): "reunião de 1 hora", "foco de 2 horas", "por 30 min", "a 2 hour meeting", "2-hour
 * block". Sai do texto antes da hora, como a antecedência. "das 9h às 10h" fica (é o começo e o fim).
 */
function withoutDuration(t: string): string {
  // Com "por", "durante" e "for", o "2h" e o "2 horas" são sempre a duração. Com "de" sozinho, só a unidade por
  // extenso ("reunião de 9h" é a hora). Com "de N … às M", é o intervalo só quando é plausível (#34969): o começo
  // N entre 6 e 23 e o fim M depois dele ("de 9h às 10h", "de 9 horas às 10 horas"). Fora disso ("de 2 horas às 10
  // horas", "de 1h às 14h", "de 30 minutos às 16h", "de uma hora e meia às 15h"), o "de N" é a duração.
  const n = `(\\d{1,3}|${NUM_WORD})`;
  const half = `(\\s+e\\s+meia|\\s+and a half)?\\b`;
  const de = new RegExp(`\\bde\\s+${n}\\s*(hs?|hrs?|horas?|hours?|min(?:uto|ute)?s?)${half}(?=(\\s*(?:as|a|ate|-)\\s*(\\d{1,2})(?!\\d))?)`, "g");
  const por = new RegExp(`\\b(?:por|durante|for)\\s+${n}\\s*(?:h|hs|hrs?|horas?|hours?|min(?:uto|ute)?s?)${half}`, "g");
  const en = new RegExp(`\\b(?:\\d{1,3}|${NUM_WORD})[- ]?(?:hours?|hrs?|minutes?|mins?)(?:\\s+and a half)?(?=\\s+(?:long\\s+)?(?:meeting|block|session|call|focus|slot|event)\\b)`, "g");
  const deCut = (all: string, num: string, unit: string, halfOf: string | undefined, to: string | undefined, end: string | undefined) => {
    const compact = /^(hs?|hrs?)$/.test(unit);
    if (to === undefined) return compact ? all : " ";
    if (unit[0] === "m" || halfOf) return " ";
    const from = /^\d/.test(num) ? Number(num) : NUM[num]!;
    return from >= 6 && from <= 23 && pm(t, Number(end)) > from ? all : " ";
  };
  return t.replace(de, deCut).replace(por, " ").replace(en, " ");
}

/** O que o pedido diz de hora, dia e aviso; os dois `null` quando não diz nada disso. */
export function readCalendarAsk(request: string, now: Date): CalendarAsk {
  const t = fold(request);
  const lead = leadOf(t);
  // A antecedência e a duração saem do texto antes da hora: "2 h antes" e "de 1 hora" não são uma hora.
  const rest = withoutDuration(lead ? cut(t, lead.at) : t);
  const rel = relativeOf(rest, now);
  if (rel) return { start: rel.start, notify: lead?.notify ?? null };
  const time = timeOf(rest);
  const day = dayIn(rest, now);
  let start: string | null = null;
  if (time) {
    const hhmm = `${String(time.h).padStart(2, "0")}:${String(time.m).padStart(2, "0")}`;
    const today = dayOf(now.getTime());
    const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    start = `${day ?? (hhmm > nowHm ? today : addDays(today, 1))}T${hhmm}`;
  } else if (day) start = day;
  return { start, notify: lead?.notify ?? null };
}

/** A linha que vai com o cartão do agendar; "" quando o pedido não diz hora, dia nem aviso. */
export function calendarHint(request: string, now: Date): string {
  const { start, notify } = readCalendarAsk(request, now);
  if (!start && !notify) return "";
  const parts = [start ? `inicio ${start}` : "", notify ? `aviso ${notify}` : ""].filter(Boolean).join(", ");
  return `[Kiwi leu no pedido: ${parts}. Um item só; o aviso não é o começo nem o fim.]`;
}
