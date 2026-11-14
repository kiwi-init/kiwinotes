// Os textos da parte "Rotinas" (spec #12150).

import { expect, test } from "bun:test";

import { lastRunLine, routineHint, scheduleLine, timeOptions } from "./routinesText.ts";

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
