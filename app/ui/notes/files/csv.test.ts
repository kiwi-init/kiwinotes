import { expect, test } from "bun:test";

import { bytesOf, columnName, decodeText, detectDelimiter, parseDelimited, parseTable } from "./csv.ts";

test("o csv simples: cabeçalho, linhas e a quebra final que não vira linha", () => {
  const t = parseTable("nome,idade\nAna,31\nBeto,45\n", "pessoas.csv");
  expect(t).toEqual({ header: ["nome", "idade"], rows: [["Ana", "31"], ["Beto", "45"]], columns: 2, delimiter: "," });
});

test("aspas: o separador, a quebra de linha e as aspas dobradas ficam dentro do campo", () => {
  const rows = parseDelimited('a,"b, c","linha 1\nlinha 2","ela disse ""oi"""\r\n1,2,3,4', ",");
  expect(rows).toEqual([["a", "b, c", "linha 1\nlinha 2", 'ela disse "oi"'], ["1", "2", "3", "4"]]);
  // Aspas no meio de um campo sem aspas são texto.
  expect(parseDelimited('5" de tela,ok', ",")).toEqual([['5" de tela', "ok"]]);
  // Campo vazio entre aspas, e campos vazios no fim.
  expect(parseDelimited('"",x,,', ",")).toEqual([["", "x", "", ""]]);
});

test("CRLF, CR sozinho e o BOM do Excel", () => {
  expect(parseDelimited("﻿a;b\r\n1;2\r\n", ";")).toEqual([["a", "b"], ["1", "2"]]);
  expect(parseDelimited("a,b\r1,2", ",")).toEqual([["a", "b"], ["1", "2"]]);
});

test("o separador: tab no tsv, ponto e vírgula do Excel em português, e a vírgula no resto", () => {
  expect(detectDelimiter("a\tb,c\n", "dados.tsv")).toBe("\t");
  expect(detectDelimiter("a,b,c;d\n", "DADOS.TSV")).toBe("\t");
  expect(detectDelimiter("nome;valor;obs\nAna;1,5;ok\n", "x.csv")).toBe(";");
  expect(detectDelimiter("a\tb\tc\n1\t2\t3\n", "x.csv")).toBe("\t");
  expect(detectDelimiter("a,b\n", "x.csv")).toBe(",");
  expect(detectDelimiter("uma coluna só\noutra\n", "x.csv")).toBe(",");
  // O separador dentro das aspas não conta, e só a primeira linha decide.
  expect(detectDelimiter('"a;b;c;d",e,f\n1;2;3;4;5;6\n', "x.csv")).toBe(",");
  expect(parseTable("nome;valor\nAna;1,5\n", "x.csv")).toMatchObject({ header: ["nome", "valor"], rows: [["Ana", "1,5"]], delimiter: ";" });
});

test("linhas tortas: as colunas são as da linha mais larga, e as linhas em branco saem", () => {
  const t = parseTable("a,b\n1\n\n1,2,3\n\n", "x.csv");
  expect(t.header).toEqual(["a", "b"]);
  expect(t.rows).toEqual([["1"], ["1", "2", "3"]]);
  expect(t.columns).toBe(3);
});

test("o arquivo vazio e o de uma linha só", () => {
  expect(parseTable("", "x.csv")).toEqual({ header: [], rows: [], columns: 0, delimiter: "," });
  expect(parseTable("só o cabeçalho,aqui", "x.csv")).toMatchObject({ header: ["só o cabeçalho", "aqui"], rows: [], columns: 2 });
});

test("o nome da coluna sem cabeçalho, como na planilha", () => {
  expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});

test("um csv grande abre rápido", () => {
  const text = `id,nome,valor\n${Array.from({ length: 50_000 }, (_, i) => `${i},"Item ${i}, o grande",${i * 1.5}`).join("\n")}\n`;
  const start = performance.now();
  const t = parseTable(text, "grande.csv");
  expect(t.rows.length).toBe(50_000);
  expect(t.rows[49_999]).toEqual(["49999", "Item 49999, o grande", "74998.5"]);
  expect(performance.now() - start).toBeLessThan(2000);
});

test("revisão do T7107: o csv do Excel em Windows-1252 sai com os acentos certos", () => {
  // "Descrição;Preço\r\nAção;1,5\r\n" em Windows-1252 (ç = E7, ã = E3).
  const latin = Uint8Array.from(Buffer.from("Descrição;Preço\r\nAção;1,5\r\n", "latin1"));
  expect(new TextDecoder().decode(latin)).toContain("�");
  const d = decodeText(latin);
  expect(d.encoding).toBe("windows-1252");
  expect(parseTable(d.text, "x.csv")).toMatchObject({ header: ["Descrição", "Preço"], rows: [["Ação", "1,5"]] });
  // Os caracteres que só o Windows-1252 tem (aspas curvas, o euro), e não o Latin-1.
  expect(decodeText(Uint8Array.from([0x93, 0x6f, 0x69, 0x94, 0x20, 0x80])).text).toBe("“oi” €");
  // UTF-8 (com e sem BOM) e UTF-16 seguem como são.
  expect(decodeText(new TextEncoder().encode("ação;1"))).toEqual({ text: "ação;1", encoding: "utf-8" });
  expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toMatchObject({ encoding: "utf-8" });
  expect(decodeText(Uint8Array.from([0xff, 0xfe, 0x61, 0x00, 0xe7, 0x00]))).toEqual({ text: "aç", encoding: "utf-16" });
  expect(decodeText(Uint8Array.from([0xfe, 0xff, 0x00, 0x61, 0x00, 0xe7]))).toEqual({ text: "aç", encoding: "utf-16" });
  expect(decodeText(new Uint8Array(0))).toEqual({ text: "", encoding: "utf-8" });
  expect([...bytesOf("YcOn")]).toEqual([0x61, 0xc3, 0xa7]);
});

test("revisão do T7107: no empate da primeira linha, as linhas de baixo decidem o separador; e a dica sep= do Excel", () => {
  const tie = "Nome;Valor (R$ 1,00);Obs, etc\nAna;1,5;ok\nBeto;2;nada\n";
  expect(detectDelimiter(tie, "x.csv")).toBe(";");
  expect(parseTable(tie, "x.csv")).toMatchObject({ header: ["Nome", "Valor (R$ 1,00)", "Obs, etc"], columns: 3 });
  // O contrário: vírgula como separador e ponto e vírgula no texto do cabeçalho.
  expect(detectDelimiter("a; b,c; d,e\n1,2,3\n4,5,6\n", "x.csv")).toBe(",");
  // Empate total: o ponto e vírgula (no Excel em português a vírgula é o decimal).
  expect(detectDelimiter("a;b,c\n", "x.csv")).toBe(";");
  // Uma quebra de linha dentro das aspas não é outra linha.
  expect(detectDelimiter('a,"x;\ny;",b\n1,2,3\n', "x.csv")).toBe(",");

  const hinted = parseTable("sep=;\r\nNome;Obs, etc\r\nAna;ok\r\n", "x.csv");
  expect(hinted).toMatchObject({ header: ["Nome", "Obs, etc"], rows: [["Ana", "ok"]], delimiter: ";" });
  expect(parseTable("﻿sep=,\nA,B;C\n1,2\n", "x.csv")).toMatchObject({ header: ["A", "B;C"], delimiter: "," });
  // `sep=` só vale como a primeira linha inteira.
  expect(parseTable("sep=x;y\n1;2\n", "x.csv").header).toEqual(["sep=x", "y"]);
});
