// T5562: CodeMirror's local search and Markdown folding, with previews suspended while searching.
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type KeyBinding } from "@codemirror/view";
import { foldGutter, foldKeymap, foldService, ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { openSearchPanel, search, searchKeymap, searchPanelOpen } from "@codemirror/search";
export const SEARCH_KEYS: readonly KeyBinding[] = [
  ...searchKeymap.filter(k => ["Mod-f", "Mod-g", "F3", "Escape"].includes(k.key ?? "")),
  { key: "Mod-Alt-f", scope: "editor search-panel", run(view) {
    openSearchPanel(view);
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus();
    return true;
  } },
];
export const editorPhrases = EditorState.phrases.of({
  Find: "Buscar", Replace: "Substituir", next: "Próximo", previous: "Anterior", all: "Selecionar todas",
  "match case": "Diferenciar maiúsculas", regexp: "Expressão regular", "by word": "Palavra inteira",
  replace: "Substituir", "replace all": "Substituir tudo", close: "Fechar",
  "Fold line": "Recolher linha", "Unfold line": "Expandir linha", "folded code": "Texto recolhido",
  "unfold": "Expandir", "current match": "Ocorrência atual", "on line": "na linha",
});
export const listFolding = foldService.of((state, start, end) => {
  const tree = ensureSyntaxTree(state, end, 50) ?? syntaxTree(state);
  for (let n = tree.resolveInner(end, -1); n; n = n.parent!) {
    if ((n.name === "ListItem" || n.name === "BulletList" || n.name === "OrderedList")
        && state.doc.lineAt(n.from).from === start && n.to > end) return { from: end, to: n.to };
  }
  return null;
});
/** Raw source while the panel is open: matches in tables, code, images and inactive blocks stay visible/selectable. */
export function searchablePreviews(previews: Extension[]): Extension {
  const slot = new Compartment();
  return [slot.of(previews), ViewPlugin.fromClass(class {
    destroyed = false;
    update(update: { view: EditorView; state: EditorState; startState: EditorState }) {
      if (searchPanelOpen(update.state) === searchPanelOpen(update.startState)) return;
      queueMicrotask(() => { if (!this.destroyed) update.view.dispatch({ effects: slot.reconfigure(searchPanelOpen(update.view.state) ? [] : previews) }); });
    }
    destroy() { this.destroyed = true; }
  })];
}
export const searchAndFold = [editorPhrases, search({ top: true }), listFolding, foldGutter({ domEventHandlers: { mousedown(view, _line, event) { event.preventDefault(); view.focus(); return false; } } }), keymap.of([...SEARCH_KEYS, ...foldKeymap]),
  EditorView.theme({
    '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)', borderColor: 'var(--border)', maxWidth: '100%' },
    '.cm-search': { padding: '10px 28px 10px 10px', fontFamily: 'var(--font)', fontSize: '12px', lineHeight: '1.8' },
    '.cm-search .cm-textfield': { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '5px', padding: '4px 7px', maxWidth: '100%' },
    '.cm-search .cm-button': { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 7px' },
    '.cm-gutters': { background: 'transparent', color: 'var(--text-3)', border: 'none', cursor: 'pointer' },
    // Heading lines have top padding; keep the arrow beside their text baseline.
    '.cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
    '.cm-foldPlaceholder': { background: 'var(--surface-2)', color: 'var(--text-2)', borderColor: 'var(--border)', padding: '0 5px', borderRadius: '4px' },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, #f6c945 30%, transparent)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  })];
