// T21107: as referências andando como no Excel.
import { describe, expect, test } from "bun:test";

import { colIndex, colName, moveFormula, parseCell, renameInFormula, shiftFormula, shiftRange, shiftSqref } from "./refs.ts";

describe("endereços", () => {
  test("letras e números", () => {
    expect(colIndex("A")).toBe(0);
    expect(colIndex("Z")).toBe(25);
    expect(colIndex("AA")).toBe(26);
    expect(colIndex("XFD")).toBe(16383);
    for (const n of [0, 25, 26, 701, 702, 16383]) expect(colIndex(colName(n))).toBe(n);
    expect(parseCell("$B$2")).toEqual({ row: 1, col: 1 });
    expect(parseCell("A0")).toBeNull();
    expect(parseCell("XFE1")).toBeNull();
  });
});

describe("faixas", () => {
  const ins = (at: number, count: number) => ({ axis: "row" as const, at, count });
  test("linha entra antes, no meio e depois", () => {
    expect(shiftRange("A2:C5", ins(0, 2))).toBe("A4:C7");
    expect(shiftRange("A2:C5", ins(3, 1))).toBe("A2:C6");
    expect(shiftRange("A2:C5", ins(9, 1))).toBe("A2:C5");
    expect(shiftRange("$A$2", ins(1, 1))).toBe("$A$3");
  });
  test("linha sai: anda, encolhe ou some", () => {
    expect(shiftRange("A5:C8", ins(1, -2))).toBe("A3:C6");
    expect(shiftRange("A2:C5", ins(2, -2))).toBe("A2:C3");
    expect(shiftRange("A2:C5", ins(0, -3))).toBe("A1:C2");
    expect(shiftRange("A3", ins(2, -1))).toBeNull();
    expect(shiftRange("A3:B4", ins(2, -2))).toBeNull();
  });
  test("colunas inteiras e linhas inteiras", () => {
    expect(shiftRange("B:D", { axis: "col", at: 0, count: 1 })).toBe("C:E");
    expect(shiftRange("B:D", { axis: "row", at: 0, count: 1 })).toBe("B:D");
    expect(shiftRange("2:4", { axis: "row", at: 2, count: -1 })).toBe("2:3");
  });
  test("sqref com várias faixas", () => {
    expect(shiftSqref("C2:C7 E9", { axis: "row", at: 3, count: -1 })).toBe("C2:C6 E8");
    expect(shiftSqref("C3", { axis: "row", at: 2, count: -1 })).toBe("");
  });
});

describe("fórmulas", () => {
  const row = (at: number, count: number) => ({ axis: "row" as const, at, count });
  test("a mesma aba anda; outra aba não", () => {
    expect(shiftFormula("C2*D2", "Estoque", "Estoque", row(0, 1))).toBe("C3*D3");
    expect(shiftFormula("C2*D2", "Resumo", "Estoque", row(0, 1))).toBe("C2*D2");
    expect(shiftFormula("SUM(Estoque!E2:E7)", "Resumo", "Estoque", row(3, 1))).toBe("SUM(Estoque!E2:E8)");
    expect(shiftFormula("'Minha aba'!A1+1", "X", "minha aba", row(0, 2))).toBe("'Minha aba'!A3+1");
  });
  test("o que só apontava para o que saiu vira #REF!", () => {
    expect(shiftFormula("C3+1", "S", "S", row(2, -1))).toBe("#REF!+1");
    expect(shiftFormula("SUM(C2:C7)", "S", "S", row(2, -1))).toBe("SUM(C2:C6)");
  });
  test("texto entre aspas, funções e nomes não são referências", () => {
    expect(shiftFormula('IF(A1>0,"B2","")', "S", "S", row(0, 1))).toBe('IF(A2>0,"B2","")');
    expect(shiftFormula("LOG10(A1)+Taxa1", "S", "S", row(0, 1))).toBe("LOG10(A2)+Taxa1");
    expect(shiftFormula("_xlfn.XLOOKUP(A1,B:B,C:C)", "S", "S", { axis: "col", at: 1, count: 1 })).toBe("_xlfn.XLOOKUP(A1,C:C,D:D)");
  });
  test("renomear a aba", () => {
    expect(renameInFormula("SUM(Estoque!E2:E7)+Outra!A1", "Estoque", "Loja centro")).toBe("SUM('Loja centro'!E2:E7)+Outra!A1");
    expect(renameInFormula("'Loja centro'!A1", "loja centro", "Loja")).toBe("Loja!A1");
    expect(renameInFormula("A1", "Estoque", "Loja")).toBe("A1");
  });
  test("a fórmula compartilhada copiada para outra célula", () => {
    expect(moveFormula("C2*D2", 3, 0)).toBe("C5*D5");
    expect(moveFormula("$C$2*D2", 1, 1)).toBe("$C$2*E3");
  });
});
