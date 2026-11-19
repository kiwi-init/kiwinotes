// A célula selecionada e a largura arrastável da planilha (T21040, spec #21008), a parte pura: o endereço, as setas, a
// rolagem que deixa a célula à vista e as contas da borda arrastada. Sem React e sem DOM, para os testes.
//
// As linhas contam como na grade: a 0 é a de cima, parada (os nomes do csv, a linha 1 da planilha); a `r` é `rows[r - 1]`.

import { columnName } from "./csv.ts";
import { CELL_PAD, MIN_COL, ROW_H, sampleRows, type Viewport } from "./grid.ts";

export interface Cell {
  row: number;
  col: number;
}

/** O endereço da célula, como no Excel: `B2`. `firstRow` é o número da linha 1 de `rows` (a de cima é a anterior). */
export function cellAddress(cell: Cell, firstRow: number): string {
  return `${columnName(cell.col)}${firstRow - 1 + cell.row}`;
}

/** O texto de uma célula, com a linha de cima na conta. */
export function cellText(cell: Cell, header: string[], rows: string[][]): string {
  return (cell.row === 0 ? header[cell.col] : rows[cell.row - 1]?.[cell.col]) ?? "";
}

/** A célula dentro da grade de `rows + 1` linhas e `columns` colunas. */
export function clampCell(cell: Cell, rows: number, columns: number): Cell {
  return { row: Math.max(0, Math.min(rows, cell.row)), col: Math.max(0, Math.min(columns - 1, cell.col)) };
}

export interface MoveKey {
  key: string;
  /** ⌘ no Mac: a seta vai até a borda, como no Numbers e no Excel. */
  meta?: boolean;
}

/**
 * Para onde a tecla leva a seleção, ou `null` se a tecla não é de andar. `page` é quantas linhas cabem na tela. Setas
 * andam uma célula; ⌘ + seta vai até a borda; Home e End vão ao começo e ao fim da linha; Page Up e Page Down, uma tela.
 */
export function moveCell(cell: Cell, k: MoveKey, rows: number, columns: number, page: number): Cell | null {
  const step = Math.max(1, page - 1);
  const to = (row: number, col: number) => clampCell({ row, col }, rows, columns);
  switch (k.key) {
    case "ArrowUp":
      return to(k.meta ? 0 : cell.row - 1, cell.col);
    case "ArrowDown":
      return to(k.meta ? rows : cell.row + 1, cell.col);
    case "ArrowLeft":
      return to(cell.row, k.meta ? 0 : cell.col - 1);
    case "ArrowRight":
      return to(cell.row, k.meta ? columns - 1 : cell.col + 1);
    case "Home":
      return to(cell.row, 0);
    case "End":
      return to(cell.row, columns - 1);
    case "PageUp":
      return to(cell.row - step, cell.col);
    case "PageDown":
      return to(cell.row + step, cell.col);
    default:
      return null;
  }
}

/**
 * A rolagem que deixa a célula inteira à vista, sem passar por baixo das partes paradas (a linha das letras, a de cima
 * e a coluna dos números): a mesma rolagem se ela já está à vista. `view` é a área das células, como no `visibleRange`.
 * A linha de cima está sempre à vista: o clique nela não rola; a tecla que chega nela (⌘↑, Page Up) volta ao começo,
 * para as linhas logo abaixo dela aparecerem (`toTop`).
 */
export function scrollToShow(cell: Cell, offsets: number[], view: Viewport, toTop = false): { left: number; top: number } {
  let { left, top } = view;
  const x0 = offsets[cell.col] ?? 0;
  const x1 = offsets[cell.col + 1] ?? x0;
  // Uma coluna mais larga que a tela mostra o começo.
  if (x1 > left + view.width) left = x1 - view.width;
  if (x0 < left) left = x0;
  if (cell.row > 0) {
    const y0 = (cell.row - 1) * ROW_H;
    const y1 = y0 + ROW_H;
    if (y1 > top + view.height) top = y1 - view.height;
    if (y0 < top) top = y0;
  } else if (toTop) {
    top = 0;
  }
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

/** A célula do canto de cima, à esquerda, que está à vista: onde a primeira seta começa, sem pular a rolagem. */
export function firstVisible(offsets: number[], view: Viewport, rows: number): Cell {
  let col = 0;
  while (col < offsets.length - 2 && offsets[col]! < view.left) col++;
  const row = view.top <= 0 ? 0 : Math.min(rows, Math.ceil(view.top / ROW_H) + 1);
  return { row, col };
}

/** A largura mínima e a máxima da borda arrastada (px). */
export const MIN_DRAG = 24;
export const MAX_DRAG = 1600;
/** Dois cliques na borda: a largura do conteúdo, sem o máximo de 320 da abertura, até este (px). */
export const MAX_FIT = 960;

/** A largura enquanto a borda é arrastada `dx` px a partir de `start`. */
export function dragWidth(start: number, dx: number): number {
  return Math.round(Math.max(MIN_DRAG, Math.min(MAX_DRAG, start + dx)));
}

/**
 * Dois cliques na borda: a coluna fica da largura do texto mais largo dela (nas linhas de `sampleRows`, e o de cima em
 * negrito), mais o respiro, entre `MIN_COL` e `MAX_FIT`. `measure(text, bold)` dá a largura do texto em px.
 */
export function fitWidth(col: number, header: string[], rows: string[][], measure: (text: string, bold: boolean) => number): number {
  let w = header[col] ? measure(header[col]!, true) : 0;
  for (const r of sampleRows(rows)) {
    const v = r[col];
    if (v) w = Math.max(w, measure(v.length > 400 ? v.slice(0, 400) : v, false));
    if (w + CELL_PAD >= MAX_FIT) break;
  }
  return Math.round(Math.min(MAX_FIT, Math.max(MIN_COL, w + CELL_PAD)));
}

/** As larguras com as que a pessoa mudou por cima. */
export function withCustom(base: number[], custom: Readonly<Record<number, number>>): number[] {
  return base.map((w, i) => custom[i] ?? w);
}
