import { expect, test } from "bun:test";

import { columnName, detectDelimiter, parseDelimited, parseTable } from "./csv.ts";

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
