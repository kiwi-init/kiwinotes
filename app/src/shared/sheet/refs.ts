// As referências de uma planilha (T21107, spec #21065): o endereço A1, e o que acontece com as referências de uma
// fórmula, de uma faixa (`sqref`) ou de um gráfico quando linhas ou colunas entram ou saem, ou quando uma aba muda de
// nome. É o que o Excel faz: o que estava depois do ponto anda, uma faixa que cruza o ponto cresce ou encolhe, e o que
// apontava só para o que saiu vira `#REF!`.

/** Linha e coluna a partir de 0. */
export interface Cell {
  row: number;
  col: number;
}

/** "A" → 0, "AA" → 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function colName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "B2" → { row: 1, col: 1 }; os `$` não importam. */
export function parseCell(ref: string): Cell | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return null;
  const row = Number(m[2]) - 1;
  const col = colIndex(m[1]!);
  return row >= 0 && row < MAX_ROWS && col >= 0 && col < MAX_COLS ? { row, col } : null;
}

export const cellName = (c: Cell): string => `${colName(c.col)}${c.row + 1}`;

/** Os limites do Excel. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** Uma mudança de linhas ou colunas: `count` > 0 entra (antes de `at`), < 0 sai (a partir de `at`). */
export interface Shift {
  axis: "row" | "col";
  at: number;
  count: number;
}

/**
 * Um intervalo [a, b] num eixo depois da mudança, ou `null` se ele saiu todo. `whole`: uma ponta só (uma célula),
 * que não cresce quando a mudança entra no meio.
 */
export function shiftSpan(a: number, b: number, s: Shift): [number, number] | null {
  if (s.count > 0) {
    if (a >= s.at) return [a + s.count, b + s.count];
    if (b >= s.at) return [a, b + s.count];
    return [a, b];
  }
  const from = s.at;
  const to = s.at - s.count - 1;
  const n = -s.count;
  if (b < from) return [a, b];
  if (a > to) return [a - n, b - n];
  // Cruza o que sai: fica o que sobra antes e depois.
  const left = a < from ? a : from;
  const right = b > to ? b - n : from - 1;
  return right < left ? null : [left, right];
}

/** Uma faixa "A1:B3", "A1", "A:C" ou "2:5" depois da mudança; `null` se ela saiu toda. Mantém os `$`. */
export function shiftRange(range: string, s: Shift): string | null {
  const parts = range.split(":");
  if (parts.length > 2) return range;
  const ends = parts.map(parseEnd);
  if (ends.some((e) => !e)) return range;
  const [p, q] = [ends[0]!, ends[1] ?? ends[0]!];
  const out = [{ ...p }, { ...q }];
  const key = s.axis;
  const lo = p[key];
  const hi = q[key];
  // Uma faixa de colunas inteiras ("A:C") não tem linha, e vice-versa: a mudança no outro eixo não a toca.
  if (lo !== undefined && hi !== undefined) {
    const span = shiftSpan(Math.min(lo, hi), Math.max(lo, hi), s);
    if (!span) return null;
    out[0]![key] = span[0];
    out[1]![key] = span[1];
  }
  const text = out.map(endText);
  return parts.length === 1 ? text[0]! : `${text[0]}:${text[1]}`;
}

interface End {
  row?: number;
  col?: number;
  absRow: boolean;
  absCol: boolean;
}

function parseEnd(t: string): End | null {
  const m = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(t);
  if (!m || (!m[2] && !m[4])) return null;
  return {
    col: m[2] ? colIndex(m[2]) : undefined,
    row: m[4] ? Number(m[4]) - 1 : undefined,
    absCol: m[1] === "$" && !!m[2],
    absRow: m[2] ? m[3] === "$" : m[1] === "$",
  };
}

function endText(e: End): string {
  const col = e.col === undefined ? "" : `${e.absCol ? "$" : ""}${colName(e.col)}`;
  const row = e.row === undefined ? "" : `${e.absRow ? "$" : ""}${e.row + 1}`;
  return col + row;
}

/** Um `sqref` ("A1:B2 D4") depois da mudança; `""` se tudo saiu. */
export function shiftSqref(sqref: string, s: Shift): string {
  return sqref
    .split(/\s+/)
    .filter(Boolean)
    .map((r) => shiftRange(r, s))
    .filter((r): r is string => r !== null)
    .join(" ");
}

/** O nome de uma aba como uma fórmula escreve: entre aspas simples quando precisa, com `'` dobrada. */
export function sheetRef(name: string): string {
  return /^[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*$/.test(name) && !parseCell(name) && !/^R\d*C\d*$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * Os pedaços de uma fórmula: o texto entre aspas e as referências (com a aba, se houver) separados do resto, para
 * trocar só as referências. Uma referência é `[aba!]A1[:B2]`, `[aba!]A:C` ou `[aba!]2:5`; um nome de função (`LOG10(`)
 * ou de nome definido não é referência.
 */
type Token = { kind: "text"; text: string } | { kind: "ref"; sheet: string | null; sheetText: string; range: string };

const REF = /^(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)/;

function tokenize(formula: string): Token[] {
  const out: Token[] = [];
  let text = "";
  let i = 0;
  const push = (t: Token) => {
    if (text) out.push({ kind: "text", text });
    text = "";
    out.push(t);
  };
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      // O texto entre aspas, com `""` dentro.
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      text += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prev = i > 0 ? formula[i - 1]! : "";
    // Uma referência não começa no meio de um nome ("Taxa1", "_xlfn.X").
    const boundary = !/[A-Za-z0-9_.\\$\]]/.test(prev);
    if (boundary) {
      // A aba: 'Nome com espaço'! ou Nome!
      let sheet: string | null = null;
      let sheetText = "";
      let j = i;
      if (ch === "'") {
        let k = i + 1;
        let name = "";
        while (k < formula.length) {
          if (formula[k] === "'") {
            if (formula[k + 1] === "'") {
              name += "'";
              k += 2;
              continue;
            }
            break;
          }
          name += formula[k];
          k++;
        }
        if (formula[k + 1] === "!") {
          sheet = name;
          sheetText = formula.slice(i, k + 2);
          j = k + 2;
        }
      } else {
        const m = /^([A-Za-z_À-￿][A-Za-z0-9_.À-￿]*)!/.exec(formula.slice(i));
        if (m) {
          sheet = m[1]!;
          sheetText = m[0];
          j = i + m[0].length;
        }
      }
      const m = REF.exec(formula.slice(j));
      if (m) {
        const after = formula[j + m[0].length] ?? "";
        // `LOG10(` é função, `A1B` não é referência, e `A1!` seria uma aba chamada A1.
        if (!/[A-Za-z0-9_(!.]/.test(after)) {
          push({ kind: "ref", sheet, sheetText, range: m[0] });
          i = j + m[0].length;
          continue;
        }
      }
      if (sheet !== null && /^#REF!/.test(formula.slice(j))) {
        push({ kind: "ref", sheet, sheetText, range: "#REF!" });
        i = j + 5;
        continue;
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ kind: "text", text });
  return out;
}

function join(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === "text" ? t.text : t.sheetText + t.range)).join("");
}

const sameSheet = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Uma fórmula depois que `target` ganhou ou perdeu linhas ou colunas. `home` é a aba onde a fórmula está (uma
 * referência sem aba é dela). O que só apontava para o que saiu vira `#REF!`.
 */
export function shiftFormula(formula: string, home: string | null, target: string, s: Shift): string {
  const tokens = tokenize(formula);
  let changed = false;
  for (const t of tokens) {
    if (t.kind !== "ref" || t.range === "#REF!") continue;
    const sheet = t.sheet ?? home;
    if (sheet === null || !sameSheet(sheet, target)) continue;
    const next = shiftRange(t.range, s);
    const range = next ?? "#REF!";
    if (range !== t.range) {
      t.range = range;
      changed = true;
    }
  }
  return changed ? join(tokens) : formula;
}

/** Uma fórmula depois que a aba `from` virou `to`. */
export function renameInFormula(formula: string, from: string, to: string): string {
  const tokens = tokenize(formula);
  let changed = false;
  for (const t of tokens) {
    if (t.kind !== "ref" || t.sheet === null || !sameSheet(t.sheet, from)) continue;
    t.sheetText = `${sheetRef(to)}!`;
    t.sheet = to;
    changed = true;
  }
  return changed ? join(tokens) : formula;
}

/** A fórmula de uma célula copiada `dRow` linhas e `dCol` colunas adiante: anda o que não tem `$` (a compartilhada). */
export function moveFormula(formula: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return formula;
  const tokens = tokenize(formula);
  for (const t of tokens) {
    if (t.kind !== "ref" || t.range === "#REF!") continue;
    t.range = t.range
      .split(":")
      .map((p) => {
        const e = parseEnd(p);
        if (!e) return p;
        if (e.row !== undefined && !e.absRow) e.row += dRow;
        if (e.col !== undefined && !e.absCol) e.col += dCol;
        return (e.row ?? 0) < 0 || (e.col ?? 0) < 0 ? "#REF!" : endText(e);
      })
      .join(":");
    if (t.range.includes("#REF!")) t.range = "#REF!";
  }
  return join(tokens);
}

/** As abas que uma fórmula cita (para saber se ela aponta para uma aba que mudou). */
export function formulaSheets(formula: string): string[] {
  return tokenize(formula).flatMap((t) => (t.kind === "ref" && t.sheet !== null ? [t.sheet] : []));
}
