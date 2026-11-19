// As ferramentas da planilha do agente (T21114, spec #21033): o `sheets_read` lê as células de um xlsx, csv ou tsv
// com os valores e as fórmulas, e o `sheets_edit` muda o arquivo por operações (as células, as linhas e as colunas,
// as abas), gravando como a grade grava: só o que mudou, com o recálculo das fórmulas que dependem da edição. As
// operações vão junto da gravação para o Kiwi ao vivo (`liveWriter.saveBytes`): a grade aberta toca cada uma.

import * as XLSX from "xlsx";

import { type CellValue, checkOp, type Grid, type GridSheet, SheetOpError, type SheetOp, applyToGrid } from "../../shared/sheet/ops.ts";
import { cellName, parseCell } from "../../shared/sheet/refs.ts";
import { docBytes, editBatch, openDoc, type SheetDoc, sheetDisplay } from "../../../ui/notes/files/sheet-doc.ts";
import { base64Of } from "../../../ui/notes/files/csv.ts";
import type { VaultReader } from "./reader.ts";
import type { VaultWriter } from "./writer.ts";

/** Quantas linhas o `sheets_read` devolve sem intervalo, e o máximo de células num pedido. */
export const SHEETS_READ_ROWS = 100;
export const SHEETS_READ_CELLS = 5_000;
/** O máximo de mudanças e de células num `sheets_edit`. */
export const SHEETS_EDIT_CHANGES = 200;
export const SHEETS_EDIT_CELLS = 5_000;
/** O maior arquivo que as ferramentas abrem. */
export const SHEETS_MAX_BYTES = 20 * 1024 * 1024;

export const isSheetPath = (path: string) => /\.(xlsx|csv|tsv)$/i.test(path);

/** O erro que o agente lê; o `tools.ts` o converte no `ToolError`. */
export class SheetToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** O texto do valor com o formato da célula, como a pessoa vê (o decimal com vírgula). */
const display = sheetDisplay(XLSX.SSF, ",");

const fromBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

function open(path: string, bytes: Uint8Array): SheetDoc {
  try {
    return openDoc(bytes, path.split("/").at(-1) ?? path, display);
  } catch (e) {
    throw new SheetToolError("E_FAILED", `não deu para abrir ${path} como planilha: ${(e as Error).message}`);
  }
}

/** A aba pelo nome (sem diferenciar maiúscula); sem nome, a primeira que aparece. O csv tem uma aba só, sem nome. */
function sheetOf(doc: SheetDoc, grid: Grid, name: string | undefined, path: string): GridSheet {
  if (doc.kind === "delimited") return grid.sheets[0]!;
  const visible = grid.sheets.filter((s) => !doc.hidden.includes(s.name));
  if (name === undefined || name === "") {
    const first = visible[0] ?? grid.sheets[0];
    if (!first) throw new SheetToolError("E_NOT_FOUND", `${path} não tem abas`);
    return first;
  }
  const s = grid.sheets.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new SheetToolError("E_NOT_FOUND", `${path} não tem a aba ${name}; as abas: ${visible.map((x) => x.name).join(", ")}`);
  return s;
}

/** O tamanho dos dados da aba: até a última linha e a última coluna com algo. */
function extent(sheet: GridSheet): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  sheet.rows.forEach((r, i) => {
    r?.forEach((c, j) => {
      if (c && (c.value !== null || c.formula !== undefined)) {
        rows = Math.max(rows, i + 1);
        cols = Math.max(cols, j + 1);
      }
    });
  });
  return { rows, cols };
}

function cellAt(ref: string, field: string): { row: number; col: number } {
  const c = parseCell(ref.trim().toUpperCase().replace(/\$/g, ""));
  if (!c) throw new SheetToolError("E_BAD_ARGS", `${field}: ${ref} não é uma célula (ex.: B3)`);
  return c;
}

/** "A1:D20", "B5" ou nada (as primeiras linhas). */
function rangeOf(raw: string | undefined, size: { rows: number; cols: number }): { r0: number; r1: number; c0: number; c1: number } {
  if (!raw?.trim()) return { r0: 0, r1: Math.min(size.rows, SHEETS_READ_ROWS) - 1, c0: 0, c1: size.cols - 1 };
  const [a, b = a] = raw.split(":");
  const p = cellAt(a!, "intervalo");
  const q = cellAt(b!, "intervalo");
  return { r0: Math.min(p.row, q.row), r1: Math.max(p.row, q.row), c0: Math.min(p.col, q.col), c1: Math.max(p.col, q.col) };
}

export interface SheetsReadArgs {
  caminho: string;
  aba?: string;
  intervalo?: string;
}

/**
 * As células de um intervalo: `linhas` com os valores (número é número; a célula vazia, null), `formulas` com as
 * fórmulas (A1 → "=SUM(B2:B4)", em inglês como no Excel) e `textos` com o que a célula mostra quando o formato muda
 * o valor (a moeda, a data, a porcentagem). `filtrar` passa o texto pelo filtro dos segredos.
 */
export async function sheetsRead(reader: VaultReader, a: SheetsReadArgs, filtrar: (text: string) => Promise<string>): Promise<Record<string, unknown>> {
  const path = a.caminho.trim().replace(/^\/+/, "");
  if (!isSheetPath(path)) throw new SheetToolError("E_BAD_ARGS", `o \`sheets_read\` lê só xlsx, csv e tsv; para ${path}, use files_read`);
  const f = await reader.file(path);
  if ("tooLarge" in f || f.size > SHEETS_MAX_BYTES) throw new SheetToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);
  if (!("base64" in f)) throw new SheetToolError("E_FAILED", `não deu para ler ${path}`);
  const doc = open(path, fromBase64(f.base64));
  const sheet = sheetOf(doc, doc.base, a.aba, path);
  const size = extent(sheet);
  const range = rangeOf(a.intervalo, size);
  const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
  if (cells > SHEETS_READ_CELLS) throw new SheetToolError("E_TOO_LARGE", `o intervalo tem ${cells} células, e o máximo por leitura é ${SHEETS_READ_CELLS}; peça um intervalo menor`);
  const linhas: CellValue[][] = [];
  const formulas: Record<string, string> = {};
  const textos: Record<string, string> = {};
  for (let r = range.r0; r <= range.r1; r++) {
    const row: CellValue[] = [];
    for (let c = range.c0; c <= range.c1; c++) {
      const cell = sheet.rows[r]?.[c];
      row.push(cell?.value ?? null);
      if (!cell) continue;
      const ref = cellName({ row: r, col: c });
      if (cell.formula !== undefined) formulas[ref] = `=${cell.formula}`;
      if (cell.value !== null && typeof cell.value !== "string" && cell.format && cell.format !== "General" && cell.text !== "") textos[ref] = cell.text;
    }
    linhas.push(row);
  }
  // O texto do arquivo passa pelo filtro dos segredos de uma vez: cada string numa linha, na ordem.
  const strings: { set: (s: string) => void; s: string }[] = [];
  linhas.forEach((row) => row.forEach((v, i) => typeof v === "string" && strings.push({ s: v, set: (s) => (row[i] = s) })));
  for (const k of Object.keys(formulas)) strings.push({ s: formulas[k]!, set: (s) => (formulas[k] = s) });
  for (const k of Object.keys(textos)) strings.push({ s: textos[k]!, set: (s) => (textos[k] = s) });
  const names = doc.kind === "xlsx" ? doc.base.sheets.filter((s) => !doc.hidden.includes(s.name)).map((s) => s.name) : [];
  const all = [...strings.map((x) => x.s), ...names];
  if (all.length) {
    // Uma quebra de linha dentro da célula viraria duas linhas: vai como um marcador e volta depois.
    const NL = " ";
    const clean = (await filtrar(all.map((s) => s.replace(/\r?\n/g, NL)).join("\n"))).split("\n").map((s) => s.replaceAll(NL, "\n"));
    if (clean.length !== all.length) throw new SheetToolError("E_FAILED", `não deu para ler ${path} com o filtro`);
    strings.forEach((x, i) => x.set(clean[i]!));
    names.splice(0, names.length, ...clean.slice(strings.length));
  }
  const de = cellName({ row: range.r0, col: range.c0 });
  const ate = cellName({ row: Math.max(range.r0, range.r1), col: Math.max(range.c0, range.c1) });
  const avisos = [
    ...(doc.readOnly ? [`Só leitura: ${doc.readOnly}. O sheets_edit não muda este arquivo.`] : []),
    ...(!a.intervalo && size.rows > SHEETS_READ_ROWS ? [`Há mais: a aba tem ${size.rows} linhas; peça o resto com intervalo (ex.: A${SHEETS_READ_ROWS + 1}:${cellName({ row: 0, col: Math.max(0, size.cols - 1) }).replace(/\d+$/, "")}${size.rows}).`] : []),
    ...(doc.kind === "delimited" ? ["É um csv/tsv: tudo é texto, e não há fórmulas nem abas."] : []),
  ];
  return {
    caminho: path,
    versao: f.version,
    formato: doc.kind === "xlsx" ? "xlsx" : path.split(".").at(-1)!.toLowerCase(),
    ...(names.length ? { abas: names, aba: names.find((n) => n.toLowerCase() === sheet.name.toLowerCase()) ?? sheet.name } : {}),
    tamanho: { linhas: size.rows, colunas: size.cols },
    intervalo: size.rows && size.cols ? `${de}:${ate}` : "",
    linhas: size.rows && size.cols ? linhas : [],
    ...(Object.keys(formulas).length ? { formulas } : {}),
    ...(Object.keys(textos).length ? { textos } : {}),
    ...(avisos.length ? { avisos } : {}),
  };
}

export type SheetChange =
  | { tipo: "celulas"; aba?: string; celulas: Record<string, CellValue> }
  | { tipo: "inserir_linhas" | "apagar_linhas"; aba?: string; linha: number; quantidade?: number }
  | { tipo: "inserir_colunas" | "apagar_colunas"; aba?: string; coluna: string; quantidade?: number }
  | { tipo: "nova_aba"; nome: string }
  | { tipo: "renomear_aba"; aba: string; nome: string };

export interface SheetsEditArgs {
  caminho: string;
  versao: string;
  mudancas: SheetChange[];
}

export interface SheetsEditResult {
  path: string;
  version: string;
  copy: string;
  before: number;
  after: number;
  ops: SheetOp[];
  cells: number;
}

function colOf(raw: string): number {
  const c = parseCell(`${raw.trim().toUpperCase()}1`);
  if (!c) throw new SheetToolError("E_BAD_ARGS", `coluna: ${raw} não é uma coluna (ex.: C)`);
  return c.col;
}

/** O valor que o agente mandou, como a operação da célula: o "=" é fórmula (em inglês, como no Excel). */
function setOp(doc: SheetDoc, sheet: string, ref: string, raw: unknown, restore: (s: string) => string): SheetOp {
  const { row, col } = cellAt(ref, "celulas");
  if (raw === null || raw === "") return { op: "set", sheet, row, col, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new SheetToolError("E_BAD_ARGS", `${ref}: o número não é finito`);
    return { op: "set", sheet, row, col, value: doc.kind === "delimited" ? String(raw) : raw };
  }
  if (typeof raw === "boolean") return { op: "set", sheet, row, col, value: doc.kind === "delimited" ? (raw ? "TRUE" : "FALSE") : raw };
  if (typeof raw !== "string") throw new SheetToolError("E_BAD_ARGS", `${ref}: o valor é número, texto, true/false ou null`);
  const text = restore(raw);
  if (doc.kind === "xlsx" && /^=./.test(text)) return { op: "set", sheet, row, col, value: null, formula: text.slice(1) };
  return { op: "set", sheet, row, col, value: text };
}

/** As operações de uma mudança, contra a grade de agora (as posições são as de depois das mudanças anteriores). */
function opsOf(doc: SheetDoc, grid: Grid, m: SheetChange, i: number, path: string, restore: (s: string) => string): SheetOp[] {
  const where = `mudancas[${i}]`;
  if (!m || typeof m !== "object") throw new SheetToolError("E_BAD_ARGS", `${where} não é um objeto`);
  const count = (q: unknown) => {
    if (q === undefined) return 1;
    if (!Number.isInteger(q) || (q as number) < 1 || (q as number) > 10_000) throw new SheetToolError("E_BAD_ARGS", `${where}.quantidade vai de 1 a 10000`);
    return q as number;
  };
  switch (m.tipo) {
    case "celulas": {
      const sheet = sheetOf(doc, grid, m.aba, path).name;
      if (!m.celulas || typeof m.celulas !== "object" || Array.isArray(m.celulas)) throw new SheetToolError("E_BAD_ARGS", `${where}.celulas é um objeto como {"B3": 12}`);
      return Object.entries(m.celulas).map(([ref, v]) => setOp(doc, sheet, ref, v, restore));
    }
    case "inserir_linhas":
    case "apagar_linhas": {
      const sheet = sheetOf(doc, grid, m.aba, path).name;
      if (!Number.isInteger(m.linha) || m.linha < 1) throw new SheetToolError("E_BAD_ARGS", `${where}.linha é o número da linha, a partir de 1`);
      return [{ op: m.tipo === "inserir_linhas" ? "insertRows" : "deleteRows", sheet, at: m.linha - 1, count: count(m.quantidade) }];
    }
    case "inserir_colunas":
    case "apagar_colunas": {
      const sheet = sheetOf(doc, grid, m.aba, path).name;
      if (typeof m.coluna !== "string") throw new SheetToolError("E_BAD_ARGS", `${where}.coluna é a letra da coluna (ex.: C)`);
      return [{ op: m.tipo === "inserir_colunas" ? "insertCols" : "deleteCols", sheet, at: colOf(m.coluna), count: count(m.quantidade) }];
    }
    case "nova_aba":
    case "renomear_aba": {
      if (doc.kind !== "xlsx") throw new SheetToolError("E_BAD_ARGS", `${path} é csv/tsv, e não tem abas`);
      if (typeof m.nome !== "string") throw new SheetToolError("E_BAD_ARGS", `${where}.nome é o nome da aba`);
      const nome = restore(m.nome);
      if (m.tipo === "nova_aba") return [{ op: "addSheet", name: nome }];
      return [{ op: "renameSheet", sheet: sheetOf(doc, grid, m.aba, path).name, name: nome }];
    }
    default:
      throw new SheetToolError("E_BAD_ARGS", `${where}.tipo: ${(m as { tipo?: unknown }).tipo} não é um tipo de mudança`);
  }
}

/**
 * Muda a planilha: confere a versão, aplica as mudanças na ordem (cada uma contra o resultado da anterior), recalcula
 * as fórmulas que dependem delas e grava os bytes com as operações, depois de guardar a cópia de antes no registro.
 */
export async function sheetsEdit(
  writer: VaultWriter,
  journal: { keep(path: string, before: string): Promise<string>; drop(copy: string): Promise<void> },
  a: SheetsEditArgs,
  restore: (path: string, text: string) => string,
): Promise<SheetsEditResult> {
  if (!writer.getBytes || !writer.saveBytes) throw new SheetToolError("E_UNKNOWN_TOOL", "o Kiwi não tem a ferramenta `sheets_edit`");
  const path = a.caminho.trim().replace(/^\/+/, "");
  if (!isSheetPath(path)) throw new SheetToolError("E_BAD_ARGS", `o \`sheets_edit\` muda só xlsx, csv e tsv`);
  if (!Array.isArray(a.mudancas) || !a.mudancas.length) throw new SheetToolError("E_BAD_ARGS", "mudancas está vazio");
  if (a.mudancas.length > SHEETS_EDIT_CHANGES) throw new SheetToolError("E_BAD_ARGS", `no máximo ${SHEETS_EDIT_CHANGES} mudanças por vez`);
  const f = await writer.getBytes(path);
  if ("tooLarge" in f) throw new SheetToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);
  if (f.version !== a.versao) throw new SheetToolError("E_CHANGED", `${path} mudou desde que você leu. Nada foi escrito: leia de novo com \`sheets_read\` e mande a versao nova.`);
  const before = fromBase64(f.base64);
  if (before.length > SHEETS_MAX_BYTES) throw new SheetToolError("E_TOO_LARGE", `${path} é grande demais para abrir aqui`);
  const doc = open(path, before);
  if (doc.readOnly) throw new SheetToolError("E_READ_ONLY", `${path} é só leitura (${doc.readOnly}); nada foi escrito`);

  let grid = doc.base;
  const ops: SheetOp[] = [];
  let cells = 0;
  const keep = (s: string) => restore(path, s);
  try {
    a.mudancas.forEach((m, i) => {
      const mine = opsOf(doc, grid, m, i, path, keep);
      for (const op of mine) {
        if (op.op === "set" && ++cells > SHEETS_EDIT_CELLS) throw new SheetToolError("E_BAD_ARGS", `no máximo ${SHEETS_EDIT_CELLS} células por vez`);
        checkOp(op, grid.sheets.map((s) => s.name));
        grid = applyToGrid(grid, op, display);
        ops.push(op);
      }
    });
  } catch (e) {
    if (e instanceof SheetOpError) throw new SheetToolError("E_BAD_ARGS", e.message);
    throw e;
  }
  // A pessoa com a caixa aberta numa célula que o lote muda: o gato espera ela sair, com teto. Nada do lote passa na
  // frente: ou ele grava inteiro depois, ou nada (T21114, spec #21033).
  if (writer.waitCells) {
    const { busy, waited } = await writer.waitCells(path, ops);
    if (busy) {
      const ref = `${cellName(busy)}${doc.kind === "xlsx" ? ` (aba ${busy.sheet})` : ""}`;
      throw new SheetToolError("E_BUSY", `a pessoa está editando ${ref} agora. Nada foi escrito: mude as outras células num sheets_edit sem ${cellName(busy)}, ou tente de novo daqui a pouco.`);
    }
    if (waited) {
      const now = await writer.getBytes(path);
      if ("tooLarge" in now || now.version !== f.version)
        throw new SheetToolError("E_CHANGED", `a pessoa acabou de mudar ${path} na célula que você ia escrever. Nada foi escrito: leia de novo com \`sheets_read\` e decida com o valor dela.`);
    }
  }
  const batch = await editBatch(doc, doc.base, ops, display);
  const after = docBytes(doc, [batch], [batch].reduce((g, op) => applyToGrid(g, op, display), doc.base));
  const copy = await journal.keep(path, f.base64);
  let r: Awaited<ReturnType<NonNullable<VaultWriter["saveBytes"]>>>;
  try {
    r = await writer.saveBytes(path, base64Of(after), f.version, batch.op === "batch" ? batch.ops : [batch]);
  } catch (e) {
    await journal.drop(copy);
    throw e;
  }
  if (!r.saved) {
    await journal.drop(copy);
    throw new SheetToolError("E_CHANGED", `${path} mudou enquanto o Kiwi gravava. Nada foi escrito: leia de novo com \`sheets_read\`.`);
  }
  return { path: r.path, version: r.version, copy, before: before.length, after: after.length, ops: batch.op === "batch" ? batch.ops : [batch], cells };
}
