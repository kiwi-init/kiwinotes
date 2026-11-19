// O recálculo das fórmulas (T21108, spec #21065, parte 3): mudou um número, o resultado das fórmulas que dependem dele
// muda na tela e no arquivo. Quem calcula é o HyperFormula (GPL-3.0, ~400 funções do Excel), sem tela.
//
// - `recalc(grid)` devolve a grade com o `value` e o `text` de cada fórmula refeitos. A grade chama depois de cada
//   `applyToGrid` (T21109).
// - `recalcOps(antes, depois)` são os `cached` dos resultados que mudaram, para irem no mesmo `batch` da edição: o
//   arquivo ganha o valor novo (só o `<v>`; o `<f>` fica byte a byte), e o desfazer volta tudo de uma vez.
// - **Nunca um número errado sem aviso:** a fórmula que o HyperFormula não sabe calcular (uma função ou um nome que ele
//   não conhece, a referência estruturada de uma tabela, um ciclo) fica com o valor antigo e `stale: true`, e também
//   toda fórmula que depende dela. O arquivo já vai com o `fullCalcOnLoad` (o `patchXlsx`), e o Excel recalcula ao abrir.
//
// Este arquivo carrega o HyperFormula: a janela o importa com `import()` só quando a planilha tem fórmula
// (`hasFormulas`, em `./has-formulas.ts`, que é leve).

import { DetailedCellError, ErrorType, HyperFormula, type SimpleCellAddress, type SimpleCellRange } from "hyperformula";

import { MAX_COLS, MAX_ROWS } from "../refs.ts";
import { hasFormulas } from "./has-formulas.ts";
import { plainDisplay, type CellValue, type Display, type Grid, type GridCell, type SheetOp } from "../ops.ts";

/** Os erros que dizem "não sei calcular isto", e não um resultado: a célula fica marcada, com o valor antigo. */
const CANT: ReadonlySet<string> = new Set([ErrorType.NAME, ErrorType.ERROR, ErrorType.CYCLE, ErrorType.SPILL, ErrorType.LIC]);

/** O texto do erro como o Excel grava (`#DIV/0!`, `#N/A`). */
const EXCEL_ERROR: Partial<Record<string, string>> = { [ErrorType.NA]: "#N/A", [ErrorType.NUM]: "#NUM!", [ErrorType.VALUE]: "#VALUE!" };

/**
 * O único erro em que o HyperFormula e o Excel sempre concordam. Nos outros eles divergem (um PROCV de texto numa coluna
 * de números: `#VALUE!` aqui, `#N/A` no Excel), então um erro novo que não seja este fica marcado, com o valor antigo.
 * O mesmo erro que a célula já tinha não muda nada.
 */
const SURE_ERROR: ReadonlySet<string> = new Set([ErrorType.DIV_BY_ZERO]);

/**
 * A fórmula do arquivo como o HyperFormula lê: sem os prefixos de função nova do Excel (`_xlfn.XLOOKUP`), e o
 * VERDADEIRO/FALSO solto (`PROCV(…;FALSO)`, gravado `FALSE`) como a função que ele conhece (`FALSE()`). O texto entre
 * aspas e o nome de aba entre apóstrofos passam iguais.
 */
function forEngine(formula: string): string {
  const parts = formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/);
  return `=${parts
    .map((p, i) =>
      i % 2 ? p : p.replace(/\b_xl(?:fn|ws)\./gi, "").replace(/(?<![\w.$])(TRUE|FALSE)\b(?!\s*[(!])/gi, (m) => `${m.toUpperCase()}()`),
    )
    .join("")}`;
}

/** O conteúdo de uma célula para o HyperFormula. O texto vai com `'`, para "007" ou "=x" continuarem texto. */
function content(c: GridCell | undefined): CellValue {
  if (!c) return null;
  if (c.formula !== undefined) return forEngine(c.formula);
  return typeof c.value === "string" ? `'${c.value}` : c.value;
}

const sameValue = (a: CellValue, b: CellValue) => a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));

/**
 * Um nome definido do livro (`XlsxBook.names`): `Quantidades` = `Estoque!$C$2:$C$8`. Com `sheet`, vale só naquela aba.
 * O nome que o HyperFormula não entende (o de uma tabela, `Fornecedores[Prazo]`) fica de fora, e a fórmula que o usa
 * sai marcada.
 */
export interface DefinedName {
  name: string;
  formula: string;
  sheet?: string;
}

/**
 * A grade com as fórmulas recalculadas. Sem fórmula nenhuma, devolve a mesma grade. Uma célula que não é fórmula nunca
 * muda; a fórmula muda só o `value`, o `text` e a marca `stale`.
 */
export function recalc(grid: Grid, display: Display = plainDisplay, names: readonly DefinedName[] = []): Grid {
  if (!hasFormulas(grid)) return grid;
  const data: Record<string, CellValue[][]> = {};
  // Sem buracos: o HyperFormula pede um array de arrays de verdade (a linha ou a célula que falta vira vazia).
  for (const s of grid.sheets) data[s.name] = Array.from(s.rows, (r) => Array.from(r ?? [], content));
  const hf = HyperFormula.buildFromSheets(data as never, { licenseKey: "gpl-v3", maxRows: MAX_ROWS, maxColumns: MAX_COLS });
  try {
    const ids = grid.sheets.map((s) => hf.getSheetId(s.name)!);
    for (const n of names) {
      const scope = n.sheet === undefined ? undefined : hf.getSheetId(n.sheet);
      if (n.sheet !== undefined && scope === undefined) continue;
      try {
        if (hf.isItPossibleToAddNamedExpression(n.name, forEngine(n.formula), scope)) hf.addNamedExpression(n.name, forEngine(n.formula), scope);
      } catch {
        // Um nome que o HyperFormula não lê: a fórmula que o usa dá #NAME? e sai marcada.
      }
    }
    const at = (sheet: number, row: number, col: number): SimpleCellAddress => ({ sheet: ids[sheet]!, row, col });
    const key = (a: SimpleCellAddress) => `${a.sheet}:${a.row}:${a.col}`;

    // O que não dá para calcular, e tudo o que depende disso, de célula em célula e de faixa em faixa.
    const stale = new Set<string>();
    const queue: (SimpleCellAddress | SimpleCellRange)[] = [];
    grid.sheets.forEach((s, i) =>
      s.rows.forEach((r, row) =>
        r?.forEach((c, col) => {
          if (c?.formula === undefined) return;
          const v = hf.getCellValue(at(i, row, col));
          const unsure = v instanceof DetailedCellError && (CANT.has(v.type) || (!SURE_ERROR.has(v.type) && valueOf(v) !== c.value));
          if (unsure) {
            stale.add(key(at(i, row, col)));
            queue.push(at(i, row, col));
          }
        }),
      ),
    );
    const seen = new Set<string>();
    while (queue.length) {
      const node = queue.pop()!;
      for (const d of hf.getCellDependents(node)) {
        const k = "start" in d ? `${key(d.start)}-${key(d.end)}` : key(d);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!("start" in d)) stale.add(k);
        queue.push(d);
      }
    }

    return {
      sheets: grid.sheets.map((s, i) => ({
        name: s.name,
        rows: s.rows.map((r, row) =>
          r?.map((c, col): GridCell | undefined => {
            if (c?.formula === undefined) return c;
            const { stale: _old, ...cell } = c;
            if (stale.has(key(at(i, row, col)))) return { ...cell, stale: true };
            const value = valueOf(hf.getCellValue(at(i, row, col)));
            return sameValue(value, cell.value) ? cell : { ...cell, value, text: display(value, cell.format) };
          }),
        ),
      })),
    };
  } finally {
    hf.destroy();
  }
}

function valueOf(v: unknown): CellValue {
  if (v instanceof DetailedCellError) return EXCEL_ERROR[v.type] ?? v.value;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  // A fórmula que aponta para uma célula vazia dá 0 no Excel.
  return 0;
}

/**
 * Os `cached` das fórmulas cujo resultado mudou de `antes` (a grade depois do `applyToGrid`) para `depois` (o `recalc`
 * dela). As duas grades têm a mesma forma. A fórmula marcada (`stale`) não entra: o arquivo fica com o valor antigo,
 * e o Excel recalcula ao abrir (o `fullCalcOnLoad` do `patchXlsx`).
 */
export function recalcOps(antes: Grid, depois: Grid): SheetOp[] {
  const ops: SheetOp[] = [];
  depois.sheets.forEach((s, i) =>
    s.rows.forEach((r, row) =>
      r?.forEach((c, col) => {
        if (c?.formula === undefined || c.stale) return;
        const old = antes.sheets[i]?.rows[row]?.[col];
        if (old?.formula !== undefined && sameValue(old.value, c.value)) return;
        ops.push({ op: "cached", sheet: s.name, row, col, value: c.value });
      }),
    ),
  );
  return ops;
}
