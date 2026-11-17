// Os textos do balão das rotinas (spec #12150).

import { expect, test } from "bun:test";

import { noteName, routineLine } from "./routineText.ts";

test("pronto: o nome da rotina e o da nota; sem nota, aponta a Atividade", () => {
  expect(routineLine({ kind: "daily", phase: "done", request: "r1", note: "Rotinas/Resumo de 16-11-2026.md", change: 1 })).toBe("O resumo do dia está pronto: Resumo de 16-11-2026.");
  expect(routineLine({ kind: "weekly", phase: "done", request: "r2", note: null, change: null })).toBe("Os pendentes da semana terminaram, mas o agente não criou a nota. A resposta está na Atividade.");
  expect(routineLine({ kind: "weekly", phase: "done", request: "r3", note: "Rotinas/Pendentes da semana de 23-11-2026.md", change: 1 })).toBe("Os pendentes da semana estão prontos: Pendentes da semana de 23-11-2026.");
  expect(noteName("A/B/Pendentes da semana de 23-11-2026.md")).toBe("Pendentes da semana de 23-11-2026");
});

test("o limite: avisa, com a hora de volta quando ela veio; o 'Agora não' não precisa de balão", () => {
  const back = new Date(2026, 10, 16, 21, 5).toISOString();
  expect(routineLine({ kind: "daily", phase: "skipped", reason: "limit", resetsAt: back })).toBe("O resumo do dia não rodou: o limite do seu plano acabou e volta às 21:05. Ele roda de novo no próximo horário.");
  expect(routineLine({ kind: "weekly", phase: "skipped", reason: "limit" })).toBe("Os pendentes da semana não rodaram: o limite do seu plano acabou. Eles rodam de novo no próximo horário.");
  expect(routineLine({ kind: "daily", phase: "skipped", reason: "declined" })).toBeNull();
});

test("uma rotina nova (spec #12944) diz o nome dela, no feminino", () => {
  const who = { kind: "custom", id: "r-abcd1234", name: "Resumo das reuniões" } as const;
  expect(routineLine({ ...who, phase: "done", request: "q", note: "Rotinas/Resumo das reuniões de 16-11-2026.md", change: 1 })).toBe(
    "A rotina “Resumo das reuniões” está pronta: Resumo das reuniões de 16-11-2026.",
  );
  expect(routineLine({ ...who, phase: "skipped", reason: "limit" })).toBe("A rotina “Resumo das reuniões” não rodou: o limite do seu plano acabou. Ela roda de novo no próximo horário.");
  expect(routineLine({ ...who, phase: "skipped", reason: "declined" })).toBeNull();
});
