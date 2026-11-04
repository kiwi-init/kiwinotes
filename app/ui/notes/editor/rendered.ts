// O Markdown renderizado fora do cursor (T2983, spec #2973): cada bloco em que o cursor não está aparece desenhado pela
// mesma lib do Channels (react-native-enriched-markdown), e o bloco do cursor fica cru para editar. Aqui fica a parte
// sem DOM (testada): quais blocos renderizar, o Markdown que vai para a lib e onde cai o clique no texto. O desenho
// fica em `renderedWidget.tsx`.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

import { tagsInLine } from "../../../src/shared/tags.ts";
import { parseLinks } from "../links.ts";
import { embedLine } from "./attachments.ts";
import { DICTATION_CAPTION } from "./livePreview.ts";

/** Os blocos de cima da árvore que a lib desenha. Tabela tem o widget editável dela (`tablePreview`). */
const RENDERED = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "BulletList",
  "OrderedList",
  "Blockquote",
  "FencedCode",
  "CodeBlock",
  "HorizontalRule",
]);

const CODE = new Set(["FencedCode", "CodeBlock"]);

export interface RenderedBlock {
  /** Do começo da primeira linha ao fim da última. */
  from: number;
  to: number;
  /** O texto do bloco como está no `.md`. */
  source: string;
}

/** A árvore inteira: o parser anda aos poucos, e um bloco do fim da nota sem árvore ficaria cru. */
export function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function hasNode(node: SyntaxNode, names: Set<string>): boolean {
  const c = node.cursor();
  do if (names.has(c.name)) return true;
  while (c.next() && c.from < node.to);
  return false;
}

const LEFT_RAW = new Set(["Image"]);

/**
 * Fica cru (com o preview de hoje) o que outra parte do editor já desenha ou que a lib não sabe mostrar: os anexos
 * `![[…]]` e as imagens (T2984), os comentários `%%` (o `commentPreview` os esconde) e a legenda do ditado.
 */
export function keepsRaw(node: SyntaxNode, source: string): boolean {
  if (CODE.has(node.name)) return false;
  if (source.includes("%%") || source.includes("![[")) return true;
  if (source.split("\n").some((l) => DICTATION_CAPTION.test(l) || embedLine(l))) return true;
  return hasNode(node, LEFT_RAW);
}

/**
 * Os blocos que aparecem renderizados. Com o editor focado, o bloco onde está o cursor (ou a seleção) fica de fora;
 * sem foco, a nota inteira aparece renderizada.
 */
export function renderedBlocks(state: EditorState, focused: boolean, tree: Tree = fullTree(state)): RenderedBlock[] {
  const out: RenderedBlock[] = [];
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (!RENDERED.has(n.name)) continue;
    const from = state.doc.lineAt(n.from).from;
    const to = state.doc.lineAt(n.to).to;
    if (focused && touches(state, from, to)) continue;
    const source = state.doc.sliceString(from, to);
    if (!source.trim() || keepsRaw(n, source)) continue;
    out.push({ from, to, source });
  }
  return out;
}

// ---------------------------------------------------------------- o Markdown que vai para a lib

/** Os endereços próprios dos links que a lib desenha: a janela trata o clique (`linkAction`). */
export const NOTE_LINK = "kiwi-note:";
export const MISSING_LINK = "kiwi-note-missing:";
export const TAG_LINK = "kiwi-tag:";

export type LinkStatusOf = (target: string) => "ok" | "missing" | "unknown";

const escapeLabel = (s: string) => s.replace(/([\\[\]*_`~<>])/g, "\\$1");

const NO_TAG = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "URL", "Link", "Autolink", "HTMLBlock", "Comment", "WikiLink"]);

function inAny(tree: Tree, pos: number, names: Set<string>): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) if (names.has(n.name)) return true;
  return false;
}

/**
 * O texto do bloco como a lib vai ler: `[[nota|apelido]]` vira `[apelido](kiwi-note:nota)` (ou `kiwi-note-missing:`
 * quando a nota ainda não existe) e `#tag` vira `[#tag](kiwi-tag:tag)`, como as menções do Channels. Fora de código.
 * `offset` é onde o bloco começa no documento (para olhar a árvore).
 */
export function toRenderable(source: string, offset: number, tree: Tree, status: LinkStatusOf): string {
  const edits: { from: number; to: number; insert: string }[] = [];
  let lineStart = 0;
  for (const line of source.split("\n")) {
    for (const link of parseLinks(line)) {
      const a = lineStart + link.from;
      if (inAny(tree, offset + a + 2, CODE_INLINE)) continue;
      const shown = link.alias || link.target;
      const scheme = status(link.target) === "missing" ? MISSING_LINK : NOTE_LINK;
      edits.push({ from: a, to: lineStart + link.to, insert: `[${escapeLabel(shown)}](${scheme}${encodeURIComponent(link.target)})` });
    }
    const callout = calloutHead(line);
    if (callout && !inAny(tree, offset + lineStart, CODE_INLINE)) {
      const prev = source.slice(0, Math.max(0, lineStart - 1)).split("\n").pop() ?? "";
      if (lineStart === 0 || !/^\s*>/.test(prev)) {
        const head = `[!${callout.type}]`;
        edits.push({
          from: lineStart + callout.from,
          to: lineStart + callout.titleAt,
          insert: callout.title ? `${head}\n${callout.quote}**` : head,
        });
        if (callout.title) edits.push({ from: lineStart + line.length, to: lineStart + line.length, insert: "**" });
      }
    }
    for (const t of tagsInLine(line)) {
      const a = lineStart + t.from;
      if (inAny(tree, offset + a, NO_TAG)) continue;
      if (edits.some((e) => a >= e.from && a < e.to)) continue;
      edits.push({ from: a, to: lineStart + t.to, insert: `[${escapeLabel(line.slice(t.from, t.to))}](${TAG_LINK}${encodeURIComponent(t.tag)})` });
    }
    lineStart += line.length + 1;
  }
  edits.sort((x, y) => y.from - x.from);
  let out = source;
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

const CODE_INLINE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

/** Os tipos de callout do Obsidian no tipo mais perto dos cinco que a lib (e o Channels) desenha. */
const CALLOUTS: Record<string, string> = {
  note: "NOTE",
  info: "NOTE",
  todo: "NOTE",
  abstract: "NOTE",
  summary: "NOTE",
  tldr: "NOTE",
  example: "NOTE",
  quote: "NOTE",
  cite: "NOTE",
  tip: "TIP",
  hint: "TIP",
  success: "TIP",
  check: "TIP",
  done: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  attention: "WARNING",
  question: "WARNING",
  help: "WARNING",
  faq: "WARNING",
  caution: "CAUTION",
  danger: "CAUTION",
  error: "CAUTION",
  failure: "CAUTION",
  fail: "CAUTION",
  missing: "CAUTION",
  bug: "CAUTION",
};

/**
 * A primeira linha de um callout do Obsidian (`> [!note] Título`, `> [!tip]-`). A lib só lê o do GitHub, `> [!NOTE]`
 * sozinho na linha: o título desce para a linha de baixo, em negrito.
 */
export function calloutHead(line: string): { quote: string; from: number; titleAt: number; type: string; title: string } | null {
  const m = /^(\s*>\s?)\[!([A-Za-z]+)\][+-]?[ \t]*/.exec(line);
  if (!m) return null;
  const type = CALLOUTS[m[2]!.toLowerCase()];
  if (!type) return null;
  return { quote: m[1]!, from: m[1]!.length, titleAt: m[0].length, type, title: line.slice(m[0].length).trim() };
}

export type LinkAction = { kind: "note"; target: string } | { kind: "tag"; tag: string } | { kind: "url"; url: string };

/** O que fazer com o clique num link desenhado pela lib. */
export function linkAction(url: string): LinkAction | null {
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  for (const scheme of [MISSING_LINK, NOTE_LINK]) {
    if (url.startsWith(scheme)) {
      const target = decode(url.slice(scheme.length));
      return target ? { kind: "note", target } : null;
    }
  }
  if (url.startsWith(TAG_LINK)) {
    const tag = decode(url.slice(TAG_LINK.length));
    return tag ? { kind: "tag", tag } : null;
  }
  return { kind: "url", url };
}

// ---------------------------------------------------------------- as tarefas

/** Onde está o caractere de dentro do `[ ]` de cada tarefa do bloco, na ordem: o mesmo índice que a lib dá. */
export function taskMarks(tree: Tree, from: number, to: number): number[] {
  const out: number[] = [];
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === "TaskMarker") out.push(n.from + 1);
    },
  });
  return out;
}

// ---------------------------------------------------------------- o clique

/**
 * Onde cai no `.md` o caractere `at` do texto que aparece renderizado. O texto renderizado é quase uma subsequência da
 * fonte (a marcação some): anda nas duas ao mesmo tempo, pulando na fonte o que não aparece. Um caractere que só existe
 * no desenho (o número da lista, uma quebra) não anda na fonte.
 */
export function sourceOffset(source: string, rendered: string, at: number): number {
  const WINDOW = 80;
  let s = 0;
  for (let r = 0; r < Math.min(at, rendered.length); r++) {
    const c = rendered[r]!;
    const space = /\s/.test(c);
    let found = -1;
    for (let i = s; i < source.length && i - s <= WINDOW; i++) {
      if (space ? /\s/.test(source[i]!) : source[i] === c) {
        found = i;
        break;
      }
    }
    if (found >= 0) s = found + 1;
  }
  // A marcação logo antes do caractere clicado (o `**` que abre, o `- ` do item) fica antes do cursor.
  const next = rendered[at];
  if (next && !/\s/.test(next)) {
    const found = source.indexOf(next, s);
    if (found >= 0 && found - s <= WINDOW) s = found;
  }
  return Math.min(s, source.length);
}
