// Os textos da parte "Rotinas" em Ajustes › Agente (spec #12150, T12191). Puros, para o teste.

import type { AgentRoutine, RoutineKind } from "../../src/shared/ui-contract.ts";

export const ROUTINES_TITLE = "Rotinas";
export const ROUTINES_HINT = "O agente faz sozinho, na hora marcada, só o que você ligar. Cada vez gasta um pedido do seu plano.";

export const ROUTINE_TITLES: Record<RoutineKind, string> = { daily: "O resumo do dia", weekly: "Os pendentes da semana" };

/** O que cada rotina faz, e o aviso do modo econômico quando ele está ligado. */
export function routineHint(kind: RoutineKind, economy: boolean): string {
  const what =
    kind === "daily"
      ? "Uma nota com o que mudou nas notas e nas reuniões do dia, as decisões e os próximos passos, no Modelo de nota."
      : "Uma nota com as ações em aberto das notas e das reuniões, por projeto, com o link de onde cada uma veio.";
  return `${what} Gasta um pedido do seu plano a cada vez.${economy ? " Com o modo econômico, o Kiwi pergunta antes." : ""}`;
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label }));

/** As horas da lista, de meia em meia hora, e a de agora se ela não cair numa delas. */
export function timeOptions(current: string): { value: string; label: string }[] {
  const all = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  if (!all.includes(current)) all.push(current);
  return all.sort().map((t) => ({ value: t, label: t }));
}

const two = (n: number) => String(n).padStart(2, "0");

/** A última vez que rodou, pelo relógio do Mac: hoje, ontem ou a data. */
export function lastRunLine(r: Pick<AgentRoutine, "lastRun">, now: Date): string {
  if (!r.lastRun) return "Ainda não rodou.";
  const d = new Date(r.lastRun);
  const hour = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day(d) === day(now)) return `Rodou hoje às ${hour}.`;
  if (day(d) === day(yesterday)) return `Rodou ontem às ${hour}.`;
  return `Rodou em ${two(d.getDate())}/${two(d.getMonth() + 1)} às ${hour}.`;
}

/** Quando ela roda, numa frase: "Todo dia às 18:00" ou "Toda segunda às 09:00". */
export function scheduleLine(kind: RoutineKind, r: Pick<AgentRoutine, "time" | "weekday">): string {
  if (kind === "daily") return `Todo dia às ${r.time}`;
  const day = WEEKDAYS[r.weekday ?? 1]!.toLowerCase();
  return `${r.weekday === 0 || r.weekday === 6 ? "Todo" : "Toda"} ${day} às ${r.time}`;
}
