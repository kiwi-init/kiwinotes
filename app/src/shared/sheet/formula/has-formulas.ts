// Se a grade tem fórmula (T21108): leve, sem o HyperFormula. A janela só importa o `recalc.ts` (que carrega o
// HyperFormula) quando isto diz sim, como o spec #21065 pede: a biblioteca carrega só ao editar uma planilha com fórmula.

import type { Grid } from "../ops.ts";

export const hasFormulas = (grid: Grid): boolean => grid.sheets.some((s) => s.rows.some((r) => r?.some((c) => c?.formula !== undefined)));
