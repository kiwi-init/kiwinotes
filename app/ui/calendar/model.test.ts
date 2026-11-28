// O lado puro da aba Calendário (T32155): os períodos, a grade e o arrastar. Datas fixas, sem relógio.

import { describe, expect, test } from "bun:test";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { MIN_SHOWN_MIN, NEAR_MIN, itemsOfDay, layoutDay, mondayOf, moveItem, noteLine, nowMinutes, onDay, resizeItem, stepAnchor, viewRange } from "./model.ts";

const item = (o: Partial<CalendarItem> & Pick<CalendarItem, "id" | "start">): CalendarItem => ({
  kind: "task",
  title: o.id,
  project: null,
  end: null,
  allDay: false,
  notify: "none",
  readOnly: false,
  source: null,
  ...o,
});

describe("os períodos", () => {
  test("a semana começa na segunda", () => {
    expect(mondayOf("2026-11-26")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(viewRange("week", "2026-11-26")).toMatchObject({ from: "2026-11-23", to: "2026-11-30" });
  });

  test("o mês mostra 6 semanas a partir da segunda do dia 1", () => {
    const r = viewRange("month", "2026-11-26");
    expect(r.days).toHaveLength(42);
    expect(r.from).toBe("2026-10-26");
    expect(r.days).toContain("2026-11-30");
  });

  test("o dia e a agenda partem do dia âncora", () => {
    expect(viewRange("day", "2026-11-26")).toEqual({ days: ["2026-11-26"], from: "2026-11-26", to: "2026-11-27" });
    expect(viewRange("agenda", "2026-11-26").days).toHaveLength(14);
  });

  test("‹ › andam o período da vista", () => {
    expect(stepAnchor("day", "2026-11-30", 1)).toBe("2026-12-01");
    expect(stepAnchor("week", "2026-11-26", -1)).toBe("2026-11-19");
    expect(stepAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(stepAnchor("agenda", "2026-11-26", 1)).toBe("2026-12-10");
  });
});

describe("a grade das horas", () => {
  test("o que se cruza fica lado a lado; o que vem depois volta à largura toda", () => {
    const placed = layoutDay(
      [
        item({ id: "a", start: "2026-11-26T10:00", end: "2026-11-26T11:00" }),
        item({ id: "b", start: "2026-11-26T10:30", end: "2026-11-26T11:30" }),
        item({ id: "c", start: "2026-11-26T11:00", end: "2026-11-26T12:00" }),
        item({ id: "d", start: "2026-11-26T14:00" }),
      ],
      "2026-11-26",
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect([by.a!.col, by.b!.col, by.c!.col]).toEqual([0, 1, 0]);
    expect([by.a!.cols, by.b!.cols, by.c!.cols]).toEqual([2, 2, 2]);
    expect(by.d).toMatchObject({ col: 0, cols: 1, top: 14 * 60, bottom: 14 * 60 + 30 });
  });

  // #466: a caixa de cima que começava menos de NEAR_MIN depois cobria a hora da de baixo (a 2ª linha dela).
  test("na cascata, a caixa que começa logo depois da de baixo desce até abaixo da hora dela, sem mudar o fim", () => {
    const placed = layoutDay(
      [
        item({ id: "ana", start: "2026-11-26T14:00", end: "2026-11-26T15:00" }),
        item({ id: "perto", start: "2026-11-26T14:30", end: "2026-11-26T16:00" }),
        item({ id: "longo", start: "2026-11-26T08:00", end: "2026-11-26T11:00" }),
        item({ id: "depois", start: "2026-11-26T10:00", end: "2026-11-26T11:00" }),
      ],
      "2026-11-26",
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect(NEAR_MIN).toBeGreaterThanOrEqual(42);
    // A de cima começa às 14:30, mas a caixa só a partir de 14:00 + NEAR_MIN; o fim é o de verdade.
    expect(by.perto).toMatchObject({ col: 1, top: 14 * 60 + 30, shownTop: 14 * 60 + NEAR_MIN, bottom: 16 * 60 });
    expect(by.ana!.shownTop).toBe(14 * 60);
    // Começou 2 h depois: a hora da de baixo já ficou para trás, a caixa fica na hora dela.
    expect(by.depois).toMatchObject({ col: 1, top: 10 * 60, shownTop: 10 * 60 });
  });

  test("a caixa empurrada nunca passa do próprio fim, e três no mesmo começo descem uma abaixo da outra", () => {
    const placed = layoutDay(
      [
        item({ id: "a", start: "2026-11-26T09:00", end: "2026-11-26T11:30" }),
        item({ id: "b", start: "2026-11-26T09:00", end: "2026-11-26T11:30" }),
        item({ id: "c", start: "2026-11-26T09:00", end: "2026-11-26T11:30" }),
        item({ id: "curta", start: "2026-11-26T15:00", end: "2026-11-26T16:00" }),
        item({ id: "rapida", start: "2026-11-26T15:00", end: "2026-11-26T15:30" }),
      ],
      "2026-11-26",
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect([by.a!.shownTop, by.b!.shownTop, by.c!.shownTop]).toEqual([9 * 60, 9 * 60 + NEAR_MIN, 9 * 60 + 2 * NEAR_MIN]);
    // A de 30 min não cabe abaixo da hora da outra: desce só até sobrar o mínimo dela.
    expect(by.rapida!.shownTop).toBe(15 * 60 + 30 - MIN_SHOWN_MIN);
    for (const p of placed) expect(p.bottom - p.shownTop).toBeGreaterThanOrEqual(Math.min(MIN_SHOWN_MIN, p.bottom - p.top));
  });

  test("o que passa da meia-noite aparece cortado nos dois dias", () => {
    const late = item({ id: "x", start: "2026-11-26T23:00", end: "2026-11-27T01:00" });
    expect(layoutDay([late], "2026-11-26")[0]).toMatchObject({ top: 23 * 60, bottom: 24 * 60 });
    expect(layoutDay([late], "2026-11-27")[0]).toMatchObject({ top: 0, bottom: 60 });
  });

  test("o dia todo não entra na grade das horas, e vem primeiro na lista do dia", () => {
    const all = item({ id: "aniv", start: "2026-11-27", allDay: true });
    const t = item({ id: "t", start: "2026-11-27T08:00" });
    expect(layoutDay([all, t], "2026-11-27").map((p) => p.item.id)).toEqual(["t"]);
    expect(itemsOfDay([t, all], "2026-11-27").map((i) => i.id)).toEqual(["aniv", "t"]);
    expect(onDay(all, "2026-11-28")).toBe(false);
  });

  test("a linha do agora só aparece hoje", () => {
    const now = new Date(2026, 10, 26, 11, 36).getTime();
    expect(nowMinutes("2026-11-26", now)).toBe(11 * 60 + 36);
    expect(nowMinutes("2026-11-27", now)).toBeNull();
  });
});

describe("arrastar e esticar", () => {
  const meeting = item({ id: "m", start: "2026-11-26T10:00", end: "2026-11-26T11:00" });

  test("arrastar anda em passos de 15 min e mantém a duração", () => {
    expect(moveItem(meeting, 37, 0)).toEqual({ start: "2026-11-26T10:30", end: "2026-11-26T11:30" });
    expect(moveItem(meeting, -60, 1)).toEqual({ start: "2026-11-27T09:00", end: "2026-11-27T10:00" });
    expect(moveItem(meeting, 5, 0)).toBeNull();
  });

  test("o sem fim continua sem fim, e o dia todo só troca de dia", () => {
    expect(moveItem(item({ id: "s", start: "2026-11-26T09:00" }), 30, 0)).toEqual({ start: "2026-11-26T09:30", end: null });
    const all = item({ id: "a", start: "2026-11-26", allDay: true });
    expect(moveItem(all, 120, 0)).toBeNull();
    expect(moveItem(all, 0, 2)).toEqual({ start: "2026-11-28", end: null });
  });

  test("esticar tem 15 min no mínimo", () => {
    expect(resizeItem(meeting, 30)).toEqual({ end: "2026-11-26T11:30" });
    expect(resizeItem(meeting, -500)).toEqual({ end: "2026-11-26T10:15" });
    expect(resizeItem(meeting, 4)).toBeNull();
    // Sem fim: esticar grava o fim (a meia hora da grade mais o que andou).
    expect(resizeItem(item({ id: "s", start: "2026-11-26T09:00" }), 15)).toEqual({ end: "2026-11-26T09:45" });
  });

  test("o link abre na linha 1-based da nota", () => {
    expect(noteLine(item({ id: "n", start: "2026-11-26", source: { path: "Projeto X/Pendências.md", line: 13, internal: false } }))).toBe(14);
    expect(noteLine(item({ id: "f", start: "2026-11-26", source: { path: "Projeto X/Ideias.md", line: null, internal: false } }))).toBeUndefined();
  });
});
