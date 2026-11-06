import { expect, test } from "bun:test";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { wikiLinkSyntax } from "./index.ts";
import { applySpelling, disableSpellcheck, SPELLING_EXCLUDED, spellingAt, spellingAttributes, spellingForMenu, spellingMenu } from "./spelling.ts";
import { isSpellingLanguage, isSpellingWord, NO_SPELLING, spellingResult } from "../../../src/shared/spelling.ts";

function editor(doc: string) {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] }),
    disableSpellcheck(SPELLING_EXCLUDED), spellingAttributes, history({ newGroupDelay: 10_000 })] });
  return { get state() { return state; }, dom: { isConnected: true }, focus() {},
    dispatch(spec: TransactionSpec | Transaction) { state = spec instanceof Transaction ? spec.state : state.update(spec).state; },
    switchNote(doc: string) { state = EditorState.create({ doc }); } };
}
test("word targets use exact Unicode offsets and skip code, URLs and wiki names", () => {
  const doc = "Uma reunião marcada.\n\n`codigoerrado`\n\n[site](https://exemplo.invalid/caminho)\n\n[[Nomeerrado]]\n\n```ts\ncodigoerrado\n```";
  const view = editor(doc);
  const target = spellingAt(view.state, doc.indexOf("reunião") + 2)!;
  expect(target.word).toBe("reunião"); expect(doc.slice(target.from, target.to)).toBe("reunião");
  for (const value of ["codigoerrado", "exemplo", "Nomeerrado"]) expect(spellingAt(view.state, doc.indexOf(value) + 2)).toBeNull();
  expect(spellingAt(view.state, doc.lastIndexOf("codigoerrado") + 2)).toBeNull();
});
test("payload validators reject whole lines and malformed languages", () => {
  for (const word of ["", "duas palavras", "erro\n", "abc123", "http://exemplo", "a".repeat(129)]) expect(isSpellingWord(word)).toBe(false);
  expect(isSpellingWord("reunião")).toBe(true); expect(isSpellingWord("d'água")).toBe(true);
  expect(isSpellingLanguage("pt-BR")).toBe(true); expect(isSpellingLanguage("en_US")).toBe(true);
  for (const language of ["", "pt-BR\n", "../pt", "a".repeat(33)]) expect(isSpellingLanguage(language)).toBe(false);
});
test("suggestions are bounded, unique and contain no control or line-separator characters", () => {
  const r = spellingResult({ available: true, misspelled: true, suggestions: ["reuniao", "reunião", "reunião", "ruim\nlinha", "ruim\u2028linha", "a".repeat(129), ...Array.from({ length: 20 }, (_, i) => `opção${i}`)] }, "reuniao");
  expect(r.suggestions[0]).toBe("reunião"); expect(r.suggestions).toHaveLength(8);
  expect(r.suggestions.some((s) => /[\n\u2028]/.test(s))).toBe(false);
});
test("a chosen correction changes only its word and is an independent undo step", () => {
  const view = editor("Uma reuniao com errro.");
  expect(applySpelling(view, spellingAt(view.state, 6)!, "reunião")).toBe(true);
  const first = view.state.doc.toString();
  expect(applySpelling(view, spellingAt(view.state, first.indexOf("errro") + 1)!, "erro")).toBe(true);
  expect(view.state.doc.toString()).toBe("Uma reunião com erro.");
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(first);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe("Uma reuniao com errro.");
});
test("stale suggestions cannot edit a changed, switched or closed note", () => {
  const changed = editor("reuniao"), switched = editor("reuniao"), closed = editor("reuniao");
  const a = spellingAt(changed.state, 2)!, b = spellingAt(switched.state, 2)!, c = spellingAt(closed.state, 2)!;
  changed.dispatch({ changes: { from: 0, insert: "nova " } }); switched.switchNote("reuniao"); closed.dom.isConnected = false;
  expect(applySpelling(changed, a, "reunião")).toBe(false); expect(changed.state.doc.toString()).toBe("nova reuniao");
  expect(applySpelling(switched, b, "reunião")).toBe(false); expect(applySpelling(closed, c, "reunião")).toBe(false);
});
test("correct words and unavailable checkers do not add a spelling section", () => {
  const view = editor("palavra"), target = spellingAt(view.state, 2)!;
  expect(spellingMenu(view, target, NO_SPELLING)).toEqual([]);
  expect(spellingMenu(view, target, { available: true, misspelled: false, suggestions: [] })).toEqual([]);
});
test("failed, synchronously throwing and slow checkers leave the ordinary menu available", async () => {
  expect(await spellingForMenu("palavra", async () => { throw new Error("closed"); })).toEqual(NO_SPELLING);
  expect(await spellingForMenu("palavra", () => { throw new Error("closed"); })).toEqual(NO_SPELLING);
  expect(await spellingForMenu("palavra", () => new Promise(() => {}), 5)).toEqual(NO_SPELLING);
});
