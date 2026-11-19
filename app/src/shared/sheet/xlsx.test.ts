// T21107: gravar o xlsx sem perda, numa planilha inventada (o estoque de uma loja, test/fixtures/sheet/estoque.xlsx,
// gerada pelo make-estoque.py). Cada teste confere parte por parte: o que a operação não toca sai com os mesmos bytes
// compactados, e o arquivo gravado abre de novo no Kiwi e numa segunda biblioteca (o SheetJS).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

import type { SheetOp } from "./ops.ts";
import { inspectXlsx, patchXlsx, readXlsx, renameTableColumn } from "./xlsx.ts";
import { partText, readZip, writeZip } from "./zip.ts";

const original = new Uint8Array(readFileSync(join(import.meta.dir, "../../../test/fixtures/sheet/estoque.xlsx")));

/** Cada parte: os bytes crus do registro local (compactados) e o texto aberto. */
function parts(bytes: Uint8Array): Map<string, { raw: Uint8Array; text: string }> {
  return new Map(readZip(bytes).map((p) => [p.name, { raw: bytes.slice(p.data, p.data + p.compressed), text: partText(bytes, p) }]));
}

/** As partes que mudaram (ou entraram, ou saíram) entre dois arquivos. */
function changedParts(a: Uint8Array, b: Uint8Array): string[] {
  const pa = parts(a);
  const pb = parts(b);
  const names = new Set([...pa.keys(), ...pb.keys()]);
  return [...names].filter((n) => !pa.has(n) || !pb.has(n) || !Buffer.from(pa.get(n)!.raw).equals(Buffer.from(pb.get(n)!.raw))).sort();
}

const text = (bytes: Uint8Array, name: string) => parts(bytes).get(name)!.text;
// `sheetStubs`: o SheetJS pula a célula de fórmula sem valor guardado (`<v />`, como o openpyxl grava).
const sheetJs = (bytes: Uint8Array) => XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, sheetStubs: true });
const cell = (bytes: Uint8Array, sheet: string, ref: string) => {
  const book = readXlsx(bytes);
  const s = book.sheets.find((x) => x.name === sheet)!;
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return s.rows[Number(m[2]) - 1]?.[m[1]!.charCodeAt(0) - 65];
};

/** O estoque com um `calcChain.xml`, como o Excel grava (o openpyxl não escreve um). */
function withCalcChain(): Uint8Array {
  const zip = readZip(original);
  const changed = new Map<string, Uint8Array>();
  const enc = (s: string) => new TextEncoder().encode(s);
  changed.set("xl/calcChain.xml", enc('<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="E2" i="1"/><c r="C8"/><c r="B1" i="2"/></calcChain>'));
  changed.set(
    "[Content_Types].xml",
    enc(text(original, "[Content_Types].xml").replace("</Types>", '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml" /></Types>')),
  );
  changed.set(
    "xl/_rels/workbook.xml.rels",
    enc(text(original, "xl/_rels/workbook.xml.rels").replace("</Relationships>", '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml" Id="rId9" /></Relationships>')),
  );
  return writeZip(original, zip, changed);
}

describe("sem operação nenhuma", () => {
  test("o arquivo sai idêntico, byte a byte", () => {
    expect(Buffer.from(patchXlsx(original, [])).equals(Buffer.from(original))).toBe(true);
  });
});

describe("mudar células", () => {
  test("um número: só a aba muda, e as outras 13 partes saem com os mesmos bytes", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 }]);
    expect(changedParts(original, out)).toEqual(["xl/worksheets/sheet1.xml"]);
    expect(cell(out, "Estoque", "C2")).toEqual({ value: 8 });
    // O estilo da célula fica: o preço continua em reais.
    const out2 = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 3, value: 26.5 }]);
    expect(cell(out2, "Estoque", "D2")).toEqual({ value: 26.5, format: '"R$" #,##0.00' });
    expect(sheetJs(out2).Sheets.Estoque!.D2.v).toBe(26.5);
  });

  test("texto vira inlineStr e não mexe nas strings compartilhadas", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 2, col: 0, value: "Vaso <grande> & \"fundo\"" }]);
    expect(changedParts(original, out)).toEqual(["xl/worksheets/sheet1.xml"]);
    expect(cell(out, "Estoque", "A3")).toEqual({ value: 'Vaso <grande> & "fundo"' });
    expect(sheetJs(out).Sheets.Estoque!.A3.v).toBe('Vaso <grande> & "fundo"');
  });

  test("célula nova longe do fim: a linha entra na ordem e a dimensão cresce", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 11, col: 7, value: "Obs" }]);
    expect(text(out, "xl/worksheets/sheet1.xml")).toContain('<dimension ref="A1:H12" />');
    expect(cell(out, "Estoque", "H12")).toEqual({ value: "Obs" });
    expect(sheetJs(out).Sheets.Estoque!.H12.v).toBe("Obs");
  });

  test("apagar o valor de uma célula sem estilo tira a célula", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: null }]);
    expect(text(out, "xl/worksheets/sheet1.xml")).not.toContain('r="C2"');
    expect(cell(out, "Estoque", "C2")).toBeUndefined();
  });

  test("fórmula: <f> e <v>, e o cálculo roda ao abrir", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 5, value: 17.43, formula: "E2/10" }]);
    expect(cell(out, "Estoque", "F2")).toEqual({ value: 17.43, formula: "E2/10" });
    expect(text(out, "xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
    const js = sheetJs(out).Sheets.Estoque!.F2;
    expect([js.f, js.v]).toEqual(["E2/10", 17.43]);
  });

  test("dentro de uma mescla é recusado com o motivo", () => {
    expect(() => patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 7, col: 1, value: 1 }])).toThrow("mescla");
  });
});

describe("a cadeia de cálculo (calcChain)", () => {
  const book = withCalcChain();
  test("a fórmula mudou: a parte sai, com o Override e a relação", () => {
    const out = patchXlsx(book, [{ op: "set", sheet: "Estoque", row: 1, col: 4, value: 56, formula: "C2*8" }]);
    expect(parts(out).has("xl/calcChain.xml")).toBe(false);
    expect(text(out, "[Content_Types].xml")).not.toContain("calcChain");
    expect(text(out, "xl/_rels/workbook.xml.rels")).not.toContain("calcChain");
    expect(changedParts(book, out)).toEqual(["[Content_Types].xml", "xl/_rels/workbook.xml.rels", "xl/calcChain.xml", "xl/worksheets/sheet1.xml"]);
    expect(sheetJs(out).Sheets.Estoque!.E2.f).toBe("C2*8");
  });
  test("só um valor mudou: a cadeia fica", () => {
    const out = patchXlsx(book, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 9 }]);
    expect(changedParts(book, out)).toEqual(["xl/worksheets/sheet1.xml"]);
  });
});

describe("formato de número novo (styles.xml)", () => {
  const styles = (b: Uint8Array) => text(b, "xl/styles.xml");
  test("embutido (0%): um xf novo, cellXfs count sobe, sem numFmt novo", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 5, value: 0.31, format: "0%" }]);
    expect(changedParts(original, out)).toEqual(["xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(styles(out)).toContain('<cellXfs count="4">');
    expect(styles(out)).toContain('<numFmts count="1">');
    expect(styles(out)).toMatch(/<xf numFmtId="9"[^>]*applyNumberFormat="1"\/><\/cellXfs>/);
    expect(cell(out, "Estoque", "F2")).toEqual({ value: 0.31, format: "0%" });
    expect(sheetJs(out).Sheets.Estoque!.F2.w).toBe("31%");
  });
  test("fora dos embutidos (dd/mm/yyyy): numFmt com id 165, count atualizado", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 5, value: 46329, format: "dd/mm/yyyy" }]);
    expect(styles(out)).toContain('<numFmts count="2">');
    expect(styles(out)).toContain('<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>');
    expect(cell(out, "Estoque", "F2")).toEqual({ value: 46329, format: "dd/mm/yyyy" });
    expect(sheetJs(out).Sheets.Estoque!.F2.w).toBe("03/11/2026");
  });
  test("o mesmo estilo com o mesmo formato reaproveita o xf", () => {
    const out = patchXlsx(original, [
      { op: "set", sheet: "Estoque", row: 1, col: 5, value: 0.31, format: "0%" },
      { op: "set", sheet: "Estoque", row: 2, col: 5, value: 0.5, format: "0%" },
      { op: "set", sheet: "Resumo", row: 2, col: 1, value: 0.2, format: "0%" },
    ]);
    expect(styles(out)).toContain('<cellXfs count="4">');
    expect(cell(out, "Estoque", "F3")?.format).toBe("0%");
    expect(cell(out, "Resumo", "B3")?.format).toBe("0%");
  });
  test("a moeda que já existe (164) é reaproveitada, sem numFmt novo", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 7, format: '"R$" #,##0.00' }]);
    expect(styles(out)).toContain('<numFmts count="1">');
    expect(styles(out)).toContain('<cellXfs count="4">');
  });
});

describe("linhas e colunas", () => {
  test("inserir linha: células, fórmulas, mescla, formatação, validação, filtro, gráfico, nomes e a outra aba andam", () => {
    const out = patchXlsx(original, [{ op: "insertRows", sheet: "Estoque", at: 3, count: 1 }]);
    expect(changedParts(original, out)).toEqual(["xl/charts/chart1.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const s1 = text(out, "xl/worksheets/sheet1.xml");
    expect(s1).toContain('<dimension ref="A1:E9" />');
    expect(s1).toContain('<mergeCell ref="A9:B9" />');
    expect(s1).toContain('<conditionalFormatting sqref="C2:C8">');
    expect(s1).toContain('<dataValidation sqref="C2:C8"');
    expect(s1).toContain('<autoFilter ref="A1:E8" />');
    expect(cell(out, "Estoque", "A5")).toEqual({ value: "Toalha listrada" });
    expect(cell(out, "Estoque", "E5")?.formula).toBe("C5*D5");
    expect(cell(out, "Estoque", "E9")?.formula).toBe("SUM(E2:E8)");
    expect(cell(out, "Resumo", "B1")?.formula).toBe("Estoque!C9");
    expect(cell(out, "Resumo", "B2")?.formula).toBe("SUM(Estoque!E2:E8)");
    expect(text(out, "xl/charts/chart1.xml")).toContain("<f>'Estoque'!$C$2:$C$8</f>");
    expect(readXlsx(out).names).toContainEqual({ name: "Quantidades", formula: "Estoque!$C$2:$C$8" });
    const js = sheetJs(out);
    expect(js.Sheets.Estoque!.A5.v).toBe("Toalha listrada");
    expect(js.Sheets.Resumo!.B2.f).toBe("SUM(Estoque!E2:E8)");
  });

  test("apagar coluna: o que só apontava para ela vira #REF!, a largura e o gráfico andam", () => {
    const out = patchXlsx(original, [{ op: "deleteCols", sheet: "Estoque", at: 1, count: 1 }]);
    const s1 = text(out, "xl/worksheets/sheet1.xml");
    expect(cell(out, "Estoque", "B2")).toEqual({ value: 7 });
    expect(cell(out, "Estoque", "D2")?.formula).toBe("B2*C2");
    expect(s1).toContain('<conditionalFormatting sqref="B2:B7">');
    // A mescla A8:B8 virou uma célula só: sai, e o contêiner vazio sai junto.
    expect(s1).not.toContain("<mergeCell");
    expect(s1).toContain('<col width="22" customWidth="1" min="1" max="1" />');
    expect(s1).not.toContain('<col width="14"');
    expect(text(out, "xl/charts/chart1.xml")).toContain("<f>'Estoque'!$B$2:$B$7</f>");
    expect(text(out, "xl/drawings/drawing1.xml")).toContain("<col>5</col>");
    expect(cell(out, "Resumo", "B2")?.formula).toBe("SUM(Estoque!D2:D7)");
  });

  test("apagar a linha de um item: a soma encolhe e a validação também", () => {
    const out = patchXlsx(original, [{ op: "deleteRows", sheet: "Estoque", at: 2, count: 1 }]);
    expect(cell(out, "Estoque", "A3")).toEqual({ value: "Toalha listrada" });
    expect(cell(out, "Estoque", "E7")?.formula).toBe("SUM(E2:E6)");
    expect(cell(out, "Resumo", "B1")?.formula).toBe("Estoque!C7");
    expect(sheetJs(out).Sheets.Estoque!.A3.v).toBe("Toalha listrada");
  });

  test("aba com comentários: a operação é recusada com o motivo, e a célula continua editável", () => {
    const zip = readZip(original);
    const s1 = text(original, "xl/worksheets/sheet1.xml").replace("</worksheet>", '<legacyDrawing r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></worksheet>');
    const book = writeZip(original, zip, new Map([["xl/worksheets/sheet1.xml", new TextEncoder().encode(s1)]]));
    expect(() => patchXlsx(book, [{ op: "insertRows", sheet: "Estoque", at: 2, count: 1 }])).toThrow("comentários");
    expect(() => patchXlsx(book, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 }])).not.toThrow();
  });
});

describe("abas", () => {
  test("renomear: o workbook, a fórmula da outra aba, o nome definido e o gráfico", () => {
    const out = patchXlsx(original, [{ op: "renameSheet", sheet: "Estoque", name: "Loja centro" }]);
    expect(changedParts(original, out)).toEqual(["xl/charts/chart1.xml", "xl/workbook.xml", "xl/worksheets/sheet2.xml"]);
    expect(cell(out, "Resumo", "B2")?.formula).toBe("SUM('Loja centro'!E2:E7)");
    expect(text(out, "xl/charts/chart1.xml")).toContain("<f>'Loja centro'!$C$2:$C$7</f>");
    expect(sheetJs(out).SheetNames).toEqual(["Loja centro", "Resumo", "Fornecedores"]);
  });

  test("nova aba: a parte, o Override, a relação e o <sheet>; nada mais muda", () => {
    const out = patchXlsx(original, [
      { op: "addSheet", name: "Compras" },
      { op: "set", sheet: "Compras", row: 0, col: 0, value: "Fornecedor" },
    ]);
    expect(changedParts(original, out)).toEqual(["[Content_Types].xml", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/worksheets/sheet4.xml"]);
    expect(cell(out, "Compras", "A1")).toEqual({ value: "Fornecedor" });
    const js = sheetJs(out);
    expect(js.SheetNames).toEqual(["Estoque", "Resumo", "Fornecedores", "Compras"]);
    expect(js.Sheets.Compras!.A1.v).toBe("Fornecedor");
  });
});

describe("tabela (revisão do T21107)", () => {
  const column = (bytes: Uint8Array) => [...text(bytes, "xl/tables/table1.xml").matchAll(/<tableColumn\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);

  test("mudar o cabeçalho troca o tableColumn e as referências estruturadas", () => {
    const out = patchXlsx(original, [{ op: "set", sheet: "Fornecedores", row: 0, col: 2, value: "Prazo (dias)" }]);
    expect(column(out)).toEqual(["Fornecedor", "Cidade", "Prazo (dias)"]);
    expect(cell(out, "Fornecedores", "C1")).toEqual({ value: "Prazo (dias)" });
    expect(cell(out, "Resumo", "B3")).toMatchObject({ formula: "AVERAGE(Fornecedores[Prazo (dias)])" });
    expect(text(out, "xl/workbook.xml")).toContain(">Fornecedores[[#Data],[Prazo (dias)]]</definedName>");
    expect(changedParts(original, out)).toEqual(["xl/tables/table1.xml", "xl/workbook.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]);
    const js = sheetJs(out);
    expect(js.Sheets.Fornecedores!.C1.v).toBe("Prazo (dias)");
    expect(js.Sheets.Resumo!.B3.f).toBe("AVERAGE(Fornecedores[Prazo (dias)])");
  });

  test("como no Excel: número vira texto, nome repetido ganha um número", () => {
    const out = patchXlsx(original, [
      { op: "set", sheet: "Fornecedores", row: 0, col: 1, value: 2026 },
      { op: "set", sheet: "Fornecedores", row: 0, col: 2, value: "fornecedor" },
    ]);
    expect(column(out)).toEqual(["Fornecedor", "2026", "fornecedor2"]);
    expect(cell(out, "Fornecedores", "B1")).toEqual({ value: "2026" });
    expect(cell(out, "Fornecedores", "C1")).toEqual({ value: "fornecedor2" });
    // A célula de dados e a de fora da tabela continuam livres.
    const free = patchXlsx(original, [{ op: "set", sheet: "Fornecedores", row: 1, col: 2, value: 12 }, { op: "set", sheet: "Fornecedores", row: 0, col: 4, value: "" }]);
    expect(changedParts(original, free)).toEqual(["xl/worksheets/sheet3.xml"]);
  });

  test("cabeçalho vazio ou com fórmula é recusado com o motivo", () => {
    expect(() => patchXlsx(original, [{ op: "set", sheet: "Fornecedores", row: 0, col: 0, value: null }])).toThrow("não pode ficar vazio");
    expect(() => patchXlsx(original, [{ op: "set", sheet: "Fornecedores", row: 0, col: 0, value: " " }])).toThrow("não pode ficar vazio");
    expect(() => patchXlsx(original, [{ op: "set", sheet: "Fornecedores", row: 0, col: 0, value: null, formula: "1+1" }])).toThrow("não leva fórmula");
  });

  test("apagar o cabeçalho sem a tabela é recusado; uma linha de dados sai e a tabela encolhe", () => {
    expect(() => patchXlsx(original, [{ op: "deleteRows", sheet: "Fornecedores", at: 0, count: 1 }])).toThrow("o cabeçalho de uma tabela sairia sem ela");
    const out = patchXlsx(original, [{ op: "deleteRows", sheet: "Fornecedores", at: 1, count: 1 }]);
    expect(text(out, "xl/tables/table1.xml")).toContain('ref="A1:C3"');
    expect(column(out)).toEqual(["Fornecedor", "Cidade", "Prazo"]);
  });

  test("a linha de totais também só sai com a tabela", () => {
    const zip = readZip(original);
    const table = zip.find((p) => p.name === "xl/tables/table1.xml")!;
    const withTotals = writeZip(original, zip, new Map([["xl/tables/table1.xml", new TextEncoder().encode(partText(original, table).replace('headerRowCount="1"', 'headerRowCount="1" totalsRowCount="1"'))]]), new Set());
    expect(() => patchXlsx(withTotals, [{ op: "deleteRows", sheet: "Fornecedores", at: 3, count: 1 }])).toThrow("a linha de totais de uma tabela sairia sem ela");
    expect(() => patchXlsx(withTotals, [{ op: "deleteRows", sheet: "Fornecedores", at: 2, count: 1 }])).not.toThrow();
  });

  test("a referência estruturada: as formas do arquivo, o escape com ', e o que não é dela", () => {
    const r = (f: string) => renameTableColumn(f, "Vendas", "Qtd [un]", "Itens");
    expect(r("SUM(Vendas[Qtd '[un']])")).toBe("SUM(Vendas[Itens])");
    expect(r("Vendas[[#This Row],[Qtd '[un']]]*2")).toBe("Vendas[[#This Row],[Itens]]*2");
    expect(r("SUM(vendas[[Qtd '[un']]:[Preço]])")).toBe("SUM(vendas[[Itens]:[Preço]])");
    expect(r('"Vendas[Qtd \'[un\']]"&Outras[Qtd \'[un\']]&MinhasVendas[Qtd \'[un\']]')).toBe('"Vendas[Qtd \'[un\']]"&Outras[Qtd \'[un\']]&MinhasVendas[Qtd \'[un\']]');
    expect(renameTableColumn("Vendas[#Headers]", "Vendas", "#Headers", "x")).toBe("Vendas[#Headers]");
    expect(renameTableColumn("Vendas[Preço]", "Vendas", "Preço", "Preço # 'final'")).toBe("Vendas[Preço '# ''final'']");
  });
});

describe("desfazer", () => {
  test("gravar as operações até o cursor: desfazer tudo devolve o original", () => {
    const ops: SheetOp[] = [
      { op: "deleteRows", sheet: "Estoque", at: 7, count: 1 },
      { op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 },
    ];
    // Desfeita a segunda, a mescla da linha apagada continua fora; desfeitas as duas, o arquivo é o original.
    const one = patchXlsx(original, ops.slice(0, 1));
    expect(text(one, "xl/worksheets/sheet1.xml")).not.toContain("<mergeCell ");
    expect(Buffer.from(patchXlsx(original, ops.slice(0, 0))).equals(Buffer.from(original))).toBe(true);
    // Refeito, sai o mesmo arquivo de antes, byte a byte.
    expect(Buffer.from(patchXlsx(original, ops)).equals(Buffer.from(patchXlsx(original, ops)))).toBe(true);
  });
});

describe("só leitura, com o motivo", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const variant = (changes: [string, string][]) => writeZip(original, readZip(original), new Map(changes.map(([n, t]) => [n, enc(t)])));
  test("o arquivo do estoque é editável", () => {
    expect(inspectXlsx(original, "estoque.xlsx")).toEqual({ editable: true });
  });
  test("senha para abrir (um arquivo CFB)", () => {
    const cfb = new Uint8Array(512);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(inspectXlsx(cfb, "estoque.xlsx")).toMatchObject({ editable: false, reason: "password" });
  });
  test("aba protegida", () => {
    const s1 = text(original, "xl/worksheets/sheet1.xml").replace("<autoFilter", '<sheetProtection sheet="1" objects="1"/><autoFilter');
    expect(inspectXlsx(variant([["xl/worksheets/sheet1.xml", s1]]))).toMatchObject({ editable: false, reason: "password", detail: "a aba Estoque está protegida" });
  });
  test("macro: pelo nome, pela parte vbaProject.bin ou pelo tipo", () => {
    expect(inspectXlsx(original, "estoque.xlsm")).toMatchObject({ editable: false, reason: "macro" });
    expect(inspectXlsx(variant([["xl/vbaProject.bin", "x"]]))).toMatchObject({ editable: false, reason: "macro" });
  });
  test("estrutura desconhecida: zip quebrado, sem workbook, Strict", () => {
    expect(inspectXlsx(original.slice(0, 2000))).toMatchObject({ editable: false, reason: "unknown" });
    expect(inspectXlsx(variant([["_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>']]))).toMatchObject({ editable: false, reason: "unknown" });
    const strict = text(original, "xl/workbook.xml").replace("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main");
    expect(inspectXlsx(variant([["xl/workbook.xml", strict]]))).toMatchObject({ editable: false, reason: "unknown" });
  });
  test("patchXlsx num arquivo só de leitura lança com o motivo", () => {
    expect(() => patchXlsx(original, [{ op: "set", sheet: "Estoque", row: 0, col: 0, value: 1 }], "estoque.xlsm")).toThrow("macros");
  });
  test("a estrutura vazia do openpyxl (<workbookProtection />) não é senha", () => {
    expect(text(original, "xl/workbook.xml")).toContain("<workbookProtection />");
    expect(inspectXlsx(original).editable).toBe(true);
  });
});

describe("ler", () => {
  test("valores, fórmulas, formatos e nomes", () => {
    const book = readXlsx(original);
    expect(book.sheets.map((s) => s.name)).toEqual(["Estoque", "Resumo", "Fornecedores"]);
    expect(cell(original, "Estoque", "A2")).toEqual({ value: "Caneca azul" });
    expect(cell(original, "Estoque", "D2")).toEqual({ value: 24.9, format: '"R$" #,##0.00' });
    expect(cell(original, "Estoque", "E8")).toEqual({ value: null, formula: "SUM(E2:E7)", format: '"R$" #,##0.00' });
    expect(book.names).toContainEqual({ name: "_xlnm._FilterDatabase", formula: "'Estoque'!$A$1:$E$7", sheet: "Estoque" });
  });
  test("fórmula compartilhada aberta em cada célula", () => {
    const s1 = text(original, "xl/worksheets/sheet1.xml")
      .replace("<f>C2*D2</f>", '<f t="shared" ref="E2:E4" si="0">C2*D2</f>')
      .replace("<f>C3*D3</f>", '<f t="shared" si="0"/>')
      .replace("<f>C4*D4</f>", '<f t="shared" si="0"/>');
    const book = writeZip(original, readZip(original), new Map([["xl/worksheets/sheet1.xml", new TextEncoder().encode(s1)]]));
    expect(cell(book, "Estoque", "E4")?.formula).toBe("C4*D4");
    // Editar uma célula do grupo escreve todas por extenso.
    const out = patchXlsx(book, [{ op: "set", sheet: "Estoque", row: 2, col: 2, value: 4 }]);
    expect(text(out, "xl/worksheets/sheet1.xml")).not.toContain('t="shared"');
    expect(sheetJs(out).Sheets.Estoque!.E4.f).toBe("C4*D4");
  });
});
