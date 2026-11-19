// O Kiwi Cat editando a planilha ao vivo (T21114, spec #21065), a parte pura: as operações que o agente gravou viram
// os passos que a grade toca por cima do arquivo do disco (que já tem tudo). Cada célula escrita vai para onde ela
// ficou no fim (uma linha inserida depois a empurra, uma apagada a tira), na aba com o nome do fim. Sem React e sem
// DOM, para os testes.

import { flatOps, type Grid, type SheetOp } from "../../../src/shared/sheet/ops.ts";

export interface KiwiCellStep {
  row: number;
  col: number;
}

export interface KiwiSheetSteps {
  /** As células que o gato escreveu, na ordem, nas linhas e colunas do arquivo de agora. */
  cells: KiwiCellStep[];
  /** As que mudaram só pelo recálculo (o resultado de uma fórmula): realçam no fim. */
  recalc: KiwiCellStep[];
  /** As linhas e as colunas que ele inseriu (do arquivo de agora). */
  rowsIn: number[];
  colsIn: number[];
  /** Alguma linha ou coluna entrou ou saiu: o texto de antes não está mais no mesmo lugar. */
  shifted: boolean;
}

/** De onde a janela tira o que o gato gravou: o aviso do `agent.wrote` (pelo caminho e pela versão), e a cor dele. */
export interface KiwiSheetSource {
  take(path: string, version: string): { sheetOps?: SheetOp[] } | null;
  cor: unknown;
}

/** Um toque: as operações de uma gravação do gato, sobre a grade que estava na tela (`before`, ou `null`). */
export interface KiwiPlay {
  ops: SheetOp[];
  before: Grid | null;
  cor: unknown;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface Mark {
  kind: "cell" | "recalc" | "row" | "col";
  sheet: string;
  row: number;
  col: number;
}

/** Os passos das operações `ops` na aba que no fim se chama `sheet` (no csv, a aba sem nome). */
export function kiwiSteps(ops: readonly SheetOp[], sheet: string): KiwiSheetSteps {
  let marks: Mark[] = [];
  let shifted = false;
  for (const op of flatOps(ops)) {
    switch (op.op) {
      case "renameSheet":
        for (const m of marks) if (same(m.sheet, op.sheet)) m.sheet = op.name;
        break;
      case "addSheet":
        break;
      case "set":
      case "cached": {
        const at = marks.findIndex((m) => (m.kind === "cell" || m.kind === "recalc") && same(m.sheet, op.sheet) && m.row === op.row && m.col === op.col);
        // A célula escrita pelo gato e depois recalculada continua dele.
        if (op.op === "cached" && at >= 0) break;
        if (at >= 0) marks.splice(at, 1);
        marks.push({ kind: op.op === "set" ? "cell" : "recalc", sheet: op.sheet, row: op.row, col: op.col });
        break;
      }
      default: {
        shifted = true;
        const rows = op.op === "insertRows" || op.op === "deleteRows";
        const ins = op.op === "insertRows" || op.op === "insertCols";
        const next: Mark[] = [];
        for (const m of marks) {
          if (!same(m.sheet, op.sheet) || (rows ? m.kind === "col" : m.kind === "row")) {
            next.push(m);
            continue;
          }
          const p = rows ? m.row : m.col;
          let q = p;
          if (ins) q = p >= op.at ? p + op.count : p;
          else if (p >= op.at + op.count) q = p - op.count;
          else if (p >= op.at) continue;
          next.push(rows ? { ...m, row: q } : { ...m, col: q });
        }
        marks = next;
        if (ins) for (let i = 0; i < op.count; i++) marks.push({ kind: rows ? "row" : "col", sheet: op.sheet, row: rows ? op.at + i : 0, col: rows ? 0 : op.at + i });
      }
    }
  }
  const here = marks.filter((m) => same(m.sheet, sheet));
  const pos = (m: Mark) => ({ row: m.row, col: m.col });
  return {
    cells: here.filter((m) => m.kind === "cell").map(pos),
    recalc: here.filter((m) => m.kind === "recalc").map(pos),
    rowsIn: here.filter((m) => m.kind === "row").map((m) => m.row),
    colsIn: here.filter((m) => m.kind === "col").map((m) => m.col),
    shifted,
  };
}

/** A aba onde o gato mexeu primeiro, com o nome do fim; `null` se ele só mudou nomes de aba. */
export function kiwiSheetOf(ops: readonly SheetOp[]): string | null {
  const flat = flatOps(ops);
  const first = flat.find((o) => o.op === "set" || o.op === "insertRows" || o.op === "deleteRows" || o.op === "insertCols" || o.op === "deleteCols");
  if (!first || !("sheet" in first)) return null;
  let name = first.sheet;
  for (const o of flat.slice(flat.indexOf(first))) if (o.op === "renameSheet" && same(o.sheet, name)) name = o.name;
  return name;
}

/** Quanto o gato leva para digitar: por letra, o máximo por célula, a pausa entre células e quantas ele digita. */
export const KIWI_CHAR_MS = 32;
export const KIWI_CELL_MAX_MS = 520;
export const KIWI_GAP_MS = 150;
/** Depois dessas, as outras aparecem de uma vez, realçadas: uma planilha inteira não vira um minuto de animação. */
export const KIWI_TYPED_MAX = 24;
/** Quanto o realce fica antes de sumir. */
export const KIWI_HOLD_MS = 2600;

/** Quantos passos de digitação uma célula tem: o texto aparece aos pedaços, nunca mais devagar que o máximo. */
export function typingFrames(text: string): { frames: string[]; stepMs: number } {
  const chars = [...text];
  if (chars.length <= 1) return { frames: [text], stepMs: KIWI_CHAR_MS };
  // No máximo tantos quadros quantos cabem no tempo da célula; o texto longo anda de vários caracteres por quadro.
  const most = Math.floor(KIWI_CELL_MAX_MS / KIWI_CHAR_MS);
  const per = Math.ceil(chars.length / most);
  const frames: string[] = [];
  for (let i = per; i < chars.length; i += per) frames.push(chars.slice(0, i).join(""));
  frames.push(text);
  return { frames, stepMs: KIWI_CHAR_MS };
}
