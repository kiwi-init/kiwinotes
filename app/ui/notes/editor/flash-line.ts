// A linha que um link de fora abriu (o Calendário, T32155, spec #32129): o editor rola até ela, põe o cursor no começo
// e a marca por um instante. A marca leva `data-flash-line` com o número da linha no arquivo (com o frontmatter), para
// o roteiro provar que caiu na linha certa; some sozinha, ou na primeira edição.

import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** Quanto tempo a marca fica (a piscada do CSS dura menos; o resto é a linha ainda clara). */
export const FLASH_MS = 1600;

const setFlash = StateEffect.define<{ line: number; fileLine: number } | null>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue;
      if (!e.value) return Decoration.none;
      const at = tr.state.doc.line(e.value.line).from;
      return Decoration.set([
        Decoration.line({ attributes: { class: "kn-flash-line", "data-flash-line": String(e.value.fileLine) } }).range(at),
      ]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const flashLine: Extension = flashField;

/** A linha do corpo (1-based) para a linha do arquivo, tirando as do frontmatter; `null` se cai fora do corpo. */
export function bodyLine(fileLine: number, frontmatter: string, body: string): number | null {
  const skip = frontmatter ? frontmatter.split("\n").length - 1 : 0;
  const n = fileLine - skip;
  return n >= 1 && n <= body.split("\n").length ? n : null;
}

/** Rola até a linha, põe o cursor no começo e marca. Devolve o timer que tira a marca (o chamador limpa ao desmontar). */
export function jumpToLine(v: EditorView, line: number, fileLine: number): ReturnType<typeof setTimeout> {
  const at = v.state.doc.line(line).from;
  v.dispatch({
    selection: { anchor: at },
    effects: [setFlash.of({ line, fileLine }), EditorView.scrollIntoView(at, { y: "center" })],
  });
  return setTimeout(() => {
    if (v.dom.isConnected) v.dispatch({ effects: setFlash.of(null) });
  }, FLASH_MS);
}
