// Os passos do Kiwi Cat na grade (T21114): onde cada célula escrita ficou no fim. Tudo inventado.

import { describe, expect, test } from "bun:test";

import { KIWI_CELL_MAX_MS, kiwiSheetOf, kiwiSteps, typingFrames } from "./kiwi-sheet.ts";

describe("kiwiSteps (T21114)", () => {
  test("as células na ordem, e a recalculada à parte", () => {
    const s = kiwiSteps(
      [
        { op: "set", sheet: "Estoque", row: 1, col: 2, value: 10 },
        { op: "cached", sheet: "Estoque", row: 1, col: 4, value: 249 },
        { op: "set", sheet: "Resumo", row: 0, col: 0, value: "x" },
        { op: "set", sheet: "Estoque", row: 2, col: 0, value: "Jarra" },
      ],
      "Estoque",
    );
    expect(s.cells).toEqual([{ row: 1, col: 2 }, { row: 2, col: 0 }]);
    expect(s.recalc).toEqual([{ row: 1, col: 4 }]);
    expect(s.shifted).toBe(false);
  });

  test("a linha inserida depois empurra a célula, e a apagada a tira", () => {
    const s = kiwiSteps(
      [
        { op: "set", sheet: "A", row: 3, col: 0, value: "um" },
        { op: "set", sheet: "A", row: 5, col: 0, value: "dois" },
        { op: "insertRows", sheet: "A", at: 2, count: 2 },
        { op: "deleteRows", sheet: "A", at: 7, count: 1 },
      ],
      "A",
    );
    expect(s.cells).toEqual([{ row: 5, col: 0 }]);
    expect(s.rowsIn).toEqual([2, 3]);
    expect(s.shifted).toBe(true);
  });

  test("a coluna inserida e a aba renomeada no mesmo lote", () => {
    const s = kiwiSteps(
      [
        {
          op: "batch",
          ops: [
            { op: "insertCols", sheet: "A", at: 1, count: 1 },
            { op: "set", sheet: "A", row: 0, col: 1, value: "Novo" },
            { op: "renameSheet", sheet: "A", name: "B" },
          ],
        },
      ],
      "B",
    );
    expect(s.colsIn).toEqual([1]);
    expect(s.cells).toEqual([{ row: 0, col: 1 }]);
    expect(kiwiSteps([{ op: "set", sheet: "A", row: 0, col: 0, value: 1 }, { op: "renameSheet", sheet: "A", name: "B" }], "A").cells).toEqual([]);
  });

  test("a recalculada que o gato escreveu continua dele", () => {
    const s = kiwiSteps([{ op: "set", sheet: "A", row: 0, col: 0, value: 1 }, { op: "cached", sheet: "A", row: 0, col: 0, value: 1 }], "A");
    expect(s.cells).toHaveLength(1);
    expect(s.recalc).toHaveLength(0);
  });

  test("kiwiSheetOf dá a aba com o nome do fim", () => {
    expect(kiwiSheetOf([{ op: "set", sheet: "A", row: 0, col: 0, value: 1 }, { op: "renameSheet", sheet: "A", name: "B" }])).toBe("B");
    expect(kiwiSheetOf([{ op: "renameSheet", sheet: "A", name: "B" }])).toBeNull();
  });
});

describe("typingFrames", () => {
  test("termina no texto inteiro e não passa do máximo por célula", () => {
    expect(typingFrames("")).toEqual({ frames: [""], stepMs: 32 });
    expect(typingFrames("abc").frames).toEqual(["a", "ab", "abc"]);
    const long = typingFrames("x".repeat(200));
    expect(long.frames.at(-1)).toBe("x".repeat(200));
    expect(long.frames.length * long.stepMs).toBeLessThanOrEqual(KIWI_CELL_MAX_MS + long.stepMs);
  });
});
