// As edições de uma planilha (T21107, spec #21065, parte 1): toda mudança é uma operação pequena (uma célula, linhas,
// colunas, uma aba), a mesma para a pessoa na grade e para o Kiwi Cat. Sem tela: a grade da janela, a gravação do xlsx
// e do csv e o gato usam este módulo.
//
// O desfazer não guarda inversas: o estado é o arquivo original mais as operações até o cursor. Desfazer anda o cursor
// para trás, e gravar reaplica as que ficaram sobre o original. Assim um "apagar linha" desfeito volta com o estilo, a
// mescla e a formatação dela, sem nada escrito à mão para cada operação.

import { MAX_COLS, MAX_ROWS, renameInFormula, shiftFormula, type Shift } from "./refs.ts";

/** O valor de uma célula; `null` é a célula vazia. */
export type CellValue = string | number | boolean | null;

export type SheetOp =
  /**
   * Uma célula (linha e coluna a partir de 0; a linha 0 é a linha 1 do arquivo). `formula` sem o "=", e `value` é o
   * resultado dela (o T21108 calcula). `format`: o código de formato de número novo, quando o que a pessoa digitou pede
   * um (`31%` numa célula Geral).
   */
  | { op: "set"; sheet: string; row: number; col: number; value: CellValue; formula?: string; format?: string }
  /**
   * Só o resultado guardado de uma célula com fórmula (o `<v>` do xlsx), depois do recálculo (T21108): a fórmula, o
   * estilo e o resto do arquivo não mudam. Vai no mesmo `batch` da edição que mudou o resultado.
   */
  | { op: "cached"; sheet: string; row: number; col: number; value: CellValue }
  | { op: "insertRows" | "deleteRows" | "insertCols" | "deleteCols"; sheet: string; at: number; count: number }
  | { op: "renameSheet"; sheet: string; name: string }
  | { op: "addSheet"; name: string }
  /** Várias de uma vez, um passo só no desfazer (a célula e as fórmulas que dependem dela). */
  | { op: "batch"; ops: SheetOp[] };

/** Uma operação que não cabe na planilha: a tela diz o porquê, e nada muda. */
export class SheetOpError extends Error {}

/** O que o Excel aceita como nome de aba. */
export function sheetNameProblem(name: string, taken: readonly string[], except?: string): string | null {
  if (!name.trim()) return "o nome da aba não pode ficar vazio";
  if (name.length > 31) return "o nome da aba tem no máximo 31 caracteres";
  if (/[\\/?*[\]:]/.test(name)) return "o nome da aba não pode ter \\ / ? * [ ] :";
  if (name.startsWith("'") || name.endsWith("'")) return "o nome da aba não pode começar nem terminar com '";
  const lower = name.toLowerCase();
  if (taken.some((t) => t.toLowerCase() === lower && t.toLowerCase() !== except?.toLowerCase())) return `já existe uma aba chamada ${name}`;
  return null;
}

/** Confere uma operação contra os nomes das abas; lança `SheetOpError` com o motivo. */
export function checkOp(op: SheetOp, sheets: readonly string[]): void {
  const has = (s: string) => sheets.some((t) => t.toLowerCase() === s.toLowerCase());
  const int = (n: number) => Number.isInteger(n) && n >= 0;
  switch (op.op) {
    case "batch":
      for (const o of op.ops) checkOp(o, sheets);
      return;
    case "addSheet": {
      const p = sheetNameProblem(op.name, sheets);
      if (p) throw new SheetOpError(p);
      return;
    }
    case "renameSheet": {
      if (!has(op.sheet)) throw new SheetOpError(`não há aba chamada ${op.sheet}`);
      const p = sheetNameProblem(op.name, sheets, op.sheet);
      if (p) throw new SheetOpError(p);
      return;
    }
    case "set":
    case "cached":
      if (!has(op.sheet)) throw new SheetOpError(`não há aba chamada ${op.sheet}`);
      if (!int(op.row) || !int(op.col) || op.row >= MAX_ROWS || op.col >= MAX_COLS) throw new SheetOpError("a célula fica fora da planilha");
      if (typeof op.value === "number" && !Number.isFinite(op.value)) throw new SheetOpError("o número não é finito");
      return;
    default: {
      if (!has(op.sheet)) throw new SheetOpError(`não há aba chamada ${op.sheet}`);
      if (!int(op.at) || !Number.isInteger(op.count) || op.count < 1) throw new SheetOpError("posição ou quantidade inválida");
      const max = op.op.endsWith("Rows") ? MAX_ROWS : MAX_COLS;
      if (op.at + op.count > max) throw new SheetOpError("passa do fim da planilha");
    }
  }
}

/** A mudança de linhas ou colunas de uma operação. */
export function shiftOf(op: SheetOp): Shift | null {
  switch (op.op) {
    case "insertRows":
      return { axis: "row", at: op.at, count: op.count };
    case "deleteRows":
      return { axis: "row", at: op.at, count: -op.count };
    case "insertCols":
      return { axis: "col", at: op.at, count: op.count };
    case "deleteCols":
      return { axis: "col", at: op.at, count: -op.count };
    default:
      return null;
  }
}

/** As operações simples, com os lotes abertos. */
export function flatOps(ops: readonly SheetOp[]): Exclude<SheetOp, { op: "batch" }>[] {
  return ops.flatMap((o) => (o.op === "batch" ? flatOps(o.ops) : [o]));
}

/**
 * O histórico de uma planilha aberta: desfazer e refazer andam pelas operações, enquanto o arquivo está aberto
 * (fechou, acabou). `ops` são as que valem agora, na ordem; gravar é reaplicá-las sobre o original.
 */
export class SheetHistory {
  private list: SheetOp[] = [];
  private cursor = 0;

  do(op: SheetOp): void {
    this.list.length = this.cursor;
    this.list.push(op);
    this.cursor++;
  }

  /** A operação desfeita, ou `null` se não há. */
  undo(): SheetOp | null {
    if (!this.cursor) return null;
    return this.list[--this.cursor]!;
  }

  redo(): SheetOp | null {
    if (this.cursor >= this.list.length) return null;
    return this.list[this.cursor++]!;
  }

  get ops(): readonly SheetOp[] {
    return this.list.slice(0, this.cursor);
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.list.length;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// A grade da tela

export interface GridCell {
  value: CellValue;
  formula?: string;
  /** O código de formato de número da célula (`"R$" #,##0.00`), como no arquivo. */
  format?: string;
  /** O que a célula mostra. */
  text: string;
  /**
   * O recálculo não soube refazer esta fórmula: o `value` é o de antes (T21108). Para a tela, os dois são o mesmo aviso.
   * `true`: o cálculo dela não bateu com o que o Excel gravou, e a marca fica até a pessoa reescrevê-la. `"recheck"`: ela
   * depende de uma marcada, ou dá um erro que o motor não resolve; o próximo recálculo confere de novo.
   */
  stale?: true | "recheck";
}

export interface GridSheet {
  name: string;
  /** Linha a linha; uma linha ou célula que falta é vazia. */
  rows: (GridCell | undefined)[][];
}

export interface Grid {
  sheets: GridSheet[];
}

/** O texto de um valor num formato: na janela, o `SSF.format` do SheetJS com os separadores do sistema. */
export type Display = (value: CellValue, format?: string) => string;

export const plainDisplay: Display = (v) => (v === null ? "" : typeof v === "boolean" ? (v ? "VERDADEIRO" : "FALSO") : String(v));

const findSheet = (grid: Grid, name: string) => grid.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());

/** A grade depois de uma operação, sem mexer na de antes. Lança `SheetOpError` se ela não cabe. */
export function applyToGrid(grid: Grid, op: SheetOp, display: Display = plainDisplay): Grid {
  checkOp(op, grid.sheets.map((s) => s.name));
  if (op.op === "batch") return op.ops.reduce((g, o) => applyToGrid(g, o, display), grid);
  if (op.op === "addSheet") return { sheets: [...grid.sheets, { name: op.name, rows: [] }] };
  if (op.op === "renameSheet") {
    const i = findSheet(grid, op.sheet);
    const from = grid.sheets[i]!.name;
    return {
      sheets: grid.sheets.map((s, k) => ({
        name: k === i ? op.name : s.name,
        rows: mapFormulas(s.rows, (f) => renameInFormula(f, from, op.name)),
      })),
    };
  }
  const i = findSheet(grid, op.sheet);
  const target = grid.sheets[i]!;
  if (op.op === "set") {
    const rows = target.rows.slice();
    const row = (rows[op.row] ?? []).slice();
    const old = row[op.col];
    const format = op.format ?? old?.format;
    const cell: GridCell | undefined =
      op.value === null && op.formula === undefined && !format ? undefined : { value: op.value, text: display(op.value, format), ...(op.formula !== undefined ? { formula: op.formula } : {}), ...(format ? { format } : {}) };
    row[op.col] = cell;
    rows[op.row] = row;
    return { sheets: grid.sheets.map((s, k) => (k === i ? { name: s.name, rows } : s)) };
  }
  if (op.op === "cached") {
    const old = target.rows[op.row]?.[op.col];
    if (old?.formula === undefined) throw new SheetOpError("a célula não tem fórmula");
    const rows = target.rows.slice();
    const row = rows[op.row]!.slice();
    const { stale: _, ...rest } = old;
    row[op.col] = { ...rest, value: op.value, text: display(op.value, old.format) };
    rows[op.row] = row;
    return { sheets: grid.sheets.map((s, k) => (k === i ? { name: s.name, rows } : s)) };
  }
  const shift = shiftOf(op)!;
  return {
    sheets: grid.sheets.map((s, k) => {
      const rows = mapFormulas(s.rows, (f) => shiftFormula(f, s.name, target.name, shift));
      return k === i ? { name: s.name, rows: moveCells(rows, shift) } : { name: s.name, rows };
    }),
  };
}

function mapFormulas(rows: GridSheet["rows"], f: (formula: string) => string): GridSheet["rows"] {
  return rows.map((r) =>
    r?.map((c) => {
      if (!c?.formula) return c;
      const next = f(c.formula);
      return next === c.formula ? c : { ...c, formula: next };
    }),
  );
}

function moveCells(rows: GridSheet["rows"], s: Shift): GridSheet["rows"] {
  // Sem buracos no array: a linha nova é `[]`, a célula nova `undefined` de verdade.
  const splice = <T>(list: T[], blank: () => T): T[] => {
    const out = list.slice();
    if (s.count > 0) {
      if (s.at < out.length) out.splice(s.at, 0, ...Array.from({ length: s.count }, blank));
    } else out.splice(s.at, -s.count);
    return out;
  };
  return s.axis === "row" ? splice(rows, () => []) : rows.map((r) => (r ? splice(r, () => undefined) : r));
}

// ---------------------------------------------------------------------------------------------------------------------
// O que a pessoa digita

export type FormatKind = "general" | "text" | "number" | "percent" | "currency" | "date";

/** O tipo de um código de formato, o bastante para ler o que a pessoa digita. */
export function formatKind(format: string | undefined): FormatKind {
  if (!format || /^general$/i.test(format)) return "general";
  if (format === "@") return "text";
  // Sem o texto entre aspas e as cores, para "R$" ou "[Red]" não confundirem.
  const bare = format.replace(/"[^"]*"/g, (q) => (/[R$€£]/.test(q) ? "$" : "")).replace(/\[(?!\$)[^\]]*\]/g, "");
  if (/[$€£]|\[\$/.test(bare)) return "currency";
  if (bare.includes("%")) return "percent";
  if (/[dmyhs]/i.test(bare.replace(/\\./g, ""))) return "date";
  return "number";
}

export interface Input {
  value: CellValue;
  formula?: string;
  /** Um formato novo, quando o que foi digitado pede um e a célula não tem (`31%` numa célula Geral). */
  format?: string;
}

const CURRENCY_FORMAT = '"R$" #,##0.00';

/**
 * O que a pessoa (ou o gato) digitou numa célula, como o Excel entende: número com os separadores do sistema, moeda,
 * porcentagem, data, verdadeiro e falso, fórmula (`=`) ou texto. `format` é o formato da célula agora; numa célula
 * Geral, `31%`, `R$ 10,50` e `03/11/2026` trazem o formato junto. Numa célula de texto (`@`), tudo fica texto.
 */
export function parseInput(text: string, format?: string, decimal: "," | "." = ","): Input {
  const kind = formatKind(format);
  if (kind === "text") return { value: text === "" ? null : text };
  const t = text.trim();
  if (t === "") return { value: null };
  if (t.startsWith("=") && t.length > 1) return { value: null, formula: t.slice(1) };
  const upper = t.toUpperCase();
  if (upper === "VERDADEIRO" || upper === "TRUE") return { value: true };
  if (upper === "FALSO" || upper === "FALSE") return { value: false };
  const date = parseDate(t, decimal);
  if (date !== null) return kind === "date" ? { value: date } : { value: date, format: decimal === "," ? "dd/mm/yyyy" : "m/d/yyyy" };
  const num = parseNumber(t, decimal);
  if (num) {
    if (num.percent) {
      const value = num.value / 100;
      return kind === "percent" ? { value } : { value, format: num.decimals ? `0.${"0".repeat(num.decimals)}%` : "0%" };
    }
    if (num.currency && kind !== "currency") return { value: num.value, format: CURRENCY_FORMAT };
    return { value: num.value };
  }
  return { value: text };
}

function parseNumber(t: string, decimal: "," | "."): { value: number; percent: boolean; currency: boolean; decimals: number } | null {
  const thousands = decimal === "," ? "." : ",";
  let s = t.replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  let currency = false;
  const cur = /^(R\$|US\$|\$|€|£)/.exec(s);
  if (cur) {
    currency = true;
    s = s.slice(cur[0].length);
    if (s.startsWith("-")) {
      negative = !negative;
      s = s.slice(1);
    }
  }
  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1);
  }
  const esc = (c: string) => `\\${c}`;
  const re = new RegExp(`^(\\d{1,3}(?:${esc(thousands)}\\d{3})+|\\d+)(?:${esc(decimal)}(\\d+))?$|^${esc(decimal)}(\\d+)$`);
  const m = re.exec(s);
  if (!m) return null;
  const whole = (m[1] ?? "0").split(thousands).join("");
  const frac = m[2] ?? m[3] ?? "";
  const value = Number(`${whole}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, percent, currency, decimals: frac.length };
}

/** "03/11/2026" (dia primeiro, com a vírgula decimal) → o número de série do Excel; `null` se não é data. */
function parseDate(t: string, decimal: "," | "."): number | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const [day, month] = decimal === "," ? [a, b] : [b, a];
  let year = Number(m[3]);
  if (m[3]!.length === 2) year += year < 30 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1) return null;
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return excelSerial(utc);
}

/** O número de série do Excel (sistema 1900) de um dia em UTC. */
export function excelSerial(utcMs: number): number {
  return Math.round(utcMs / 86_400_000) + 25_569;
}
