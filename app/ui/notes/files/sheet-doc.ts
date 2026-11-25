// A planilha editável das Notas (T21109, spec #21065, parte 4), a parte pura: o arquivo vira a grade das operações
// (`src/shared/sheet/ops.ts`), a pessoa edita por operações, e gravar é reaplicá-las sobre os bytes do original (o xlsx
// pelo `patchXlsx`, o csv e o tsv pelo `writeDelimited`). Aqui ficam também o que a pessoa digita numa célula, o colar
// e o copiar de um bloco (o texto com tabs do Excel e do Numbers), e a ordem e o filtro, que são só da vista: nada
// disso grava. Sem React e sem DOM, para os testes.

import type * as Xlsx from "xlsx";

import { readDelimited, writeDelimited, type DelimitedFormat } from "../../../src/shared/sheet/delimited.ts";
import { hasFormulas } from "../../../src/shared/sheet/formula/has-formulas.ts";
import type { DefinedName } from "../../../src/shared/sheet/formula/recalc.ts";
import { toEnglish, toPtBr } from "../../../src/shared/sheet/formula/translate.ts";
import { applyToGrid, type CellValue, type Display, formatKind, type Grid, type GridCell, type GridSheet, parseInput, plainDisplay, type SheetOp } from "../../../src/shared/sheet/ops.ts";
import { inspectXlsx, patchXlsx, readXlsx } from "../../../src/shared/sheet/xlsx.ts";

import { checkZip } from "./zipSize.ts";
import { isXlsx, localizeNumber, TooLarge } from "./sheet.ts";
import type { SheetWhy } from "../../../src/shared/sheet/why.ts";

export type Decimal = "," | ".";

export interface SheetDoc {
  kind: "xlsx" | "delimited";
  /** O nome do arquivo, para as mensagens de erro do xlsx. */
  name: string;
  /** Os bytes como abriram (ou como a última gravação deixou): gravar reaplica as operações sobre eles. */
  original: Uint8Array;
  /** A grade dos bytes, com o texto que cada célula mostra. */
  base: Grid;
  /** O separador, a codificação e as linhas cruas do csv e do tsv. */
  format: DelimitedFormat | null;
  /** Os nomes definidos do livro, para o recálculo. */
  names: DefinedName[];
  /** As abas escondidas no Excel: ficam no arquivo, fora da tela. */
  hidden: string[];
  /** Por que o arquivo abre só para leitura (a senha, as macros), ou `null`. */
  /** Por que abre só para leitura (T29245): a tela traduz. */
  readOnly: SheetWhy | null;
}

/**
 * O texto de um valor no formato da célula, como a grade mostra: o código de formato do Excel pelo SSF do SheetJS, com
 * os separadores do sistema (o SheetJS escreve os dos EUA). A data fica como o formato diz.
 */
export function sheetDisplay(SSF: typeof Xlsx.SSF, decimal: Decimal): Display {
  return (value, format) => {
    if (value === null) return "";
    if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
    if (typeof value === "string") return value;
    const code = format ?? "General";
    let text: string;
    try {
      text = SSF.format(code, value);
    } catch {
      text = String(value);
    }
    return SSF.is_date(code) ? text : localizeNumber(text, decimal);
  };
}

/** Abre os bytes: o xlsx pela leitura sem perda, o csv e o tsv pelas linhas cruas. Lança `TooLarge` na bomba de zip. */
export function openDoc(bytes: Uint8Array, name: string, display: Display = plainDisplay): SheetDoc {
  if (!/\.xlsx$/i.test(name)) {
    const { rows, format } = readDelimited(bytes, name);
    const cells = rows.map((r) => r.map((t): GridCell | undefined => (t === "" ? undefined : { value: t, text: t })));
    return { kind: "delimited", name, original: bytes, base: { sheets: [{ name: "", rows: cells }] }, format, names: [], hidden: [], readOnly: null };
  }
  if (isXlsx(bytes)) {
    const zip = checkZip(bytes);
    if (!zip.ok) throw zip.reason === "too-large" ? new TooLarge("the spreadsheet is too large to open here") : new Error("not an xlsx file");
  }
  const inspection = inspectXlsx(bytes, name);
  const readOnly = inspection.editable ? null : inspection.why;
  const book = readXlsx(bytes, name);
  const sheets: GridSheet[] = book.sheets.map((s) => ({
    name: s.name,
    rows: s.rows.map((r) => r.map((c): GridCell | undefined => (c ? { ...c, text: display(c.value, c.format) } : undefined))),
  }));
  return {
    kind: "xlsx",
    name,
    original: bytes,
    base: { sheets },
    format: null,
    names: book.names,
    hidden: book.sheets.filter((s) => s.hidden).map((s) => s.name),
    readOnly,
  };
}

/** A grade depois das operações, a partir da do arquivo. */
export function replay(doc: SheetDoc, ops: readonly SheetOp[], display: Display = plainDisplay): Grid {
  return ops.reduce((g, op) => applyToGrid(g, op, display), doc.base);
}

/** Os bytes que gravam: as operações sobre o original. */
export function docBytes(doc: SheetDoc, ops: readonly SheetOp[], grid: Grid): Uint8Array {
  if (doc.kind === "xlsx") return patchXlsx(doc.original, ops, doc.name);
  return writeDelimited(sheetTexts(grid.sheets[0]!), doc.format!);
}

/** O texto de cada célula da aba, linha a linha, todas da mesma largura (a da linha mais larga). */
export function sheetTexts(sheet: GridSheet): string[][] {
  const columns = sheet.rows.reduce((n, r) => Math.max(n, r?.length ?? 0), 0);
  return Array.from(sheet.rows, (r) => Array.from({ length: columns }, (_, c) => r?.[c]?.text ?? ""));
}

// ---------------------------------------------------------------------------------------------------------------------
// Editar uma célula

/** O número como a pessoa digita, com o decimal do sistema e sem os milhares (`1234,5`). */
function typedNumber(n: number, decimal: Decimal): string {
  const s = String(Number(n.toPrecision(15)));
  return decimal === "," ? s.replace(".", ",") : s;
}

/** O que a caixa de edição mostra ao abrir: a fórmula em português (`=SOMA(A1;A2)`), ou o valor como se digita. */
export function editText(cell: GridCell | undefined, decimal: Decimal): string {
  if (!cell) return "";
  if (cell.formula !== undefined) return toPtBr(cell.formula);
  const v = cell.value;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "string") return v;
  const kind = formatKind(cell.format);
  if (kind === "percent") return `${typedNumber(v * 100, decimal)}%`;
  if (kind === "date") return cell.text;
  return typedNumber(v, decimal);
}

/**
 * A operação do que a pessoa digitou numa célula (linha e coluna do arquivo). No csv tudo é texto, como no arquivo; no
 * xlsx o texto passa pelo `parseInput` (número, moeda, data, fórmula), e a fórmula vai em inglês para o arquivo.
 */
export function inputOp(doc: SheetDoc, sheet: string, row: number, col: number, typed: string, current: GridCell | undefined, decimal: Decimal): SheetOp {
  if (doc.kind === "delimited") return { op: "set", sheet, row, col, value: typed === "" ? null : typed };
  const input = parseInput(typed, current?.format, decimal);
  if (input.formula !== undefined) return { op: "set", sheet, row, col, value: current?.formula !== undefined ? current.value : null, formula: toEnglish(input.formula) };
  return { op: "set", sheet, row, col, value: input.value, ...(input.format ? { format: input.format } : {}) };
}

/** A edição inteira, num passo do desfazer: as células da pessoa e, no xlsx com fórmula, o recálculo de quem depende delas. */
export async function editBatch(doc: SheetDoc, grid: Grid, ops: SheetOp[], display: Display): Promise<SheetOp> {
  if (doc.kind !== "xlsx") return ops.length === 1 ? ops[0]! : { op: "batch", ops };
  const after = ops.reduce((g, op) => applyToGrid(g, op, display), grid);
  if (!hasFormulas(after)) return ops.length === 1 ? ops[0]! : { op: "batch", ops };
  // O HyperFormula (787 KB) só carrega quando a planilha tem fórmula (#21862).
  const { recalc, recalcOps } = await import("../../../src/shared/sheet/formula/recalc.ts");
  return { op: "batch", ops: [...ops, ...recalcOps(after, recalc(after, display, doc.names))] };
}

/** A grade que a tela mostra: com fórmula, recalculada, para a marca `stale` das que o Kiwi não sabe refazer. */
export async function shownGrid(doc: SheetDoc, ops: readonly SheetOp[], display: Display): Promise<Grid> {
  const grid = replay(doc, ops, display);
  if (doc.kind !== "xlsx" || !ops.length || !hasFormulas(grid)) return grid;
  const { recalc } = await import("../../../src/shared/sheet/formula/recalc.ts");
  return recalc(grid, display, doc.names);
}

// ---------------------------------------------------------------------------------------------------------------------
// Colar e copiar um bloco

/**
 * O texto que o Excel e o Numbers põem na área de transferência: uma linha por quebra, as células separadas por tab, e
 * entre aspas a célula que tem tab, quebra ou aspas. A quebra do fim não é uma linha.
 */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    started = true;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
    } else field += c;
  }
  if (started) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** O bloco como o Excel e o Numbers colam: tabs e quebras, com aspas onde a célula tem tab, quebra ou aspas. */
export function clipboardText(block: readonly (readonly string[])[]): string {
  const q = (v: string) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return block.map((r) => r.map(q).join("\t")).join("\n");
}

/** As operações de colar um bloco a partir de uma célula (do arquivo). */
export function pasteOps(doc: SheetDoc, sheet: GridSheet, row: number, col: number, block: string[][], decimal: Decimal): SheetOp[] {
  const ops: SheetOp[] = [];
  block.forEach((r, i) =>
    r.forEach((typed, j) => {
      const current = sheet.rows[row + i]?.[col + j];
      if (typed === "" && !current) return;
      ops.push(inputOp(doc, sheet.name, row + i, col + j, typed, current, decimal));
    }),
  );
  return ops;
}

export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** A área entre duas células, em qualquer ordem. */
export function rangeOf(a: { row: number; col: number }, b: { row: number; col: number }): Range {
  return { r0: Math.min(a.row, b.row), c0: Math.min(a.col, b.col), r1: Math.max(a.row, b.row), c1: Math.max(a.col, b.col) };
}

/** Apagar o conteúdo de uma área (o Delete): só as células que têm valor ou fórmula; o formato fica. */
export function clearOps(sheet: GridSheet, rows: readonly number[], c0: number, c1: number): SheetOp[] {
  const ops: SheetOp[] = [];
  for (const row of rows) {
    for (let col = c0; col <= c1; col++) {
      const cell = sheet.rows[row]?.[col];
      if (cell && (cell.value !== null || cell.formula !== undefined)) ops.push({ op: "set", sheet: sheet.name, row, col, value: null });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------------------------------
// A ordem e o filtro: só a vista

export interface ViewSpec {
  sort?: { col: number; dir: 1 | -1 };
  /** Só as linhas em que a coluna mostra um destes textos. */
  filter?: { col: number; values: string[] };
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function compareCells(a: GridCell | undefined, b: GridCell | undefined): number {
  const empty = (c: GridCell | undefined) => !c || c.value === null || c.value === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  const [va, vb] = [a!.value, b!.value];
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  // O número vem antes do texto, como no Excel.
  if (typeof va === "number") return -1;
  if (typeof vb === "number") return 1;
  return collator.compare(a!.text, b!.text);
}

/**
 * As linhas do arquivo que a vista mostra abaixo da de cima (a linha 0, os títulos, fica parada), na ordem da vista.
 * A célula vazia vai para o fim nos dois sentidos, e o empate segue a ordem do arquivo.
 */
export function viewRows(sheet: GridSheet, total: number, spec: ViewSpec): number[] {
  let out = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1);
  const f = spec.filter;
  if (f) {
    const keep = new Set(f.values);
    out = out.filter((r) => keep.has(sheet.rows[r]?.[f.col]?.text ?? ""));
  }
  const s = spec.sort;
  if (s) {
    out = out
      .map((r, i) => ({ r, i }))
      .sort((x, y) => {
        const [a, b] = [sheet.rows[x.r]?.[s.col], sheet.rows[y.r]?.[s.col]];
        const blank = (c: GridCell | undefined) => !c || c.value === null || c.value === "";
        if (blank(a) !== blank(b)) return blank(a) ? 1 : -1;
        return compareCells(a, b) * s.dir || x.i - y.i;
      })
      .map((x) => x.r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// ⌘F

/** Sem acento e sem caixa, para "Sao" achar "São". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** As células cujo texto contém a busca, na ordem da vista (linha a linha). `rows` são os textos já na ordem da vista. */
export function findCells(rows: readonly (readonly string[])[], query: string): { row: number; col: number }[] {
  const q = fold(query.trim());
  if (!q) return [];
  const out: { row: number; col: number }[] = [];
  rows.forEach((r, row) => r.forEach((t, col) => t && fold(t).includes(q) && out.push({ row, col })));
  return out;
}

export type { CellValue };
