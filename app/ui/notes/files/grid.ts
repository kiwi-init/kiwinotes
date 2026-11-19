// A planilha legível (T21038, spec #21008), a parte pura: a largura de cada coluna pelo conteúdo, as linhas e colunas
// vazias do fim, o número que alinha à direita e o pedaço da grade que está na tela (só ele é montado). Sem React e sem
// DOM, para os testes: a medida do texto entra como função.

/** A largura de uma coluna fica entre estas duas (px). O que não cabe no máximo corta com "…". */
export const MIN_COL = 64;
export const MAX_COL = 320;
/** O respiro de cada lado do texto, somado (px): 12 + 12 do padding, 1 da borda e 1 de folga do arredondamento. */
export const CELL_PAD = 26;
/** A altura de cada linha, a do cabeçalho inclusive (px). */
export const ROW_H = 30;
/**
 * Quantas linhas a largura olha, sem medir 100.000: as `SAMPLE_ROWS` do começo e mais `SAMPLE_SPREAD` espalhadas pelo
 * resto, a última inclusa (o pedido 100000 e o total maior costumam estar no fim).
 */
export const SAMPLE_ROWS = 200;
export const SAMPLE_SPREAD = 100;

/** As linhas que a largura mede. */
export function sampleRows(rows: string[][]): string[][] {
  if (rows.length <= SAMPLE_ROWS + SAMPLE_SPREAD) return rows;
  const out = rows.slice(0, SAMPLE_ROWS);
  const rest = rows.length - SAMPLE_ROWS;
  for (let i = 1; i <= SAMPLE_SPREAD; i++) out.push(rows[SAMPLE_ROWS + Math.ceil((i * rest) / SAMPLE_SPREAD) - 1]!);
  return out;
}
/** As linhas e colunas montadas a mais, de cada lado da tela, para a rolagem não mostrar o branco. */
export const OVERSCAN_ROWS = 8;
export const OVERSCAN_PX = 320;

/**
 * Tira as linhas e as colunas vazias do fim: uma planilha com formatação até a coluna Z, ou um csv que termina em
 * `;;;`, diz só o que tem dado. `header` conta como uma linha (a coluna com nome não é vazia).
 */
export function trimEmpty(header: string[], rows: string[][], columns: number): { rows: string[][]; columns: number } {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.every((v) => v === "")) end--;
  const kept = end === rows.length ? rows : rows.slice(0, end);
  let used = 0;
  for (const r of [header, ...kept]) {
    for (let c = Math.min(r.length, columns) - 1; c >= used; c--) {
      if (r[c] !== "" && r[c] !== undefined) {
        used = c + 1;
        break;
      }
    }
    if (used === columns) break;
  }
  return { rows: kept, columns: used };
}

/**
 * Um número, como a planilha mostra: `42`, `-7`, `1.200`, `2.099,40`, `R$ 29,90`, `31,3%`, `1e3`. Alinha à direita.
 * Data e texto com número no meio ficam à esquerda.
 */
const NUMBER = /^[-+]?(?:R\$\s?|US\$\s?|€\s?|\$\s?)?[-+]?\(?\d[\d.,\s]*\)?(?:[eE][-+]?\d+)?\s?%?$/;
export function isNumeric(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  // 03/11/2026 e 14:30 são data e hora: à esquerda.
  if (/[/:]/.test(t)) return false;
  return NUMBER.test(t);
}

/**
 * A largura de cada coluna: o texto mais largo da coluna nas linhas de `sampleRows` (e no cabeçalho, em
 * negrito), mais o respiro, entre `MIN_COL` e `MAX_COL`. `measure(text, bold)` dá a largura do texto em px.
 */
export function columnWidths(header: string[], rows: string[][], columns: number, measure: (text: string, bold: boolean) => number): number[] {
  const widths: number[] = [];
  const sample = sampleRows(rows);
  for (let c = 0; c < columns; c++) {
    let w = header[c] ? measure(header[c]!, true) : 0;
    for (const r of sample) {
      const v = r[c];
      // Uma célula muito comprida já passa do máximo: não precisa medir tudo.
      if (v) w = Math.max(w, measure(v.length > 120 ? v.slice(0, 120) : v, false));
      if (w + CELL_PAD >= MAX_COL) break;
    }
    widths.push(Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w + CELL_PAD))));
  }
  return widths;
}

/** Onde cada coluna começa (px, a partir da primeira), e a largura total no fim: `offsets[columns]`. */
export function offsetsOf(widths: number[]): number[] {
  const out = new Array<number>(widths.length + 1);
  out[0] = 0;
  for (let i = 0; i < widths.length; i++) out[i + 1] = out[i]! + widths[i]!;
  return out;
}

/** A primeira coluna cujo fim passa de `x` (busca binária nas `offsets`). */
function columnAt(offsets: number[], x: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo);
}

export interface Viewport {
  /** A rolagem e o tamanho da área das células (sem o cabeçalho e sem a coluna dos números). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** O pedaço da grade a montar: as linhas `[row0, row1)` e as colunas `[col0, col1)`, com a folga dos dois lados. */
export function visibleRange(v: Viewport, offsets: number[], rows: number): { row0: number; row1: number; col0: number; col1: number } {
  const columns = offsets.length - 1;
  const row0 = Math.max(0, Math.floor(v.top / ROW_H) - OVERSCAN_ROWS);
  const row1 = Math.min(rows, Math.ceil((v.top + v.height) / ROW_H) + OVERSCAN_ROWS);
  if (columns <= 0) return { row0, row1, col0: 0, col1: 0 };
  const col0 = columnAt(offsets, Math.max(0, v.left - OVERSCAN_PX));
  const col1 = Math.min(columns, columnAt(offsets, v.left + v.width + OVERSCAN_PX) + 1);
  return { row0, row1, col0, col1 };
}
