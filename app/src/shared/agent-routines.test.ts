// As rotinas do agente (spec #12150): os ajustes saneados e a regra de "está na hora", com datas no relógio local.

import { describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_ROUTINES, patchRoutines, routineDay, routineDue, routinesOff, sanitizeAgentRoutines, slotToday, type AgentRoutine } from "./agent-routines.ts";

/** 16/11/2026 é uma segunda-feira. */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const iso = (d: Date) => d.toISOString();
const daily = (o: Partial<AgentRoutine> = {}): AgentRoutine => ({ ...DEFAULT_AGENT_ROUTINES.daily, on: true, ...o });
const weekly = (o: Partial<AgentRoutine> = {}): AgentRoutine => ({ ...DEFAULT_AGENT_ROUTINES.weekly, on: true, ...o });

describe("os ajustes", () => {
  test("as duas nascem desligadas: o resumo às 18h e os pendentes na segunda às 9h", () => {
    const r = sanitizeAgentRoutines(undefined);
    expect(r).toEqual(DEFAULT_AGENT_ROUTINES);
    expect([r.daily.on, r.weekly.on]).toEqual([false, false]);
    expect([r.daily.time, r.weekly.time, r.weekly.weekday]).toEqual(["18:00", "09:00", 1]);
  });

  test("o saneamento recusa hora, dia, pasta e datas que não valem", () => {
    const r = sanitizeAgentRoutines({
      daily: { on: "sim", time: "25:00", folder: "../fora", lastRun: "ontem", weekday: 3 },
      weekly: { on: true, time: "07:30", weekday: 9, folder: " Resumos/Semana/ ", lastRun: "2026-11-16T12:00:00.000Z" },
    });
    expect(r.daily).toEqual({ on: false, time: "18:00", folder: "Rotinas", lastRun: null, armedAt: null });
    expect(r.weekly).toEqual({ on: true, time: "07:30", weekday: 1, folder: "Resumos/Semana", lastRun: "2026-11-16T12:00:00.000Z", armedAt: null });
  });

  test("ligar ou mudar a hora arma a rotina agora; a pasta não, e o lastRun nunca vem de fora", () => {
    const now = at(16, 19).getTime();
    const on = patchRoutines(DEFAULT_AGENT_ROUTINES, { daily: { on: true, lastRun: "2030-01-01T00:00:00.000Z" } }, now);
    expect(on.daily).toMatchObject({ on: true, lastRun: null, armedAt: new Date(now).toISOString() });
    expect(on.weekly).toEqual(DEFAULT_AGENT_ROUTINES.weekly);
    const folder = patchRoutines(on, { daily: { folder: "Diário/Resumos" } }, now + 60_000);
    expect(folder.daily).toMatchObject({ folder: "Diário/Resumos", armedAt: new Date(now).toISOString() });
    const time = patchRoutines(folder, { daily: { time: "20:00" } }, now + 120_000);
    expect(time.daily.armedAt).toBe(new Date(now + 120_000).toISOString());
    expect(routinesOff(time).daily.on).toBe(false);
  });
});

describe("está na hora", () => {
  test("o resumo do dia: só depois das 18h de hoje, e uma vez", () => {
    expect(routineDue("daily", daily(), at(16, 17, 59))).toBe(false);
    expect(routineDue("daily", daily(), at(16, 18))).toBe(true);
    expect(routineDue("daily", daily({ lastRun: iso(at(16, 18, 1)) }), at(16, 18, 30))).toBe(false);
    // Rodou ontem: hoje roda de novo.
    expect(routineDue("daily", daily({ lastRun: iso(at(15, 18, 1)) }), at(16, 18, 30))).toBe(true);
  });

  test("com o app fechado na hora, roda uma vez ao abrir no mesmo dia, e no dia seguinte pula", () => {
    const r = daily({ lastRun: iso(at(15, 18, 1)) });
    expect(routineDue("daily", r, at(16, 22, 40))).toBe(true);
    // Abriu só no dia 17 de manhã: o horário de ontem não conta, e o de hoje ainda não chegou.
    expect(routineDue("daily", r, at(17, 8))).toBe(false);
    expect(routineDue("daily", r, at(17, 18))).toBe(true);
  });

  test("ligar depois do horário de hoje não roda na hora", () => {
    expect(routineDue("daily", daily({ armedAt: iso(at(16, 19)) }), at(16, 19, 5))).toBe(false);
    expect(routineDue("daily", daily({ armedAt: iso(at(16, 19)) }), at(17, 18))).toBe(true);
    expect(routineDue("daily", daily({ armedAt: iso(at(16, 17)) }), at(16, 18))).toBe(true);
  });

  test("os pendentes da semana: só no dia da semana dela", () => {
    expect(slotToday("weekly", weekly(), at(17, 9))).toBeNull();
    expect(routineDue("weekly", weekly(), at(16, 8, 59))).toBe(false);
    expect(routineDue("weekly", weekly(), at(16, 9))).toBe(true);
    // Na terça, a de segunda já não roda.
    expect(routineDue("weekly", weekly(), at(17, 10))).toBe(false);
    expect(routineDue("weekly", weekly({ lastRun: iso(at(16, 9, 1)) }), at(16, 12))).toBe(false);
    expect(routineDue("weekly", weekly({ lastRun: iso(at(16, 9, 1)) }), at(23, 9))).toBe(true);
  });

  test("desligada nunca está na hora", () => {
    expect(routineDue("daily", { ...daily(), on: false }, at(16, 23))).toBe(false);
  });

  test("o dia da nota", () => {
    expect(routineDay(at(3, 18))).toBe("03/11/2026");
  });
});
