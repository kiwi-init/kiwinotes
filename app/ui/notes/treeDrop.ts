// Onde cai o que se arrasta na árvore (T19937, spec #19261): soltar em qualquer linha põe na pasta daquela linha, em
// cima de uma pasta põe dentro, e nas bordas de uma pasta põe ao lado dela (entre duas pastas da raiz → a raiz).

/** O que se arrasta: uma nota, uma pasta ou um arquivo que não é nota. */
export interface Dragged {
  kind: "note" | "folder" | "file";
  path: string;
}

/** A linha sob o mouse. `expanded` só vale para pasta. */
export interface DropRow {
  kind: "note" | "folder" | "file";
  path: string;
  expanded?: boolean;
}

/** A borda de uma pasta que vale como "ao lado" (fração da altura da linha, em cima e embaixo). */
export const EDGE = 0.25;

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * A pasta de destino (`""` é a raiz), ou null quando soltar ali não muda nada ou não pode (a pasta dentro dela
 * mesma). `y` é a posição do mouse na linha, de 0 (topo) a 1 (base).
 */
export function dropFolder(row: DropRow, y: number, dragged: Dragged | null): string | null {
  let folder: string;
  if (row.kind !== "folder") folder = parentOf(row.path);
  else if (y < EDGE) folder = parentOf(row.path);
  // A base de uma pasta aberta encosta na primeira linha de dentro dela: ali, soltar é dentro.
  else if (y > 1 - EDGE && !row.expanded) folder = parentOf(row.path);
  else folder = row.path;
  return canDrop(dragged, folder) ? folder : null;
}

/** Se `dragged` pode ir para `folder`: não é onde já está, nem (uma pasta) para dentro dela mesma. */
export function canDrop(dragged: Dragged | null, folder: string): boolean {
  if (!dragged) return false;
  if (parentOf(dragged.path) === folder) return false;
  if (dragged.kind === "folder" && (folder === dragged.path || folder.startsWith(`${dragged.path}/`))) return false;
  return true;
}
