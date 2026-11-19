// A planilha editável (T21109): abrir, digitar, colar, apagar, inserir, gravar sem perda, a ordem e o filtro da vista e
// o ⌘F. Dados inventados (o estoque de uma loja).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { readXlsx } from "../../../src/shared/sheet/xlsx.ts";
import type { GridSheet, SheetOp } from "../../../src/shared/sheet/ops.ts";
import {
  clearOps,
  clipboardText,
  docBytes,
  editBatch,
  editText,
  findCells,
  inputOp,
  openDoc,
  parseClipboard,
  pasteOps,
  replay,
  sheetDisplay,
  sheetTexts,
  shownGrid,
  viewRows,
} from "./sheet-doc.ts";

const ESTOQUE = new Uint8Array(readFileSync(path.join(import.meta.dir, "../../../test/fixtures/sheet/estoque.xlsx")));
const display = sheetDisplay(XLSX.SSF, ",");
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("abrir", () => {
  test("xlsx: as abas, o texto no formato da célula com a vírgula, a fórmula guardada", () => {
    const doc = openDoc(ESTOQUE, "estoque.xlsx", display);
    expect(doc.kind).toBe("xlsx");
    expect(doc.readOnly).toBeNull();
    expect(doc.base.sheets.map((s) => s.name)).toEqual(["Estoque", "Resumo", "Fornecedores"]);
    const preco = doc.base.sheets[0]!.rows[1]![3]!;
    expect(preco.text).toBe("R$ 24,90");
    expect(doc.base.sheets[0]!.rows[1]![4]!.formula).toBe("C2*D2");
  });

  test("csv: as células são texto, como no arquivo", () => {
    const doc = openDoc(enc("Produto;Qtd\nCaneca;7\n"), "loja.csv");
    expect(doc.kind).toBe("delimited");
    expect(sheetTexts(doc.base.sheets[0]!)).toEqual([["Produto", "Qtd"], ["Caneca", "7"]]);
  });

  test("um xlsx que não abre lança", () => {
    expect(() => openDoc(enc("não é planilha"), "x.xlsx")).toThrow();
  });
});

describe("digitar numa célula", () => {
  const doc = openDoc(ESTOQUE, "estoque.xlsx", display);
  const est = doc.base.sheets[0]!;

  test("o texto da caixa: a fórmula em português, o número com a vírgula", () => {
    expect(editText(est.rows[7]![2], ",")).toBe("=SOMA(C2:C7)");
    expect(editText(est.rows[1]![3], ",")).toBe("24,9");
    expect(editText(est.rows[1]![0], ",")).toBe("Caneca azul");
    expect(editText(undefined, ",")).toBe("");
  });

  test("número, moeda e fórmula em português viram a operação do arquivo", () => {
    expect(inputOp(doc, "Estoque", 1, 2, "8", est.rows[1]![2], ",")).toEqual({ op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 });
    expect(inputOp(doc, "Estoque", 9, 0, "R$ 10,50", undefined, ",")).toMatchObject({ value: 10.5, format: '"R$" #,##0.00' });
    expect(inputOp(doc, "Estoque", 9, 1, "=SOMA(C2;C3)", undefined, ",")).toMatchObject({ formula: "SUM(C2,C3)" });
  });

  test("no csv, o que se digita fica texto", () => {
    const csv = openDoc(enc("A;B\n1;2\n"), "a.csv");
    expect(inputOp(csv, "", 1, 0, "007", undefined, ",")).toEqual({ op: "set", sheet: "", row: 1, col: 0, value: "007" });
  });

  test("a edição leva o recálculo junto, num passo só", async () => {
    const op = await editBatch(doc, doc.base, [inputOp(doc, "Estoque", 1, 2, "8", est.rows[1]![2], ",")], display);
    expect(op.op).toBe("batch");
    const ops = (op as { ops: SheetOp[] }).ops;
    expect(ops[0]).toMatchObject({ op: "set", row: 1, col: 2, value: 8 });
    // E2 = 8 × 24,9; a soma das quantidades passa de 49 a 50.
    expect(ops).toContainEqual({ op: "cached", sheet: "Estoque", row: 1, col: 4, value: 8 * 24.9 });
    expect(ops).toContainEqual({ op: "cached", sheet: "Estoque", row: 7, col: 2, value: 50 });
    const grid = await shownGrid(doc, [op], display);
    expect(grid.sheets[0]!.rows[1]![4]!.text).toBe("R$ 199,20");
    // A média de uma coluna de tabela o Kiwi não refaz: fica marcada.
    expect(grid.sheets[1]!.rows[2]![1]!.stale).toBe(true);
  });

  test("gravar reaplica sobre o original, e a fórmula fica", async () => {
    const op = await editBatch(doc, doc.base, [inputOp(doc, "Estoque", 1, 2, "8", est.rows[1]![2], ",")], display);
    const grid = replay(doc, [op], display);
    const back = readXlsx(docBytes(doc, [op], grid), "estoque.xlsx").sheets[0]!;
    expect(back.rows[1]![2]!.value).toBe(8);
    expect(back.rows[1]![4]).toMatchObject({ formula: "C2*D2", value: 8 * 24.9 });
  });
});

describe("colar e copiar um bloco", () => {
  test("o texto do Excel: tabs, quebras e aspas", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseClipboard('"duas\nlinhas"\t"com ""aspas"""\n')).toEqual([["duas\nlinhas", 'com "aspas"']]);
    expect(parseClipboard("só uma")).toEqual([["só uma"]]);
    expect(parseClipboard("a\t\tc")).toEqual([["a", "", "c"]]);
  });

  test("o copiar volta igual pelo colar", () => {
    const block = [["Caneca", "duas\nlinhas"], ['com "aspas"', "a\tb"]];
    expect(parseClipboard(clipboardText(block))).toEqual(block);
    expect(clipboardText([["1", "2"], ["3", "4"]])).toBe("1\t2\n3\t4");
  });

  test("colar um bloco a partir de uma célula", () => {
    const doc = openDoc(ESTOQUE, "estoque.xlsx", display);
    const ops = pasteOps(doc, doc.base.sheets[2]!, 4, 0, parseClipboard("Cerâmica Fictícia\tCidade D\t12\n"), ",");
    expect(ops).toEqual([
      { op: "set", sheet: "Fornecedores", row: 4, col: 0, value: "Cerâmica Fictícia" },
      { op: "set", sheet: "Fornecedores", row: 4, col: 1, value: "Cidade D" },
      { op: "set", sheet: "Fornecedores", row: 4, col: 2, value: 12 },
    ]);
  });
});

describe("apagar, inserir e gravar o csv sem perda", () => {
  test("Delete apaga só o que tem conteúdo", () => {
    const doc = openDoc(enc("A;B;C\n1;;3\n"), "a.csv");
    expect(clearOps(doc.base.sheets[0]!, [1], 0, 2)).toEqual([
      { op: "set", sheet: "", row: 1, col: 0, value: null },
      { op: "set", sheet: "", row: 1, col: 2, value: null },
    ]);
  });

  test("a linha que não mudou sai crua; a linha nova entra; a coluna apagada some (e a linha mudada sai com as aspas que precisa)", () => {
    const original = '"Produto";Qtd\r\nCaneca;7\r\nVaso;3\r\n';
    const doc = openDoc(enc(original), "loja.csv");
    const ops: SheetOp[] = [
      { op: "insertRows", sheet: "", at: 2, count: 1 },
      { op: "set", sheet: "", row: 2, col: 0, value: "Pote" },
      { op: "set", sheet: "", row: 2, col: 1, value: "20" },
    ];
    expect(dec(docBytes(doc, ops, replay(doc, ops)))).toBe('"Produto";Qtd\r\nCaneca;7\r\nPote;20\r\nVaso;3\r\n');
    const del: SheetOp[] = [{ op: "deleteCols", sheet: "", at: 1, count: 1 }];
    expect(dec(docBytes(doc, del, replay(doc, del)))).toBe("Produto\r\nCaneca\r\nVaso\r\n");
  });

  test("um texto com o separador ganha aspas", () => {
    const doc = openDoc(enc("A;B\n1;2\n"), "a.csv");
    const ops: SheetOp[] = [{ op: "set", sheet: "", row: 1, col: 0, value: "um; dois" }];
    expect(dec(docBytes(doc, ops, replay(doc, ops)))).toBe('A;B\n"um; dois";2\n');
  });
});

describe("a ordem e o filtro, só na vista", () => {
  const sheet: GridSheet = openDoc(enc("Produto;Qtd;Setor\nVaso;3;Jardim\nCaneca;12;Cozinha\nÁgua;;Cozinha\nbalde;7;Jardim\n"), "a.csv").base.sheets[0]!;
  const num = (rows: GridSheet["rows"]) => rows.map((r) => r?.map((c) => (c && /^\d+$/.test(c.text) ? { ...c, value: Number(c.text) } : c)));
  const typed: GridSheet = { name: "", rows: num(sheet.rows) };

  test("sem nada, a ordem do arquivo, sem a linha de cima", () => {
    expect(viewRows(sheet, 5, {})).toEqual([1, 2, 3, 4]);
  });

  test("texto pela ordem do português (acento e caixa não pesam); vazio no fim nos dois sentidos", () => {
    expect(viewRows(sheet, 5, { sort: { col: 0, dir: 1 } })).toEqual([3, 4, 2, 1]);
    expect(viewRows(typed, 5, { sort: { col: 1, dir: 1 } })).toEqual([1, 4, 2, 3]);
    expect(viewRows(typed, 5, { sort: { col: 1, dir: -1 } })).toEqual([2, 4, 1, 3]);
  });

  test("o filtro deixa só os valores escolhidos, e a ordem vale junto", () => {
    expect(viewRows(sheet, 5, { filter: { col: 2, values: ["Jardim"] } })).toEqual([1, 4]);
    expect(viewRows(sheet, 5, { filter: { col: 2, values: ["Jardim"] }, sort: { col: 0, dir: 1 } })).toEqual([4, 1]);
  });
});

describe("⌘F", () => {
  test("sem acento e sem caixa, linha a linha", () => {
    const rows = [["Produto", "Setor"], ["Agua", "cozinha"], ["Pão", "Cozinha"]];
    expect(findCells(rows, "COZ")).toEqual([{ row: 1, col: 1 }, { row: 2, col: 1 }]);
    expect(findCells(rows, "pao")).toEqual([{ row: 2, col: 0 }]);
    expect(findCells(rows, "  ")).toEqual([]);
  });
});
