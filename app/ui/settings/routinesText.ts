// Os textos da parte "Rotinas" em Ajustes › Agente (spec #12150, T12191). Puros, para o teste.

import type { AgentRoutine, CustomRoutine, RoutineDays, RoutineKind } from "../../src/shared/ui-contract.ts";

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

// As rotinas novas (spec #12944).

/** Os dois caminhos, embaixo do título (spec #12944): o botão e o pedido ao gato. */
export const ROUTINES_PATHS = "Crie uma rotina pelo botão Nova rotina, ou peça ao Kiwi Cat, por exemplo: “todo dia às 18h, faz um resumo das reuniões”. Ele propõe, e você cria.";
export const NEW_ROUTINE = "Nova rotina";
export const EDIT_ROUTINE = "Editar a rotina";
export const ADJUST_ROUTINE = "Ajustar a rotina que o Kiwi Cat propôs";
export const ROUTINE_NAME_LABEL = "Nome";
export const ROUTINE_PROMPT_LABEL = "O que o agente faz";
export const ROUTINE_PROMPT_PLACEHOLDER = "Ex.: faz um resumo das reuniões do dia, com as decisões e os próximos passos.";
export const ROUTINE_CREATED_OFF = "Ela entra desligada: ligue quando quiser.";

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** A escolha dos dias no cartão: todo dia, os dias úteis, ou os dias marcados. */
export type DaysChoice = "every" | "weekdays" | "chosen";
export const DAYS_OPTIONS: { value: DaysChoice; label: string }[] = [
  { value: "every", label: "Todo dia" },
  { value: "weekdays", label: "Dias úteis (seg. a sex.)" },
  { value: "chosen", label: "Escolher os dias" },
];
export const daysChoice = (d: RoutineDays): DaysChoice => (Array.isArray(d) ? "chosen" : d);

/** Quando uma rotina nova roda, numa frase: "Todo dia às 18:00", "Dias úteis às 09:00", "Toda quarta às 08:30", "Seg, qua e sex às 08:30". */
export function customScheduleLine(r: Pick<CustomRoutine, "time" | "days">): string {
  if (r.days === "every") return `Todo dia às ${r.time}`;
  if (r.days === "weekdays") return `Dias úteis às ${r.time}`;
  if (r.days.length === 1) return scheduleLine("weekly", { time: r.time, weekday: r.days[0]! });
  if (r.days.length === 7) return `Todo dia às ${r.time}`;
  const names = r.days.map((d) => WEEKDAY_SHORT[d]!.toLowerCase());
  const list = `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} às ${r.time}`;
}

/** A linha de uma rotina nova: o pedido, e o aviso do gasto (e do modo econômico). */
export function customHint(r: Pick<CustomRoutine, "prompt" | "folder">, economy: boolean): string {
  return `${r.prompt} A nota vai para ${r.folder}. Gasta um pedido do seu plano a cada vez.${economy ? " Com o modo econômico, o Kiwi pergunta antes." : ""}`;
}
