// Os arquivos do cofre que o agente lê (spec #11549, T11691): csv, xlsx, docx, pdf e txt viram texto aqui, no Mac, sem
// interpretar nada. Desde o spec #17587 (T17600), também o pptx (o texto de cada slide), o json, o xml, o html (sem as
// tags), o md de dentro de um zip e o zip: a lista do que há nele, e um arquivo de dentro pelo caminho
// `pasta/arquivo.zip/dentro.csv`, lido pelo mesmo caminho. A planilha vira uma tabela em texto (por aba, com o cabeçalho), o docx vira o texto com os títulos,
// e o pdf vira o texto de cada página. O arquivo grande vem por partes: o sumário (as abas, as páginas, as linhas) e a
// parte pedida, nunca o arquivo inteiro de uma vez.
//
// As bibliotecas são as que as Notas já usam para mostrar esses arquivos (o SheetJS, o mammoth e o PDF.js), e as
// partes puras também: a leitura da planilha (`readWorkbook`), a do csv (`parseTable`) e a do HTML do docx.

import { MAX_ROWS, readWorkbook, TooLarge } from "../../../ui/notes/files/sheet.ts";
import { decodeText, parseTable } from "../../../ui/notes/files/csv.ts";
import { parseDocHtml, type DocNode } from "../../../ui/notes/files/docx.ts";
import { checkZip, ZIP_LIMITS, zipEntries, type ZipEntry } from "../../../ui/notes/files/zipSize.ts";
import { Inflate } from "pako/lib/inflate.js";
import { canvasTexts, CanvasParseError, parseCanvas, type CanvasText } from "../../shared/json-canvas.ts";
import { drawioPages } from "../../../ui/notes/files/drawio.ts";

/** O maior arquivo que o agente lê (o spec): 20 MB. */
export const FILES_READ_MAX_BYTES = 20 * 1024 * 1024;
/** As linhas de uma parte de planilha, no máximo (o spec): 2.000. */
export const SHEET_PART_ROWS = 2_000;
/** Quantas partes o índice mostra; o resto é contado. */
export const FILES_INDEX_MAX = 100;

export const FILE_FORMATS = ["csv", "xlsx", "docx", "pdf", "txt", "pptx", "json", "xml", "html", "md", "zip", "canvas", "drawio"] as const;
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
  if (ext === "htm") return "html";
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
  summary: {
    abas?: { nome: string; linhas: number; colunas: number }[];
    paginas?: number;
    slides?: number;
    /** No quadro branco: quantos cartões, grupos e setas têm texto. */
    itens?: number;
    /** No zip: quantos arquivos há dentro (sem contar as pastas). */
    arquivos?: number;
    linhas?: number;
    caracteres?: number;
  };
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
export function pdfPageLines(items: { str?: string; hasEOL?: boolean; transform?: number[]; height?: number }[]): string[] {
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
export async function pdfjs() {
  const [lib, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker;
  return lib;
}

/** O caminho de um arquivo dentro de um zip: `pasta/a.zip/dentro/b.csv` → o zip e o caminho de dentro. */
export function splitZipPath(path: string): { zip: string; inner: string } | null {
  const m = /^(.*?\.zip)\/(.+)$/i.exec(path);
  return m ? { zip: m[1]!, inner: m[2]! } : null;
}

/** As entradas do zip que são arquivos (as pastas, que terminam em "/", e o lixo do macOS ficam de fora). */
function zipFiles(bytes: Uint8Array): ZipEntry[] {
  const entries = zipEntries(bytes);
  if (!entries) throw new FileReadError("E_BAD_FILE", "não é um zip que abre");
  if (entries.length > ZIP_LIMITS.entries) throw new FileReadError("E_TOO_LARGE", `o zip tem mais de ${ZIP_LIMITS.entries} arquivos`);
  return entries.filter((e) => !e.name.endsWith("/") && !/(^|\/)__MACOSX\//.test(e.name) && !/(^|\/)\.DS_Store$/.test(e.name));
}

/**
 * Os bytes de uma entrada, descompactados em pedaços e contados: passou de `cap`, para (o zip bomba, que declara um
 * tamanho e abre outro). O tamanho declarado não decide nada.
 */
export function zipExtract(bytes: Uint8Array, e: ZipEntry, cap: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.offset + 30 > bytes.length || view.getUint32(e.offset, true) !== 0x04034b50) throw new FileReadError("E_BAD_FILE", "não é um zip que abre");
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const data = bytes.subarray(start, Math.min(bytes.length, start + e.compressed));
  const tooLarge = () => new FileReadError("E_TOO_LARGE", `${e.name} passa de ${Math.round(cap / 1024 / 1024)} MB aberto`);
  if (e.method === 0) {
    if (data.length > cap) throw tooLarge();
    return data;
  }
  if (e.method !== 8) throw new FileReadError("E_BAD_FILE", `${e.name} usa uma compressão que o Kiwi não abre`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const inflate = new Inflate({ raw: true, chunkSize: 64 * 1024 });
  inflate.onData = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > cap) over = true;
    else chunks.push(chunk);
  };
  inflate.onEnd = () => {};
  for (let at = 0; at < data.length && !over; at += 16 * 1024) {
    const end = Math.min(at + 16 * 1024, data.length);
    inflate.push(data.subarray(at, end), end === data.length);
    if (inflate.err) throw new FileReadError("E_BAD_FILE", `${e.name} está quebrado dentro do zip`);
  }
  if (over) throw tooLarge();
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** As entidades do XML e do HTML: as com nome mais comuns e as numéricas. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** O texto de uma página HTML: sem script, estilo e comentários; os blocos viram linhas (sem as vazias), os títulos `#`, a lista `-`. */
export function htmlLines(html: string): string[] {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n${"#".repeat(Number(n))} `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|ul|ol|li|tr|table|thead|tbody|h[1-6]|blockquote|pre|dl|dt|dd|figure|figcaption|title|body|html)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean);
}

/** O texto de um slide do pptx: um parágrafo (`<a:p>`) por linha, com os pedaços (`<a:t>`) juntos. */
function slideLines(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.split(/<\/a:p>/)) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1]!));
    const line = runs.join("").trim();
    if (line) out.push(line);
  }
  return out;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Como cada pedaço do quadro aparece para o agente. */
const CANVAS_KIND: Readonly<Record<CanvasText["kind"], string>> = { text: "cartão", file: "nota", link: "link", group: "grupo", edge: "seta" };

/** O texto como linhas, numa parte só por trecho (o txt, o md, o xml e o json). */
function textDoc(format: FileFormat, text: string, name: string, maxChars: number, warnings: string[]): FileDocument {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return { format, summary: { linhas: lines.length, caracteres: text.length }, parts: partition([{ name, unit: "trecho", lines }], maxChars), warnings };
}

/**
 * O arquivo como texto, em partes de até `maxChars` caracteres. Lança `FileReadError` num arquivo que não abre (o
 * formato errado, o zip grande demais ao abrir, o pdf com senha). Um caminho com `arquivo.zip/` no meio lê o arquivo de
 * dentro do zip (`bytes` são os do zip), pelo mesmo caminho.
 */
export async function readDocument(path: string, bytes: Uint8Array, maxChars: number): Promise<FileDocument> {
  const inside = splitZipPath(path);
  if (inside) {
    const name = inside.inner.replace(/^\/+/, "");
    if (splitZipPath(name)) throw new FileReadError("E_BAD_ARGS", "o Kiwi abre um zip de cada vez: um zip dentro de outro só aparece na lista");
    const entry = zipFiles(bytes).find((e) => e.name === name) ?? zipFiles(bytes).find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!entry) throw new FileReadError("E_NOT_FOUND", `${inside.zip} não tem ${name}`);
    if (!fileFormat(entry.name)) throw new FileReadError("E_BAD_ARGS", `${entry.name}: o agente lê só ${FILE_FORMATS.join(", ")}`);
    const doc = await readFormat(entry.name, zipExtract(bytes, entry, FILES_READ_MAX_BYTES), maxChars);
    if (doc.format === "zip") throw new FileReadError("E_BAD_ARGS", "o Kiwi abre um zip de cada vez: um zip dentro de outro só aparece na lista");
    return doc;
  }
  return readFormat(path, bytes, maxChars);
}

async function readFormat(path: string, bytes: Uint8Array, maxChars: number): Promise<FileDocument> {
  const format = fileFormat(path);
  if (!format) throw new FileReadError("E_BAD_ARGS", `o agente lê só ${FILE_FORMATS.join(", ")}`);
  const warnings: string[] = [];
  switch (format) {
    case "txt":
    case "md":
    case "xml":
      return textDoc(format, decodeText(bytes).text, format === "xml" ? "XML" : "Texto", maxChars, warnings);
    case "json": {
      const { text } = decodeText(bytes);
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        warnings.push("Não é um JSON válido: vai o texto como está.");
      }
      return textDoc(format, pretty, "JSON", maxChars, warnings);
    }
    case "canvas": {
      // O quadro branco (T22217): o texto de cada cartão, com o tipo e o id. A forma do quadro (as posições, as cores)
      // fica de fora; para mudar um cartão, o agente lê o arquivo com o notes_read e troca o trecho com o notes_edit.
      let items: CanvasText[];
      try {
        items = canvasTexts(parseCanvas(decodeText(bytes).text));
      } catch (e) {
        throw new FileReadError("E_BAD_ARGS", e instanceof CanvasParseError ? `o quadro não abre: ${e.message}` : "o quadro não abre");
      }
      const lines = items.flatMap((it) => {
        const [first = "", ...rest] = it.text.replace(/\r\n?/g, "\n").split("\n");
        return [`${CANVAS_KIND[it.kind]} ${it.id}: ${first}`, ...rest.map((l) => `  ${l}`)];
      });
      const caracteres = items.reduce((n, it) => n + it.text.length, 0);
      warnings.push("Para mudar o texto de um cartão: kiwi ler/nota no quadro (o JSON) e kiwi escrever/trecho no \"text\" dele.");
      return { format, summary: { itens: items.length, caracteres }, parts: partition([{ name: "Quadro", unit: "trecho", lines }], maxChars), warnings };
    }
    case "drawio": {
      // O diagrama (T22217): os rótulos de cada página, com o id da forma. O desenho se muda no draw.io.
      const pages = drawioPages(decodeText(bytes).text);
      if (!pages) throw new FileReadError("E_BAD_ARGS", "o diagrama não abre: não é um .drawio, ou abre grande demais");
      const blocks: Block[] = pages.map((p, i) => ({
        name: `Página ${i + 1}${p.name ? ` (${p.name})` : ""}`,
        unit: "trecho",
        lines: p.labels.flatMap((l) => l.text.split("\n").map((t, k) => (k ? `  ${t}` : `${l.id}: ${t}`))),
      }));
      const caracteres = pages.reduce((n, p) => n + p.labels.reduce((m, l) => m + l.text.length, 0), 0);
      return { format, summary: { paginas: pages.length, caracteres }, parts: partition(blocks, maxChars), warnings };
    }
    case "html": {
      const lines = htmlLines(decodeText(bytes).text);
      const caracteres = lines.reduce((n, l) => n + l.length + 1, 0);
      return { format, summary: { linhas: lines.length, caracteres }, parts: partition([{ name: "Página", unit: "trecho", lines }], maxChars), warnings };
    }
    case "pptx": {
      const zip = checkZip(bytes);
      if (!zip.ok) throw zip.reason === "too-large" ? new FileReadError("E_TOO_LARGE", "a apresentação é grande demais para abrir aqui") : new FileReadError("E_BAD_FILE", "não é um pptx que abre");
      const slides = zipFiles(bytes)
        .map((e) => ({ e, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name)?.[1]) }))
        .filter((x) => Number.isInteger(x.n) && x.n > 0)
        .sort((a, b) => a.n - b.n);
      if (!slides.length) throw new FileReadError("E_BAD_FILE", "não é um pptx que abre");
      let chars = 0;
      const blocks: Block[] = slides.map(({ e }, i) => {
        const lines = slideLines(new TextDecoder().decode(zipExtract(bytes, e, ZIP_LIMITS.xml)));
        chars += lines.join("").length;
        return { name: `Slide ${i + 1}`, unit: "trecho", lines };
      });
      if (!chars) warnings.push("Os slides não têm texto (talvez só imagens): o Kiwi não faz OCR, então não há o que ler.");
      return { format, summary: { slides: slides.length, caracteres: chars }, parts: partition(blocks, maxChars), warnings };
    }
    case "zip": {
      const files = zipFiles(bytes);
      const lines = files.map((e) => {
        const f = fileFormat(e.name);
        return `- ${e.name} (${kb(e.size)}) · ${f ?? "sem leitura"}`;
      });
      if (!files.length) lines.push("(o zip está vazio)");
      warnings.push(`Para ler um arquivo de dentro, peça o caminho do zip com o de dentro: ${path}/<arquivo>. Os tamanhos são os que o zip declara.`);
      return { format, summary: { arquivos: files.length }, parts: partition([{ name: "Conteúdo do zip", unit: "trecho", lines }], maxChars), warnings };
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
