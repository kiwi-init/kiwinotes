// O lado puro da aba Calendário (T32155): os períodos, a grade e o arrastar. Datas fixas, sem relógio.

import { describe, expect, test } from "bun:test";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { clockOf, MIN_SHOWN_MIN, NEAR_MIN, itemsOfDay, layoutDay, mondayOf, moveItem, newItemDay, noteLine, nowMinutes, onDay, resizeItem, resizeTop, slotSpan, stepAnchor, viewRange } from "./model.ts";

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

  test("esticar para em 24 h, o teto do calendar.update (#480)", () => {
    // meeting: 10:00–11:00. Trinta horas a mais param no dia seguinte, às 10:00, e não no que o calendar.update recusa.
    expect(resizeItem(meeting, 30 * 60)).toEqual({ end: "2026-11-27T10:00" });
    expect(resizeItem(meeting, 23 * 60)).toEqual({ end: "2026-11-27T10:00" });
    expect(resizeItem(meeting, 22 * 60)).toEqual({ end: "2026-11-27T09:00" });
    // Já no teto: esticar mais não muda nada, e a tela não grava.
    expect(resizeItem({ ...meeting, end: "2026-11-27T10:00" }, 120)).toBeNull();
    // Sem fim também para em 24 h.
    expect(resizeItem(item({ id: "s", start: "2026-11-26T09:00" }), 40 * 60)).toEqual({ end: "2026-11-27T09:00" });
  });

  test("esticar a borda de cima muda o começo e deixa o fim (spec #34706, ponto 5)", () => {
    const m = item({ id: "m", start: "2026-11-26T10:00", end: "2026-11-26T11:00" });
    expect(resizeTop(m, -30)).toEqual({ start: "2026-11-26T09:30", end: "2026-11-26T11:00" });
    expect(resizeTop(m, 20)).toEqual({ start: "2026-11-26T10:15", end: "2026-11-26T11:00" });
    // 15 min no mínimo: puxar o começo para depois do fim para a 15 min dele.
    expect(resizeTop(m, 500)).toEqual({ start: "2026-11-26T10:45", end: "2026-11-26T11:00" });
    expect(resizeTop(m, 5)).toBeNull();
    // Atravessa a meia-noite para trás e para em 24 h.
    expect(resizeTop(m, -11 * 60)).toEqual({ start: "2026-11-25T23:00", end: "2026-11-26T11:00" });
    expect(resizeTop(m, -40 * 60)).toEqual({ start: "2026-11-25T11:00", end: "2026-11-26T11:00" });
    // Sem fim: grava o fim da meia hora da grade, para ele não andar junto.
    expect(resizeTop(item({ id: "s", start: "2026-11-26T09:00" }), -15)).toEqual({ start: "2026-11-26T08:45", end: "2026-11-26T09:30" });
    expect(resizeTop(item({ id: "a", start: "2026-11-26", allDay: true }), -60)).toBeNull();
  });

  test("o clique no vazio marca meia hora a partir do quarto de hora", () => {
    expect(slotSpan(9 * 60 + 40, 9 * 60 + 40, false)).toEqual({ from: 9 * 60 + 30, to: 10 * 60 });
    expect(slotSpan(0, 0, false)).toEqual({ from: 0, to: 30 });
    // No fim do dia, não passa da meia-noite.
    expect(slotSpan(23 * 60 + 50, 23 * 60 + 50, false)).toEqual({ from: 23 * 60 + 45, to: 24 * 60 });
    expect(slotSpan(-30, -30, false)).toEqual({ from: 0, to: 30 });
  });

  test("o arrastar no vazio vai do começo ao fim, em passos de 15 min, para baixo ou para cima", () => {
    expect(slotSpan(9 * 60 + 5, 10 * 60 + 20, true)).toEqual({ from: 9 * 60, to: 10 * 60 + 30 });
    expect(slotSpan(10 * 60 + 20, 9 * 60 + 5, true)).toEqual({ from: 9 * 60, to: 10 * 60 + 30 });
    // Arrastar pouco ainda dá 15 min.
    expect(slotSpan(9 * 60 + 1, 9 * 60 + 2, true)).toEqual({ from: 9 * 60, to: 9 * 60 + 15 });
    // Para dentro do dia.
    expect(slotSpan(22 * 60, 30 * 60, true)).toEqual({ from: 22 * 60, to: 24 * 60 });
    expect(slotSpan(60, -100, true)).toEqual({ from: 0, to: 60 });
  });

  test("a hora dos campos", () => {
    expect(clockOf(0)).toBe("00:00");
    expect(clockOf(9 * 60 + 5)).toBe("09:05");
    expect(clockOf(24 * 60)).toBe("23:59");
  });

  test("o link abre na linha 1-based da nota", () => {
    expect(noteLine(item({ id: "n", start: "2026-11-26", source: { path: "Projeto X/Pendências.md", line: 13, internal: false } }))).toBe(14);
    expect(noteLine(item({ id: "f", start: "2026-11-26", source: { path: "Projeto X/Ideias.md", line: null, internal: false } }))).toBeUndefined();
  });
});

describe("newItemDay: o dia que o + Novo sugere (#491)", () => {
  const today = "2026-11-28";
  test("no Mês de outro mês, o dia 1 dele, não a segunda da grade (30/11)", () => {
    expect(viewRange("month", "2026-12-01").from).toBe("2026-11-30");
    expect(newItemDay("month", "2026-12-01", today)).toBe("2026-12-01");
    expect(newItemDay("month", "2026-10-15", today)).toBe("2026-10-01");
  });
  test("no Mês de hoje, hoje", () => {
    expect(newItemDay("month", "2026-11-03", today)).toBe(today);
  });
  test("no Mês seguinte, hoje na borda cinza da grade não conta", () => {
    // A grade de Dezembro começa em 30/11; hoje 30/11 está nela, mas não no mês.
    expect(newItemDay("month", "2026-12-01", "2026-11-30")).toBe("2026-12-01");
  });
  test("na Semana e na Agenda, hoje se está no período, senão o 1º dia", () => {
    expect(newItemDay("week", "2026-11-26", today)).toBe(today);
    expect(newItemDay("week", "2026-12-09", today)).toBe("2026-12-07");
    expect(newItemDay("agenda", "2026-12-10", today)).toBe("2026-12-10");
  });
  test("no Dia, o dia à vista", () => {
    expect(newItemDay("day", "2026-12-24", today)).toBe("2026-12-24");
  });
});
