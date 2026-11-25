// Os textos do medidor (spec #11084, T11114), separados da tela para os testes lerem cada estado sem navegador. Nada em
// dinheiro: só tokens, pedidos e a % que o próprio agente informa. Cada função leva a língua no fim (T29271): sem ela, o
// português de sempre.

import { formatNumber, formatTime, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import type { AgentUsageSum, AgentUsageView } from "../../src/shared/ui-contract.ts";

const fmt = (v: number, locale: Locale) => formatNumber(locale, v, { maximumFractionDigits: 1 });

/** "1,2 mil tokens", "3,4 mi tokens" (em inglês, "1.2K tokens"). */
export function tokens(n: number, locale: Locale = "pt"): string {
  if (n < 1000) return translate(locale, "agent.usage.tokens", { n: String(n) });
  return n < 1_000_000
    ? translate(locale, "agent.usage.tokensK", { n: fmt(n / 1000, locale) })
    : translate(locale, "agent.usage.tokensM", { n: fmt(n / 1_000_000, locale) });
}

/** Uma soma: "3 pedidos, 12 mil tokens, 40% lidos do cache." Sem o ponto do meio (spec #12626): é uma frase. */
export function sumLine(s: AgentUsageSum, locale: Locale = "pt"): string {
  if (!s.requests) return translate(locale, "agent.usage.none");
  const cache = s.tokens ? Math.round((s.cacheRead / s.tokens) * 100) : 0;
  const parts = [translate(locale, "agent.usage.requests", { n: s.requests }), tokens(s.tokens, locale)];
  if (cache) parts.push(translate(locale, "agent.usage.cache", { pct: cache }));
  return `${parts.join(", ")}.`;
}

/** A hora sozinha: "18h40" em português, "6:40 PM" em inglês. */
const hourMinute = (d: Date, locale: Locale) =>
  locale === "pt" ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}` : formatTime(locale, d);

/** A hora, como a pessoa lê: "18h40", ou "amanhã às 9h00" / "seg, 18/11 às 9h00" quando não é hoje. */
export function clock(iso: string, now: number, locale: Locale = "pt"): string {
  const d = new Date(iso);
  const time = hourMinute(d, locale);
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return translate(locale, "agent.usage.tomorrow", { time });
  const day = d.toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  return translate(locale, "agent.usage.dayAt", { day, time });
}

/** "às 18h40" hoje; "amanhã às 9h00" ou "seg, 18/11 às 9h00" nos outros dias. */
export function at(iso: string, now: number, locale: Locale = "pt"): string {
  const d = new Date(iso);
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? translate(locale, "agent.usage.at", { time: hourMinute(d, locale) }) : clock(iso, now, locale);
}

/** O limite acabado: com a hora de volta só quando o agente informou. */
export function outLine(out: AgentUsageView["out"], now: number, locale: Locale = "pt"): string | null {
  if (!out) return null;
  return out.resetsAt
    ? translate(locale, "agent.usage.out", { when: at(out.resetsAt, now, locale) })
    : translate(locale, "agent.usage.outUnknown");
}

const WINDOWS: Record<string, TextKey> = {
  five_hour: "agent.usage.window.five_hour",
  seven_day: "agent.usage.window.seven_day",
  seven_day_opus: "agent.usage.window.seven_day_opus",
  seven_day_sonnet: "agent.usage.window.seven_day_sonnet",
};

/** O último uso da janela que o agente informou no meio de um pedido. */
export function limitLine(limit: AgentUsageView["limit"], now: number, locale: Locale = "pt"): string | null {
  if (!limit || limit.percent === undefined) return null;
  const which = translate(locale, (limit.window && WINDOWS[limit.window]) || "agent.usage.window.any");
  const when = translate(locale, "agent.usage.at", { time: clock(limit.at, now, locale) });
  return translate(locale, "agent.usage.limit", { pct: limit.percent, which, when });
}

/** A assinatura, pelo `/usage`: "5 horas: 37%, volta às 18h40. Semana: 12%, volta seg, 18/11 às 9h00." (spec #12626: frases, sem o ponto do meio). */
export function subscriptionLine(sub: AgentUsageView["subscription"], now: number, locale: Locale = "pt"): string {
  if (!sub) return translate(locale, "agent.usage.sub.tap");
  if (sub.unavailable || (!sub.fiveHour && !sub.week)) return translate(locale, "agent.usage.sub.unavailable");
  const part = (label: TextKey, w?: { percent: number; resetsAt?: string }) => {
    if (!w) return null;
    const l = translate(locale, label);
    return w.resetsAt
      ? translate(locale, "agent.usage.sub.partBack", { label: l, pct: w.percent, when: at(w.resetsAt, now, locale) })
      : translate(locale, "agent.usage.sub.part", { label: l, pct: w.percent });
  };
  return [part("agent.usage.sub.fiveHour", sub.fiveHour), part("agent.usage.sub.week", sub.week)].filter(Boolean).join(". ") + ".";
}

/** O que o balão diz no aviso do agente e no limite acabado (spec #11084). */
export function limitBubble(status: "warning" | "out", percent: number | undefined, resetsAt: string | undefined, now: number, locale: Locale = "pt"): string {
  if (status === "warning")
    return percent !== undefined ? translate(locale, "agent.usage.bubble.warning", { pct: percent }) : translate(locale, "agent.usage.bubble.near");
  return resetsAt ? translate(locale, "agent.usage.bubble.outBack", { when: at(resetsAt, now, locale) }) : translate(locale, "agent.usage.bubble.out");
}

/** A nota do subagente, embaixo da semana. */
export const subagentNote = (locale: Locale = "pt") => translate(locale, "agent.usage.subagent");
export const SUBAGENT_NOTE = subagentNote();
