// A edição da pessoa por cima da gravação de outro (T21114, spec #21033): o Kiwi Cat gravou a planilha enquanto a
// pessoa tinha edições ainda por gravar. Elas não se perdem: cada uma é refeita sobre a versão nova, com as linhas e
// colunas que o outro inseriu ou apagou já contadas (a célula anda junto, a fórmula também). A célula cuja linha ou
// coluna o outro apagou não tem mais onde ficar e sai.

import { flatOps, shiftOf, type SheetOp } from "./ops.ts";
import { renameInFormula, shiftFormula } from "./refs.ts";

type Flat = Exclude<SheetOp, { op: "batch" }>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `op` depois de `by` ter acontecido antes dela; `null` quando ela não tem mais onde valer. */
function through(op: Flat, by: Flat): Flat | null {
  if (by.op === "renameSheet") {
    const out = { ...op } as Flat;
    if ("sheet" in out && same(out.sheet, by.sheet)) (out as { sheet: string }).sheet = by.name;
    if (out.op === "set" && out.formula) out.formula = renameInFormula(out.formula, by.sheet, by.name);
    return out;
  }
  const s = shiftOf(by);
  if (!s || !("sheet" in by)) return op;
  switch (op.op) {
    case "set":
    case "cached": {
      const formula = op.op === "set" && op.formula ? shiftFormula(op.formula, op.sheet, by.sheet, s) : undefined;
      let { row, col } = op;
      if (same(op.sheet, by.sheet)) {
        const p = s.axis === "row" ? row : col;
        let q = p;
        if (s.count > 0) q = p >= s.at ? p + s.count : p;
        else if (p >= s.at - s.count) q = p + s.count;
        else if (p >= s.at) return null;
        if (s.axis === "row") row = q;
        else col = q;
      }
      return { ...op, row, col, ...(formula !== undefined ? { formula } : {}) };
    }
    case "insertRows":
    case "deleteRows":
    case "insertCols":
    case "deleteCols": {
      const axis = op.op.endsWith("Rows") ? "row" : "col";
      if (!same(op.sheet, by.sheet) || axis !== s.axis) return op;
      let at = op.at;
      if (s.count > 0) at = at >= s.at ? at + s.count : at;
      else if (at >= s.at - s.count) at += s.count;
      else if (at >= s.at) {
        // Dentro do que o outro apagou: o apagar já aconteceu; o inserir fica no lugar do apagado.
        if (op.op.startsWith("delete")) return null;
        at = s.at;
      }
      return { ...op, at };
    }
    default:
      return op;
  }
}

/** As operações `mine` (feitas sobre a versão de antes) refeitas sobre a versão em que `theirs` já aconteceram. */
export function rebaseOps(mine: readonly SheetOp[], theirs: readonly SheetOp[]): SheetOp[] {
  // Só o que move ou renomeia muda as posições; o recálculo (`cached`) refaz-se depois, sobre o arquivo novo.
  let moves: Flat[] = flatOps(theirs).filter((o) => o.op !== "set" && o.op !== "cached");
  const out: SheetOp[] = [];
  for (const m of flatOps(mine)) {
    if (m.op === "cached") continue;
    let r: Flat | null = m;
    for (const by of moves) if (r) r = through(r, by);
    if (!r) continue;
    out.push(r);
    // O que vem depois da minha operação já a conta: as do outro também andam por ela.
    const mineMove = r;
    moves = moves.map((x) => through(x, mineMove)).filter((x): x is Flat => x !== null);
  }
  return out;
}

/** Onde a célula `cell` (de antes de `ops`) foi parar; `null` se a linha ou a coluna dela saiu. */
export function moveCell(cell: { sheet: string; row: number; col: number }, ops: readonly SheetOp[]): { sheet: string; row: number; col: number } | null {
  let at: Flat | null = { op: "cached", sheet: cell.sheet, row: cell.row, col: cell.col, value: null };
  for (const by of flatOps(ops)) if (at) at = through(at, by);
  return at && at.op === "cached" ? { sheet: at.sheet, row: at.row, col: at.col } : null;
}
