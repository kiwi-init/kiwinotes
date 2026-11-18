// T5556: menu operations share E1 transactions; clipboard access happens only after a chosen action.
import { markdownStructure, type NoteHeading } from "../../../src/shared/markdown-structure.ts";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";
import type { MenuItem } from "../ContextMenu.tsx";
import type { MenuIconName } from "./menuIcons.tsx";
import { FORMAT_KEYS, tableAt, tableActionCommand } from "./index.ts";
import { insertLink } from "./format.ts";
import { slashInsert } from "./slash.ts";
import { CALLOUT_KINDS, calloutAt } from "./callouts.ts";
import { insertFootnote } from "./footnotes.ts";
import { focusEditorNow } from "./livePreview.ts";
import { linkFromPaste } from "./text.ts";
import { TEXT_TOOLS, textTool, splitAt } from "./tools.ts";
import { TABLE_ACTIONS, canTableAction, tableContext } from "./table.ts";

export interface EditorClipboard {
  read?(): Promise<string>;
  write?(text: string): Promise<unknown>;
}
export interface ClipboardTarget {
  readonly state: EditorState;
  readonly dom: { isConnected: boolean };
  dispatch(spec: TransactionSpec): void;
  focus(): void;
}
const unchanged = (view: ClipboardTarget, state: EditorState) =>
  view.dom.isConnected && view.state.doc === state.doc && view.state.selection.eq(state.selection);

/** Failed clipboard writes never erase the selection. A delayed result cannot edit another note. */
export async function cutSelection(view: ClipboardTarget, clipboard: EditorClipboard) {
  const state = view.state, sel = state.selection.main;
  if (sel.empty || !clipboard.write) return;
  await clipboard.write(state.sliceDoc(sel.from, sel.to));
  if (!unchanged(view, state)) return;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" }, selection: { anchor: sel.from }, userEvent: "delete.cut", scrollIntoView: true });
  view.focus();
}
export async function pasteSelection(view: ClipboardTarget, clipboard: EditorClipboard, plain: boolean) {
  const state = view.state, sel = state.selection.main;
  if (!clipboard.read) return;
  const text = (await clipboard.read()).replace(/\r\n?/g, "\n");
  if (!text || !unchanged(view, state)) return;
  const insert = !plain && !sel.empty ? linkFromPaste(state.sliceDoc(sel.from, sel.to), text) ?? text : text;
  view.dispatch({ ...view.state.replaceSelection(insert), userEvent: "input.paste", scrollIntoView: true });
  view.focus();
}

/**
 * O título em que o cursor está (spec #13385), pela árvore que o editor já tem: antes, cada clique com o botão direito
 * lia a nota inteira (`markdownStructure`), de 58 a 100 ms numa nota de 400 KB. Só o texto do título passa pelo
 * `markdownStructure`, então o título e as posições são os mesmos de antes.
 */
/** Onde termina o frontmatter (`---` no começo e o `---` que fecha), como no `markdownStructure`; 0 sem ele. */
function frontmatterEnd(state: EditorState): number {
  const fence = /^---[ \t]*$/;
  if (state.doc.lines < 3 || !fence.test(state.doc.line(1).text)) return 0;
  for (let n = 2; n <= state.doc.lines; n++) if (fence.test(state.doc.line(n).text)) return state.doc.line(n).to;
  return 0;
}

export function headingAtCursor(state: EditorState): NoteHeading | undefined {
  const head = state.selection.main.head;
  // O frontmatter não tem título (o `tags: […]` antes do `---` não é um título setext).
  if (head <= frontmatterEnd(state)) return undefined;
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, head + 1), 50) ?? syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = tree.resolveInner(head, side); n; n = n.parent) {
      if (!/^(ATX|Setext)Heading\d$/.test(n.name)) continue;
      if (n.from < frontmatterEnd(state)) return undefined;
      const h = markdownStructure(state.sliceDoc(n.from, n.to)).headings[0];
      if (!h) return undefined;
      const at = (x: number) => x + n!.from;
      const found = { ...h, from: at(h.from), to: at(h.to), textFrom: at(h.textFrom), textTo: at(h.textTo) };
      return found.from <= head && head <= found.to ? found : undefined;
    }
  }
  return undefined;
}

/**
 * O callout em que o cursor está (spec #13385): só as linhas de citação (`>`) em volta dele vão ao `calloutAt`, e não a
 * nota inteira (`doc.toString()`, a cada clique com o botão direito).
 */
export function calloutAtCursor(state: EditorState): ReturnType<typeof calloutAt> {
  const head = state.selection.main.head;
  const quote = (n: number) => /^\s*>/.test(state.doc.line(n).text);
  const at = state.doc.lineAt(head).number;
  if (!quote(at)) return null;
  let first = at, last = at;
  while (first > 1 && quote(first - 1)) first--;
  while (last < state.doc.lines && quote(last + 1)) last++;
  const from = state.doc.line(first).from;
  const found = calloutAt(state.sliceDoc(from, state.doc.line(last).to), head - from);
  return found && { ...found, from: found.from + from, to: found.to + from };
}

/**
 * O Formatar no próprio estilo (spec #17703): cada opção mostra o que faz no texto, como as "Ferramentas de texto"
 * (MAIÚSCULAS, minúsculas). Os estilos, em `notes.css`, são os do editor: o realce, o comentário e o código.
 */
export const FORMAT_STYLE: Record<string, string> = {
  "Mod-b": "kn-menu-bold",
  "Mod-i": "kn-menu-italic",
  "Shift-Mod-x": "kn-menu-strike",
  "Shift-Mod-h": "kn-menu-highlight",
  "Mod-e": "kn-menu-code",
  "Mod-/": "kn-menu-comment",
  "Mod-\\": "kn-menu-clear",
};

/**
 * O jeito de cada opção do Parágrafo (spec #17703): os títulos em cascata (`kn-menu-h1`…`h6`), o Corpo no normal, e
 * um ícone nas listas, na citação e no marcar tarefa.
 */
export const PARAGRAPH_LOOK: Record<string, { icon?: MenuIconName; labelClass?: string }> = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`Mod-${n}`, { labelClass: `kn-menu-h${n}` }])),
  "Shift-Mod-8": { icon: "bullet" },
  "Shift-Mod-7": { icon: "numbered" },
  "Shift-Mod-9": { icon: "task" },
  "Shift-Mod-.": { icon: "quote" },
  "Mod-l": { icon: "check" },
};

/**
 * O menu do botão direito do editor. `plain` (spec #13385): o de um texto puro (.txt), o mesmo menu sem o que só existe
 * numa nota (o link para outra nota e dividir a nota). A formatação entra como Markdown simples (`# `, `- `, `**`).
 * `code` (T19312): o de um arquivo de código, sem Formatar, Parágrafo e Inserir, que são Markdown.
 */
export function editorMenu(view: EditorView, clipboard: EditorClipboard, onError: (message: string) => void, onSplit?: () => void, onRenameHeading?: (offset: number, title: string, source: string) => void, opts: { plain?: boolean; code?: boolean; tablePos?: number } = {}): MenuItem[] {
  const chosenState = view.state;
  const safe = () => unchanged(view, chosenState);
  // O foco antes da ação (T6377): despachada com o editor ainda sem foco, o texto digitado logo depois caía fora dela.
  const perform = (action: () => void) => () => { if (safe()) { focusEditorNow(view); action(); } };
  const asyncAction = (action: () => Promise<unknown>) => () => {
    if (safe()) void action()
      .catch(() => onError("Não foi possível acessar a área de transferência. Tente novamente."))
      .finally(() => { if (safe()) view.focus(); });
  };
  const command = (key: string): MenuItem => {
    const item = FORMAT_KEYS.find((item) => item.key === key)!;
    return { label: item.label, labelClass: FORMAT_STYLE[key], ...PARAGRAPH_LOOK[key], onSelect: perform(() => { item.run(view); }) };
  };
  const insertBlock = (id: string) => perform(() => {
    const sel = view.state.selection.main, line = view.state.doc.lineAt(sel.from);
    const result = slashInsert(id, !view.state.sliceDoc(line.from, sel.from).trim(), new Date());
    if (!result) return;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: result.insert }, selection: { anchor: sel.from + result.cursor }, userEvent: "input.type", scrollIntoView: true });
    if (id === "link") startCompletion(view);
  });
  const heading = onRenameHeading ? headingAtCursor(chosenState) : undefined;
  const selected = !view.state.selection.main.empty;
  // A tabela desenhada (T19814) manda a célula do clique (`tablePos`): as ações valem para ela, e o cursor não entra.
  const at = opts.tablePos;
  const range = tableAt(view.state, at);
  const ctx = range && (at !== undefined || view.state.selection.ranges.length === 1)
    ? tableContext(view.state.sliceDoc(range.from, range.to), (at ?? view.state.selection.main.head) - range.from) : null;
  const tableItems: MenuItem[] = ctx ? [{ kind: "submenu", label: "Tabela", items: [
    ...([ ["row", "Linha"], ["column", "Coluna"], ["align", "Alinhamento"], ["sort", "Ordenar pela coluna"] ] as const).map(([group, label]): MenuItem => ({
      kind: "submenu", label, items: TABLE_ACTIONS.filter((item) => item.group === group).map((item) => ({
        label: item.label, hint: item.hint, disabled: !canTableAction(ctx, item.id),
        checked: "align" in item ? (ctx.table.align[ctx.col] ?? null) === item.align : undefined,
        onSelect: perform(() => { tableActionCommand(item.id)(view, at); }),
      })),
    })),
    ...(at === undefined ? [] : [{ kind: "separator" as const },
      // O Markdown cru, só quando a pessoa pede (spec #19323): o cursor entra na célula, e a tabela vira texto.
      { label: "Editar como Markdown", onSelect: perform(() => view.dispatch({ selection: { anchor: at }, scrollIntoView: true })) }]),
  ] }, { kind: "separator" }] : [];
  const callout = opts.plain ? null : calloutAtCursor(chosenState);
  const calloutItems: MenuItem[] = callout ? [{ kind: "submenu", label: "Tipo do callout", items: CALLOUT_KINDS.map((kind): MenuItem => ({
    // Só o título (spec #12626): o menu é de texto, e o glifo saiu.
    label: kind.title,
    checked: kind.id === callout.kind.id,
    onSelect: perform(() => view.dispatch({ changes: { from: callout.from, to: callout.to, insert: kind.id }, userEvent: "input.type" })),
  })) }, { kind: "separator" }] : [];
  return [
    ...calloutItems,
    ...(heading ? [{ label: "Renomear título e seus links…", onSelect: perform(() => onRenameHeading?.(heading.from, heading.title, chosenState.doc.toString())) }, { kind: "separator" as const }] : []),
    ...tableItems,
    // O código (T19312): sem o Markdown, que num .py ou num .css viraria lixo.
    ...(opts.code ? [] : [{ kind: "submenu" as const, label: "Formatar", items: [
      ...["Mod-b", "Mod-i", "Shift-Mod-x", "Shift-Mod-h", "Mod-e", "Mod-/"].map(command),
      { kind: "separator" }, command("Mod-\\"),
    ] },
    { kind: "submenu", label: "Parágrafo", items: [
      ...[1, 2, 3, 4, 5, 6].map((n) => command(`Mod-${n}`)), command("Mod-0"),
      { kind: "separator" }, ...["Shift-Mod-8", "Shift-Mod-7", "Shift-Mod-9", "Shift-Mod-.", "Mod-l"].map(command),
    ] },
    // O Inserir com um ícone em cada opção (spec #17703), os mesmos do menu do "/".
    { kind: "submenu", label: "Inserir", items: [
      { label: "Link", icon: "link", onSelect: perform(() => view.dispatch(insertLink(view.state))) },
      ...(opts.plain ? [] : [{ label: "Link para nota", icon: "note-link" as const, onSelect: insertBlock("link") }]),
      { label: "Tabela", icon: "table", onSelect: insertBlock("table") },
      { label: "Bloco de código", icon: "code", onSelect: insertBlock("code") },
      { label: "Separador", icon: "divider", onSelect: insertBlock("divider") },
      { label: "Callout", icon: "callout", onSelect: insertBlock("callout") },
      { label: "Nota de rodapé", icon: "footnote", onSelect: perform(() => view.dispatch(insertFootnote(view.state))) },
    ] }] satisfies MenuItem[]),
    { kind: "submenu", label: "Ferramentas de texto", items: TEXT_TOOLS.map(item => ({ label: item.label,
      disabled: !textTool(chosenState, item.id), onSelect: perform(() => { const tr = textTool(view.state, item.id); if (tr) view.dispatch(tr); }),
    })) },
    ...(opts.plain ? [] : [{ label: "Dividir nota aqui", disabled: !onSplit || !splitAt(chosenState), onSelect: perform(() => onSplit?.()) }]),
    { kind: "separator" },
    { label: "Recortar", hint: "⌘X", disabled: !selected || !clipboard.write, onSelect: asyncAction(() => cutSelection(view, clipboard)) },
    { label: "Copiar", hint: "⌘C", disabled: !selected || !clipboard.write, onSelect: asyncAction(async () => {
      const sel = chosenState.selection.main;
      await clipboard.write!(chosenState.sliceDoc(sel.from, sel.to));
      if (safe()) view.focus();
    }) },
    { label: "Colar", hint: "⌘V", disabled: !clipboard.read, onSelect: asyncAction(() => pasteSelection(view, clipboard, false)) },
    { label: "Colar sem formatação", hint: "⇧⌘V", disabled: !clipboard.read, onSelect: asyncAction(() => pasteSelection(view, clipboard, true)) },
  ];
}
