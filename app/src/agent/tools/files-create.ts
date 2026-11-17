// Os arquivos que o Kiwi gera com o que o agente manda (spec #11549, T11692): o agente manda o conteúdo estruturado
// (uma tabela, ou títulos, parágrafos, itens e tabelas) e o Kiwi monta o arquivo aqui, no Mac, com as bibliotecas do
// app: txt e csv à mão, xlsx pelo SheetJS, docx pela `docx` e pdf pelo `pdf-lib`. Nada sai do Mac.

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, type PDFFont, StandardFonts, rgb } from "pdf-lib";

export const CREATE_FORMATS = ["txt", "csv", "xlsx", "docx", "pdf"] as const;
export type CreateFormat = (typeof CREATE_FORMATS)[number];

/** Um pedaço do documento: um título (nível 1 a 3), um parágrafo, um item de lista ou uma tabela (a 1ª linha é o cabeçalho). */
export type DocBlock = { tipo: "titulo"; texto: string; nivel?: 1 | 2 | 3 } | { tipo: "paragrafo"; texto: string } | { tipo: "item"; texto: string } | { tipo: "tabela"; linhas: string[][] };

/** O conteúdo de um arquivo: os blocos (txt, docx, pdf), a tabela (csv, xlsx) ou as abas (xlsx). */
export interface CreateContent {
  blocos?: DocBlock[];
  tabela?: string[][];
  abas?: { nome: string; tabela: string[][] }[];
}

/** O csv vai com `;` e o BOM do UTF-8: é o que o Excel em português abre certo, com os acentos. */
export const CSV_DELIMITER = ";";

const csvCell = (v: string) => (/[;"\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const NUMBER = /^-?\d{1,15}(\.\d+)?$/;

/** As linhas de um bloco de tabela como texto: `| a | b |`. */
const tableText = (rows: string[][]) => rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|").replace(/\s+/g, " ")).join(" | ")} |`);

function txtOf(c: CreateContent): string {
  const out: string[] = [];
  for (const b of blocksOf(c)) {
    if (b.tipo === "titulo") out.push(`${"#".repeat(b.nivel ?? 1)} ${b.texto}`, "");
    else if (b.tipo === "paragrafo") out.push(b.texto, "");
    else if (b.tipo === "item") out.push(`- ${b.texto}`);
    else out.push(...tableText(b.linhas), "");
  }
  while (out.at(-1) === "") out.pop();
  return `${out.join("\n")}\n`;
}

/** Os blocos do conteúdo; uma tabela solta vira um bloco de tabela. */
function blocksOf(c: CreateContent): DocBlock[] {
  return c.blocos ?? (c.tabela ? [{ tipo: "tabela", linhas: c.tabela }] : []);
}

async function xlsxOf(c: CreateContent): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const sheets = c.abas ?? [{ nome: "Planilha1", tabela: c.tabela ?? [] }];
  const used = new Set<string>();
  for (const s of sheets) {
    // O nome de uma aba: até 31 caracteres, sem `[]:*?/\`, e sem repetir.
    let name = s.nome.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Planilha";
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    // Um número escrito como número vira número (soma e ordena no Excel); o resto fica como texto.
    const rows = s.tabela.map((r) => r.map((v) => (NUMBER.test(v) ? Number(v) : v)));
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}

async function docxOf(c: CreateContent): Promise<Uint8Array> {
  const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const children: (Paragraph | Table)[] = [];
  for (const b of blocksOf(c)) {
    if (b.tipo === "titulo") children.push(new Paragraph({ text: b.texto, heading: heading[(b.nivel ?? 1) - 1]! }));
    else if (b.tipo === "paragrafo") children.push(new Paragraph(b.texto));
    else if (b.tipo === "item") children.push(new Paragraph({ text: b.texto, bullet: { level: 0 } }));
    else if (b.linhas.length) {
      const columns = Math.max(...b.linhas.map((r) => r.length), 1);
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.linhas.map(
            (r, i) =>
              new TableRow({
                tableHeader: i === 0,
                children: Array.from({ length: columns }, (_, k) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r[k] ?? "", bold: i === 0 })] })] })),
              }),
          ),
        }),
        new Paragraph(""),
      );
    }
  }
  if (!children.length) children.push(new Paragraph({ text: "", alignment: AlignmentType.LEFT }));
  return new Uint8Array(await Packer.toBuffer(new Document({ creator: "Kiwi Notes", sections: [{ children }] })));
}

/** O texto que a fonte padrão do pdf escreve: o que ela não tem (um emoji, uma letra de outro alfabeto) vira `?`. */
function encodable(font: PDFFont, cache: Map<string, boolean>, text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    out += ok ? ch : "?";
  }
  return out;
}

async function pdfOf(c: CreateContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreator("Kiwi Notes");
  pdf.setProducer("Kiwi Notes");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cache = new Map<string, boolean>();
  const [W, H, M] = [595.28, 841.89, 56];
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  /** Quebra o texto em linhas que cabem na largura. */
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = [];
    for (const para of encodable(font, cache, text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) lines.push(line);
          // Uma palavra maior que a linha é cortada.
          let rest = word;
          while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
            let n = rest.length;
            while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
            lines.push(rest.slice(0, n));
            rest = rest.slice(n);
          }
          line = rest;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const write = (text: string, o: { font?: PDFFont; size?: number; indent?: number; gap?: number; bullet?: boolean }) => {
    const font = o.font ?? regular;
    const size = o.size ?? 11;
    const indent = o.indent ?? 0;
    const lead = size * 1.35;
    wrap(text, font, size, W - 2 * M - indent).forEach((l, i) => {
      if (y - lead < M) newPage();
      y -= lead;
      if (o.bullet && i === 0) page.drawText("•", { x: M + indent - 10, y, size, font: regular, color: rgb(0, 0, 0) });
      page.drawText(l, { x: M + indent, y, size, font, color: rgb(0, 0, 0) });
    });
    y -= o.gap ?? 0;
  };
  for (const b of blocksOf(c)) {
    if (b.tipo === "titulo") write(b.texto, { font: bold, size: [18, 14, 12][(b.nivel ?? 1) - 1]!, gap: 6 });
    else if (b.tipo === "paragrafo") write(b.texto, { gap: 6 });
    else if (b.tipo === "item") write(b.texto, { indent: 14, bullet: true, gap: 2 });
    else {
      // A tabela em texto, uma linha por linha da tabela, o cabeçalho em negrito.
      b.linhas.forEach((r, i) => write(r.join("  |  "), { font: i === 0 ? bold : regular, size: 10, gap: 1 }));
      y -= 6;
    }
  }
  return pdf.save({ useObjectStreams: true });
}

/** Os bytes do arquivo no formato pedido. */
export async function buildFile(format: CreateFormat, c: CreateContent): Promise<Uint8Array> {
  switch (format) {
    case "txt":
      return new TextEncoder().encode(txtOf(c));
    case "csv": {
      const rows = c.tabela ?? [];
      const text = rows.map((r) => r.map(csvCell).join(CSV_DELIMITER)).join("\r\n");
      return new TextEncoder().encode(`﻿${text}\r\n`);
    }
    case "xlsx":
      return xlsxOf(c);
    case "docx":
      return docxOf(c);
    case "pdf":
      return pdfOf(c);
  }
}
