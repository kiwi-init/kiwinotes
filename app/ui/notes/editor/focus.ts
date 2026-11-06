// O modo foco e a máquina de escrever (T6385, E13, issue 189). O foco esmaece todas as linhas fora do parágrafo do
// cursor; a máquina de escrever mantém a linha do cursor no meio da tela. Os dois ligam e desligam por `Compartment`,
// sem recriar o editor. Ideia do Zettlr (`typewriter.ts`, `distraction-free.ts`, GPL-3.0): nada de código de lá.

import { Compartment, type EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** As linhas (de, até, 1-based) do parágrafo do cursor: as não vazias juntas em volta dele. Linha vazia: só ela. */
export function paragraphAt(state: EditorState, pos: number): { from: number; to: number } {
  const doc = state.doc;
  const here = doc.lineAt(pos);
  if (!here.text.trim()) return { from: here.number, to: here.number };
  let from = here.number;
  let to = here.number;
  while (from > 1 && doc.line(from - 1).text.trim()) from--;
  while (to < doc.lines && doc.line(to + 1).text.trim()) to++;
  return { from, to };
}

const here = Decoration.line({ class: "cm-focus-here" });

/** As linhas do parágrafo do cursor ganham a marca; o resto (as linhas e os blocos desenhados) fica esmaecido. */
function current(state: EditorState): DecorationSet {
  const { from, to } = paragraphAt(state, state.selection.main.head);
  const b = new RangeSetBuilder<Decoration>();
  for (let n = from; n <= to; n++) b.add(state.doc.line(n).from, state.doc.line(n).from, here);
  return b.finish();
}

const focusLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = current(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = current(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

const focusTheme = EditorView.theme({
  "&.cm-focus-on .cm-content > *": { opacity: "0.32", transition: "opacity var(--slow) var(--ease)" },
  "&.cm-focus-on .cm-content > .cm-focus-here": { opacity: "1" },
});

/** Centraliza a linha do cursor quando ele anda ou o texto muda (digitar, colar, desfazer). */
const centerCursor = EditorView.updateListener.of((u) => {
  if (!u.selectionSet && !u.docChanged) return;
  if (u.transactions.some((t) => t.isUserEvent("select.pointer"))) return;
  const head = u.state.selection.main.head;
  queueMicrotask(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) }));
});

/** Espaço embaixo e em cima: a primeira e a última linha também conseguem ficar no meio. */
const typewriterTheme = EditorView.theme({
  ".cm-content": { paddingTop: "40vh", paddingBottom: "40vh" },
});

export const focusCompartment = new Compartment();
export const typewriterCompartment = new Compartment();

export const focusExtension = (on: boolean): Extension =>
  on ? [focusLines, focusTheme, EditorView.editorAttributes.of({ class: "cm-focus-on" })] : [];
export const typewriterExtension = (on: boolean): Extension => (on ? [centerCursor, typewriterTheme] : []);
