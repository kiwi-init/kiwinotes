// O recálculo das fórmulas (T21108, spec #21065 parte 3): mudou um número, as fórmulas que dependem dele mudam na grade
// e no arquivo; a função desconhecida fica marcada, nunca errada. Sobre o estoque inventado do T21107
// (`test/fixtures/sheet/estoque.xlsx`) e grades pequenas, também inventadas.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { applyToGrid, plainDisplay, type CellValue, type Grid, type GridCell, type SheetOp } from "../ops.ts";
import { patchXlsx, readXlsx, type XlsxBook } from "../xlsx.ts";
import { hasFormulas } from "./has-formulas.ts";
import { calibrate, recalc, recalcOps } from "./recalc.ts";

const ESTOQUE = new Uint8Array(readFileSync(path.join(import.meta.dir, "../../../../test/fixtures/sheet/estoque.xlsx")));

const gridOf = (book: XlsxBook): Grid => ({
  sheets: book.sheets.map((s) => ({
    name: s.name,
    rows: s.rows.map((r) => r.map((c): GridCell | undefined => (c ? { ...c, text: plainDisplay(c.value, c.format) } : undefined))),
  })),
});

/** Uma grade de uma aba a partir de linhas: "=…" é fórmula (sem valor ainda), o resto é valor. */
const small = (rows: (CellValue | `=${string}`)[][], name = "Caixa"): Grid => ({
  sheets: [
    {
      name,
      rows: rows.map((r) =>
        r.map((v): GridCell | undefined =>
          v === null ? undefined : typeof v === "string" && v.startsWith("=") ? { value: null, formula: v.slice(1), text: "" } : { value: v, text: plainDisplay(v) },
        ),
      ),
    },
  ],
});

const cell = (g: Grid, ref: string, sheet = 0) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return g.sheets[sheet]!.rows[Number(m[2]) - 1]?.[m[1]!.charCodeAt(0) - 65];
};

/** A edição como a grade faz (T21109): o `set` da pessoa e os `cached` do recálculo, num batch só. */
function edit(g: Grid, op: SheetOp) {
  const applied = applyToGrid(g, op);
  const after = recalc(applied);
  const batch: SheetOp = { op: "batch", ops: [op, ...recalcOps(applied, after)] };
  return { grid: after, batch };
}

describe("recalc: a grade", () => {
  test("mudou a quantidade: o total da linha, a soma e a aba Resumo mudam", () => {
    const g = calibrate(gridOf(readXlsx(ESTOQUE)));
    const linha = Number(cell(g, "E2")!.value);
    const d2 = Number(cell(g, "D2")!.value);
    const somaE = Number(cell(g, "E8")!.value);
    const { grid } = edit(g, { op: "set", sheet: "Estoque", row: 1, col: 2, value: 100 });
    expect(cell(grid, "E2")!.value).toBeCloseTo(100 * d2);
    expect(cell(grid, "E8")!.value).toBeCloseTo(somaE - linha + 100 * d2);
    expect(cell(grid, "B2", 1)!.value).toBeCloseTo(somaE - linha + 100 * d2);
    expect(cell(grid, "B1", 1)!.value).toBe(cell(grid, "C8")!.value);
  });

  test("a referência de tabela fica marcada com o valor antigo; as outras fórmulas calculam", () => {
    const book = readXlsx(ESTOQUE);
    const g = calibrate(gridOf(book));
    const resumo = g.sheets[1]!;
    const prazo = resumo.rows.findIndex((r) => r?.[1]?.formula?.includes("Fornecedores["));
    expect(prazo).toBeGreaterThanOrEqual(0);
    expect(resumo.rows[prazo]![1]).toMatchObject({ stale: "recheck", value: book.sheets[1]!.rows[prazo]![1]!.value });
    expect(cell(g, "E8")!.stale).toBeUndefined();
  });

  test("uma função desconhecida fica marcada, com o valor antigo, e quem depende dela também, até o SEERRO", () => {
    const g = small([[2, "=FUNCAOINVENTADA(A1)", "=B1*2", "=IFERROR(C1,0)", "=A1*3"]]);
    g.sheets[0]!.rows[0]![1] = { value: 7, formula: "FUNCAOINVENTADA(A1)", text: "7" };
    g.sheets[0]!.rows[0]![2] = { value: 14, formula: "B1*2", text: "14" };
    g.sheets[0]!.rows[0]![3] = { value: 14, formula: "IFERROR(C1,0)", text: "14" };
    const r = recalc(g);
    expect(r.sheets[0]!.rows[0]!.map((c) => [c!.value, c!.stale ?? false])).toEqual([
      [2, false],
      [7, "recheck"],
      [14, "recheck"],
      [14, "recheck"],
      [6, false],
    ]);
    expect(recalcOps(g, r)).toEqual([{ op: "cached", sheet: "Caixa", row: 0, col: 4, value: 6 }]);
  });

  test("o #DIV/0! é resultado; o erro em que o Excel pode discordar e o ciclo ficam marcados, com o valor antigo", () => {
    const g = small([[0, "=1/A1", '=VLOOKUP("x",A1:A1,1,FALSE)', "=D1+1", "=SQRT(-1)"]]);
    g.sheets[0]!.rows[0]![2] = { value: "#N/A", formula: 'VLOOKUP("x",A1:A1,1,FALSE)', text: "#N/A" };
    const r = recalc(g);
    // O PROCV de texto numa coluna de números dá #VALUE! no HyperFormula e #N/A no Excel: fica o #N/A, marcado.
    expect(r.sheets[0]!.rows[0]!.slice(1).map((c) => [c!.value, c!.stale ?? false])).toEqual([
      ["#DIV/0!", false],
      ["#N/A", "recheck"],
      [null, "recheck"],
      [null, "recheck"],
    ]);
    // A célula que já tinha o mesmo erro não é marcada.
    const ja = small([[null, "=SQRT(-1)"]]);
    ja.sheets[0]!.rows[0]![1] = { value: "#NUM!", formula: "SQRT(-1)", text: "#NUM!" };
    expect(recalc(ja).sheets[0]!.rows[0]![1]).toEqual({ value: "#NUM!", formula: "SQRT(-1)", text: "#NUM!" });
  });

  test("o VERDADEIRO/FALSO solto da fórmula, como o Excel grava, calcula", () => {
    const r = recalc(small([["caixa", 5, '=VLOOKUP("caixa",A1:B1,2,FALSE)', "=IF(TRUE,1,2)", '="FALSE"&"!"']]));
    expect(r.sheets[0]!.rows[0]!.slice(2).map((c) => [c!.value, c!.stale ?? false])).toEqual([
      [5, false],
      [1, false],
      ["FALSE!", false],
    ]);
  });

  test("o texto que parece número ou fórmula continua texto; a célula vazia vale 0", () => {
    const g = small([["007", null, "=A1&B1", "=LEN(A1)", "=Z9"]]);
    g.sheets[0]!.rows[0]![1] = { value: "=x", text: "=x" };
    const r = recalc(g);
    expect(r.sheets[0]!.rows[0]!.slice(2).map((c) => c!.value)).toEqual(["007=x", 3, 0]);
  });

  test("os nomes definidos calculam; o _xlfn. das funções novas também", () => {
    const g = small([[3, 4, "=SUM(Pecas)", "=_xlfn.XLOOKUP(4,A1:B1,A1:B1)"]], "Loja");
    const r = recalc(g, plainDisplay, [{ name: "Pecas", formula: "Loja!$A$1:$B$1" }]);
    expect(r.sheets[0]!.rows[0]!.slice(2).map((c) => [c!.value, c!.stale ?? false])).toEqual([
      [7, false],
      [4, false],
    ]);
  });

  test("o texto da célula segue o formato dela", () => {
    const g = small([[2, "=A1*1.5"]]);
    g.sheets[0]!.rows[0]![1]!.format = "0.00";
    const r = recalc(g, (v, f) => (f === "0.00" && typeof v === "number" ? v.toFixed(2) : String(v)));
    expect(cell(r, "B1")).toMatchObject({ value: 3, text: "3.00", format: "0.00" });
  });

  test("sem fórmula, a mesma grade, sem carregar nada", () => {
    const g = small([[1, 2, "três"]]);
    expect(hasFormulas(g)).toBe(false);
    expect(recalc(g)).toBe(g);
  });

  test("uma célula que não é fórmula nunca muda, e a fórmula que não mudou não vira operação", () => {
    const g = recalc(small([[1, 2, "=A1+B1"]]));
    expect(recalcOps(g, recalc(g))).toEqual([]);
    expect(recalc(g).sheets[0]!.rows[0]!.slice(0, 2)).toEqual(g.sheets[0]!.rows[0]!.slice(0, 2));
  });
});

describe("calibrate: o que o Excel gravou manda", () => {
  /** Uma aba como o Excel gravaria: cada fórmula com o valor que ele calculou. */
  const gravada = (cells: [CellValue, string?][]) => ({
    sheets: [{ name: "Caixa", rows: [cells.map(([value, formula]): GridCell => (formula ? { value, formula, text: plainDisplay(value) } : { value, text: plainDisplay(value) }))] }],
  });
  // As contas em que o HyperFormula e o Excel divergem, com o valor que o Excel grava (a sonda da revisão, #21910).
  const g = gravada([
    [1],
    [2],
    [3],
    [-2, "INT(-1.5)"],
    [2, "SUMPRODUCT((A1:C1>1)*1)"],
    ["1,234.50", 'TEXT(1234.5,"#,##0.00")'],
    [10 / 3, "10/3"],
    [0.1 + 0.2, "0.1+0.2"],
    [1 - 0.9, "1-0.9"],
    [-4, "D1*2"],
    [46000.5, "NOW()"],
    [6, "SUM(A1:C1)"],
    [null, "A1+B1"],
  ]);

  test("sem edição: nenhum valor gravado muda e nenhuma operação sai além da fórmula sem valor", () => {
    // A fórmula sem valor gravado ganha o do HyperFormula; é a única operação.
    const aberta = calibrate(g);
    expect(aberta.sheets[0]!.rows[0]![12]).toMatchObject({ value: 3 });
    expect(recalcOps(g, aberta)).toEqual([{ op: "cached", sheet: "Caixa", row: 0, col: 12, value: 3 }]);
    // Com todos os valores gravados, nada muda.
    const cheia = structuredClone(g);
    cheia.sheets[0]!.rows[0]![12]!.value = 3;
    const c = calibrate(cheia);
    expect(c.sheets[0]!.rows[0]!.map((x) => x!.value)).toEqual(cheia.sheets[0]!.rows[0]!.map((x) => x!.value));
    expect(recalcOps(cheia, c)).toEqual([]);
    expect(recalcOps(c, recalc(c))).toEqual([]);
  });

  test("a fórmula em que o HyperFormula não chega ao valor do Excel fica marcada, e quem depende dela também", () => {
    const c = calibrate(g);
    const marcadas = c.sheets[0]!.rows[0]!.flatMap((x, i) => (x?.stale ? [x.formula ?? i] : []));
    // O INT calcula como no Excel (vai ao motor como FLOOR.MATH); o TEXT está na lista das divergências.
    expect(marcadas).toEqual(['TEXT(1234.5,"#,##0.00")', "NOW()"]);
    expect(c.sheets[0]!.rows[0]!.map((x) => x!.stale).filter(Boolean)).toEqual([true, true]);
  });

  test("o double inteiro e a conta com faixas, como no Excel", () => {
    const r = recalc(small([[1, 2, 3, "=10/3", "=0.1+0.2", "=SUMPRODUCT((A1:C1>1)*1)"]]));
    expect(r.sheets[0]!.rows[0]!.slice(3).map((x) => x!.value)).toEqual([10 / 3, 0.1 + 0.2, 2]);
  });

  test("depois da edição: a marca fica, e só muda o que depende da célula editada", () => {
    const c = calibrate(g);
    const { grid, batch } = edit(c, { op: "set", sheet: "Caixa", row: 0, col: 0, value: 5 });
    expect(batch).toEqual({
      op: "batch",
      ops: [
        { op: "set", sheet: "Caixa", row: 0, col: 0, value: 5 },
        { op: "cached", sheet: "Caixa", row: 0, col: 4, value: 3 },
        { op: "cached", sheet: "Caixa", row: 0, col: 11, value: 10 },
        { op: "cached", sheet: "Caixa", row: 0, col: 12, value: 7 },
      ],
    });
    expect(grid.sheets[0]!.rows[0]![5]).toMatchObject({ value: "1,234.50", stale: true });
    expect(grid.sheets[0]!.rows[0]![10]).toMatchObject({ value: 46000.5, stale: true });
  });
});

describe("as marcas: a que fica e a que se confere de novo", () => {
  test("reescrita a fórmula que não batia, a que dependia dela calcula", () => {
    const g = {
      sheets: [
        {
          name: "Caixa",
          rows: [
            [
              { value: 5, text: "5" },
              { value: 3, formula: "ROUNDDOWN(A1/2,0)*1.5", text: "3" },
              { value: 6, formula: "B1*2", text: "6" },
              { value: 1, formula: "C1-5", text: "1" },
            ] as GridCell[],
          ],
        },
      ],
    };
    // B1 grava 3, e o motor dá 3: para forçar a divergência, o arquivo diz 4.
    g.sheets[0]!.rows[0]![1]!.value = 4;
    const c = calibrate(g);
    expect(c.sheets[0]!.rows[0]!.slice(1).map((x) => x!.stale)).toEqual([true, "recheck", "recheck"]);
    // Num recálculo qualquer, B1 continua marcada (fica), e C1 e D1 continuam porque B1 continua.
    const r = recalc(c);
    expect(r.sheets[0]!.rows[0]!.slice(1).map((x) => [x!.value, x!.stale])).toEqual([
      [4, true],
      [6, "recheck"],
      [1, "recheck"],
    ]);
    // A pessoa reescreve B1: a marca sai dela, e C1 e D1 calculam.
    const { grid, batch } = edit(r, { op: "set", sheet: "Caixa", row: 0, col: 1, value: null, formula: "A1+1" });
    expect(grid.sheets[0]!.rows[0]!.slice(1).map((x) => [x!.value, x!.stale ?? null])).toEqual([
      [6, null],
      [12, null],
      [7, null],
    ]);
    expect(batch.op === "batch" && batch.ops.length).toBe(4);
  });

  test("sem valor gravado, a divergência conhecida não passa calada", () => {
    const r = recalc(small([[-1.5, "=INT(A1)", '=TEXT(1234.5,"#,##0.00")', '=TEXT(A1,"0%")&"INT(x)"', '="TEXT("&A1']]));
    expect(r.sheets[0]!.rows[0]!.slice(1).map((x) => [x!.value, x!.stale ?? null])).toEqual([
      [-2, null],
      [null, "recheck"],
      [null, "recheck"],
      ["TEXT(-1.5", null],
    ]);
  });
});

describe("recalc: o arquivo", () => {
  test("a edição e o recálculo num batch: o arquivo reabre com os valores novos, no Kiwi e no SheetJS", () => {
    const g = calibrate(gridOf(readXlsx(ESTOQUE)));
    const { grid, batch } = edit(g, { op: "set", sheet: "Estoque", row: 1, col: 2, value: 100 });
    const out = patchXlsx(ESTOQUE, [batch]);
    const back = readXlsx(out);
    expect(back.sheets[0]!.rows[7]![4]!.value).toBeCloseTo(Number(cell(grid, "E8")!.value));
    expect(back.sheets[1]!.rows[1]![1]!.value).toBeCloseTo(Number(cell(grid, "B2", 1)!.value));
    expect(back.sheets[0]!.rows[7]![4]!.formula).toBe("SUM(E2:E7)");
    const wb = XLSX.read(out);
    expect(wb.Sheets.Estoque!.E8.v).toBeCloseTo(Number(cell(grid, "E8")!.value));
    expect(wb.Sheets.Estoque!.E8.f).toBe("SUM(E2:E7)");
  });

  test("uma fórmula nova digitada: calcula, e o resultado vai junto", () => {
    const g = calibrate(gridOf(readXlsx(ESTOQUE)));
    const { grid, batch } = edit(g, { op: "set", sheet: "Resumo", row: 5, col: 1, value: null, formula: "Estoque!C2*2" });
    const esperado = Number(cell(g, "C2")!.value) * 2;
    expect(cell(grid, "B6", 1)!.value).toBe(esperado);
    expect(readXlsx(patchXlsx(ESTOQUE, [batch])).sheets[1]!.rows[5]![1]).toMatchObject({ formula: "Estoque!C2*2", value: esperado });
  });

  test("50 mil linhas com fórmula recalculam a tempo", () => {
    const rows: (CellValue | `=${string}`)[][] = Array.from({ length: 50_000 }, (_, i) => [i % 97, 3, `=A${i + 1}*B${i + 1}`]);
    rows.push([null, null, "=SUM(C1:C50000)"]);
    const g = small(rows);
    const t0 = performance.now();
    const r = recalc(g);
    const ms = performance.now() - t0;
    expect(r.sheets[0]!.rows[50_000]![2]!.value).toBe(rows.slice(0, 50_000).reduce((a, x) => a + Number(x[0]) * 3, 0));
    expect(ms).toBeLessThan(15_000);
  }, 30_000);
});
