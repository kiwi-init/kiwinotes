// O lado puro da aba Calendário (T32155): os períodos, a grade e o arrastar. Datas fixas, sem relógio.

import { describe, expect, test } from "bun:test";

import type { CalendarItem } from "../../src/shared/calendar.ts";
import { fitColumns, itemsOfDay, layoutDay, mondayOf, moveItem, newItemDay, noteLine, nowMinutes, onDay, resizeItem, stepAnchor, viewRange } from "./model.ts";

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

  const at = (id: string, from: string, to: string) => item({ id, start: `2026-11-26T${from}`, end: `2026-11-26T${to}` });
  const place = (list: CalendarItem[]) => Object.fromEntries(layoutDay(list, "2026-11-26").map((p) => [p.item.id, p]));

  // Ponto 9 do spec #34706: lado a lado, como no Teams e no Google Agenda, em vez da cascata.
  test("dois no mesmo horário: metade da largura cada; o que vem depois volta à largura cheia", () => {
    const by = place([at("a", "09:00", "10:00"), at("b", "09:00", "10:00"), at("c", "11:00", "12:00")]);
    expect(by.a).toMatchObject({ col: 0, cols: 2, span: 1, top: 9 * 60, bottom: 10 * 60 });
    expect(by.b).toMatchObject({ col: 1, cols: 2, span: 1, top: 9 * 60 });
    expect(by.c).toMatchObject({ col: 0, cols: 1, span: 1 });
    expect(by.c!.group).not.toBe(by.a!.group);
  });

  test("três cruzados: um terço cada, cada um na hora de verdade", () => {
    const by = place([at("a", "14:00", "15:00"), at("b", "14:30", "16:00"), at("c", "14:45", "15:15")]);
    expect([by.a!.col, by.b!.col, by.c!.col]).toEqual([0, 1, 2]);
    for (const p of Object.values(by)) expect(p).toMatchObject({ cols: 3, span: 1 });
    expect(by.b!.top).toBe(14 * 60 + 30);
  });

  test("cinco no mesmo horário: cinco colunas, e o que não cabe vira um +N só", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => at(id, "10:00", "11:00"));
    const placed = layoutDay(five, "2026-11-26");
    expect(placed.map((p) => p.col)).toEqual([0, 1, 2, 3, 4]);
    expect(placed.every((p) => p.cols === 5)).toBe(true);
    // Cabem 5: nada muda.
    expect(fitColumns(placed, 5)).toEqual({ shown: placed, more: [] });
    // Cabem 3: duas à vista, e o +3 na terceira coluna com as outras.
    const { shown, more } = fitColumns(placed, 3);
    expect(shown.map((p) => [p.item.id, p.col, p.cols])).toEqual([["a", 0, 3], ["b", 1, 3]]);
    expect(more).toEqual([{ top: 10 * 60, bottom: 11 * 60, col: 2, cols: 3, items: [five[2], five[3], five[4]] }]);
  });

  test("a cadeia A–B–C: A e C não se cruzam, dividem a coluna e ficam no mesmo grupo de B", () => {
    const by = place([at("a", "10:00", "11:00"), at("b", "10:30", "11:30"), at("c", "11:00", "12:00"), at("d", "14:00", "14:30")]);
    expect([by.a!.col, by.b!.col, by.c!.col]).toEqual([0, 1, 0]);
    expect([by.a!.cols, by.b!.cols, by.c!.cols]).toEqual([2, 2, 2]);
    expect(new Set([by.a!.group, by.b!.group, by.c!.group]).size).toBe(1);
    expect(by.d).toMatchObject({ col: 0, cols: 1, span: 1, top: 14 * 60, bottom: 14 * 60 + 30 });
  });

  test("na cadeia, o item sem vizinho à direita se estica pelas colunas livres", () => {
    // A 09–12 cruza com B 09–10 e C 09:30–10:30; D 11–12 só cruza com A e fica com as colunas 1 e 2.
    const by = place([at("a", "09:00", "12:00"), at("b", "09:00", "10:00"), at("c", "09:30", "10:30"), at("d", "11:00", "12:00")]);
    expect([by.a!.col, by.b!.col, by.c!.col, by.d!.col]).toEqual([0, 1, 2, 1]);
    expect(by.d).toMatchObject({ cols: 3, span: 2 });
    expect(by.b!.span).toBe(1);
    // Com só 2 colunas à vista, o D não estica por cima do +N, e o +N junta só a faixa do C.
    const { shown, more } = fitColumns(layoutDay([at("a", "09:00", "12:00"), at("b", "09:00", "10:00"), at("c", "09:30", "10:30"), at("d", "11:00", "12:00")], "2026-11-26"), 2);
    expect(shown.map((p) => [p.item.id, p.col, p.span])).toEqual([["a", 0, 1]]);
    expect(more.map((r) => [r.top, r.bottom, r.items.map((i) => i.id)])).toEqual([[9 * 60, 10 * 60 + 30, ["b", "c"]], [11 * 60, 12 * 60, ["d"]]]);
  });

  test("o +N só em quem não cabe: o grupo que cabe no mesmo dia continua inteiro", () => {
    const placed = layoutDay([at("a", "08:00", "09:00"), at("b", "08:00", "09:00"), ...["c", "d", "e", "f"].map((id) => at(id, "15:00", "16:00"))], "2026-11-26");
    const { shown, more } = fitColumns(placed, 2);
    expect(shown.map((p) => p.item.id)).toEqual(["a", "b", "c"]);
    expect(more).toHaveLength(1);
    expect(more[0]).toMatchObject({ col: 1, cols: 2, top: 15 * 60 });
    expect(more[0]!.items.map((i) => i.id)).toEqual(["d", "e", "f"]);
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
