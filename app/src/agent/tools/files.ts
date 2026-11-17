// Os arquivos do cofre que o agente lê (spec #11549, T11691): csv, xlsx, docx, pdf e txt viram texto aqui, no Mac, sem
// interpretar nada. A planilha vira uma tabela em texto (por aba, com o cabeçalho), o docx vira o texto com os títulos,
// e o pdf vira o texto de cada página. O arquivo grande vem por partes: o sumário (as abas, as páginas, as linhas) e a
// parte pedida, nunca o arquivo inteiro de uma vez.
//
// As bibliotecas são as que as Notas já usam para mostrar esses arquivos (o SheetJS, o mammoth e o PDF.js), e as
// partes puras também: a leitura da planilha (`readWorkbook`), a do csv (`parseTable`) e a do HTML do docx.

import { MAX_ROWS, readWorkbook, TooLarge } from "../../../ui/notes/files/sheet.ts";
import { decodeText, parseTable } from "../../../ui/notes/files/csv.ts";
import { parseDocHtml, type DocNode } from "../../../ui/notes/files/docx.ts";
import { checkZip } from "../../../ui/notes/files/zipSize.ts";

/** O maior arquivo que o agente lê (o spec): 20 MB. */
export const FILES_READ_MAX_BYTES = 20 * 1024 * 1024;
/** As linhas de uma parte de planilha, no máximo (o spec): 2.000. */
export const SHEET_PART_ROWS = 2_000;
/** Quantas partes o índice mostra; o resto é contado. */
export const FILES_INDEX_MAX = 100;

export const FILE_FORMATS = ["csv", "xlsx", "docx", "pdf", "txt"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export class FileReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** O formato pela extensão; null num arquivo que o agente não lê. */
export function fileFormat(path: string): FileFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "tsv") return "csv";
  return (FILE_FORMATS as readonly string[]).includes(ext ?? "") ? (ext as FileFormat) : null;
}

/** Um pedaço do arquivo com nome ("Aba Vendas", "Página 3"): o cabeçalho, que se repete em cada parte, e as linhas. */
interface Block {
  name: string;
  /** Como as linhas se chamam no rótulo da parte: as da planilha são numeradas como no Excel. */
  unit: "linhas" | "trecho";
  header?: string;
  lines: string[];
  /** O número (do Excel) da primeira linha de `lines`. */
  firstRow?: number;
  maxLines?: number;
}

export interface FilePart {
  label: string;
  text: string;
}

export interface FileDocument {
  format: FileFormat;
  /** O sumário, só contado: as abas, as páginas, as linhas e os caracteres. */
  summary: { abas?: { nome: string; linhas: number; colunas: number }[]; paginas?: number; linhas?: number; caracteres?: number };
  parts: FilePart[];
  warnings: string[];
}

const cell = (v: string) => v.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
const row = (r: string[], columns: number) => `| ${Array.from({ length: Math.max(columns, 1) }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;

/** A tabela como texto: o cabeçalho (a 1ª linha) com o separador, e as linhas de dados. */
function tableBlock(name: string, rows: string[][], columns: number, maxLines = SHEET_PART_ROWS): Block {
  const [head = [], ...rest] = rows;
  const header = `${row(head, columns)}\n| ${Array.from({ length: Math.max(columns, 1) }, () => "---").join(" | ")} |`;
  return { name, unit: "linhas", header, lines: rest.map((r) => row(r, columns)), firstRow: 2, maxLines };
}

/**
 * As partes de cada pedaço: até `maxLines` linhas e `maxChars` caracteres por parte (o cabeçalho conta e se repete).
 * Uma linha sozinha maior que a parte é cortada.
 */
function partition(blocks: Block[], maxChars: number): FilePart[] {
  const parts: FilePart[] = [];
  for (const b of blocks) {
    const head = b.header ? `${b.header}\n` : "";
    const room = Math.max(200, maxChars - head.length);
    const pieces: { text: string; from: number; to: number }[] = [];
    let cur: string[] = [];
    let size = 0;
    let from = 0;
    const flush = (to: number) => {
      if (cur.length) pieces.push({ text: cur.join("\n"), from, to });
      cur = [];
      size = 0;
      from = to;
    };
    b.lines.forEach((line, i) => {
      if (line.length > room) {
        flush(i);
        for (let at = 0; at < line.length; at += room) pieces.push({ text: line.slice(at, at + room), from: i, to: i + 1 });
        from = i + 1;
        return;
      }
      if (cur.length && (size + line.length + 1 > room || (b.maxLines !== undefined && cur.length >= b.maxLines))) flush(i);
      cur.push(line);
      size += line.length + 1;
    });
    flush(b.lines.length);
    if (!pieces.length) pieces.push({ text: "", from: 0, to: 0 });
    pieces.forEach((p, k) => {
      let label = b.name;
      if (b.unit === "linhas" && b.firstRow !== undefined && p.to > p.from) label += `, linhas ${b.firstRow + p.from}–${b.firstRow + p.to - 1}`;
      else if (b.unit === "linhas" && p.to === p.from) label += ", sem linhas";
      else if (pieces.length > 1) label += `, parte ${k + 1} de ${pieces.length}`;
      parts.push({ label, text: `${head}${p.text}`.replace(/\n+$/, "") });
    });
  }
  return parts;
}

/** O texto de uma árvore do docx: os títulos com `#`, as listas com `-`, as tabelas em linhas `| … |`. */
function docLines(nodes: DocNode[]): string[] {
  const out: string[] = [];
  const inline = (n: DocNode): string => (typeof n === "string" ? n : n.tag === "br" ? " " : n.children.map(inline).join(""));
  const walk = (list: DocNode[], depth: number) => {
    for (const n of list) {
      if (typeof n === "string") {
        if (n.trim()) out.push(n.trim());
        continue;
      }
      const h = /^h([1-6])$/.exec(n.tag);
      if (h) out.push(`${"#".repeat(Number(h[1]))} ${inline(n).trim()}`);
      else if (n.tag === "p") {
        const t = inline(n).trim();
        if (t) out.push(t);
      } else if (n.tag === "ul" || n.tag === "ol") walk(n.children, depth + 1);
      else if (n.tag === "li") {
        const own = n.children.filter((c) => typeof c === "string" || !["ul", "ol"].includes(c.tag));
        const t = own.map(inline).join(" ").replace(/\s+/g, " ").trim();
        if (t) out.push(`${"  ".repeat(Math.max(0, depth - 1))}- ${t}`);
        walk(n.children.filter((c) => typeof c !== "string" && ["ul", "ol"].includes(c.tag)), depth);
      } else if (n.tag === "tr") out.push(`| ${n.children.filter((c) => typeof c !== "string").map((c) => cell(inline(c))).join(" | ")} |`);
      else walk(n.children, depth);
    }
  };
  walk(nodes, 0);
  return out;
}

/** O texto de uma página do pdf, com a quebra de linha onde o pdf marca (ou onde a linha de base muda). */
function pdfPageLines(items: { str?: string; hasEOL?: boolean; transform?: number[]; height?: number }[]): string[] {
  let text = "";
  let lastY: number | null = null;
  let lastH = 0;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    const y = it.transform?.[5] ?? null;
    if (it.str && lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(lastH, it.height ?? 0, 1) / 2 && !text.endsWith("\n")) text += "\n";
    text += it.str;
    if (it.str) {
      lastY = y;
      lastH = it.height ?? 0;
    }
    if (it.hasEOL && !text.endsWith("\n")) text += "\n";
  }
  return text.split("\n").map((l) => l.replace(/\s+$/, ""));
}

/** O PDF.js no main, sem worker: o do próprio pacote, importado aqui para o bundle levar junto. */
async function pdfjs() {
  const [lib, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker;
  return lib;
}

/**
 * O arquivo como texto, em partes de até `maxChars` caracteres. Lança `FileReadError` num arquivo que não abre (o
 * formato errado, o zip grande demais ao abrir, o pdf com senha).
 */
export async function readDocument(path: string, bytes: Uint8Array, maxChars: number): Promise<FileDocument> {
  const format = fileFormat(path);
  if (!format) throw new FileReadError("E_BAD_ARGS", `o agente lê só ${FILE_FORMATS.join(", ")}`);
  const warnings: string[] = [];
  switch (format) {
    case "txt": {
      const { text } = decodeText(bytes);
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      return { format, summary: { linhas: lines.length, caracteres: text.length }, parts: partition([{ name: "Texto", unit: "trecho", lines }], maxChars), warnings };
    }
    case "csv": {
      const { text } = decodeText(bytes);
      const t = parseTable(text, path);
      // O `parseTable` separa o cabeçalho; aqui ele volta a ser a 1ª linha, como numa aba.
      const all = t.header.length ? [t.header, ...t.rows] : t.rows;
      const rows = all.slice(0, MAX_ROWS);
      if (all.length > MAX_ROWS) warnings.push(`A tabela tem mais de ${MAX_ROWS} linhas; só as primeiras ${MAX_ROWS} foram lidas.`);
      const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
      return { format, summary: { linhas: rows.length, abas: [{ nome: "Tabela", linhas: rows.length, colunas: columns }] }, parts: partition([tableBlock("Tabela", rows, columns)], maxChars), warnings };
    }
    case "xlsx": {
      const XLSX = await import("xlsx");
      let book: ReturnType<typeof readWorkbook>;
      try {
        book = readWorkbook(XLSX, bytes);
      } catch (e) {
        if (e instanceof TooLarge) throw new FileReadError("E_TOO_LARGE", "a planilha é grande demais para abrir aqui");
        throw new FileReadError("E_BAD_FILE", "não é uma planilha xlsx que abre");
      }
      if (book.hidden) warnings.push(`${book.hidden} aba(s) escondida(s) no Excel ficaram de fora.`);
      if (book.truncated) warnings.push(`Uma aba tem mais de ${MAX_ROWS} linhas; só as primeiras ${MAX_ROWS} foram lidas.`);
      const abas = book.sheets.map((s) => ({ nome: s.name, linhas: s.rows.length, colunas: s.columns }));
      return { format, summary: { abas }, parts: partition(book.sheets.map((s) => tableBlock(`Aba ${s.name}`, s.rows, s.columns)), maxChars), warnings };
    }
    case "docx": {
      const zip = checkZip(bytes);
      if (!zip.ok) throw zip.reason === "too-large" ? new FileReadError("E_TOO_LARGE", "o documento é grande demais para abrir aqui") : new FileReadError("E_BAD_FILE", "não é um docx que abre");
      const mammoth = (await import("mammoth")).default;
      let html: string;
      try {
        html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
      } catch {
        throw new FileReadError("E_BAD_FILE", "não é um docx que abre");
      }
      const lines = docLines(parseDocHtml(html));
      const caracteres = lines.reduce((n, l) => n + l.length + 1, 0);
      return { format, summary: { caracteres }, parts: partition([{ name: "Documento", unit: "trecho", lines }], maxChars), warnings };
    }
    case "pdf": {
      const lib = await pdfjs();
      const task = lib.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
      try {
        const doc = await task.promise.catch((e: { name?: string }) => {
          throw e?.name === "PasswordException" ? new FileReadError("E_BAD_FILE", "o pdf tem senha; o Kiwi não abre") : new FileReadError("E_BAD_FILE", "não é um pdf que abre");
        });
        const blocks: Block[] = [];
        let chars = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const lines = pdfPageLines((await page.getTextContent()).items as never);
          page.cleanup();
          chars += lines.join("").trim().length;
          blocks.push({ name: `Página ${i}`, unit: "trecho", lines });
        }
        if (!chars) warnings.push("O pdf não tem texto (talvez seja escaneado): o Kiwi não faz OCR, então não há o que ler.");
        return { format, summary: { paginas: doc.numPages, caracteres: chars }, parts: partition(blocks, maxChars), warnings };
      } finally {
        await task.destroy().catch(() => {});
      }
    }
  }
}
