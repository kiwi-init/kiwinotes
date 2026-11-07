import { describe, expect, test } from "bun:test";

import { insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";

import { wikiLinkSyntax } from "./index.ts";
import { exitEmptyItem, itemIndentEm } from "./lists.ts";

/** O Enter do editor: o nosso primeiro, e o do lang-markdown quando o nosso não trata (a ordem do keymap). */
const enter: StateCommand = (target) => exitEmptyItem(target) || insertNewlineContinueMarkup(target);

/** Roda o comando no texto com o cursor em `|` e devolve o texto com o cursor depois, ou null quando não tratou. */
function run(cmd: StateCommand, marked: string): string | null {
  const at = marked.indexOf("|");
  const doc = marked.replace("|", "");
  const state = EditorState.create({ doc, selection: { anchor: at }, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  let out: Transaction | null = null;
  if (!cmd({ state, dispatch: (tr) => (out = tr) }) || !out) return null;
  const next = (out as Transaction).state;
  const head = next.selection.main.head;
  return `${next.doc.sliceString(0, head)}|${next.doc.sliceString(head)}`;
}

describe("Enter na lista (T6379)", () => {
  test("no item vazio do fim, um Enter sai da lista, com a linha em branco que o Markdown pede", () => {
    expect(run(enter, "- a\n- |")).toBe("- a\n\n|");
    expect(run(enter, "1. um\n2. |")).toBe("1. um\n\n|");
    expect(run(enter, "- [ ] tarefa\n- [ ] |")).toBe("- [ ] tarefa\n\n|");
    expect(run(enter, "* a\n* |")).toBe("* a\n\n|");
  });

  test("com a linha em branco já em cima (ou sozinho), só apaga o marcador", () => {
    expect(run(enter, "Texto.\n\n- |")).toBe("Texto.\n\n|");
    expect(run(enter, "- |")).toBe("|");
    expect(run(enter, "- a\n\n- |")).toBe("- a\n\n|");
  });

  test("o resto é o do lang-markdown: continuar, tarefa nova sem o x, renumerar, tirar um nível", () => {
    expect(run(enter, "- item|")).toBe("- item\n- |");
    expect(run(enter, "- [x] feita|")).toBe("- [x] feita\n- [ ] |");
    expect(run(enter, "1. um|\n2. dois")).toBe("1. um\n2. |\n3. dois");
    expect(run(enter, "- a\n  - |")).toBe("- a\n- |");
  });

  test("não mexe fora de lista, em código, no item com texto ou com o cursor antes do marcador", () => {
    expect(run(exitEmptyItem, "- a|")).toBeNull();
    expect(run(exitEmptyItem, "```\n- |\n```")).toBeNull();
    expect(run(exitEmptyItem, "|- ")).toBeNull();
    expect(run(exitEmptyItem, "texto|")).toBeNull();
    expect(run(exitEmptyItem, "> - |")).toBeNull();
  });
});

describe("recuo pendurado (T6379)", () => {
  test("a largura do começo do item, em em, a mesma em todas as linhas do item", () => {
    expect(itemIndentEm("", "-", false)).toBe(1.15);
    expect(itemIndentEm("  ", "-", false)).toBe(2.25);
    expect(itemIndentEm("\t", "*", false)).toBe(3.35);
    expect(itemIndentEm("", "1.", false)).toBe(1.4);
    expect(itemIndentEm("", "10.", false)).toBe(1.95);
    expect(itemIndentEm("", "-", true)).toBe(1.95);
  });
});
