// O texto de dentro do pdf, do docx e do xlsx (T22218): a marca das fixtures da régua, onde cada pedaço está, e o que
// fica de fora (o excluído da alteração controlada, a aba escondida, o que passa do teto).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";

import mammoth from "mammoth";

import { zipBytes } from "../../test/office-files.ts";
import { docParagraphs, parseDocHtml } from "../../ui/notes/files/docx.ts";
import { ABA_LARGA, MARCA, PASTA, xlsxGrande } from "../../test/regua/arquivos.ts";
import { columnName, docLines, docText, DocTextError, isDocText } from "./doc-text.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(PASTA, name)));
const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;
const docx = (body: string) =>
  zipBytes({ "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>` }, { deflate: true });
const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

describe("docText: as fixtures da régua", () => {
  test("pdf: a marca, na página 1", async () => {
    const d = await docText("estoque.pdf", fixture("estoque.pdf"));
    const seg = d.segments.find((s) => s.text.includes(MARCA));
    expect(seg?.at).toEqual({ page: 1 });
    expect(d.truncated).toBe(false);
  });

  test("docx: a marca no 2º parágrafo, com o inserido e sem o excluído", async () => {
    const d = await docText("estoque.docx", fixture("estoque.docx"));
    const seg = d.segments.find((s) => s.text.includes(MARCA));
    expect(seg?.at).toEqual({ paragraph: 2 });
    expect(seg?.text).toContain("A contagem foi sexta.");
    expect(docLines(d)).not.toContain("quinta");
    // As células da tabela também são parágrafos.
    expect(d.segments.some((s) => s.text === "Quantidade")).toBe(true);
  });

  test("xlsx: a marca na última coluna (IV) da aba larga", async () => {
    const d = await docText("estoque.xlsx", fixture("estoque.xlsx"));
    const seg = d.segments.find((s) => s.text.includes(MARCA));
    expect(seg?.at).toEqual({ sheet: ABA_LARGA, cell: "IV3" });
  });

  test("xlsx de 50 mil linhas (SheetJS, sharedStrings): a marca na última linha", async () => {
    const d = await docText("grande.xlsx", xlsxGrande());
    const seg = d.segments.find((s) => s.text.includes(MARCA));
    expect(seg?.at).toEqual({ sheet: "Estoque", cell: "A50002" });
  }, 60_000); // gerar a planilha com o SheetJS leva segundos
});

/** Os parágrafos com texto que o visualizador do docx mostra (o mammoth), na ordem: o que o número do parágrafo conta. */
const viewerBlocks = async (bytes: Uint8Array) => docParagraphs(parseDocHtml((await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value));

describe("docText: docx", () => {
  test("o número do parágrafo é o do visualizador (o mammoth): a imagem e a equação não contam", async () => {
    const bytes = fixture("estoque.docx");
    const mine = (await docText("estoque.docx", bytes)).segments.map((s) => s.text);
    expect(mine).toEqual(await viewerBlocks(bytes));
  });

  test("a lista com subitem e a tabela contam como o visualizador", async () => {
    const item = (t: string, lvl: number) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const numbering = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const body = p("Antes") + item("Caixa", 0) + item("Fita", 1) + item("Parafuso", 0) + `<w:tbl><w:tr><w:tc>${p("Seção")}</w:tc><w:tc>${p("12")}</w:tc></w:tr></w:tbl>` + p("Depois");
    const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
    const bytes = zipBytes(
      {
        "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
        "word/numbering.xml": numbering,
        "word/_rels/document.xml.rels": rels,
      },
      { deflate: true },
    );
    const html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
    expect(html).toContain("<li>Caixa<ol><li>Fita</li></ol></li>");
    const mine = (await docText("a.docx", bytes)).segments.map((s) => s.text);
    expect(mine).toEqual(["Antes", "Caixa", "Fita", "Parafuso", "Seção", "12", "Depois"]);
    expect(mine).toEqual(await viewerBlocks(bytes));
  });

  test("o tab e a quebra viram espaço; o código de campo e o parágrafo vazio ficam de fora", async () => {
    const body =
      p("Primeiro") +
      `<w:p/><w:p><w:pPr/></w:p>` +
      `<w:p><w:r><w:t>Caixa</w:t><w:tab/><w:t>azul</w:t><w:br/><w:t>fundo</w:t></w:r></w:p>` +
      `<w:p><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>Página &amp; seção &lt;1&gt;</w:t></w:r></w:p>`;
    const d = await docText("a.docx", docx(body));
    expect(d.segments).toEqual([
      { at: { paragraph: 1 }, text: "Primeiro" },
      { at: { paragraph: 2 }, text: "Caixa azul fundo" },
      { at: { paragraph: 3 }, text: "Página & seção <1>" },
    ]);
  });

  test("a caixa de texto sai uma vez só (sem o mc:Fallback)", async () => {
    const box = (t: string) => `<w:txbxContent>${p(t)}</w:txbxContent>`;
    const body = `<w:p><w:r><mc:AlternateContent><mc:Choice>${box("Na caixa")}</mc:Choice><mc:Fallback>${box("Na caixa")}</mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>Fora</w:t></w:r></w:p>`;
    const d = await docText("a.docx", docx(body));
    expect(d.segments.map((s) => s.text)).toEqual(["Na caixa", "Fora"]);
  });

  test("sem o document.xml, ou que não é zip: erro", async () => {
    await expect(docText("a.docx", zipBytes({ "x.xml": "<x/>" }))).rejects.toBeInstanceOf(DocTextError);
    await expect(docText("a.docx", new TextEncoder().encode("não é zip"))).rejects.toBeInstanceOf(DocTextError);
  });
});

describe("docText: xlsx", () => {
  test("a aba escondida fica de fora; número, booleano e resultado de fórmula entram", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Produto", "Qtd", "Ativo"], ["Fita", 12, true]]), "Vista");
    const ws = XLSX.utils.aoa_to_sheet([["segredo de teste"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Oculta");
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const sheet = wb.Sheets.Vista!;
    sheet.D2 = { t: "n", v: 24, f: "B2*2" };
    sheet["!ref"] = "A1:D2";
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const d = await docText("a.xlsx", bytes);
    expect(d.segments).toEqual([
      { at: { sheet: "Vista", cell: "A1" }, text: "Produto" },
      { at: { sheet: "Vista", cell: "B1" }, text: "Qtd" },
      { at: { sheet: "Vista", cell: "C1" }, text: "Ativo" },
      { at: { sheet: "Vista", cell: "A2" }, text: "Fita" },
      { at: { sheet: "Vista", cell: "B2" }, text: "12" },
      { at: { sheet: "Vista", cell: "C2" }, text: "VERDADEIRO" },
      { at: { sheet: "Vista", cell: "D2" }, text: "24" },
    ]);
  });

  test("célula sem a referência `r`: conta pela posição", async () => {
    const files = {
      "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>um</t></si><si><r><t>do</t></r><r><t>is</t></r><rPh><t>ruído</t></rPh></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row r="5"><c r="C5" t="inlineStr"><is><t>três</t></is></c></row></sheetData></worksheet>`,
    };
    const d = await docText("a.xlsx", zipBytes(files));
    expect(d.segments).toEqual([
      { at: { sheet: "A & B", cell: "A1" }, text: "um" },
      { at: { sheet: "A & B", cell: "B1" }, text: "dois" },
      { at: { sheet: "A & B", cell: "C5" }, text: "três" },
    ]);
  });

  test("columnName", () => {
    expect([0, 25, 26, 51, 52, 255, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "IV", "ZZ", "AAA"]);
  });
});

describe("docText: pdf", () => {
  test("uma linha por página, na ordem", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const t of ["Capa", "Meio da contagem", "Fim"]) doc.addPage([300, 200]).drawText(t, { x: 20, y: 100, size: 12, font });
    const d = await docText("a.pdf", await doc.save());
    expect(d.segments).toEqual([
      { at: { page: 1 }, text: "Capa" },
      { at: { page: 2 }, text: "Meio da contagem" },
      { at: { page: 3 }, text: "Fim" },
    ]);
    expect(docLines(d)).toBe("Capa\nMeio da contagem\nFim");
  });

  test("não é pdf: erro", async () => {
    await expect(docText("a.pdf", new TextEncoder().encode("texto"))).rejects.toBeInstanceOf(DocTextError);
  });
});

test("o teto de caracteres corta e avisa", async () => {
  const d = await docText("a.docx", docx(p("a".repeat(40)) + p("b".repeat(40)) + p("c".repeat(40))), 90);
  expect(d.segments.length).toBe(2);
  expect(d.truncated).toBe(true);
});

test("isDocText", () => {
  expect(["a.pdf", "B.DOCX", "c.xlsx", "d.xls", "e.doc", "f.txt"].map(isDocText)).toEqual([true, true, true, false, false, false]);
});
