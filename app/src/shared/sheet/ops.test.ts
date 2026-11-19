// T21107: as operações da planilha na grade, o desfazer e o que a pessoa digita. Dados inventados (o estoque de uma loja).
import { describe, expect, test } from "bun:test";

import { applyToGrid, checkOp, formatKind, type Grid, type GridCell, parseInput, SheetHistory, SheetOpError } from "./ops.ts";

const c = (value: GridCell["value"], formula?: string): GridCell => ({ value, text: value === null ? "" : String(value), ...(formula ? { formula } : {}) });
const grid = (): Grid => ({
  sheets: [
    {
      name: "Estoque",
      rows: [
        [c("Produto"), c("Qtd"), c("Preço"), c("Total")],
        [c("Caneca"), c(7), c(24.9), c(174.3, "B2*C2")],
        [c("Regador"), c(5), c(31), c(155, "B3*C3")],
        [c("Soma"), c(12, "SUM(B2:B3)")],
      ],
    },
    { name: "Resumo", rows: [[c("Total"), c(329.3, "SUM(Estoque!D2:D3)")]] },
  ],
});
const values = (g: Grid, sheet = 0) => g.sheets[sheet]!.rows.map((r) => r.map((x) => x?.formula ?? x?.value ?? null));

describe("operações na grade", () => {
  test("mudar uma célula não mexe na grade de antes", () => {
    const g = grid();
    const n = applyToGrid(g, { op: "set", sheet: "Estoque", row: 1, col: 1, value: 8 });
    expect(n.sheets[0]!.rows[1]![1]!.value).toBe(8);
    expect(g.sheets[0]!.rows[1]![1]!.value).toBe(7);
    expect(n.sheets[1]).toBe(g.sheets[1]);
  });

  test("inserir linha anda as células e as fórmulas, nesta aba e nas que apontam para ela", () => {
    const n = applyToGrid(grid(), { op: "insertRows", sheet: "Estoque", at: 2, count: 1 });
    expect(values(n)).toEqual([
      ["Produto", "Qtd", "Preço", "Total"],
      ["Caneca", 7, 24.9, "B2*C2"],
      [],
      ["Regador", 5, 31, "B4*C4"],
      ["Soma", "SUM(B2:B4)"],
    ]);
    expect(values(n, 1)).toEqual([["Total", "SUM(Estoque!D2:D4)"]]);
  });

  test("apagar coluna: a fórmula que só apontava para ela vira #REF!", () => {
    const n = applyToGrid(grid(), { op: "deleteCols", sheet: "Estoque", at: 1, count: 1 });
    expect(values(n)[1]).toEqual(["Caneca", 24.9, "#REF!*B2"]);
    // A soma estava na coluna apagada e saiu com ela; o Resumo anda uma coluna.
    expect(values(n)[3]).toEqual(["Soma"]);
    expect(values(n, 1)).toEqual([["Total", "SUM(Estoque!C2:C3)"]]);
    const m = applyToGrid(grid(), { op: "deleteCols", sheet: "Estoque", at: 3, count: 1 });
    expect(values(m, 1)).toEqual([["Total", "SUM(Estoque!#REF!)"]]);
  });

  test("renomear a aba troca as fórmulas que citam ela", () => {
    const n = applyToGrid(grid(), { op: "renameSheet", sheet: "Estoque", name: "Loja centro" });
    expect(n.sheets[0]!.name).toBe("Loja centro");
    expect(values(n, 1)).toEqual([["Total", "SUM('Loja centro'!D2:D3)"]]);
  });

  test("um lote é uma operação só", () => {
    const n = applyToGrid(grid(), {
      op: "batch",
      ops: [
        { op: "set", sheet: "Estoque", row: 1, col: 1, value: 8 },
        { op: "set", sheet: "Estoque", row: 1, col: 3, value: 199.2, formula: "B2*C2" },
      ],
    });
    expect(n.sheets[0]!.rows[1]![3]!.value).toBe(199.2);
  });

  test("`cached` troca só o resultado: a fórmula fica, e a marca de desatualizada sai", () => {
    const g = grid();
    g.sheets[0]!.rows[1]![3] = { ...g.sheets[0]!.rows[1]![3]!, stale: true };
    const n = applyToGrid(g, { op: "cached", sheet: "Estoque", row: 1, col: 3, value: 199.2 });
    expect(n.sheets[0]!.rows[1]![3]).toEqual({ value: 199.2, text: "199.2", formula: "B2*C2" });
    expect(g.sheets[0]!.rows[1]![3]!.stale).toBe(true);
    expect(() => applyToGrid(g, { op: "cached", sheet: "Estoque", row: 1, col: 1, value: 1 })).toThrow("não tem fórmula");
    expect(() => applyToGrid(g, { op: "cached", sheet: "Estoque", row: 9, col: 9, value: 1 })).toThrow("não tem fórmula");
  });

  test("operações que não cabem são recusadas com o motivo", () => {
    const names = ["Estoque", "Resumo"];
    expect(() => checkOp({ op: "set", sheet: "Outra", row: 0, col: 0, value: 1 }, names)).toThrow(SheetOpError);
    expect(() => checkOp({ op: "addSheet", name: "resumo" }, names)).toThrow("já existe");
    expect(() => checkOp({ op: "renameSheet", sheet: "Estoque", name: "a/b" }, names)).toThrow(SheetOpError);
    expect(() => checkOp({ op: "renameSheet", sheet: "Estoque", name: "ESTOQUE" }, names)).not.toThrow();
    expect(() => checkOp({ op: "deleteRows", sheet: "Estoque", at: 0, count: 0 }, names)).toThrow(SheetOpError);
    expect(() => checkOp({ op: "set", sheet: "Estoque", row: -1, col: 0, value: 1 }, names)).toThrow(SheetOpError);
  });

  test("num lote, a aba nova e o nome novo valem para as operações seguintes (T21114)", () => {
    const names = ["Estoque", "Resumo"];
    const set = (sheet: string) => ({ op: "set" as const, sheet, row: 0, col: 0, value: 1 });
    expect(() => checkOp({ op: "batch", ops: [{ op: "addSheet", name: "Notas" }, set("Notas")] }, names)).not.toThrow();
    expect(() => checkOp({ op: "batch", ops: [{ op: "renameSheet", sheet: "Resumo", name: "Painel" }, set("Painel")] }, names)).not.toThrow();
    expect(() => checkOp({ op: "batch", ops: [{ op: "renameSheet", sheet: "Resumo", name: "Painel" }, set("Resumo")] }, names)).toThrow("não há aba chamada Resumo");
    expect(() => checkOp({ op: "batch", ops: [set("Notas"), { op: "addSheet", name: "Notas" }] }, names)).toThrow(SheetOpError);
    const g: Grid = { sheets: [{ name: "Estoque", rows: [] }] };
    const after = applyToGrid(g, { op: "batch", ops: [{ op: "addSheet", name: "Notas" }, set("Notas")] });
    expect(after.sheets.map((s) => s.name)).toEqual(["Estoque", "Notas"]);
    expect(after.sheets[1]!.rows[0]![0]!.value).toBe(1);
  });
});

describe("desfazer e refazer", () => {
  test("andam pelas operações; uma nova depois de desfazer corta o que estava à frente", () => {
    const h = new SheetHistory();
    const a = { op: "set", sheet: "Estoque", row: 1, col: 1, value: 8 } as const;
    const b = { op: "insertRows", sheet: "Estoque", at: 2, count: 1 } as const;
    const d = { op: "addSheet", name: "Compras" } as const;
    h.do(a);
    h.do(b);
    expect(h.ops).toEqual([a, b]);
    expect(h.undo()).toBe(b);
    expect(h.ops).toEqual([a]);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(b);
    expect(h.redo()).toBeNull();
    h.undo();
    h.do(d);
    expect(h.ops).toEqual([a, d]);
    expect(h.canRedo).toBe(false);
    h.undo();
    h.undo();
    expect(h.undo()).toBeNull();
    expect(h.canUndo).toBe(false);
  });

  test("a grade refeita a partir do original bate com a de cada passo", () => {
    const h = new SheetHistory();
    const steps: Grid[] = [grid()];
    for (const op of [
      { op: "set", sheet: "Estoque", row: 1, col: 1, value: 8 },
      { op: "deleteRows", sheet: "Estoque", at: 2, count: 1 },
      { op: "renameSheet", sheet: "Estoque", name: "Loja" },
    ] as const) {
      h.do(op);
      steps.push(applyToGrid(steps.at(-1)!, op));
    }
    const replay = () => h.ops.reduce((g, o) => applyToGrid(g, o), grid());
    expect(replay()).toEqual(steps[3]!);
    h.undo();
    expect(replay()).toEqual(steps[2]!);
    h.undo();
    h.undo();
    expect(replay()).toEqual(steps[0]!);
  });
});

describe("o que a pessoa digita", () => {
  test("números com os separadores do sistema", () => {
    expect(parseInput("8")).toEqual({ value: 8 });
    expect(parseInput("1.234,5")).toEqual({ value: 1234.5 });
    expect(parseInput("-0,75")).toEqual({ value: -0.75 });
    expect(parseInput("1,234.5", undefined, ".")).toEqual({ value: 1234.5 });
    expect(parseInput("1.2.3")).toEqual({ value: "1.2.3" });
  });

  test("porcentagem, moeda e data ganham o formato numa célula Geral, como no Excel", () => {
    expect(parseInput("31%")).toEqual({ value: 0.31, format: "0%" });
    expect(parseInput("12,5%")).toEqual({ value: 0.125, format: "0.0%" });
    expect(parseInput("31%", "0.00%")).toEqual({ value: 0.31 });
    expect(parseInput("R$ 10,50")).toEqual({ value: 10.5, format: '"R$" #,##0.00' });
    expect(parseInput("10,50", '"R$" #,##0.00')).toEqual({ value: 10.5 });
    expect(parseInput("03/11/2026")).toEqual({ value: 46329, format: "dd/mm/yyyy" });
    expect(parseInput("03/11/2026", "dd/mm/yyyy")).toEqual({ value: 46329 });
    expect(parseInput("31/02/2026")).toEqual({ value: "31/02/2026" });
  });

  test("fórmula, verdadeiro e falso, texto, vazio", () => {
    expect(parseInput("=B2*C2")).toEqual({ value: null, formula: "B2*C2" });
    expect(parseInput("verdadeiro")).toEqual({ value: true });
    expect(parseInput("Caneca azul")).toEqual({ value: "Caneca azul" });
    expect(parseInput("  ")).toEqual({ value: null });
    expect(parseInput("8", "@")).toEqual({ value: "8" });
  });

  test("o tipo do formato", () => {
    expect(formatKind(undefined)).toBe("general");
    expect(formatKind('"R$" #,##0.00')).toBe("currency");
    expect(formatKind("[$€-2] #,##0.00")).toBe("currency");
    expect(formatKind("0.00%")).toBe("percent");
    expect(formatKind("dd/mm/yyyy")).toBe("date");
    expect(formatKind("#,##0.00;[Red]-#,##0.00")).toBe("number");
  });
});
