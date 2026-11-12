// Portado de SilverBullet/client/codemirror/spell_checking.ts @ c3cbbeeceeb1e38e59f12b12cb8b07b722ff7868 (MIT).
// Mudanças: as exclusões (código/URLs/wiki) num ViewPlugin, só nas linhas desenhadas (T7876); alvo e correção com guarda de documento.
/*
Copyright 2022, Zef Hemel
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions
 of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 DEALINGS IN THE SOFTWARE.
*/
import { type EditorState, type Range, type TransactionSpec } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import type { MenuItem } from "../ContextMenu.tsx";
import { isSpellingWord, NO_SPELLING, spellingResult, type SpellingResult } from "../../../src/shared/spelling.ts";

export const SPELLING_EXCLUDED = ["FencedCode", "CodeBlock", "InlineCode", "URL", "Autolink", "WikiLink"] as const;
const excluded = new Set<string>(SPELLING_EXCLUDED);
/**
 * O código, os links e as URLs ganham `spellcheck="false"`. Só nas linhas que o editor desenhou (T7876): o navegador só
 * confere o que está no DOM, e varrer a árvore da nota inteira a cada tecla custava ~48 ms numa nota de 400 KB.
 */
export function disableSpellcheck(selectors: readonly string[]) {
  const names = new Set(selectors);
  const off = Decoration.mark({ attributes: { spellcheck: "false" } });
  const build = (view: EditorView): DecorationSet => {
    const marks: Range<Decoration>[] = [];
    const tree = syntaxTree(view.state);
    let last = -1;
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({ from, to, enter(node) {
        if (!names.has(node.name)) return;
        // Um nó que cruza duas faixas visíveis entra uma vez só.
        if (node.from > last) marks.push(off.range(node.from, node.to));
        last = Math.max(last, node.from);
        return false;
      } });
    }
    return Decoration.set(marks, true);
  };
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
    }
  }, { decorations: (p) => p.decorations });
}
export const spellingAttributes = EditorView.contentAttributes.of({
  spellcheck: "true", autocorrect: "off", autocapitalize: "off", writingsuggestions: "false",
});
export interface SpellingTarget { from: number; to: number; word: string; doc: EditorState["doc"] }
export function spellingAt(state: EditorState, pos: number): SpellingTarget | null {
  if (pos < 0 || pos > state.doc.length) return null;
  const range = state.wordAt(pos);
  if (!range) return null;
  const word = state.sliceDoc(range.from, range.to);
  if (!isSpellingWord(word)) return null;
  const tree = ensureSyntaxTree(state, range.to, 50) ?? syntaxTree(state);
  for (let node = tree.resolveInner(range.from, 1); node; node = node.parent!) if (excluded.has(node.name)) return null;
  return { from: range.from, to: range.to, word, doc: state.doc };
}
interface SpellingView {
  readonly state: EditorState;
  readonly dom: { isConnected: boolean };
  dispatch(spec: TransactionSpec): void;
  focus(): void;
}
export function applySpelling(view: SpellingView, target: SpellingTarget, suggestion: string): boolean {
  if (!view.dom.isConnected || view.state.doc !== target.doc || view.state.sliceDoc(target.from, target.to) !== target.word) return false;
  const result = spellingResult({ available: true, misspelled: true, suggestions: [suggestion] }, target.word);
  if (!result.suggestions.length) return false;
  const text = result.suggestions[0]!;
  view.dispatch({ changes: { from: target.from, to: target.to, insert: text }, selection: { anchor: target.from + text.length },
    userEvent: "input.spelling", annotations: isolateHistory.of("full"), scrollIntoView: true });
  view.focus(); return true;
}
export function spellingMenu(view: SpellingView, target: SpellingTarget, result: SpellingResult): MenuItem[] {
  if (!result.available || !result.misspelled) return [];
  return [{ kind: "title", label: "Ortografia" },
    ...(result.suggestions.length ? result.suggestions.map((suggestion) => ({ label: suggestion, onSelect: () => { applySpelling(view, target, suggestion); } }))
      : [{ label: "Sem sugestões", disabled: true, onSelect() {} }]), { kind: "separator" }];
}
/** A slow/unavailable checker must not hold the context menu indefinitely. */
export async function spellingForMenu(word: string, check: () => Promise<SpellingResult>, timeoutMs = 600): Promise<SpellingResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([check().then((value) => spellingResult(value, word)).catch(() => NO_SPELLING),
      new Promise<SpellingResult>((resolve) => { timer = setTimeout(() => resolve(NO_SPELLING), timeoutMs); })]);
  } catch { return NO_SPELLING; } finally { clearTimeout(timer); }
}
