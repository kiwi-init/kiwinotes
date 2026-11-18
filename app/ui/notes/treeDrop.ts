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

/**
 * A linha fina onde o item cai: na borda de cima ou de baixo da linha sob o mouse, quando o destino é a pasta onde
 * ela está (não dentro da pasta da linha). null quando solta dentro dela, ou não solta.
 */
export function dropEdge(row: DropRow, y: number, folder: string | null): "top" | "bottom" | null {
  if (folder === null || (row.kind === "folder" && folder === row.path)) return null;
  return y < 0.5 ? "top" : "bottom";
}

/** Quanto tempo segurar sobre uma pasta fechada para ela abrir (spec #19261). */
export const SPRING_MS = 600;

/**
 * A pasta fechada que abre se o mouse ficar parado no meio dela: não a que se arrasta, nem uma filha dela (abrir não
 * leva a lugar nenhum onde ela possa cair). As bordas são "ao lado", e não abrem.
 */
export function springFolder(row: DropRow, y: number, dragged: Dragged | null): string | null {
  if (!dragged || row.kind !== "folder" || row.expanded || y < EDGE || y > 1 - EDGE) return null;
  if (dragged.kind === "folder" && (row.path === dragged.path || row.path.startsWith(`${dragged.path}/`))) return null;
  return row.path;
}

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

/**
 * O timer do segurar-para-abrir: `over(pasta)` a cada dragover (a mesma pasta não reinicia), `over(null)` ou
 * `cancel()` ao sair dela, ao soltar e no fim do arrasto.
 */
export function springOpener(
  open: (folder: string) => void,
  ms = SPRING_MS,
  timers: Timers = { set: (fn, t) => setTimeout(fn, t), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
) {
  let at: string | null = null;
  let id: unknown;
  const cancel = () => {
    if (id !== undefined) timers.clear(id);
    id = undefined;
    at = null;
  };
  return {
    over(folder: string | null) {
      if (folder === at) return;
      cancel();
      if (folder === null) return;
      at = folder;
      id = timers.set(() => {
        id = undefined;
        open(folder);
      }, ms);
    },
    cancel,
  };
}
