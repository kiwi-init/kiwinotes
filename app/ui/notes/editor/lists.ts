// Listas no editor (T6379, E10): o Enter num item vazio sai da lista e a linha que quebra fica alinhada ao texto do item.
// Ideia do SilverBullet (MIT, Copyright 2022 Zef Hemel), `client/codemirror/editing/markdown_enter.ts`: um Enter só no
// item vazio, sem a linha em branco da lista "solta". Nenhum código copiado. O resto do Enter (continuar o marcador, a
// tarefa nova sem o x, renumerar a lista numerada, tirar um nível do item recuado) é o do lang-markdown.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, type StateCommand } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** O começo de um item: o recuo, o marcador (`-`, `*`, `+`, `1.`, `1)`), os espaços e a caixa da tarefa. */
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;
/** O item sem texto: só o marcador (e a caixa), com ou sem espaço no fim. */
const EMPTY_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/;

/** O ponto é o marcador de um item de lista do parser (não um "- " dentro de bloco de código ou do frontmatter). */
function isListMark(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "ListMark") return true;
    if (n.name === "ListItem" || n.name === "Document") return false;
  }
  return false;
}

/**
 * Enter num item vazio do primeiro nível: a lista acaba ali. O marcador sai e fica uma linha em branco entre a lista e o
 * que vem depois (sem ela, o Markdown junta a linha nova ao item de cima). No item recuado, o lang-markdown tira um
 * nível, e no item com texto ele continua a lista: este comando devolve `false` e deixa com ele.
 */
export const exitEmptyItem: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const m = EMPTY_ITEM.exec(line.text);
  if (!m || m[1] || pos < line.from + m[2]!.length) return false;
  if (!isListMark(state, line.from)) return false;
  const above = line.number > 1 ? state.doc.line(line.number - 1).text : "";
  // Já tem linha em branco em cima (ou é a primeira linha): só apaga o marcador.
  const insert = above.trim() ? "\n" : "";
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: line.from + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

// ---------------------------------------------------------------- recuo pendurado

/**
 * A largura do começo do item (o recuo, o marcador e a caixa), em em: igual em todas as linhas do item, com o marcador
 * cru (a linha do cursor) ou desenhado (o "•" e a caixa). A caixa do começo tem essa largura mínima e a linha que quebra
 * começa nela, embaixo do texto.
 */
export function itemIndentEm(indent: string, marker: string, task: boolean): number {
  const cols = [...indent].reduce((n, c) => n + (c === "\t" ? 4 : 1), 0);
  // A tarefa desenhada é só a caixa (o marcador some); o "•" e o número ficam.
  const mark = task ? 1.95 : /^[-*+]$/.test(marker) ? 1.15 : marker.length * 0.55 + 0.3;
  return Math.round((cols * 0.55 + mark) * 100) / 100;
}

function buildHanging(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      const m = ITEM.exec(line.text);
      if (!m || !isListMark(state, line.from + m[1]!.length)) continue;
      const em = itemIndentEm(m[1]!, m[2]!, !!m[4]);
      out.push(Decoration.line({ class: "cm-list-line", attributes: { style: `--kn-hang: ${em}em` } }).range(line.from));
      out.push(Decoration.mark({ class: "cm-list-head" }).range(line.from, line.from + m[0].length));
    }
  }
  return Decoration.set(out, true);
}

export const hangingIndent = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildHanging(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = buildHanging(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.theme({
    // A linha que quebra começa no texto do item, não embaixo do marcador (o "recuo pendurado").
    ".cm-line.cm-list-line": { paddingLeft: "var(--kn-hang) !important", textIndent: "calc(-1 * var(--kn-hang))" },
    ".cm-list-head": { display: "inline-block", minWidth: "var(--kn-hang)", textIndent: "0" },
  }),
];
