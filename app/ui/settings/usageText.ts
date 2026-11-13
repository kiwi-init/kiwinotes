// Os textos do medidor (spec #11084, T11114), separados da tela para os testes lerem cada estado sem navegador. Nada em
// dinheiro: só tokens, pedidos e a % que o próprio agente informa.

import type { AgentUsageSum, AgentUsageView } from "../../src/shared/ui-contract.ts";

/** "1,2 mil tokens", "3,4 mi tokens". */
export function tokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return n < 1_000_000 ? `${fmt(n / 1000)} mil tokens` : `${fmt(n / 1_000_000)} mi tokens`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Uma soma: "3 pedidos · 12 mil tokens · 40% lidos do cache". */
export function sumLine(s: AgentUsageSum): string {
  if (!s.requests) return "Nenhum pedido.";
  const cache = s.tokens ? Math.round((s.cacheRead / s.tokens) * 100) : 0;
  return `${plural(s.requests, "pedido", "pedidos")} · ${tokens(s.tokens)}${cache ? ` · ${cache}% lidos do cache` : ""}`;
}

/** A hora, como a pessoa lê: "18h40", ou "amanhã às 9h00" / "seg, 18/11 às 9h00" quando não é hoje. */
export function clock(iso: string, now: number): string {
  const d = new Date(iso);
  const hm = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return hm;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return `amanhã às ${hm}`;
  const day = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  return `${day} às ${hm}`;
}

/** "às 18h40" hoje; "amanhã às 9h00" ou "seg, 18/11 às 9h00" nos outros dias. */
export function at(iso: string, now: number): string {
  const c = clock(iso, now);
  return /^\d/.test(c) ? `às ${c}` : c;
}

/** O limite acabado: com a hora de volta só quando o agente informou. */
export function outLine(out: AgentUsageView["out"], now: number): string | null {
  if (!out) return null;
  return out.resetsAt ? `O limite acabou. Ele volta ${at(out.resetsAt, now)}.` : "O limite acabou. O agente não disse quando ele volta.";
}

const WINDOWS: Record<string, string> = { five_hour: "da janela de 5 horas", seven_day: "da semana", seven_day_opus: "da semana no Opus", seven_day_sonnet: "da semana no Sonnet" };

/** O último uso da janela que o agente informou no meio de um pedido. */
export function limitLine(limit: AgentUsageView["limit"], now: number): string | null {
  if (!limit || limit.percent === undefined) return null;
  const which = (limit.window && WINDOWS[limit.window]) ?? "da janela";
  return `O agente informou ${limit.percent}% ${which} usados (às ${clock(limit.at, now)}).`;
}

/** A assinatura, pelo `/usage`: "5 horas: 37%, volta às 18h40 · Semana: 12%, volta seg, 18/11 às 9h00". */
export function subscriptionLine(sub: AgentUsageView["subscription"], now: number): string {
  if (!sub) return "Toque em Atualizar para ver o uso da sua assinatura.";
  if (sub.unavailable || (!sub.fiveHour && !sub.week)) return "O agente não informou o uso da assinatura. O medidor mostra só o gasto do Kiwi.";
  const part = (label: string, w?: { percent: number; resetsAt?: string }) => {
    if (!w) return null;
    return w.resetsAt ? `${label}: ${w.percent}%, volta ${at(w.resetsAt, now)}` : `${label}: ${w.percent}%`;
  };
  return [part("5 horas", sub.fiveHour), part("Semana", sub.week)].filter(Boolean).join(" · ");
}

/** O que o balão diz no aviso do agente e no limite acabado (spec #11084). */
export function limitBubble(status: "warning" | "out", percent: number | undefined, resetsAt: string | undefined, now: number): string {
  if (status === "warning") return percent !== undefined ? `Você já usou ${percent}% do seu limite. Eu sigo, mas vale ir com calma.` : "Você está perto do seu limite. Eu sigo, mas vale ir com calma.";
  return resetsAt ? `O seu limite acabou. Ele volta ${at(resetsAt, now)}.` : "O seu limite acabou.";
}

export const SUBAGENT_NOTE = "É o gasto que o agente informa de cada pedido do Kiwi. O de um subagente do Claude Code pode ficar de fora.";
