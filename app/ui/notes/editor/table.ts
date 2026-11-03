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
