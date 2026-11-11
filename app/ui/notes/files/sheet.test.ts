import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as XLSX from "xlsx";

import { localizeNumber, MAX_ROWS, readWorkbook, systemDecimal, TooLarge } from "./sheet.ts";

const fixture = () => new Uint8Array(readFileSync(new URL("../../../test/fixtures/files/vendas.xlsx", import.meta.url)));
/** Os testes fixam a vírgula como decimal (o Mac em português), qualquer que seja a máquina. */
const read = (bytes: Uint8Array) => readWorkbook(XLSX, bytes, ",");

test("o xlsx de exemplo (test/fixtures/files/vendas.xlsx): as abas visíveis, em ordem, e a escondida de fora", () => {
  const wb = read(fixture());
  expect(wb.sheets.map((s) => s.name)).toEqual(["Resumo", "Metas"]);
  expect(wb.hidden).toBe(1);
  expect(wb.truncated).toBe(false);
  expect(JSON.stringify(wb)).not.toContain("rascunho escondido");
});

test("os valores como o Excel mostra: o resultado guardado das fórmulas, a moeda, a data e a porcentagem", () => {
  const [resumo, metas] = read(fixture()).sheets;
  expect(resumo!.rows[0]).toEqual(["Produto", "Quantidade", "Preço", "Total", "Data"]);
  expect(resumo!.rows[1]).toEqual(["Cadeira", "6", "R$ 349,90", "R$ 2.099,40", "03/11/2026"]);
  expect(resumo!.rows[3]![0]).toBe("Ação");
  // A soma vem da fórmula SUM(D2:D4), pelo valor guardado; a fórmula em si não aparece.
  expect(resumo!.rows[4]).toEqual(["Soma", "9", "", "R$ 3.390,40", ""]);
  expect(JSON.stringify(resumo)).not.toContain("SUM(");
  expect(resumo!.columns).toBe(5);
  expect(metas!.rows).toEqual([["Meta", "Atingido"], ["25%", "31,3%"]]);
});

test("célula vazia no meio fica no lugar, e as linhas vazias do fim saem", () => {
  const ws = XLSX.utils.aoa_to_sheet([["a", null, "c"], [null, null, null], ["d"], [null], [null]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Aba");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const [sheet] = read(new Uint8Array(bytes)).sheets;
  expect(sheet!.rows).toEqual([["a", "", "c"], ["", "", ""], ["d", "", ""]]);
  expect(sheet!.columns).toBe(3);
});

test("uma aba comprida para no limite de linhas e avisa", () => {
  const ws = XLSX.utils.aoa_to_sheet(Array.from({ length: MAX_ROWS + 50 }, (_, i) => [i]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grande");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const r = read(new Uint8Array(bytes));
  expect(r.truncated).toBe(true);
  expect(r.sheets[0]!.rows.length).toBe(MAX_ROWS);
}, 60_000);

test("o que não é planilha dá erro, para a tela dizer", () => {
  expect(() => readWorkbook(XLSX, new TextEncoder().encode("%PDF-1.4 isto não é planilha"))).toThrow("not an xlsx");
  expect(() => readWorkbook(XLSX, new TextEncoder().encode("a,b\n1,2\n"))).toThrow("not an xlsx");
  expect(() => readWorkbook(XLSX, new Uint8Array(0))).toThrow("not an xlsx");
});

test("revisão do T7110: a planilha que descompacta grande demais é recusada antes do SheetJS", () => {
  // 800 células de ~32 mil letras (o máximo de uma célula), todas diferentes: 25 MB de texto no sharedStrings.xml,
  // acima do teto de 20 MB, e quase nada depois de compactado.
  const ws = XLSX.utils.aoa_to_sheet(Array.from({ length: 800 }, (_, i) => [`${i} ${"a".repeat(32_000)}`]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grande");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
  expect(bytes.length).toBeLessThan(1024 * 1024);
  expect(() => readWorkbook(XLSX, bytes)).toThrow(TooLarge);
}, 60_000);

test("os separadores do sistema: vírgula decimal em português, ponto em inglês; texto e data não mudam", () => {
  expect(systemDecimal("pt-BR")).toBe(",");
  expect(systemDecimal("en-US")).toBe(".");
  expect(localizeNumber("R$ 2,099.40", ",")).toBe("R$ 2.099,40");
  expect(localizeNumber("R$ 2,099.40", ".")).toBe("R$ 2,099.40");
  const [resumo] = readWorkbook(XLSX, fixture(), ".").sheets;
  expect(resumo!.rows[1]).toEqual(["Cadeira", "6", "R$ 349.90", "R$ 2,099.40", "03/11/2026"]);
  // Um texto com ponto e vírgula fica como está.
  const ws = XLSX.utils.aoa_to_sheet([["v1.2, beta", 1234.5]]);
  ws.B1!.z = "#,##0.00";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "A");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  expect(read(bytes).sheets[0]!.rows[0]).toEqual(["v1.2, beta", "1.234,50"]);
});
