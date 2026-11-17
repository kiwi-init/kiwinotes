import { describe, expect, test } from "bun:test";
import { ago, hour, when } from "./format.ts";
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
    expect(seen.slice(0, PHRASES.length)).toEqual([...PHRASES]);
    expect(seen[PHRASES.length]).toBe(PHRASES[0]);
  });

  test("sem storage, ou com lixo nele, a primeira", () => {
    expect(nextPhrase(null)).toBe(PHRASES[0]);
    expect(nextPhrase({ getItem: () => "abc", setItem: () => {} })).toBe(PHRASES[0]);
    expect(nextPhrase({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } })).toBe(PHRASES[0]);
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
