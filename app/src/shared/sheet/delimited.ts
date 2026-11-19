// Gravar csv e tsv sem perda (T21107, spec #21065, parte 2): o arquivo sai com o mesmo separador, a mesma codificação,
// o mesmo BOM e a mesma quebra de linha, e cada linha que não mudou sai com o texto cru do original (as aspas e os
// espaços como estavam). Só a linha editada é escrita de novo.

import { decodeText, type Delimiter, detectDelimiter } from "../../../ui/notes/files/csv.ts";

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DelimitedFormat {
  delimiter: Delimiter;
  encoding: Encoding;
  bom: boolean;
  /** A quebra de linha do arquivo (a primeira fora das aspas); `\n` num arquivo de uma linha só. */
  eol: "\r\n" | "\n" | "\r";
  /** O arquivo terminava com uma quebra. */
  finalEol: boolean;
  /** A linha `sep=;` do Excel no topo, como estava (sem a quebra), fora da grade. */
  preamble: string | null;
  /** As linhas do original e o texto cru de cada uma, para a que não mudou sair igual. */
  original: { cells: string[]; raw: string }[];
}

/** Um texto que a codificação do arquivo não tem (um emoji num csv em windows-1252): a tela diz qual. */
export class DelimitedError extends Error {}

const SEP_HINT = /^sep=([,;\t])$/i;

export function readDelimited(bytes: Uint8Array, name: string): { rows: string[][]; format: DelimitedFormat } {
  const decoded = decodeText(bytes);
  const encoding: Encoding = decoded.encoding === "utf-16" ? (bytes[0] === 0xff ? "utf-16le" : "utf-16be") : decoded.encoding;
  let text = decoded.text;
  // O TextDecoder já tira o BOM do texto: ele se vê nos bytes (o utf-16 só é reconhecido por ele).
  const bom = encoding.startsWith("utf-16") || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text, name);
  const lines = splitRows(text, delimiter);
  let preamble: string | null = null;
  if (lines[0] && SEP_HINT.test(lines[0].raw)) preamble = lines.shift()!.raw;
  const eol = lines.find((l) => l.eol !== "")?.eol || (preamble !== null ? (/\r\n/.test(text.slice(0, preamble.length + 2)) ? "\r\n" : "\n") : "\n");
  const finalEol = /[\r\n]$/.test(text);
  return {
    rows: lines.map((l) => l.cells.slice()),
    format: { delimiter, encoding, bom, eol, finalEol, preamble, original: lines.map((l) => ({ cells: l.cells, raw: l.raw })) },
  };
}

export function writeDelimited(rows: readonly (readonly string[])[], format: DelimitedFormat): Uint8Array {
  const lines: string[] = [];
  if (format.preamble !== null) lines.push(format.preamble);
  // Uma linha que não mudou, na mesma posição ou não (depois de inserir ou apagar uma linha), sai com o texto cru.
  const byText = new Map<string, string[]>();
  for (const o of format.original) {
    const key = JSON.stringify(trimEnd(o.cells));
    const list = byText.get(key) ?? [];
    list.push(o.raw);
    byText.set(key, list);
  }
  for (const row of rows) {
    const key = JSON.stringify(trimEnd(row));
    const raw = byText.get(key)?.shift();
    lines.push(raw ?? row.map((v) => quote(v, format.delimiter)).join(format.delimiter));
  }
  const text = lines.join(format.eol) + (format.finalEol && lines.length ? format.eol : "");
  return encode((format.bom ? "﻿" : "") + text, format.encoding);
}

/** As células do fim que estão vazias não contam (a grade pode ter mais colunas que a linha). */
function trimEnd(cells: readonly string[]): readonly string[] {
  let n = cells.length;
  while (n > 1 && cells[n - 1] === "") n--;
  return n === cells.length ? cells : cells.slice(0, n);
}

/** Aspas só quando precisa: o separador, aspas, quebra ou espaço nas pontas. */
function quote(v: string, d: Delimiter): string {
  return v.includes(d) || /["\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface Line {
  cells: string[];
  raw: string;
  eol: "\r\n" | "\n" | "\r" | "";
}

/** As linhas, com as células e o texto cru de cada uma (uma quebra entre aspas fica dentro da célula). */
function splitRows(text: string, d: Delimiter): Line[] {
  const out: Line[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === d) {
      cells.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      const eol = c === "\r" && text[i + 1] === "\n" ? "\r\n" : c;
      cells.push(field);
      out.push({ cells, raw: text.slice(start, i), eol });
      if (eol === "\r\n") i++;
      start = i + 1;
      cells = [];
      field = "";
    } else field += c;
  }
  if (start < text.length) {
    cells.push(field);
    out.push({ cells, raw: text.slice(start), eol: "" });
  }
  return out;
}

let cp1252: Map<string, number> | null = null;

function encode(text: string, encoding: Encoding): Uint8Array {
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (encoding === "windows-1252") {
    if (!cp1252) {
      cp1252 = new Map();
      const dec = new TextDecoder("windows-1252");
      for (let b = 0; b < 256; b++) cp1252.set(dec.decode(Uint8Array.of(b)), b);
    }
    const out = new Uint8Array(text.length);
    let n = 0;
    for (const ch of text) {
      const b = cp1252.get(ch);
      if (b === undefined) throw new DelimitedError(`“${ch}” não cabe na codificação do arquivo (Windows-1252)`);
      out[n++] = b;
    }
    return out.subarray(0, n);
  }
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), encoding === "utf-16le");
  return out;
}
