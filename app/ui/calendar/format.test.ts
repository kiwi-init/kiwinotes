// As cabeças de data da aba Calendário (#494): só a 1ª letra da linha em maiúscula em pt, como o inglês as escreve.
// A hora dos itens (T34131, #480): o fim no dia seguinte leva o "(+1 dia)".
// Datas fixas, sem relógio.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { translate } from "../../src/shared/i18n/index.ts";
import { agendaHead, dayHead, periodTitle, repeatLabel, timeRange, weekdayNames, whenLine } from "./format.ts";

describe("as cabeças de data", () => {
  test("a Agenda em pt: dia da semana e mês em minúscula, só a 1ª maiúscula", () => {
    expect(agendaHead("2026-11-27", "pt")).toBe("Sexta-feira, 27 de novembro");
    expect(agendaHead("2026-11-23", "pt")).toBe("Segunda-feira, 23 de novembro");
    expect(agendaHead("2026-11-29", "pt")).toBe("Domingo, 29 de novembro");
    expect(agendaHead("2026-11-27", "en")).toBe("Friday, November 27");
  });

  test("o Dia, a Semana e o Mês", () => {
    expect(periodTitle("day", ["2026-11-27"], "2026-11-27", "pt")).toBe("Sexta-feira, 27 de novembro");
    expect(periodTitle("month", [], "2026-11-27", "pt")).toBe("Novembro de 2026");
    expect(dayHead("2026-11-27", "pt")).toEqual({ weekday: "Sex", n: 27 });
    expect(weekdayNames("pt")).toEqual(["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
    expect(weekdayNames("en")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  // O texto já sai com a 1ª maiúscula do `format.ts`; um `capitalize` no CSS punha maiúscula em cada palavra em pt.
  test("o CSS do Calendário não muda as maiúsculas", () => {
    const css = readFileSync(join(import.meta.dir, "calendar.css"), "utf8");
    expect(css).not.toMatch(/text-transform:\s*capitalize/);
  });
});

const DIA_TODO = "dia todo";
const MAIS_UM = "(+1 dia)";

describe("a hora de um item", () => {
  test("no mesmo dia, sem o +1 dia", () => {
    expect(timeRange({ start: "2026-12-02T10:00", end: "2026-12-02T11:00", allDay: false }, DIA_TODO, MAIS_UM)).toBe("10:00–11:00");
    expect(timeRange({ start: "2026-12-02T10:00", end: null, allDay: false }, DIA_TODO, MAIS_UM)).toBe("10:00");
    expect(timeRange({ start: "2026-12-02", end: null, allDay: true }, DIA_TODO, MAIS_UM)).toBe(DIA_TODO);
  });

  test("o item de 24 h não parece ter duração zero: o fim no dia seguinte leva o +1 dia", () => {
    expect(timeRange({ start: "2026-12-02T11:00", end: "2026-12-03T11:00", allDay: false }, DIA_TODO, MAIS_UM)).toBe("11:00–11:00 (+1 dia)");
  });

  test("o que passa da meia-noite, ou acaba nela, também leva o +1 dia (em pt e en)", () => {
    expect(timeRange({ start: "2026-12-02T22:00", end: "2026-12-03T02:00", allDay: false }, DIA_TODO, MAIS_UM)).toBe("22:00–02:00 (+1 dia)");
    expect(timeRange({ start: "2026-12-02T23:00", end: "2026-12-03T00:00", allDay: false }, DIA_TODO, "(+1 day)")).toBe("23:00–00:00 (+1 day)");
  });

  test("o cartão mostra o dia do começo e a hora com o +1 dia", () => {
    expect(whenLine({ start: "2026-11-27T11:00", end: "2026-11-28T11:00", allDay: false }, "pt", DIA_TODO, MAIS_UM)).toBe("Sex, 27 de nov · 11:00–11:00 (+1 dia)");
    expect(whenLine({ start: "2026-11-27T11:00", end: "2026-11-27T12:00", allDay: false }, "en", "all day", "(+1 day)")).toBe("Fri, Nov 27 · 11:00–12:00");
  });
});

describe("a repetição no cartão (spec #34706, T34775)", () => {
  const label = (rep: string, l: "pt" | "en") => repeatLabel(rep as never, l, (k, p) => translate(l, k, p));
  test("as prontas e a regra montada, em pt e en", () => {
    expect(["daily", "monthly", "yearly", "weekdays"].map((r) => label(r, "pt"))).toEqual(["todo dia", "todo mês", "todo ano", "nos dias úteis"]);
    expect(label("2w:mo,we", "pt")).toBe("a cada 2 semanas, seg e qua");
    expect(label("2w:mo,we", "en")).toBe("every 2 weeks, Mon and Wed");
    expect(label("1w:mo,we,fr/10x", "pt")).toBe("toda semana, seg, qua e sex, 10 vezes");
    expect(label("3d/2026-12-31", "pt")).toBe("a cada 3 dias, até 31 de dez de 2026");
    expect(label("1m/1x", "en")).toBe("every month, once");
    expect(label("1y/2030-02-01", "en")).toBe("every year, until Feb 1, 2030");
  });
});
