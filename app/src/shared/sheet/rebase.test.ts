// A edição da pessoa refeita sobre a gravação do gato (T21114). Tudo inventado.

import { describe, expect, test } from "bun:test";

import { moveCell, rebaseOps } from "./rebase.ts";

describe("rebaseOps", () => {
  test("a célula da pessoa anda com a linha que o gato inseriu acima, e a fórmula também", () => {
    const out = rebaseOps(
      [{ op: "batch", ops: [{ op: "set", sheet: "Estoque", row: 5, col: 4, value: null, formula: "C6*D6" }, { op: "cached", sheet: "Estoque", row: 5, col: 4, value: 3 }] }],
      [{ op: "insertRows", sheet: "Estoque", at: 3, count: 1 }, { op: "set", sheet: "Estoque", row: 3, col: 0, value: "Jarra" }],
    );
    expect(out).toEqual([{ op: "set", sheet: "Estoque", row: 6, col: 4, value: null, formula: "C7*D7" }]);
  });

  test("a linha apagada pelo gato leva a célula da pessoa; a de baixo sobe", () => {
    const theirs = [{ op: "deleteRows" as const, sheet: "A", at: 2, count: 1 }];
    expect(rebaseOps([{ op: "set", sheet: "A", row: 2, col: 0, value: "x" }], theirs)).toEqual([]);
    expect(rebaseOps([{ op: "set", sheet: "A", row: 4, col: 0, value: "x" }], theirs)).toEqual([{ op: "set", sheet: "A", row: 3, col: 0, value: "x" }]);
  });

  test("a aba renomeada e outra aba sem mudança", () => {
    expect(rebaseOps([{ op: "set", sheet: "A", row: 0, col: 0, value: 1 }, { op: "set", sheet: "B", row: 0, col: 0, value: 2 }], [{ op: "renameSheet", sheet: "A", name: "Novo" }, { op: "insertCols", sheet: "Novo", at: 0, count: 1 }])).toEqual([
      { op: "set", sheet: "Novo", row: 0, col: 1, value: 1 },
      { op: "set", sheet: "B", row: 0, col: 0, value: 2 },
    ]);
  });

  test("a linha que a pessoa inseriu conta para a célula dela que vem depois", () => {
    // A pessoa inseriu a linha 1 e escreveu na 6 (que era a 5); o gato inseriu na 3 do arquivo de antes.
    const out = rebaseOps(
      [{ op: "insertRows", sheet: "A", at: 1, count: 1 }, { op: "set", sheet: "A", row: 6, col: 0, value: "y" }],
      [{ op: "insertRows", sheet: "A", at: 3, count: 2 }],
    );
    expect(out).toEqual([{ op: "insertRows", sheet: "A", at: 1, count: 1 }, { op: "set", sheet: "A", row: 8, col: 0, value: "y" }]);
  });
});

describe("moveCell", () => {
  test("a caixa aberta segue a célula", () => {
    expect(moveCell({ sheet: "", row: 4, col: 1 }, [{ op: "insertRows", sheet: "", at: 2, count: 1 }])).toEqual({ sheet: "", row: 5, col: 1 });
    expect(moveCell({ sheet: "", row: 4, col: 1 }, [{ op: "deleteCols", sheet: "", at: 1, count: 1 }])).toBeNull();
  });
});
