// As cabeças de data da aba Calendário (#494): só a 1ª letra da linha em maiúscula em pt, como o inglês as escreve.
// Datas fixas, sem relógio.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { agendaHead, dayHead, periodTitle, weekdayNames } from "./format.ts";

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
