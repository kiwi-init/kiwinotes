// Os arquivos difíceis da régua (spec #21156, T21236): um ou mais por tipo, todos inventados, do estoque de uma loja
// (#17952). As pequenas ficam em `test/regua/arquivos/`, feitas por este script; as grandes (50 mil linhas, o json de
// mais de 5 MB, os arquivos acima do limite) são geradas na hora do teste, num tmp, e nunca entram no repo.
//
//   bun test/regua/arquivos.ts --write    refaz as pequenas em test/regua/arquivos/

import { mkdirSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipBytes } from "../office-files.ts";

/** A palavra inventada que só existe dentro dos arquivos (nunca no nome): a busca e a leitura a procuram. */
export const MARCA = "quindimrosa";

/** A pasta das pequenas, commitadas. */
export const PASTA = path.join(import.meta.dir, "arquivos");

const PRODUTOS = [
  ["Parafuso sextavado", "Ferragens", 120, 0.35],
  ["Martelo de unha", "Ferramentas", 14, 32.9],
  ["Fita isolante", "Elétrica", 48, 6.5],
  ["Tinta acrílica branca", "Pintura", 9, 89.0],
  ["Lâmpada de LED", "Elétrica", 60, 12.75],
] as const;

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O csv com `;`, acento e vírgula decimal, como o Excel em português grava. */
function csv(sep: string): string {
  const linhas = [["Produto", "Seção", "Quantidade", "Preço"].join(sep)];
  for (const [p, s, q, v] of PRODUTOS) linhas.push([p, s, String(q), String(v).replace(".", ",")].join(sep));
  linhas.push([`Caixa ${MARCA}`, "Diversos", "1", "0,00"].join(sep));
  return linhas.join("\r\n") + "\r\n";
}

/** O `.py` com tabs, que o salvar não pode trocar por espaços. */
const PY = [
  "# O estoque da loja (inventado).",
  "def baixo(estoque, minimo=10):",
  "\tfaltam = []",
  "\tfor nome, qtd in estoque.items():",
  "\t\tif qtd < minimo:",
  `\t\t\tfaltam.append(nome)  # ${MARCA}`,
  "\treturn faltam",
  "",
].join("\n");

const MD = `# Estoque da loja\n\nA contagem de sexta. A caixa ${MARCA} fica no fundo.\n\n- [ ] Repor a fita isolante\n- [x] Contar os parafusos\n`;
const TXT = `Estoque da loja\n\nContagem de sexta: ação, coração, pão. A caixa ${MARCA} fica no fundo.\n`;
const LOG = PRODUTOS.map(([p], i) => `2026-01-0${i + 1}T09:00:00Z INFO entrada: ${p}`).join("\n") + `\n2026-01-09T09:00:00Z WARN caixa ${MARCA} sem etiqueta\n`;
const JSON_TXT = JSON.stringify({ loja: "Loja Exemplo", itens: PRODUTOS.map(([p, s, q, v]) => ({ produto: p, secao: s, quantidade: q, preco: v })), nota: `caixa ${MARCA}` }, null, 2) + "\n";
const YAML = `loja: Loja Exemplo\nnota: caixa ${MARCA}\nitens:\n` + PRODUTOS.map(([p, s, q]) => `  - produto: ${p}\n    secao: ${s}\n    quantidade: ${q}\n`).join("");
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><rect width="200" height="40" fill="#e8f5d0"/><text x="10" y="25">Estoque ${MARCA}</text></svg>\n`;
const DRAWIO = `<mxfile><diagram id="d1" name="Estoque"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Caixa ${MARCA}" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>\n`;
const CANVAS = JSON.stringify({ nodes: [{ id: "a1", type: "text", text: `Caixa ${MARCA}`, x: 0, y: 0, width: 240, height: 60 }], edges: [] }, null, 2) + "\n";

/** Um PNG de 2×2, feito à mão. */
function png(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, 2);
  iv.setUint32(4, 2);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array([0, 200, 230, 120, 120, 200, 60, 0, 90, 160, 60, 240, 240, 240]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  return Buffer.concat(parts);
}

/** Um WAV de 0,1 s de silêncio (16 kHz, mono). */
function wav(): Uint8Array {
  const n = 1600;
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const s = (at: number, t: string) => b.set(new TextEncoder().encode(t), at);
  s(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  s(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, n * 2, true);
  return b;
}

/** A planilha difícil, feita à mão no OOXML: mescla, validação de dados, um gráfico de barras e a fórmula do total. */
function xlsx(): Uint8Array {
  const linhas = [["Produto", "Seção", "Quantidade", "Preço"], ...PRODUTOS.map((r) => [...r]), [`Caixa ${MARCA}`, "Diversos", 1, 0]];
  const col = (i: number) => String.fromCharCode(65 + i);
  const rows = linhas
    .map((r, i) => `<row r="${i + 2}">${r.map((c, j) => (typeof c === "number" ? `<c r="${col(j)}${i + 2}"><v>${c}</v></c>` : `<c r="${col(j)}${i + 2}" t="inlineStr"><is><t>${xml(c)}</t></is></c>`)).join("")}</row>`)
    .join("");
  const fim = linhas.length + 1;
  const total = `<row r="${fim + 1}"><c r="A${fim + 1}" t="inlineStr"><is><t>Total</t></is></c><c r="C${fim + 1}"><f>SUM(C3:C${fim})</f><v>${PRODUTOS.reduce((a, r) => a + r[2], 1)}</v></c></row>`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Estoque da loja</t></is></c></row>${rows}${total}</sheetData>` +
    `<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>` +
    `<dataValidations count="1"><dataValidation type="whole" operator="greaterThanOrEqual" allowBlank="1" sqref="C3:C${fim}"><formula1>0</formula1></dataValidation></dataValidations>` +
    `<drawing r:id="rId1"/></worksheet>`;
  const chart =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>Estoque!$A$3:$A$${fim}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Estoque!$C$3:$C$${fim}</c:f></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>` +
    `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>` +
    `</c:plotArea></c:chart></c:chartSpace>`;
  const drawing =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Estoque"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  const rel = (items: [string, string, string][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`).join("")}</Relationships>`;
  return zipBytes(
    {
      "[Content_Types].xml":
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
      "_rels/.rels": rel([["rId1", "officeDocument/2006/relationships/officeDocument", "xl/workbook.xml"]]),
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estoque" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": rel([["rId1", "officeDocument/2006/relationships/worksheet", "worksheets/sheet1.xml"]]),
      "xl/worksheets/sheet1.xml": sheet,
      "xl/worksheets/_rels/sheet1.xml.rels": rel([["rId1", "officeDocument/2006/relationships/drawing", "../drawings/drawing1.xml"]]),
      "xl/drawings/drawing1.xml": drawing,
      "xl/drawings/_rels/drawing1.xml.rels": rel([["rId1", "officeDocument/2006/relationships/chart", "../charts/chart1.xml"]]),
      "xl/charts/chart1.xml": chart,
    },
    { deflate: true },
  );
}

/** O docx difícil, feito à mão: título, uma alteração controlada (inserção e exclusão), uma equação e uma tabela. */
function docx(): Uint8Array {
  const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`;
  const p = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`;
  const body =
    p("Estoque da loja", "Heading1") +
    `<w:p><w:r><w:t xml:space="preserve">A contagem foi </w:t></w:r><w:del w:id="1" w:author="Ana" w:date="2026-01-05T10:00:00Z"><w:r><w:delText>quinta</w:delText></w:r></w:del>` +
    `<w:ins w:id="2" w:author="Ana" w:date="2026-01-05T10:00:00Z"><w:r><w:t>sexta</w:t></w:r></w:ins><w:r><w:t xml:space="preserve">. A caixa ${MARCA} fica no fundo.</w:t></w:r></w:p>` +
    `<w:p><m:oMathPara><m:oMath><m:r><m:t>total</m:t></m:r><m:r><m:t>=</m:t></m:r><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub/><m:sup/><m:e><m:r><m:t>q</m:t></m:r></m:e></m:nary></m:oMath></m:oMathPara></w:p>` +
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
    [["Produto", "Quantidade"], ...PRODUTOS.map(([n, , q]) => [n, String(q)])].map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("") +
    `</w:tbl>` +
    p("Fim da contagem.");
  return zipBytes(
    {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "word/styles.xml":
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` +
        `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style></w:styles>`,
    },
    { deflate: true },
  );
}

/** O pdf de uma página, pelo pdf-lib, com as datas fixas para sair igual a cada vez. */
async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  page.drawText("Estoque da loja", { x: 30, y: 250, size: 18, font });
  page.drawText(`A caixa ${MARCA} fica no fundo.`, { x: 30, y: 220, size: 12, font });
  const fixa = new Date("2026-01-05T10:00:00Z");
  doc.setCreationDate(fixa);
  doc.setModificationDate(fixa);
  doc.setProducer("kiwinotes test");
  doc.setCreator("kiwinotes test");
  return doc.save({ useObjectStreams: false });
}

/** As pequenas: o nome de cada uma e o conteúdo. Um tipo pode ter mais de uma. */
export async function pequenas(): Promise<Record<string, string | Uint8Array>> {
  return {
    "estoque.md": MD,
    "estoque.txt": TXT,
    "estoque.log": LOG,
    "estoque.json": JSON_TXT,
    "estoque.yaml": YAML,
    "estoque.csv": csv(";"),
    "estoque.tsv": csv("\t"),
    "estoque.py": PY,
    "estoque.pdf": await pdf(),
    "estoque.docx": docx(),
    "estoque.xlsx": xlsx(),
    "estoque.png": png(),
    "estoque.svg": SVG,
    "estoque.drawio": DRAWIO,
    "estoque.wav": wav(),
    "estoque.canvas": CANVAS,
  };
}

/** A planilha de 50 mil linhas (gerada no teste, nunca no repo). */
export function xlsxGrande(linhas = 50_000): Uint8Array {
  const aoa: (string | number)[][] = [["Produto", "Seção", "Quantidade", "Preço"]];
  for (let i = 0; i < linhas; i++) {
    const [p, s, q, v] = PRODUTOS[i % PRODUTOS.length]!;
    aoa.push([`${p} ${i + 1}`, s, (q * (i + 1)) % 997, v]);
  }
  aoa.push([`Caixa ${MARCA}`, "Diversos", 1, 0]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Estoque");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}

/** O csv de 50 mil linhas, com `;`. */
export function csvGrande(linhas = 50_000): string {
  const out = ["Produto;Seção;Quantidade;Preço"];
  for (let i = 0; i < linhas; i++) {
    const [p, s, q, v] = PRODUTOS[i % PRODUTOS.length]!;
    out.push(`${p} ${i + 1};${s};${(q * (i + 1)) % 997};${String(v).replace(".", ",")}`);
  }
  out.push(`Caixa ${MARCA};Diversos;1;0,00`);
  return out.join("\r\n") + "\r\n";
}

/** O json com mais de `bytes` (5 MB e pouco: passa do limite do texto). */
export function jsonGrande(bytes = 5 * 1024 * 1024 + 64 * 1024): string {
  const itens: unknown[] = [];
  let tamanho = 0;
  for (let i = 0; tamanho < bytes; i++) {
    const [p, s, q, v] = PRODUTOS[i % PRODUTOS.length]!;
    const item = { id: i + 1, produto: `${p} ${i + 1}`, secao: s, quantidade: q, preco: v };
    tamanho += JSON.stringify(item).length + 4;
    itens.push(item);
  }
  return JSON.stringify({ loja: "Loja Exemplo", itens }, null, 1);
}

/** Um arquivo esparso de `bytes` (passa do limite sem ocupar o disco). */
export function esparso(abs: string, bytes: number): void {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "");
  truncateSync(abs, bytes);
}

if (import.meta.main && process.argv.includes("--write")) {
  mkdirSync(PASTA, { recursive: true });
  for (const [nome, conteudo] of Object.entries(await pequenas())) writeFileSync(path.join(PASTA, nome), conteudo);
  console.log(`ok: ${PASTA}`);
}
