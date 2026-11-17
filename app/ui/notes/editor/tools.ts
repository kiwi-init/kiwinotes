// T5561: original Kiwi code. Pure text operations and a create-first split that never discards text on failure.
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
export type TextTool = "sort" | "deduplicate" | "uppercase" | "lowercase";
export const TEXT_TOOLS: { id: TextTool; label: string }[] = [
  { id: "sort", label: "Ordenar linhas" }, { id: "deduplicate", label: "Tirar linhas duplicadas" },
  { id: "uppercase", label: "MAIÚSCULAS" }, { id: "lowercase", label: "minúsculas" },
];
export function textTool(state: EditorState, id: TextTool): TransactionSpec | null {
  if (state.selection.ranges.length !== 1) return null;
  const sel = state.selection.main;
  let from = sel.from, to = sel.to;
  if (id === "sort" || id === "deduplicate") {
    from = state.doc.lineAt(sel.from).from;
    to = state.doc.lineAt(sel.to > sel.from && state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to).to;
  } else if (sel.empty) return null;
  const before = state.sliceDoc(from, to);
  const insert = id === "uppercase" ? before.toLocaleUpperCase("pt-BR") : id === "lowercase" ? before.toLocaleLowerCase("pt-BR")
    : id === "deduplicate" ? [...new Set(before.split("\n"))].join("\n")
    : before.split("\n").sort(new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" }).compare).join("\n");
  if (insert === before) return null;
  return { changes: { from, to, insert }, selection: EditorSelection.range(from, from + insert.length),
    annotations: isolateHistory.of("full"), userEvent: "input.textTool", scrollIntoView: true };
}
export function splitAt(state: EditorState): { head: string; tail: string; at: number } | null {
  const sel = state.selection.main;
  if (state.selection.ranges.length !== 1 || !sel.empty || sel.head <= 0 || sel.head >= state.doc.length) return null;
  return { head: state.sliceDoc(0, sel.head), tail: state.sliceDoc(sel.head), at: sel.head };
}
interface SplitView { readonly state: EditorState; readonly dom: { isConnected: boolean }; dispatch(spec: TransactionSpec): void }
export async function splitNote(view: SplitView, create: (tail: string) => Promise<string>): Promise<{ path: string; moved: boolean } | null> {
  const state = view.state, parts = splitAt(state);
  if (!parts) return null;
  const path = await create(parts.tail); // only truncate after the complete tail exists on disk
  if (!view.dom.isConnected || view.state.doc !== state.doc || !view.state.selection.eq(state.selection)) return { path, moved: false };
  view.dispatch({ changes: { from: parts.at, to: state.doc.length, insert: "" }, selection: { anchor: parts.at },
    annotations: isolateHistory.of("full"), userEvent: "delete.split", scrollIntoView: true });
  return { path, moved: true };
}
