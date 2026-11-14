// As rotinas do agente (spec #12150): os ajustes saneados e a regra de "está na hora", com datas no relógio local.

import { describe, expect, test } from "bun:test";

import {
  createRoutine,
  CUSTOM_ROUTINES_MAX,
  customRoutineInput,
  DEFAULT_AGENT_ROUTINES,
  deleteRoutine,
  dueRoutine,
  newRoutineId,
  patchRoutines,
  routineDay,
  routineDue,
  routinesOff,
  sanitizeAgentRoutines,
  slotToday,
  updateRoutine,
  type AgentRoutine,
  type CustomRoutineInput,
} from "./agent-routines.ts";

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

// As rotinas novas (spec #12944): criadas pela pessoa ou pela proposta do agente, com o nome, o pedido e os dias.
describe("as rotinas novas", () => {
  const input: CustomRoutineInput = { name: "Resumo das reuniões", prompt: "Faz um resumo das reuniões do dia.", time: "18:00", days: "every", folder: "Rotinas" };
  const NOW = at(16, 10).getTime();

  test("a nova entra desligada, com o id, e as prontas não mudam", () => {
    const r = createRoutine(DEFAULT_AGENT_ROUTINES, input, "r-abcd1234");
    expect(r.custom).toEqual([{ id: "r-abcd1234", ...input, on: false, lastRun: null, armedAt: null }]);
    expect([r.daily, r.weekly]).toEqual([DEFAULT_AGENT_ROUTINES.daily, DEFAULT_AGENT_ROUTINES.weekly]);
    // Sobrevive ao saneamento das settings.
    expect(sanitizeAgentRoutines(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  test("os campos: nome numa linha, pedido até o máximo, hora, dias e pasta; o que não vale diz o campo", () => {
    expect(customRoutineInput({ ...input, name: "  Resumo\n das   reuniões " })).toEqual({ ok: true, value: input });
    expect(customRoutineInput({ ...input, days: [5, 1, 1, 3] })).toEqual({ ok: true, value: { ...input, days: [1, 3, 5] } });
    expect(customRoutineInput({ ...input, name: " " })).toEqual({ ok: false, field: "name" });
    expect(customRoutineInput({ ...input, name: "x".repeat(61) })).toEqual({ ok: false, field: "name" });
    expect(customRoutineInput({ ...input, prompt: "x".repeat(1001) })).toEqual({ ok: false, field: "prompt" });
    expect(customRoutineInput({ ...input, time: "18h" })).toEqual({ ok: false, field: "time" });
    expect(customRoutineInput({ ...input, days: [] })).toEqual({ ok: false, field: "days" });
    expect(customRoutineInput({ ...input, days: [7] })).toEqual({ ok: false, field: "days" });
    expect(customRoutineInput({ ...input, folder: "../fora" })).toEqual({ ok: false, field: "folder" });
  });

  test("o saneamento tira a que não vale, o id repetido e as que passam do máximo", () => {
    const ok = { id: "r-00000001", ...input, on: true, lastRun: null, armedAt: null };
    const many = Array.from({ length: CUSTOM_ROUTINES_MAX + 3 }, (_, i) => ({ ...ok, id: `r-${String(i).padStart(8, "0")}` }));
    expect(sanitizeAgentRoutines({ custom: [ok, { ...ok, name: "" }, { ...ok, id: "x" }, ok] }).custom).toEqual([ok]);
    expect(sanitizeAgentRoutines({ custom: many }).custom).toHaveLength(CUSTOM_ROUTINES_MAX);
    expect(() => createRoutine(sanitizeAgentRoutines({ custom: many }), input, "r-zzzzzzzz")).toThrow(RangeError);
  });

  test("editar: ligar ou mudar a hora ou os dias arma de novo; o nome e o pedido não; apagar tira só ela", () => {
    const r = createRoutine(DEFAULT_AGENT_ROUTINES, input, "r-abcd1234");
    const on = updateRoutine(r, "r-abcd1234", { on: true }, NOW)!;
    expect(on.custom[0]).toMatchObject({ on: true, armedAt: iso(new Date(NOW)) });
    const renamed = updateRoutine(on, "r-abcd1234", { name: "Outro", prompt: "Outra coisa." }, NOW + 60_000)!;
    expect(renamed.custom[0]).toMatchObject({ name: "Outro", prompt: "Outra coisa.", armedAt: iso(new Date(NOW)) });
    expect(updateRoutine(renamed, "r-abcd1234", { days: "weekdays" }, NOW + 120_000)!.custom[0]!.armedAt).toBe(iso(new Date(NOW + 120_000)));
    expect(updateRoutine(r, "r-nao00000", { on: true }, NOW)).toBeNull();
    expect(deleteRoutine(on, "r-abcd1234")!.custom).toEqual([]);
    expect(deleteRoutine(on, "r-nao00000")).toBeNull();
    expect(routinesOff(on).custom[0]!.on).toBe(false);
  });

  test("os dias: todo dia, os dias úteis e os escolhidos; a hora certa, uma vez por dia", () => {
    const c = (days: CustomRoutineInput["days"], o: Partial<AgentRoutine> = {}) => ({ id: "r-abcd1234", ...input, days, on: true, lastRun: null, armedAt: null, ...o });
    // 16/11 é segunda; 21/11, sábado; 18/11, quarta.
    expect(routineDue("custom", c("every"), at(21, 18))).toBe(true);
    expect(routineDue("custom", c("weekdays"), at(21, 18))).toBe(false);
    expect(routineDue("custom", c("weekdays"), at(16, 18))).toBe(true);
    expect(routineDue("custom", c([3]), at(16, 18))).toBe(false);
    expect(routineDue("custom", c([3]), at(18, 18, 1))).toBe(true);
    expect(routineDue("custom", c("every"), at(16, 17, 59))).toBe(false);
    expect(routineDue("custom", c("every", { lastRun: iso(at(16, 18, 1)) }), at(16, 20))).toBe(false);
    expect(slotToday("custom", c([3]), at(18, 9))).toEqual(at(18, 18));
  });

  test("qual está na hora: as prontas primeiro, depois as novas na ordem", () => {
    let r = createRoutine(createRoutine(DEFAULT_AGENT_ROUTINES, input, "r-aaaaaaaa"), { ...input, time: "08:00" }, "r-bbbbbbbb");
    r = updateRoutine(updateRoutine(r, "r-aaaaaaaa", { on: true }, at(16, 7).getTime())!, "r-bbbbbbbb", { on: true }, at(16, 7).getTime())!;
    expect(dueRoutine(r, at(16, 7, 30))).toBeNull();
    expect(dueRoutine(r, at(16, 8, 30))).toEqual({ kind: "custom", id: "r-bbbbbbbb" });
    expect(dueRoutine(r, at(16, 18, 30))).toEqual({ kind: "custom", id: "r-aaaaaaaa" });
    const withDaily = patchRoutines(r, { daily: { on: true } }, at(16, 7).getTime());
    expect(dueRoutine(withDaily, at(16, 18, 30))).toEqual({ kind: "daily" });
  });

  test("o id novo é r- e 8 letras, e não repete um que existe", () => {
    const ids = ["aaaaaaaa-1", "aaaaaaaa-2", "bbbbbbbb-1"];
    expect(newRoutineId([{ id: "r-aaaaaaaa" }], () => ids.shift()!)).toBe("r-bbbbbbbb");
    expect(newRoutineId([])).toMatch(/^r-[a-z0-9]{8}$/);
  });
});
