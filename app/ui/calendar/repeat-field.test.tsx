// O campo da repetição do "+ Novo" (spec #34706, T34775): a regra montada vira a forma curta do contrato, o que
// falta segura o Criar, e o "Personalizar…" mostra o que a regra diz. Sem relógio.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { setAppLocale } from "../src/i18n.ts";
import { NewItem } from "./NewItem.tsx";
import { modeOf, RepeatField, repeatOfForm, ruleFor } from "./RepeatField.tsx";

afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

describe("o campo da repetição", () => {
  test("a regra montada: forma curta, a pronta quando é uma, os limites, e o 'até' sem dia segura", () => {
    const w = { every: 1, unit: "w" as const, days: [] as number[], until: null, count: null };
    expect(repeatOfForm(w, "never", "", 10)).toBe("weekly");
    expect(repeatOfForm({ ...w, days: [1, 2, 3, 4, 5] }, "never", "", 10)).toBe("weekdays");
    expect(repeatOfForm({ ...w, every: 2, days: [3, 1] }, "count", "", 10)).toBe("2w:mo,we/10x");
    expect(repeatOfForm({ ...w, unit: "m", days: [1] }, "until", "2027-06-30", 10)).toBe("1m/2027-06-30"); // dia da semana só na semana
    expect(repeatOfForm({ ...w, every: 0 }, "count", "", 5000)).toBe("1w/999x");
    expect(repeatOfForm({ ...w, every: 250, unit: "d" }, "never", "", 1)).toBe("99d");
    expect(repeatOfForm(w, "until", "", 10)).toBeNull();
  });

  test("o modo e a regra de uma repetição que já existe", () => {
    expect([null, "monthly", "2w:mo,we"].map((r) => modeOf(r as never))).toEqual(["", "monthly", "custom"]);
    expect(ruleFor("2w:mo,we/10x")).toEqual({ every: 2, unit: "w", days: [1, 3], until: null, count: 10 });
    expect(ruleFor(null)).toEqual({ every: 1, unit: "w", days: [], until: null, count: null });
  });

  test("o Personalizar… aberto: a cada N, os dias marcados, o fim e o que a regra diz, em pt e en", () => {
    const pt = renderToStaticMarkup(<RepeatField value="2w:mo,we/10x" day="2026-12-07" onChange={() => {}} />);
    expect(pt).toContain('value="custom" selected=""');
    expect(pt).toContain('max="99" name="every" value="2"');
    expect(pt.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(pt).toContain('data-weekday="1" aria-pressed="true"');
    expect(pt).toContain('name="ends" checked="" value="count"');
    expect(pt).toContain("a cada 2 semanas, seg e qua, 10 vezes");
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    const en = renderToStaticMarkup(<RepeatField value="2w:mo,we/10x" day="2026-12-07" onChange={() => {}} />);
    expect(en).toContain("every 2 weeks, Mon and Wed, 10 times");
  });

  test("o + Novo pergunta a repetição, com as prontas e o Personalizar…", () => {
    const html = renderToStaticMarkup(<NewItem day="2026-12-07" projects={["Projeto X"]} onCancel={() => {}} onCreate={() => {}} />);
    expect(html).toContain('name="repeat"');
    for (const v of ["", "daily", "weekly", "monthly", "yearly", "weekdays", "custom"]) expect(html).toContain(`<option value="${v}"`);
  });
});
