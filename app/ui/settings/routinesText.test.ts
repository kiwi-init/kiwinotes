// Os textos da parte "Rotinas" (spec #12150).

import { expect, test } from "bun:test";

import { lastRunLine, routineHint, scheduleLine, timeOptions, customScheduleLine, ROUTINES_PATHS } from "./routinesText.ts";
import { proposalLine } from "./proposalText.ts";
import type { AgentProposalSummary } from "../../src/shared/ui-contract.ts";

test("a última vez: ainda não, hoje, ontem ou a data", () => {
  const now = new Date(2026, 10, 16, 20, 0);
  expect(lastRunLine({ lastRun: null }, now)).toBe("Ainda não rodou.");
  expect(lastRunLine({ lastRun: new Date(2026, 10, 16, 18, 0).toISOString() }, now)).toBe("Rodou hoje às 18:00.");
  expect(lastRunLine({ lastRun: new Date(2026, 10, 15, 18, 5).toISOString() }, now)).toBe("Rodou ontem às 18:05.");
  expect(lastRunLine({ lastRun: new Date(2026, 10, 9, 9, 0).toISOString() }, now)).toBe("Rodou em 09/11 às 09:00.");
});

test("quando roda, numa frase, com o gênero do dia", () => {
  expect(scheduleLine("daily", { time: "18:00" })).toBe("Todo dia às 18:00");
  expect(scheduleLine("weekly", { time: "09:00", weekday: 1 })).toBe("Toda segunda às 09:00");
  expect(scheduleLine("weekly", { time: "10:30", weekday: 6 })).toBe("Todo sábado às 10:30");
});

test("as horas de meia em meia, com a de agora quando ela é outra", () => {
  expect(timeOptions("18:00")).toHaveLength(48);
  const odd = timeOptions("07:45").map((o) => o.value);
  expect(odd).toHaveLength(49);
  expect(odd.indexOf("07:45")).toBe(odd.indexOf("07:30") + 1);
});

test("o aviso do gasto, e do modo econômico só quando ele está ligado", () => {
  expect(routineHint("daily", false)).toContain("Gasta um pedido do seu plano a cada vez.");
  expect(routineHint("daily", false)).not.toContain("modo econômico");
  expect(routineHint("weekly", true)).toEndWith("Com o modo econômico, o Kiwi pergunta antes.");
});

// As rotinas novas (spec #12944).
test("quando uma rotina nova roda: todo dia, dias úteis, um dia ou a lista", () => {
  expect(customScheduleLine({ time: "18:00", days: "every" })).toBe("Todo dia às 18:00");
  expect(customScheduleLine({ time: "09:00", days: "weekdays" })).toBe("Dias úteis às 09:00");
  expect(customScheduleLine({ time: "08:30", days: [3] })).toBe("Toda quarta às 08:30");
  expect(customScheduleLine({ time: "08:30", days: [6] })).toBe("Todo sábado às 08:30");
  expect(customScheduleLine({ time: "08:30", days: [1, 3, 5] })).toBe("Seg, qua e sex às 08:30");
  expect(customScheduleLine({ time: "08:30", days: [0, 1, 2, 3, 4, 5, 6] })).toBe("Todo dia às 08:30");
  expect(ROUTINES_PATHS).toContain("Nova rotina");
  expect(ROUTINES_PATHS).toContain("Kiwi Cat");
});

test("a proposta de rotina no balão: o nome, quando roda, e que entra desligada", () => {
  const p: AgentProposalSummary = { id: "p", at: "2026-11-16T13:00:00.000Z", status: "pending", kind: "routine", meeting: null, project: null, candidates: [], theme: "Resumo das reuniões", note: null };
  const routine = { name: "Resumo das reuniões", prompt: "Faz um resumo.", time: "18:00", days: "every" as const, folder: "Rotinas" };
  expect(proposalLine({ ...p, routine })).toBe("O Kiwi Cat propõe a rotina “Resumo das reuniões”: todo dia às 18:00. Ela entra desligada.");
  expect(proposalLine({ ...p, status: "applied", routine })).toBe("Pronto: a rotina “Resumo das reuniões” está em Ajustes › Agente › Rotinas, desligada. Ligue quando quiser.");
  expect(proposalLine({ ...p, status: "discarded", routine })).toBe("A rotina “Resumo das reuniões” foi descartada.");
});
