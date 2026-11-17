import { expect, test } from "bun:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { cutSelection, pasteSelection, type ClipboardTarget } from "./context-menu.ts";

function editor(doc: string, from = 0, to = doc.length) {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  let focused = false;
  const view: ClipboardTarget = {
    get state() { return state; }, dom: { isConnected: true },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; },
    focus() { focused = true; },
  };
  return { view, text: () => state.doc.toString(), focused: () => focused,
    switchNote: (doc: string) => { state = EditorState.create({ doc }); } };
}

test("cut removes the selected Markdown only after a successful clipboard write", async () => {
  const e = editor("antes **trecho** depois", 6, 16); let copied = "";
  await cutSelection(e.view, { write: async (text) => { copied = text; } });
  expect(copied).toBe("**trecho**"); expect(e.text()).toBe("antes  depois"); expect(e.focused()).toBe(true);
});
test("failed cut keeps the text and selection", async () => {
  const e = editor("não perder");
  await expect(cutSelection(e.view, { write: async () => { throw new Error("failed"); } })).rejects.toThrow("failed");
  expect(e.text()).toBe("não perder"); expect(e.view.state.selection.main.to).toBe(10);
});
test("a delayed cut does not erase another note", async () => {
  const e = editor("original"); let finish!: () => void;
  const pending = cutSelection(e.view, { write: () => new Promise<void>((resolve) => { finish = resolve; }) });
  e.switchNote("outra nota"); finish(); await pending; expect(e.text()).toBe("outra nota");
});
test("paste follows the editor's selected-text URL behavior, plain paste preserves literal text", async () => {
  const normal = editor("Projeto"), plain = editor("Projeto");
  const clipboard = { read: async () => "https://kiwi.dev" };
  await pasteSelection(normal.view, clipboard, false); await pasteSelection(plain.view, clipboard, true);
  expect(normal.text()).toBe("[Projeto](https://kiwi.dev/)"); expect(plain.text()).toBe("https://kiwi.dev");
});
test("plain paste normalizes line endings and preserves Markdown", async () => {
  const e = editor("abc", 1, 2);
  await pasteSelection(e.view, { read: async () => "**um**\r\ndois\rtrês" }, true);
  expect(e.text()).toBe("a**um**\ndois\ntrêsc");
});
test("empty clipboard does not erase the selection", async () => {
  const e = editor("manter"); await pasteSelection(e.view, { read: async () => "" }, false); expect(e.text()).toBe("manter");
});
test("a delayed paste does not overwrite typing or a switched note", async () => {
  const e = editor("inicial"); let finish!: (value: string) => void;
  const pending = pasteSelection(e.view, { read: () => new Promise<string>((resolve) => { finish = resolve; }) }, true);
  e.view.dispatch({ changes: { from: 0, insert: "novo " } }); finish("atrasado"); await pending; expect(e.text()).toBe("novo inicial");
});
test("closing the editor while reading the clipboard never dispatches", async () => {
  const e = editor("inicial"); let finish!: (value: string) => void;
  const pending = pasteSelection(e.view, { read: () => new Promise<string>((resolve) => { finish = resolve; }) }, true);
  e.view.dom.isConnected = false; finish("atrasado"); await pending; expect(e.text()).toBe("inicial");
});
