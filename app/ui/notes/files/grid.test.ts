// A grade da planilha (T21038, spec #21008): larguras, as sobras vazias do fim, o número à direita e o pedaço na tela.
// O estoque de uma loja inventada.
import { describe, expect, test } from "bun:test";

import { CELL_PAD, columnWidths, isNumeric, MAX_COL, MIN_COL, OVERSCAN_ROWS, offsetsOf, ROW_H, SAMPLE_ROWS, SAMPLE_SPREAD, sampleRows, trimEmpty, visibleRange } from "./grid.ts";

/** 7 px por letra, 8 no negrito: o bastante para conferir as contas. */
const measure = (t: string, bold: boolean) => t.length * (bold ? 8 : 7);

describe("trimEmpty", () => {
  test("tira as linhas e as colunas vazias do fim, e deixa as do meio", () => {
    const rows = [
      ["1001", "", "Caneca", "", ""],
      ["", "", "", "", ""],
      ["1002", "", "Caderno", "", ""],
      ["", "", "", "", ""],
      ["", "", "", "", ""],
    ];
    expect(trimEmpty(["Código", "", "Produto", "", ""], rows, 5)).toEqual({ rows: rows.slice(0, 3), columns: 3 });
  });

  test("a coluna com nome no cabeçalho conta, mesmo sem dado embaixo", () => {
    expect(trimEmpty(["Código", "Obs"], [["1001", ""]], 2).columns).toBe(2);
  });

  test("linhas mais curtas que as outras não confundem", () => {
    expect(trimEmpty([], [["a"], ["b", "", "c"], []], 3)).toEqual({ rows: [["a"], ["b", "", "c"]], columns: 3 });
  });

  test("tudo vazio: nada", () => {
    expect(trimEmpty(["", ""], [["", ""]], 2)).toEqual({ rows: [], columns: 0 });
  });
});

describe("isNumeric", () => {
  test.each(["42", "-7", "1.200", "2.099,40", "R$ 29,90", "31,3%", "1e3", "  18 ", "(1.000,00)"])("%p é número", (t) => expect(isNumeric(t)).toBe(true));
  test.each(["", "Caneca", "03/11/2026", "14:30", "A5", "Caderno A5", "1001-B", "R$"])("%p não é", (t) => expect(isNumeric(t)).toBe(false));
});

describe("columnWidths", () => {
  test("o texto mais largo da coluna mais o respiro, entre o mínimo e o máximo", () => {
    const header = ["Código", "Produto", "Fornecedor de canecas e copos da loja de exemplo, filial do centro"];
    const rows = [
      ["1", "Caneca azul 300 ml", "Loja Exemplo"],
      ["2", "Caderno", ""],
    ];
    const w = columnWidths(header, rows, 3, measure);
    expect(w[0]).toBe(Math.max(MIN_COL, 6 * 8 + CELL_PAD));
    expect(w[1]).toBe(18 * 7 + CELL_PAD);
    expect(w[2]).toBe(MAX_COL);
  });

  test("a coluna estreita fica no mínimo", () => {
    expect(columnWidths([], [["x"]], 1, measure)).toEqual([MIN_COL]);
  });

  test("mede o começo e um pedaço espalhado pelo resto, o fim incluso", () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => [String(i + 1)]);
    const sample = sampleRows(rows);
    expect(sample.length).toBe(SAMPLE_ROWS + SAMPLE_SPREAD);
    expect(sample[0]).toBe(rows[0]);
    expect(sample.at(-1)).toBe(rows.at(-1));
    // O pedido 100000, na última linha, entra na largura.
    expect(columnWidths([], rows, 1, measure)).toEqual([Math.max(MIN_COL, 6 * 7 + CELL_PAD)]);
  });

  test("uma planilha pequena é medida inteira", () => {
    const rows = Array.from({ length: SAMPLE_ROWS + SAMPLE_SPREAD }, (_, i) => [i === SAMPLE_ROWS + 50 ? "uma célula comprida" : "x"]);
    expect(sampleRows(rows)).toBe(rows);
    expect(columnWidths([], rows, 1, measure)).toEqual([19 * 7 + CELL_PAD]);
  });

  test("não mede tudo: uma linha fora da amostra não muda a largura", () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => [i === 50_001 ? "uma célula bem comprida no meio" : "x"]);
    expect(sampleRows(rows)).not.toContain(rows[50_001]);
    expect(columnWidths([], rows, 1, measure)).toEqual([MIN_COL]);
  });
});

describe("visibleRange", () => {
  const widths = Array.from({ length: 256 }, () => 100);
  const offsets = offsetsOf(widths);

  test("o começo: as linhas e colunas da tela, mais a folga", () => {
    const r = visibleRange({ left: 0, top: 0, width: 800, height: 600 }, offsets, 100_000);
    expect(r.row0).toBe(0);
    expect(r.row1).toBe(600 / ROW_H + OVERSCAN_ROWS);
    expect(r.col0).toBe(0);
    expect(r.col1).toBeGreaterThanOrEqual(8);
    expect(r.col1).toBeLessThan(20);
  });

  test("no meio de 256 colunas e 100.000 linhas, só um pedaço pequeno", () => {
    const r = visibleRange({ left: 20_000, top: 1_500_000, width: 800, height: 600 }, offsets, 100_000);
    expect(r.row0).toBe(1_500_000 / ROW_H - OVERSCAN_ROWS);
    expect(r.row1 - r.row0).toBeLessThan(60);
    expect(r.col0).toBeLessThanOrEqual(200);
    expect(r.col1).toBeGreaterThan(208);
    expect(r.col1 - r.col0).toBeLessThan(20);
  });

  test("o fim não passa do total", () => {
    const r = visibleRange({ left: 25_600, top: 3_000_000, width: 800, height: 600 }, offsets, 100_000);
    expect(r.row1).toBe(100_000);
    expect(r.col1).toBe(256);
  });

  test("sem colunas", () => {
    expect(visibleRange({ left: 0, top: 0, width: 800, height: 600 }, [0], 3)).toEqual({ row0: 0, row1: 3, col0: 0, col1: 0 });
  });
});
