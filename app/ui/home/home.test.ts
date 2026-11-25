import { describe, expect, test } from "bun:test";
import { ago, hour, today, when } from "./format.ts";
import { appLocale, setAppLocale, t } from "../src/i18n.ts";
import { greeting, nextPhrase, PHRASES } from "./greeting.ts";

const at = (h: number, m = 0, day = 17) => new Date(2026, 10, day, h, m).getTime();

describe("a saudação (spec #15728)", () => {
  test("pela hora", () => {
    expect(greeting(new Date(at(5)))).toBe("Bom dia");
    expect(greeting(new Date(at(11, 59)))).toBe("Bom dia");
    expect(greeting(new Date(at(12)))).toBe("Boa tarde");
    expect(greeting(new Date(at(17, 59)))).toBe("Boa tarde");
    expect(greeting(new Date(at(18)))).toBe("Boa noite");
    expect(greeting(new Date(at(2)))).toBe("Boa noite");
  });

  test("a frase muda a cada abertura e dá a volta", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const seen = Array.from({ length: PHRASES.length + 1 }, () => nextPhrase(storage));
    expect(seen.slice(0, PHRASES.length)).toEqual(PHRASES.map((k) => t(k)));
    expect(seen[PHRASES.length]).toBe(t(PHRASES[0]!));
  });

  test("sem storage, ou com lixo nele, a primeira", () => {
    expect(nextPhrase(null)).toBe(t(PHRASES[0]!));
    expect(nextPhrase({ getItem: () => "abc", setItem: () => {} })).toBe(t(PHRASES[0]!));
    expect(nextPhrase({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } })).toBe(t(PHRASES[0]!));
  });
});

describe("as horas da Início", () => {
  const now = at(15, 0);
  test("há quanto tempo", () => {
    expect(ago(now - 20_000, now)).toBe("agora");
    expect(ago(at(14, 48), now)).toBe("há 12 min");
    expect(ago(at(12, 0), now)).toBe("há 3 h");
    expect(ago(at(9, 5, 16), now)).toBe("ontem, 09:05");
  });
  test("o dia e a hora", () => {
    expect(hour(at(10, 40))).toBe("10:40");
    expect(when(at(14), now)).toBe("hoje, 14:00");
    expect(when(at(14, 0, 12), now)).toBe("12 de nov., 14:00");
  });
});

test("o Início em inglês (spec #28171): a saudação, há quanto tempo e o dia", () => {
  const before = appLocale();
  setAppLocale({ ...before, locale: "en" });
  try {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    expect(greeting(new Date(2026, 10, 17, 9))).toBe("Good morning");
    expect(ago(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(when(new Date(2026, 10, 16, 21, 5).getTime(), now)).toBe("yesterday, 9:05 PM");
    expect(when(new Date(2026, 10, 12, 14, 0).getTime(), now)).toBe("Nov 12, 2:00 PM");
    expect(hour(new Date(2026, 10, 17, 10, 40).getTime())).toBe("10:40 AM");
    expect(today(now)).toBe("Tuesday, November 17");
    expect(nextPhrase(null)).toBe("Let's pick up where we left off.");
  } finally {
    setAppLocale(before);
  }
  expect(greeting(new Date(2026, 10, 17, 9))).toBe("Bom dia");
});
