import { describe, expect, test } from "bun:test";

import { evalCases } from "./evalset.ts";
import { type GoldenCase, goldenCases, meanScore, scoreGolden } from "./golden.ts";
import { cleanupWithRules } from "./index.ts";
import { ENHANCEMENT_SYSTEM_TEMPLATE } from "./prompts.ts";

const dicom: GoldenCase = {
  id: "t",
  raw: "o dicom store caiu",
  expected: "O DICOM store caiu.",
  dictionary: ["DICOM"],
};

describe("nota do golden (T6592)", () => {
  test("o esperado tira 1, e cada caractere a mais ou a menos desconta", () => {
    expect(scoreGolden(dicom, "O DICOM store caiu.").score).toBe(1);
    expect(scoreGolden(dicom, "  O DICOM store caiu.\n").score).toBe(1);
    const off = scoreGolden(dicom, "O DICOM store caiu");
    expect(off.score).toBeLessThan(1);
    expect(off.score).toBeGreaterThan(0.9);
  });

  test("perder termo do dicionário ou traduzir zera", () => {
    expect(scoreGolden(dicom, "O store caiu.")).toMatchObject({ score: 0, terms: false });
    const pt: GoldenCase = { id: "t", raw: "o servidor caiu de novo", expected: "O servidor caiu de novo." };
    expect(scoreGolden(pt, "The server is down again.")).toMatchObject({ score: 0, language: false });
  });

  test("responder a pergunta tira nota baixa", () => {
    const q = goldenCases.find((c) => c.id === "g-pergunta-fato")!;
    expect(scoreGolden(q, "O Brasil tem cerca de 203 milhões de habitantes.").score).toBeLessThan(0.5);
  });

  test("a média das notas", () => {
    expect(meanScore([])).toBe(0);
    expect(meanScore([scoreGolden(dicom, "O DICOM store caiu."), scoreGolden(dicom, "O store caiu.")])).toBe(0.5);
  });
});

describe("o golden em si", () => {
  test("ids únicos e nenhuma frase do evalset nem dos exemplos do prompt", () => {
    expect(new Set(goldenCases.map((c) => c.id)).size).toBe(goldenCases.length);
    const evalRaws = new Set(evalCases.map((c) => c.raw));
    for (const c of goldenCases) {
      expect(evalRaws.has(c.raw)).toBe(false);
      expect(ENHANCEMENT_SYSTEM_TEMPLATE).not.toContain(c.raw);
    }
  });

  test("as regras sozinhas não caem: média ≥ 0,95 e nenhum caso zerado", () => {
    const scores = goldenCases.map((c) => scoreGolden(c, cleanupWithRules({ raw: c.raw, bundleId: c.bundleId, dictionary: c.dictionary }).text));
    expect(scores.filter((s) => s.score === 0)).toEqual([]);
    expect(meanScore(scores)).toBeGreaterThanOrEqual(0.95);
  });
});
