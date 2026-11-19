// O texto de dentro do pdf, do docx e do xlsx (T22218): a marca das fixtures da régua, onde cada pedaço está, e o que
// fica de fora (o excluído da alteração controlada, a aba escondida, o que passa do teto).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openTreeSession } from "@docx-editor.dev/core/binding";

import { zipBytes } from "../../test/office-files.ts";
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

// Os namespaces de um docx como o Word grava: a caixa de texto (o desenho e o VML) e a equação.
const NS = [
  W,
  `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`,
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`,
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`,
  `xmlns:v="urn:schemas-microsoft-com:vml"`,
  `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`,
  `mc:Ignorable="wps"`,
].join(" ");

/** Um docx inteiro (com o `[Content_Types].xml` e as relações), que o motor do visualizador abre. */
const docxInteiro = (body: string) =>
  zipBytes(
    {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    },
    { deflate: true },
  );

/** A caixa de texto como o Word grava: o `mc:Choice` com o desenho (`wps:txbx`) e o `mc:Fallback` com o VML. */
const caixa = (texts: string[]) => {
  const content = `<w:txbxContent>${texts.map(p).join("")}</w:txbxContent>`;
  const graphic = `<wp:extent cx="2000000" cy="600000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Caixa 1"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx>${content}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`;
  const anchor = `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>3000000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${graphic}</wp:anchor>`;
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${anchor}</w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>${content}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
};

/**
 * O lugar de cada palavra pelo motor do visualizador (T22847): o número (de 1) do parágrafo do corpo onde ela está,
 * contado pela lista do próprio motor (`paragraphIds`). A palavra numa caixa de texto fica no parágrafo que segura a
 * caixa: o id dela começa pelo dele.
 */
function lugarNoMotor(bytes: Uint8Array): (palavra: string) => number[] {
  const r = openTreeSession(bytes);
  if (!r.ok) throw new Error(`o motor não abriu: ${r.reason}`);
  const ids = r.session.paragraphIds();
  return (palavra) =>
    r.session.findText(palavra, { stories: "body" }).matches.map((m) => ids.findIndex((id) => m.blockId === id || m.blockId.startsWith(`${id}.`)) + 1);
}

/**
 * Cada pedaço do docText está, pelo motor, no parágrafo que ele diz: confere por todas as palavras dele. `semBusca`: as
 * palavras que a busca do motor não alcança (a caixa de texto antiga, só VML), conferidas à parte.
 */
async function confereComOMotor(bytes: Uint8Array, semBusca: string[] = []): Promise<void> {
  const noMotor = lugarNoMotor(bytes);
  const { segments } = await docText("a.docx", bytes);
  expect(segments.length).toBeGreaterThan(0);
  for (const s of segments) {
    if (!("paragraph" in s.at)) throw new Error("não é um parágrafo");
    for (const palavra of s.text.split(" ").filter((w) => w.length > 2 && !semBusca.includes(w))) expect({ palavra, lugares: noMotor(palavra) }).toMatchObject({ palavra, lugares: expect.arrayContaining([s.at.paragraph]) });
  }
}

describe("docText: docx", () => {
  test("a caixa de texto antes do parágrafo procurado não muda o número dele: o mesmo do motor (T22847)", async () => {
    const body =
      p("Antes") +
      `<w:p>${caixa(["Na caixa um", "Na caixa dois"])}<w:r><w:t>Fora</w:t></w:r></w:p>` +
      `<w:p>${caixa(["Caixa sozinha"])}</w:p>` +
      p("A graviola chegou na sexta.");
    const bytes = docxInteiro(body);
    const graviola = (await docText("a.docx", bytes)).segments.find((s) => s.text.includes("graviola"));
    expect(graviola?.at).toEqual({ paragraph: lugarNoMotor(bytes)("graviola")[0] });
    expect(graviola?.at).toEqual({ paragraph: 4 });
  });

  test("o texto da caixa fica no parágrafo que a segura, uma vez só (sem o mc:Fallback)", async () => {
    const body = p("Antes") + `<w:p>${caixa(["Na caixa"])}<w:r><w:t>Fora</w:t></w:r></w:p>` + `<w:p>${caixa(["Caixa sozinha"])}</w:p>` + p("Depois");
    const { segments } = await docText("a.docx", docxInteiro(body));
    expect(segments).toEqual([
      { at: { paragraph: 1 }, text: "Antes" },
      { at: { paragraph: 2 }, text: "Fora" },
      { at: { paragraph: 2 }, text: "Na caixa" },
      { at: { paragraph: 3 }, text: "Caixa sozinha" },
      { at: { paragraph: 4 }, text: "Depois" },
    ]);
  });

  test("o parágrafo vazio, o só de espaços, o só de tab e o da equação contam no número, como no motor; o texto deles não entra", async () => {
    const body =
      p("Primeiro") +
      `<w:p/><w:p><w:pPr/></w:p>` +
      p("   ") +
      `<w:p><w:r><w:tab/></w:r></w:p>` +
      `<w:p><m:oMathPara><m:oMath><m:r><m:t>x=2</m:t></m:r></m:oMath></m:oMathPara></w:p>` +
      `<w:p><w:r><w:t xml:space="preserve">Texto e </w:t></w:r><m:oMath><m:r><m:t>y</m:t></m:r></m:oMath></w:p>` +
      `<w:p><w:r><w:t>Caixa</w:t><w:tab/><w:t>azul</w:t><w:br/><w:t>fundo</w:t></w:r></w:p>` +
      `<w:p><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>Página &amp; seção &lt;1&gt;</w:t></w:r></w:p>`;
    const bytes = docxInteiro(body);
    expect((await docText("a.docx", bytes)).segments).toEqual([
      { at: { paragraph: 1 }, text: "Primeiro" },
      { at: { paragraph: 7 }, text: "Texto e" },
      { at: { paragraph: 8 }, text: "Caixa azul fundo" },
      { at: { paragraph: 9 }, text: "Página & seção <1>" },
    ]);
    await confereComOMotor(bytes);
  });

  test("o controle de conteúdo, a tabela dentro da tabela e a caixa de texto antiga (só VML): o mesmo número do motor", async () => {
    const body =
      `<w:sdt><w:sdtPr/><w:sdtContent>${p("No controle")}${p("")}</w:sdtContent></w:sdt>` +
      `<w:tbl><w:tr><w:tc>${p("Célula")}<w:tbl><w:tr><w:tc>${p("Dentro")}</w:tc></w:tr></w:tbl>${p("")}</w:tc></w:tr></w:tbl>` +
      `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${p("Caixa antiga")}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
      p("Fim");
    const bytes = docxInteiro(body);
    await confereComOMotor(bytes, ["Caixa", "antiga"]);
    // A busca do motor não entra na caixa só VML: o número dela vem da lista do motor (o 6º dos 7 parágrafos do corpo).
    const r = openTreeSession(bytes);
    if (!r.ok) throw new Error(r.reason);
    expect(r.session.paragraphIds()).toHaveLength(7);
    expect((await docText("a.docx", bytes)).segments.find((s) => s.text === "Caixa antiga")?.at).toEqual({ paragraph: 6 });
  });

  test("as fixtures do repo: cada pedaço no parágrafo que o motor diz", async () => {
    await confereComOMotor(fixture("estoque.docx"));
    await confereComOMotor(new Uint8Array(readFileSync(path.join(import.meta.dir, "../../test/fixtures/files/proposta.docx"))));
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
