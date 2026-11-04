import { describe, expect, test } from "bun:test";

import { approxWord, highlightRanges, subsequence, typoBudget, withinEdits } from "./fuzzy.ts";

describe("subsequência nos títulos (T2966)", () => {
  test("as letras em ordem, não juntas: kg acha hgkjgkj", () => {
    const m = subsequence("kg", "hgkjgkj");
    expect(m).not.toBeNull();
    expect(m!.ranges).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(subsequence("gkh", "hgkjgkj")).toBeNull();
    expect(subsequence("", "hgkjgkj")).toBeNull();
  });

  test("sem acento nem maiúscula, e os trechos no texto original", () => {
    const m = subsequence("reuniao", "Reunião semanal")!;
    expect(m.ranges).toEqual([[0, 7]]);
    expect(subsequence("RSM", "Reunião semanal")).not.toBeNull();
  });

  test("letras seguidas, início de palavra e início do título valem mais", () => {
    const score = (q: string, t: string) => subsequence(q, t)!.score;
    expect(score("rs", "Reunião semanal")).toBeGreaterThan(score("rs", "Barras"));
    expect(score("sem", "Reunião semanal")).toBeGreaterThan(score("sem", "Sistema em uso"));
    expect(score("kg", "kg de café")).toBeGreaterThan(score("kg", "hgkjgkj"));
  });

  test("o melhor alinhamento, não o primeiro guloso", () => {
    // O guloso pegaria o "p" de "apto" e o "l" de "lista"; o melhor é "pl" junto no início de "Plano".
    expect(subsequence("pl", "apto Plano")!.ranges).toEqual([[5, 7]]);
  });

  test("cada palavra da busca casa sozinha", () => {
    expect(subsequence("reu sem", "Reunião semanal")!.ranges).toEqual([
      [0, 3],
      [8, 11],
    ]);
    expect(subsequence("reu xyz", "Reunião semanal")).toBeNull();
  });
});

describe("erros de digitação no texto (T2966)", () => {
  test("quantos erros cada palavra aceita", () => {
    expect(typoBudget("kg")).toBe(0);
    expect(typoBudget("ata")).toBe(0);
    expect(typoBudget("casa")).toBe(1);
    expect(typoBudget("reuniao")).toBe(2);
    expect(typoBudget("2026")).toBe(0);
    expect(typoBudget("e-mail")).toBe(0);
  });

  test("trocar, faltar, sobrar e inverter contam um erro cada", () => {
    expect(withinEdits("casa", "cama", 1)).toBe(true);
    expect(withinEdits("casa", "cas", 1)).toBe(true);
    expect(withinEdits("casa", "casas", 1)).toBe(true);
    expect(withinEdits("reunaio", "reuniao", 1)).toBe(true);
    expect(withinEdits("casa", "coisa", 1)).toBe(false);
    expect(withinEdits("projeto", "pjoreto", 2)).toBe(true);
    expect(withinEdits("projeto", "prjeot", 2)).toBe(true);
    expect(withinEdits("projeto", "objeto", 2)).toBe(false);
    expect(withinEdits("projeto", "prato", 2)).toBe(false);
  });

  test("a palavra do texto que casou, com memo", () => {
    const memo = new Map<string, boolean>();
    expect(approxWord("reunaio", ["a", "reuniao", "time"], memo)).toBe("reuniao");
    expect(memo.get("reuniao")).toBe(true);
    expect(approxWord("kg", ["kh"])).toBeNull();
    expect(approxWord("2026", ["2025"])).toBeNull();
  });

  test("o destaque no trecho: exato e aproximado", () => {
    expect(highlightRanges("A reunião de terça", ["reunaio"])).toEqual([[2, 9]]);
    expect(highlightRanges("Reunião, reunião", ["reun"])).toEqual([
      [0, 4],
      [9, 13],
    ]);
    expect(highlightRanges("nada aqui", ["reunaio"])).toEqual([]);
  });
});
