// A célula que a pessoa está editando na planilha (T21114, spec #21033): a janela avisa pelo `files.editing` qual
// célula tem a caixa de edição aberta, e o `sheets_edit` que mudaria essa célula espera a pessoa sair dela antes de
// gravar. Com um teto: a caixa esquecida aberta não prende o gato, ele recebe um erro e segue com o resto.

import { flatOps, type SheetOp } from "../shared/sheet/ops.ts";

/** A célula com a caixa aberta: a aba (no csv, a aba sem nome do arquivo) e a posição, a partir de 0. */
export interface EditingCell {
  sheet: string;
  row: number;
  col: number;
}

/** Quanto o `sheets_edit` espera a pessoa sair da célula, no máximo. */
export const SHEET_EDIT_WAIT_MS = 8_000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * As operações `ops` mudam a célula `cell` (na posição de antes delas)? Escrever nela, ou apagar a linha ou a coluna
 * dela, passa por cima do que a pessoa digita. Uma linha inserida antes só a empurra.
 */
export function opsTouchCell(ops: readonly SheetOp[], cell: EditingCell): boolean {
  let { sheet, row, col } = cell;
  for (const op of flatOps(ops)) {
    switch (op.op) {
      case "renameSheet":
        if (same(op.sheet, sheet)) sheet = op.name;
        break;
      case "addSheet":
        break;
      case "set":
        if (same(op.sheet, sheet) && op.row === row && op.col === col) return true;
        break;
      case "cached":
        break;
      default: {
        if (!same(op.sheet, sheet)) break;
        const rows = op.op === "insertRows" || op.op === "deleteRows";
        const p = rows ? row : col;
        let q = p;
        if (op.op === "insertRows" || op.op === "insertCols") q = p >= op.at ? p + op.count : p;
        else if (p >= op.at + op.count) q = p - op.count;
        else if (p >= op.at) return true;
        if (rows) row = q;
        else col = q;
      }
    }
  }
  return false;
}

/** As caixas abertas, por janela e por caminho, e quem espera alguma fechar. */
export class SheetEditing {
  private open = new Map<string, Map<string, EditingCell>>();
  private waiters = new Set<() => void>();

  /** A janela `owner` abriu a caixa em `cell` de `path`, ou fechou (`null`). */
  set(owner: string, path: string, cell: EditingCell | null): void {
    const byOwner = this.open.get(path) ?? new Map<string, EditingCell>();
    if (cell) byOwner.set(owner, { ...cell });
    else byOwner.delete(owner);
    if (byOwner.size) this.open.set(path, byOwner);
    else this.open.delete(path);
    for (const w of [...this.waiters]) w();
  }

  /** As células com a caixa aberta em `path`. */
  cells(path: string): EditingCell[] {
    return [...(this.open.get(path)?.values() ?? [])];
  }

  /**
   * Espera até nenhuma caixa aberta em `path` ser tocada pelas `ops`, por até `ms`. Dá a célula que ainda prende no
   * fim do prazo (`busy`), ou nenhuma; `waited` diz se houve espera (a pessoa pode ter gravado nesse meio-tempo).
   */
  async waitFree(path: string, ops: readonly SheetOp[], ms = SHEET_EDIT_WAIT_MS): Promise<{ busy: EditingCell | null; waited: boolean }> {
    const blocking = () => this.cells(path).find((c) => opsTouchCell(ops, c)) ?? null;
    const first = blocking();
    if (!first) return { busy: null, waited: false };
    return await new Promise((resolve) => {
      const done = (busy: EditingCell | null) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve({ busy, waited: true });
      };
      const check = () => {
        if (!blocking()) done(null);
      };
      const timer = setTimeout(() => done(blocking()), ms);
      this.waiters.add(check);
    });
  }
}
