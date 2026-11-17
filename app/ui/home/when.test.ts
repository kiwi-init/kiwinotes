// As datas das telas Pendências e Semana (T15875), no dia local de quem roda.
import { expect, test } from "bun:test";

import { summary } from "./Pendencias.tsx";
import { dayLabel, hours, thousands, weekRange } from "./when.ts";

test("o rótulo do dia e o intervalo da semana", () => {
  expect(dayLabel("2026-11-17", 0)).toBe("Hoje");
  expect(dayLabel("2026-11-16", 1)).toBe("Ontem");
  expect(dayLabel("2026-11-13", 4)).toBe("sex 13");
  expect(weekRange("2026-11-11", "2026-11-17")).toBe("De 11 a 17 de novembro");
  expect(weekRange("2026-10-28", "2026-11-03")).toBe("De 28 de outubro a 3 de novembro");
  expect(weekRange("2026-12-28", "2027-01-03")).toBe("De 28 de dezembro de 2026 a 3 de janeiro de 2027");
});

test("horas, milhar e o resumo das pendências", () => {
  expect(hours(42)).toBe("42 min");
  expect(hours(192)).toBe("3 h 12");
  expect(hours(120)).toBe("2 h");
  expect(thousands(2140)).toBe("2 140");
  expect(summary({ meeting: 0, note: 0 })).toBe("Nada em aberto.");
  expect(summary({ meeting: 1, note: 0 })).toBe("1 aberta · 1 das reuniões, 0 das notas");
  expect(summary({ meeting: 3, note: 4 })).toBe("7 abertas · 3 das reuniões, 4 das notas");
});
