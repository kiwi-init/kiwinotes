// A fórmula em português (como a pessoa digita e lê) e em inglês (como o arquivo grava). T21108. Fórmulas inventadas.

import { describe, expect, test } from "bun:test";

import { toEnglish, toPtBr } from "./translate.ts";

describe("translate", () => {
  test("o que a pessoa digita vira a fórmula do arquivo", () => {
    expect(toEnglish("=SOMA(C2:C9;2,5)")).toBe("SUM(C2:C9,2.5)");
    expect(toEnglish('=PROCV("caixa";A1:B9;2;FALSO)')).toBe('VLOOKUP("caixa",A1:B9,2,FALSE)');
    expect(toEnglish("=SE(B2>10;VERDADEIRO;FALSO)")).toBe("IF(B2>10,TRUE,FALSE)");
    expect(toEnglish("=CONT.SE(A:A;\"x\")")).toBe('COUNTIF(A:A,"x")');
    expect(toEnglish("=média(B2:B4)")).toBe("AVERAGE(B2:B4)");
    expect(toEnglish("SUM(A1;A2)")).toBe("SUM(A1,A2)");
  });

  test("o texto entre aspas, a aba entre apóstrofos e o nome definido passam iguais", () => {
    expect(toEnglish('=SOMA(\'Caixa; Loja\'!A1;"1,5; SOMA(x)")')).toBe('SUM(\'Caixa; Loja\'!A1,"1,5; SOMA(x)")');
    expect(toEnglish("=Pecas*1,1")).toBe("Pecas*1.1");
    expect(toEnglish('="diz ""oi"";"&A1')).toBe('="diz ""oi"";"&A1'.slice(1));
    expect(toEnglish("=FALSO!A1+1")).toBe("FALSO!A1+1");
  });

  test("as funções novas ganham o _xlfn. no arquivo e o perdem na tela", () => {
    expect(toEnglish("=XLOOKUP(4;A1:A9;B1:B9)")).toBe("_xlfn.XLOOKUP(4,A1:A9,B1:B9)");
    expect(toPtBr("_xlfn.XLOOKUP(4,A1:A9,B1:B9)")).toBe("=PROCX(4;A1:A9;B1:B9)");
    expect(toEnglish("=PROCX(4;A1:A9;B1:B9)")).toBe("_xlfn.XLOOKUP(4,A1:A9,B1:B9)");
  });

  test("a fórmula do arquivo volta em português, e a volta e a ida dão o mesmo", () => {
    expect(toPtBr("SUM(C2:C9,2.5)")).toBe("=SOMA(C2:C9;2,5)");
    expect(toPtBr('IF(B2>10,TRUE,"não, nunca")')).toBe('=SE(B2>10;VERDADEIRO;"não, nunca")');
    for (const f of ["SUM(C2:C9,2.5)", 'VLOOKUP("caixa",A1:B9,2,FALSE)', "Estoque!C2*2", "ROUND(A1/3,2)", 'COUNTIF(A:A,"x")', "1.5E+3*A1"]) {
      expect(toEnglish(toPtBr(f))).toBe(f);
    }
  });

  test("a função que o dicionário não tem passa como está", () => {
    expect(toEnglish("=FUNCAOINVENTADA(A1;2)")).toBe("FUNCAOINVENTADA(A1,2)");
    expect(toPtBr("FUNCAOINVENTADA(A1,2)")).toBe("=FUNCAOINVENTADA(A1;2)");
  });
});
