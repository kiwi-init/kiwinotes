// O docx difícil da contagem ao gravar (T23352, spec #21080, caixas 4 e 5), feito à mão e inventado por inteiro: uma loja
// de papelaria. Tem um de cada elemento que o motor precisa devolver ao gravar: a alteração controlada (inserção e
// exclusão), os campos (simples e o de três partes), a equação, os campos de formulário (texto, caixa de marcar e o
// controle de conteúdo), os marcadores, a imagem, a tabela, o cabeçalho e o rodapé (com o número da página).
// E a contagem: quantos de cada elemento há em cada parte do arquivo, para comparar antes e depois de gravar.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { partBytes, partText, readZip } from "../../src/shared/sheet/zip.ts";
import { zipBytes } from "../../test/office-files.ts";

/** O parágrafo onde o teste escreve, e o que escreve. */
export const ALVO = "Fim da contagem.";
export const ESCRITO = " Conferido pela Ana.";
export const NOVO = "Linha nova da Bia.";

const NS =
  `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (inner: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${inner}</w:p>`;
/** Um campo de três partes (`fldChar` begin/separate/end), com o resultado que o Word mostrou da última vez. */
const field = (instr: string, result: string, ff = "") =>
  `<w:r><w:fldChar w:fldCharType="begin">${ff}</w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

function png(): Uint8Array {
  // Um png 2×2 verde-limão, feito aqui.
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 0x9c, 0xd6, 0x2b, 0x9c, 0xd6, 0x2b, 0, 0x9c, 0xd6, 0x2b, 0x9c, 0xd6, 0x2b]);
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

const image =
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="457200" cy="457200"/><wp:docPr id="1" name="Etiqueta" descr="A etiqueta da caixa"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="etiqueta.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const cell = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${para(run(t))}</w:tc>`;
const table =
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
  [["Item", "Caixas"], ["Lápis", "8"], ["Borracha", "3"]].map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("") +
  `</w:tbl>`;

const body =
  para(run("Estoque da Papelaria Exemplo"), "Heading1") +
  // A alteração controlada: a Ana trocou "terça" por "quarta".
  para(
    run("A contagem foi na ") +
      `<w:del w:id="10" w:author="Ana" w:date="2026-01-05T10:00:00Z"><w:r><w:delText>terça</w:delText></w:r></w:del>` +
      `<w:ins w:id="11" w:author="Ana" w:date="2026-01-05T10:00:00Z"><w:r><w:t>quarta</w:t></w:r></w:ins>` +
      run(", com a porta fechada."),
  ) +
  // Os marcadores e os campos que apontam para eles.
  para(`<w:bookmarkStart w:id="20" w:name="corredor"/>${run("Corredor B, prateleira de cima.")}<w:bookmarkEnd w:id="20"/>`) +
  para(run("Veja o ") + field("REF corredor \\h", "Corredor B, prateleira de cima.") + run(". Feito em ") + `<w:fldSimple w:instr=" DATE \\@ &quot;dd/MM/yyyy&quot; "><w:r><w:t>05/01/2026</w:t></w:r></w:fldSimple>` + run(".")) +
  // A equação.
  `<w:p><m:oMathPara><m:oMath><m:r><m:t>total</m:t></m:r><m:r><m:t>=</m:t></m:r><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub/><m:sup/><m:e><m:r><m:t>caixas</m:t></m:r></m:e></m:nary></m:oMath></m:oMathPara></w:p>` +
  // Os campos de formulário: o de texto e a caixa de marcar (os antigos) e o controle de conteúdo.
  para(
    run("Responsável: ") +
      field("FORMTEXT", "Bia", `<w:ffData><w:name w:val="responsavel"/><w:enabled/><w:calcOnExit w:val="0"/><w:textInput/></w:ffData>`) +
      run(" Conferido: ") +
      field("FORMCHECKBOX", "", `<w:ffData><w:name w:val="conferido"/><w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:sizeAuto/><w:default w:val="1"/></w:checkBox></w:ffData>`),
  ) +
  para(run("Turno: ") + `<w:sdt><w:sdtPr><w:alias w:val="Turno"/><w:tag w:val="turno"/><w:id w:val="30"/><w:text/></w:sdtPr><w:sdtContent>${run("manhã")}</w:sdtContent></w:sdt>`) +
  image +
  table +
  para(`<w:bookmarkStart w:id="21" w:name="fim"/>${run(ALVO)}<w:bookmarkEnd w:id="21"/>`) +
  `<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

/** O docx difícil, inventado. */
export function dificil(): Uint8Array {
  const ct = (part: string, type: string) => `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
  return zipBytes(
    {
      "[Content_Types].xml":
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
        ct("document.xml", "document.main") + ct("styles.xml", "styles") + ct("header1.xml", "header") + ct("footer1.xml", "footer") + `</Types>`,
      "_rels/.rels": `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `${XML}<w:document ${NS}><w:body>${body}</w:body></w:document>`,
      "word/_rels/document.xml.rels":
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/header" Target="header1.xml"/><Relationship Id="rId3" Type="${REL}/footer" Target="footer1.xml"/><Relationship Id="rId4" Type="${REL}/image" Target="media/image1.png"/></Relationships>`,
      "word/header1.xml": `${XML}<w:hdr ${NS}>${para(run("Papelaria Exemplo · inventário"))}</w:hdr>`,
      "word/footer1.xml": `${XML}<w:ftr ${NS}>${para(run("Página ") + field("PAGE", "1") + run(" de ") + `<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>`)}</w:ftr>`,
      "word/media/image1.png": png(),
      "word/styles.xml":
        `${XML}<w:styles ${NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
    },
    { deflate: true },
  );
}

/** O que se conta em cada parte de texto (`document`, cabeçalhos, rodapés, notas). */
const ELEMENTOS: Record<string, RegExp> = {
  insercoes: /<w:ins [^>]*>/g,
  exclusoes: /<w:del [^>]*>/g,
  textoExcluido: /<w:delText[ >]/g,
  camposSimples: /<w:fldSimple /g,
  campos: /<w:fldChar [^>]*w:fldCharType="begin"/g,
  equacoes: /<m:oMath[ >]/g,
  camposDeFormulario: /<w:ffData[ >]/g,
  controlesDeConteudo: /<w:sdt[ >]/g,
  marcadores: /<w:bookmarkStart /g,
  fimDeMarcador: /<w:bookmarkEnd /g,
  imagens: /<w:drawing[ >]/g,
  tabelas: /<w:tbl[ >]/g,
  celulas: /<w:tc[ >]/g,
  cabecalhos: /<w:headerReference /g,
  rodapes: /<w:footerReference /g,
};

/** As instruções dos campos, em ordem: `["DATE", "FORMCHECKBOX", …]`. Um campo que perde a instrução aparece aqui. */
const instrucoes = (xml: string) => [...xml.matchAll(/(?:w:instr="\s*|<w:instrText[^>]*>\s*)([A-Z]+)/g)].map((m) => m[1]!).sort();

export type Contagem = Record<string, Record<string, number | string | string[]>>;

/** Quantos de cada elemento há em cada parte, as instruções dos campos, os nomes dos marcadores e o hash de cada mídia. */
export function contar(bytes: Uint8Array): Contagem {
  const out: Contagem = {};
  for (const part of readZip(bytes)) {
    if (/^word\/media\//.test(part.name)) {
      out[part.name] = { sha: createHash("sha256").update(partBytes(bytes, part)).digest("hex").slice(0, 16) };
      continue;
    }
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(part.name)) continue;
    const xml = partText(bytes, part);
    const c: Record<string, number | string | string[]> = {};
    for (const [k, re] of Object.entries(ELEMENTOS)) {
      const n = (xml.match(re) ?? []).length;
      if (n) c[k] = n;
    }
    c.instrucoes = instrucoes(xml);
    c.nomesDosMarcadores = [...xml.matchAll(/<w:bookmarkStart [^>]*w:name="([^"]+)"/g)].map((m) => m[1]!).sort();
    out[part.name] = c;
  }
  return out;
}

/** As diferenças de `a` para `b`, em linhas legíveis (`word/footer1.xml: some`, `word/document.xml campos: 3 → 2`). */
export function diferencas(a: Contagem, b: Contagem): string[] {
  const out: string[] = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!b[name]) out.push(`${name}: some`);
    else if (!a[name]) out.push(`${name}: aparece`);
    else for (const k of new Set([...Object.keys(a[name]!), ...Object.keys(b[name]!)])) {
      const x = JSON.stringify(a[name]![k] ?? 0), y = JSON.stringify(b[name]![k] ?? 0);
      if (x !== y) out.push(`${name} ${k}: ${x} → ${y}`);
    }
  }
  return out;
}
