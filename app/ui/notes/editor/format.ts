// Os comandos de formatação e de parágrafo do editor (T5555, E1, issue 177): o que o Obsidian e o Typora têm e o Kiwi
// não tinha. Funções puras sobre o estado (devolvem a transação, sem DOM), para o teclado, a barra e o menu do botão
// direito da E2 usarem as mesmas. Referência: Zettlr `commands/markdown.ts` (só a ideia; o código é nosso).

import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

import { toggleWrap, wrapLink } from "./text.ts";

// ---------------------------------------------------------------- em linha

/** Os marcadores em volta da seleção. */
export const INLINE = {
  bold: "**",
  italic: "*",
  strike: "~~",
  highlight: "==",
  code: "`",
  comment: "%%",
} as const;

export type InlineFormat = keyof typeof INLINE;

/** Põe ou tira o marcador em cada seleção (várias com ⌥-clique). Sem seleção, abre o par com o cursor no meio. */
export function toggleInline(state: EditorState, format: InlineFormat): TransactionSpec {
  const marker = INLINE[format];
  const n = marker.length;
  return state.changeByRange((sel) => {
    const selected = state.sliceDoc(sel.from, sel.to);
    const before = state.sliceDoc(Math.max(0, sel.from - n - 1), sel.from);
    const after = state.sliceDoc(sel.to, Math.min(state.doc.length, sel.to + n + 1));
    const r = toggleWrap(before, selected, after, marker);
    return {
      changes: { from: sel.from + r.from, to: sel.from + r.to, insert: r.insert },
      range: EditorSelection.range(sel.from + r.from + r.selFrom, sel.from + r.from + r.selTo),
    };
  });
}

/** O link (⌘K com seleção): `[texto]()`, com o cursor nos parênteses para colar o endereço. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((sel) => {
    const r = wrapLink(state.sliceDoc(sel.from, sel.to));
    return { changes: { from: sel.from, to: sel.to, insert: r.insert }, range: EditorSelection.cursor(sel.from + r.cursor) };
  });
}

/** Toda marcação em linha que aparece por inteiro na seleção sai: negrito, itálico, tachado, realce, código, comentário. */
export function stripInline(text: string): string {
  return text
    .replace(/%%([^%]*?)%%/g, "$1")
    .replace(/==([^=]+?)==/g, "$1")
    .replace(/~~([^~]+?)~~/g, "$1")
    .replace(/`([^`]+?)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![*\w])([*_])(?!\s)(.+?)(?<!\s)\1(?![*\w])/g, "$2");
}

/** Limpar formatação: só a marcação em linha da seleção. A estrutura (título, lista, citação) fica. */
export function clearInline(state: EditorState): TransactionSpec | null {
  if (state.selection.ranges.every((r) => r.empty)) return null;
  return state.changeByRange((sel) => {
    const text = state.sliceDoc(sel.from, sel.to);
    const clean = stripInline(text);
    return { changes: { from: sel.from, to: sel.to, insert: clean }, range: EditorSelection.range(sel.from, sel.from + clean.length) };
  });
}

// ---------------------------------------------------------------- parágrafo

/** O começo de uma linha: o recuo, a citação, o marcador de lista ou de tarefa e o título. */
const PREFIX = /^(\s*)((?:>\s?)*)((?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?(#{1,6}\s+)?/;

interface LineParts {
  indent: string;
  quote: string;
  list: string;
  heading: string;
  body: string;
}

export function lineParts(line: string): LineParts {
  const m = PREFIX.exec(line)!;
  return { indent: m[1]!, quote: m[2]!, list: m[3] ?? "", heading: m[4] ?? "", body: line.slice(m[0].length) };
}

/** Título 1 a 6, ou 0 (corpo). O mesmo nível de novo volta a corpo. A lista e a citação saem: título é bloco próprio. */
export function setHeading(line: string, level: number): string {
  const p = lineParts(line);
  const current = p.heading ? p.heading.trim().length : 0;
  const next = level === current ? 0 : level;
  return p.indent + (next ? `${"#".repeat(next)} ` : "") + p.body;
}

export type ListKind = "bullet" | "numbered" | "task" | "quote";

const kindOf = (p: LineParts): ListKind | null =>
  p.list ? (/\[[ xX]\]/.test(p.list) ? "task" : /^\d/.test(p.list) ? "numbered" : "bullet") : p.quote ? "quote" : null;

/**
 * Alterna o tipo de lista nas linhas (as em branco ficam). Se todas já são desse tipo, voltam a texto; senão, todas
 * viram ele, trocando o marcador que tinham (um título vira texto do item). A numerada recomeça em 1, na ordem.
 */
export function toggleList(lines: string[], kind: ListKind): string[] {
  const filled = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim());
  const parts = lines.map(lineParts);
  // A citação se olha pelo ">" (uma lista dentro dela continua citação); as listas, pelo marcador.
  const is = (p: LineParts) => (kind === "quote" ? !!p.quote : kindOf(p) === kind);
  const allAlready = filled.length > 0 && filled.every(({ i }) => is(parts[i]!));
  let n = 0;
  return lines.map((line, i) => {
    if (!line.trim()) return line;
    const p = parts[i]!;
    if (allAlready) return kind === "quote" ? p.indent + p.list + p.heading + p.body : p.indent + p.quote + p.heading + p.body;
    if (kind === "quote") return `${p.indent}> ${p.list}${p.heading}${p.body}`;
    const marker = kind === "bullet" ? "- " : kind === "numbered" ? `${++n}. ` : "- [ ] ";
    return p.indent + p.quote + marker + p.body;
  });
}

/** ⌘L: uma tarefa é marcada ou desmarcada; uma linha que não é tarefa vira uma (um item de lista ganha a caixa). */
export function toggleTask(line: string): string {
  const p = lineParts(line);
  const box = /\[([ xX])\]/.exec(p.list);
  if (box) return p.indent + p.quote + p.list.replace(/\[[ xX]\]/, box[1] === " " ? "[x]" : "[ ]") + p.heading + p.body;
  if (p.list) return p.indent + p.quote + p.list.replace(/\s+$/, " ") + "[ ] " + p.heading + p.body;
  return `${p.indent}${p.quote}- [ ] ${p.heading}${p.body}`;
}

/** Aplica `fn` às linhas inteiras de cada seleção. O cursor fica no fim do texto da linha, como no Obsidian. */
export function mapLines(state: EditorState, fn: (lines: string[]) => string[]): TransactionSpec {
  return state.changeByRange((sel) => {
    const first = state.doc.lineAt(sel.from);
    const last = state.doc.lineAt(sel.to);
    const lines: string[] = [];
    for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text);
    const next = fn(lines).join(state.lineBreak);
    // O cursor guarda a distância até o fim da linha: o texto que ele tocava continua sob ele.
    const range = sel.empty
      ? EditorSelection.cursor(Math.max(first.from, first.from + next.length - (last.to - sel.head)))
      : EditorSelection.range(first.from, first.from + next.length);
    return { changes: { from: first.from, to: last.to, insert: next }, range };
  });
}
