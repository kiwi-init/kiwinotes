// Tabela Markdown com edição simples (spec #1107, fase A): Tab e ⇧Tab andam de célula em célula, Enter abre uma linha
// nova, e a cada passo as colunas se alinham. Funções puras sobre o texto da tabela; o editor só aplica o resultado.

export type Align = "left" | "center" | "right" | null;

export interface Table {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** As células de uma linha `| a | b |`, sem os pipes das pontas. `\|` é pipe dentro da célula. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function parseTable(text: string): Table | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2 || !isSeparator(lines[1]!)) return null;
  const header = splitRow(lines[0]!);
  const align = splitRow(lines[1]!).map((c): Align => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
  const width = header.length;
  const fit = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, Math.max(width, cells.length));
  const rows = lines.slice(2).map((l) => fit(splitRow(l)));
  const cols = Math.max(width, ...rows.map((r) => r.length));
  const pad = (cells: string[]) => [...cells, ...Array(cols - cells.length).fill("")];
  return { header: pad(header), align: [...align, ...Array(Math.max(0, cols - align.length)).fill(null)].slice(0, cols), rows: rows.map(pad) };
}

const len = (s: string) => [...s].length;

function padCell(s: string, width: number, align: Align): string {
  const gap = width - len(s);
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
  return s + " ".repeat(gap);
}

/** A tabela com as colunas alinhadas, sempre com os pipes das pontas. */
export function formatTable(t: Table): string {
  const widths = t.header.map((_, c) => Math.max(3, len(t.header[c]!), ...t.rows.map((r) => len(r[c] ?? ""))));
  const line = (cells: string[]) => `| ${cells.map((s, c) => padCell(s, widths[c]!, t.align[c] ?? null)).join(" | ")} |`;
  const sep = `| ${widths
    .map((w, c) => {
      const a = t.align[c];
      const dashes = "-".repeat(w - (a === "center" ? 2 : a ? 1 : 0));
      return a === "center" ? `:${dashes}:` : a === "right" ? `${dashes}:` : a === "left" ? `:${dashes}` : dashes;
    })
    .join(" | ")} |`;
  return [line(t.header), sep, ...t.rows.map(line)].join("\n");
}

/** Linha e coluna do cursor (`offset` dentro do texto da tabela). A linha 1 é a do separador. */
export function cellAt(text: string, offset: number): { row: number; col: number } {
  const before = text.slice(0, offset);
  const row = before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const inLine = before.slice(lineStart).replace(/\\\|/g, "  ");
  const pipes = (inLine.match(/\|/g) ?? []).length;
  const leading = /^\s*\|/.test(text.slice(lineStart)) ? 1 : 0;
  return { row, col: Math.max(0, pipes - leading) };
}

/** Onde fica o conteúdo da célula (row, col) no texto formatado: [início, fim). */
export function cellRange(formatted: string, row: number, col: number): [number, number] {
  const lines = formatted.split("\n");
  let start = 0;
  for (let i = 0; i < row; i++) start += lines[i]!.length + 1;
  const line = lines[row]!;
  let pipe = -1;
  for (let c = 0; c <= col; c++) {
    pipe = line.indexOf("|", pipe + 1);
    while (pipe > 0 && line[pipe - 1] === "\\") pipe = line.indexOf("|", pipe + 1);
  }
  let next = line.indexOf("|", pipe + 1);
  while (next > 0 && line[next - 1] === "\\") next = line.indexOf("|", next + 1);
  const cell = line.slice(pipe + 1, next);
  const s = pipe + 1 + (cell.length - cell.trimStart().length);
  const e = next - (cell.length - cell.trimEnd().length);
  // Célula vazia: o cursor fica depois do espaço, onde a pessoa vai digitar.
  return e > s ? [start + s, start + e] : [start + pipe + 2, start + pipe + 2];
}

export interface TableEdit {
  /** A tabela inteira reescrita. */
  text: string;
  /** A seleção depois do passo, dentro de `text`. */
  anchor: number;
  head: number;
}

/**
 * Tab (`dir` 1) ou ⇧Tab (-1): alinha a tabela e seleciona a próxima célula (ou a anterior). Depois da última célula, o
 * Tab abre uma linha nova. `null` quando o texto não é tabela.
 */
export function tableTab(text: string, offset: number, dir: 1 | -1): TableEdit | null {
  const t = parseTable(text);
  if (!t) return null;
  const cols = t.header.length;
  let { row, col } = cellAt(text, offset);
  if (row === 1) row = dir > 0 ? 2 : 0; // o separador não tem célula: anda para a linha de dados ou o cabeçalho
  else col += dir;
  if (col >= cols) {
    col = 0;
    row = row === 0 ? 2 : row + 1;
  } else if (col < 0) {
    col = cols - 1;
    row = row === 2 ? 0 : row - 1;
  }
  if (row < 0) return { ...select(t, 0, 0) };
  if (row - 2 >= t.rows.length) t.rows.push(Array(cols).fill(""));
  return select(t, row, col);
}

/** Enter numa linha da tabela: alinha e abre uma linha vazia logo abaixo, com o cursor na primeira célula. */
export function tableEnter(text: string, offset: number): TableEdit | null {
  const t = parseTable(text);
  if (!t) return null;
  const { row } = cellAt(text, offset);
  const at = Math.max(0, row - 1); // depois do cabeçalho ou do separador: a primeira linha de dados
  t.rows.splice(at, 0, Array(t.header.length).fill(""));
  return select(t, at + 2, 0);
}

function select(t: Table, row: number, col: number): TableEdit {
  const text = formatTable(t);
  const [anchor, head] = cellRange(text, row, col);
  return { text, anchor, head };
}

// E3 (T5557): shared by the context menu and table-only keyboard commands. Original Kiwi code.
export const TABLE_ACTIONS = [
  { id: "row.insertAbove", group: "row", label: "Inserir acima", key: "Mod-Alt-Shift-ArrowUp", hint: "⇧⌥⌘↑" },
  { id: "row.insertBelow", group: "row", label: "Inserir abaixo", key: "Mod-Alt-Shift-ArrowDown", hint: "⇧⌥⌘↓" },
  { id: "row.moveUp", group: "row", label: "Mover para cima", key: "Mod-Alt-ArrowUp", hint: "⌥⌘↑" },
  { id: "row.moveDown", group: "row", label: "Mover para baixo", key: "Mod-Alt-ArrowDown", hint: "⌥⌘↓" },
  { id: "row.duplicate", group: "row", label: "Duplicar linha", key: null, hint: undefined },
  { id: "row.delete", group: "row", label: "Apagar linha", key: "Mod-Alt-Backspace", hint: "⌥⌘⌫" },
  { id: "column.insertLeft", group: "column", label: "Inserir à esquerda", key: "Mod-Alt-Shift-ArrowLeft", hint: "⇧⌥⌘←" },
  { id: "column.insertRight", group: "column", label: "Inserir à direita", key: "Mod-Alt-Shift-ArrowRight", hint: "⇧⌥⌘→" },
  { id: "column.moveLeft", group: "column", label: "Mover à esquerda", key: "Mod-Alt-ArrowLeft", hint: "⌥⌘←" },
  { id: "column.moveRight", group: "column", label: "Mover à direita", key: "Mod-Alt-ArrowRight", hint: "⌥⌘→" },
  { id: "column.duplicate", group: "column", label: "Duplicar coluna", key: "Mod-Alt-Shift-d", hint: "⇧⌥⌘D" },
  { id: "column.delete", group: "column", label: "Apagar coluna", key: "Mod-Alt-Shift-Backspace", hint: "⇧⌥⌘⌫" },
  { id: "align.left", group: "align", label: "À esquerda", key: "Mod-Alt-l", hint: "⌥⌘L", align: "left" },
  { id: "align.center", group: "align", label: "Centralizado", key: "Mod-Alt-e", hint: "⌥⌘E", align: "center" },
  { id: "align.right", group: "align", label: "À direita", key: "Mod-Alt-r", hint: "⌥⌘R", align: "right" },
  { id: "align.default", group: "align", label: "Padrão", key: "Mod-Alt-0", hint: "⌥⌘0", align: null },
  { id: "sort.asc", group: "sort", label: "Crescente (A–Z)", key: "Mod-Alt-s", hint: "⌥⌘S" },
  { id: "sort.desc", group: "sort", label: "Decrescente (Z–A)", key: "Mod-Alt-Shift-s", hint: "⇧⌥⌘S" },
] as const;
export type TableAction = (typeof TABLE_ACTIONS)[number]["id"];
export interface TableContext { table: Table; row: number; col: number }

export function tableContext(text: string, offset: number): TableContext | null {
  const table = parseTable(text);
  if (!table || !table.header.length || offset < 0 || offset > text.length) return null;
  const cell = cellAt(text, offset);
  return { table, row: cell.row === 1 ? 0 : Math.min(cell.row, table.rows.length + 1),
    col: Math.min(cell.col, table.header.length - 1) };
}

/** Header and separator stay structural; deleting the last data row is allowed, the last column is not. */
export function canTableAction(ctx: TableContext, action: TableAction): boolean {
  switch (action) {
    case "row.moveUp": return ctx.row > 2;
    case "row.moveDown": return ctx.row >= 2 && ctx.row < ctx.table.rows.length + 1;
    case "row.delete": return ctx.row >= 2;
    case "column.moveLeft": return ctx.col > 0;
    case "column.moveRight": return ctx.col < ctx.table.header.length - 1;
    case "column.delete": return ctx.table.header.length > 1;
    case "sort.asc": case "sort.desc": return ctx.table.rows.length > 1;
    default: return true;
  }
}

const tableOrder = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Rewrites only this table. The selection follows its row/column; cells keep their Markdown and escaped pipes. */
export function tableAction(text: string, offset: number, action: TableAction): TableEdit | null {
  const ctx = tableContext(text, offset);
  if (!ctx || !canTableAction(ctx, action)) return null;
  const t = ctx.table;
  let { row, col } = ctx;
  const dataRow = row - 2;
  const emptyRow = () => Array(t.header.length).fill("") as string[];
  const columns = () => [t.header, t.align, ...t.rows];
  switch (action) {
    case "row.insertAbove": case "row.insertBelow": {
      const at = row < 2 ? 0 : dataRow + (action === "row.insertBelow" ? 1 : 0);
      t.rows.splice(at, 0, emptyRow()); row = at + 2; break;
    }
    case "row.moveUp": case "row.moveDown": {
      const next = dataRow + (action === "row.moveUp" ? -1 : 1);
      [t.rows[dataRow], t.rows[next]] = [t.rows[next]!, t.rows[dataRow]!]; row = next + 2; break;
    }
    case "row.duplicate": {
      const at = row < 2 ? 0 : dataRow + 1;
      t.rows.splice(at, 0, [...(row < 2 ? t.header : t.rows[dataRow]!)]); row = at + 2; break;
    }
    case "row.delete":
      t.rows.splice(dataRow, 1); row = t.rows.length ? Math.min(dataRow, t.rows.length - 1) + 2 : 0; break;
    case "column.insertLeft": case "column.insertRight": case "column.duplicate": {
      const at = col + (action === "column.insertLeft" ? 0 : 1);
      t.header.splice(at, 0, action === "column.duplicate" ? t.header[col]! : "");
      t.align.splice(at, 0, action === "column.duplicate" ? t.align[col]! : null);
      for (const cells of t.rows) cells.splice(at, 0, action === "column.duplicate" ? cells[col]! : "");
      col = at; break;
    }
    case "column.moveLeft": case "column.moveRight": {
      const next = col + (action === "column.moveLeft" ? -1 : 1);
      for (const cells of columns()) [cells[col], cells[next]] = [cells[next]!, cells[col]!];
      col = next; break;
    }
    case "column.delete":
      for (const cells of columns()) cells.splice(col, 1);
      col = Math.min(col, t.header.length - 1); break;
    case "align.left": t.align[col] = "left"; break;
    case "align.center": t.align[col] = "center"; break;
    case "align.right": t.align[col] = "right"; break;
    case "align.default": t.align[col] = null; break;
    case "sort.asc": case "sort.desc": {
      const sign = action === "sort.asc" ? 1 : -1;
      const sorted = t.rows.map((cells, index) => ({ cells, index })).sort((a, b) => {
        const av = a.cells[col]!.trim(), bv = b.cells[col]!.trim();
        if (!av || !bv) return av ? -1 : bv ? 1 : a.index - b.index;
        return sign * tableOrder.compare(av, bv) || a.index - b.index;
      });
      t.rows = sorted.map((entry) => entry.cells);
      if (row >= 2) row = sorted.findIndex((entry) => entry.index === dataRow) + 2;
      break;
    }
  }
  return select(t, row, col);
}
