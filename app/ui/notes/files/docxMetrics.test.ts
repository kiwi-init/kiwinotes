import { expect, test } from "bun:test";

import { WORD_LINE_EM, wordLineMetrics, wordMeasurer } from "./docxMetrics.ts";

test("a linha de uma fonte da tabela fica na altura do Word, e a base desce na mesma proporção", () => {
  // O canvas mede 12,5 pt numa Helvetica de 11 pt; o Word põe 11 × 1,1753.
  const m = wordLineMetrics({ height: 12.5, baseline: 10 }, { fontFamily: "Helvetica", fontSizePt: 11 });
  expect(m.height).toBeCloseTo(11 * (2407 / 2048), 6);
  expect(m.baseline / m.height).toBeCloseTo(10 / 12.5, 6);
});

test("só cresce: a fonte que o canvas já mede mais alta, a de fora da tabela e o tamanho estranho ficam como vieram", () => {
  const measured = { height: 20, baseline: 16 };
  expect(wordLineMetrics(measured, { fontFamily: "Georgia", fontSizePt: 11 })).toBe(measured);
  expect(wordLineMetrics(measured, { fontFamily: "Fonte Inventada", fontSizePt: 30 })).toBe(measured);
  expect(wordLineMetrics(measured, { fontFamily: null, fontSizePt: 30 })).toBe(measured);
  expect(wordLineMetrics(measured, { fontFamily: "Arial", fontSizePt: 0 })).toBe(measured);
  expect(wordLineMetrics({ height: 0, baseline: 0 }, { fontFamily: "Arial", fontSizePt: 11 })).toEqual({ height: 0, baseline: 0 });
});

test("o nome da família vale com espaço e maiúscula, e as livres de métrica igual têm o número da que copiam", () => {
  const a = wordLineMetrics({ height: 1, baseline: 0.8 }, { fontFamily: "  Times New Roman ", fontSizePt: 12 });
  expect(a.height).toBeCloseTo(12 * WORD_LINE_EM["times new roman"]!, 6);
  expect(WORD_LINE_EM.carlito).toBe(WORD_LINE_EM.calibri!);
  // A Cambria e a Caladea ficam de fora (sem número conferido): a linha delas é a do canvas.
  expect(WORD_LINE_EM.cambria).toBeUndefined();
  expect(wordLineMetrics({ height: 14, baseline: 11 }, { fontFamily: "Cambria", fontSizePt: 11 })).toEqual({ height: 14, baseline: 11 });
  expect(WORD_LINE_EM["liberation sans"]).toBe(WORD_LINE_EM.arial!);
  // Toda linha do Word é mais alta que o em, e nenhuma passa de 1,5 em.
  for (const em of Object.values(WORD_LINE_EM)) expect(em > 1 && em < 1.5).toBe(true);
});

test("o medidor só troca a altura da linha: a largura e o resto são os do canvas", () => {
  const base = {
    measure: (text: string) => text.length * 5,
    lineMetrics: () => ({ height: 12, baseline: 9.6 }),
    hasResolvedFont: () => true,
  };
  const m = wordMeasurer(base as never);
  const style = { fontFamily: "Verdana", fontSizePt: 11 } as never;
  expect(m.measure("abc", style)).toBe(15);
  expect(m.hasResolvedFont?.(style)).toBe(true);
  expect(m.lineMetrics(style).height).toBeCloseTo(11 * (2489 / 2048), 6);
  expect(m.lineMetrics({ fontFamily: "Fonte Inventada", fontSizePt: 11 } as never)).toEqual({ height: 12, baseline: 9.6 });
});
