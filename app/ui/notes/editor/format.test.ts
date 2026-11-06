// Os comandos de formatação e parágrafo (T5555, E1) sobre um EditorState de verdade, sem DOM.

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";

import {
  clearInline, insertLink, lineParts, mapLines, setHeading, stripInline, toggleInline, toggleList, toggleTask,
} from "./format.ts";
import { FORMAT_KEYS } from "./index.ts";

/** O documento com `[` e `]` marcando a seleção (ou `|` o cursor). */
function state(marked: string): EditorState {
  const cursor = marked.indexOf("|");
  if (cursor >= 0) return EditorState.create({ doc: marked.replace("|", ""), selection: EditorSelection.cursor(cursor) });
  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;
  return EditorState.create({ doc: marked.replace("[", "").replace("]", ""), selection: EditorSelection.range(from, to) });
}

/** Aplica e devolve o documento com a seleção marcada do mesmo jeito. */
function after(s: EditorState, spec: TransactionSpec | null): string {
  if (!spec) return "(nada)";
  const next = s.update(spec).state;
  const { from, to } = next.selection.main;
  const doc = next.doc.toString();
  return from === to ? doc.slice(0, from) + "|" + doc.slice(from) : doc.slice(0, from) + "[" + doc.slice(from, to) + "]" + doc.slice(to);
}

const apply = (marked: string, make: (s: EditorState) => TransactionSpec | null) => after(state(marked), make(state(marked)));

describe("em linha: negrito, itálico, tachado, realce, código e comentário", () => {
  test("põe e tira, e a seleção fica no texto", () => {
    expect(apply("a [texto] b", (s) => toggleInline(s, "strike"))).toBe("a ~~[texto]~~ b");
    expect(apply("a ~~[texto]~~ b", (s) => toggleInline(s, "strike"))).toBe("a [texto] b");
    expect(apply("a [texto] b", (s) => toggleInline(s, "highlight"))).toBe("a ==[texto]== b");
    expect(apply("a ==[texto]== b", (s) => toggleInline(s, "highlight"))).toBe("a [texto] b");
    expect(apply("a [x] b", (s) => toggleInline(s, "comment"))).toBe("a %%[x]%% b");
    expect(apply("a [x] b", (s) => toggleInline(s, "code"))).toBe("a `[x]` b");
    expect(apply("a **[x]** b", (s) => toggleInline(s, "bold"))).toBe("a [x] b");
    // O itálico dentro de um negrito não confunde os asteriscos.
    expect(apply("**[x]**", (s) => toggleInline(s, "italic"))).toBe("***[x]***");
  });

  test("sem seleção, abre o par com o cursor no meio", () => {
    expect(apply("a |b", (s) => toggleInline(s, "bold"))).toBe("a **|**b");
  });

  test("várias seleções de uma vez", () => {
    const s = EditorState.create({ doc: "um dois", selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 7)]), extensions: EditorState.allowMultipleSelections.of(true) });
    expect(s.update(toggleInline(s, "bold")).state.doc.toString()).toBe("**um** **dois**");
  });

  test("link (⌘K) só com seleção, com o cursor nos parênteses", () => {
    expect(apply("veja [o site] hoje", insertLink)).toBe("veja [o site](|) hoje");
    const key = FORMAT_KEYS.find((k) => k.key === "Mod-k")!;
    expect(key).toBeDefined();
  });

  test("limpar formatação tira toda marcação em linha da seleção, e só dela", () => {
    expect(stripInline("**a** *b* ~~c~~ ==d== `e` %%f%% __g__ _h_")).toBe("a b c d e f g h");
    expect(stripInline("2 * 3 * 4 e snake_case_nome")).toBe("2 * 3 * 4 e snake_case_nome");
    expect(apply("# Título [**forte** e ==realce==] fim", clearInline)).toBe("# Título [forte e realce] fim");
    expect(apply("sem |seleção", clearInline)).toBe("(nada)");
  });
});

describe("parágrafo: títulos, corpo, listas, tarefas e citação", () => {
  test("título 1 a 6, o mesmo de novo volta a corpo, e 0 é corpo", () => {
    expect(setHeading("Ideias", 1)).toBe("# Ideias");
    expect(setHeading("## Ideias", 4)).toBe("#### Ideias");
    expect(setHeading("### Ideias", 3)).toBe("Ideias");
    expect(setHeading("### Ideias", 0)).toBe("Ideias");
    expect(setHeading("- item", 2)).toBe("## item"); // título é bloco próprio: a lista sai
    expect(apply("um\nIdei|as\ntrês", (s) => mapLines(s, (ls) => ls.map((l) => setHeading(l, 2))))).toBe("um\n## Idei|as\ntrês");
  });

  test("lista, numerada e tarefas: alterna nas linhas da seleção, trocando o marcador", () => {
    expect(toggleList(["a", "", "b"], "bullet")).toEqual(["- a", "", "- b"]);
    expect(toggleList(["- a", "- b"], "bullet")).toEqual(["a", "b"]);
    expect(toggleList(["- a", "b", "* c"], "numbered")).toEqual(["1. a", "2. b", "3. c"]);
    expect(toggleList(["1. a", "2. b"], "numbered")).toEqual(["a", "b"]);
    expect(toggleList(["- a", "1. b"], "task")).toEqual(["- [ ] a", "- [ ] b"]);
    expect(toggleList(["- [x] a", "- [ ] b"], "task")).toEqual(["a", "b"]);
    expect(toggleList(["  - a"], "numbered")).toEqual(["  1. a"]); // o recuo fica
    expect(toggleList(["## Título"], "bullet")).toEqual(["- Título"]);
  });

  test("citação põe e tira o >, mantendo a lista de dentro", () => {
    expect(toggleList(["a", "- b"], "quote")).toEqual(["> a", "> - b"]);
    expect(toggleList(["> a", "> - b"], "quote")).toEqual(["a", "- b"]);
  });

  test("⌘L marca e desmarca a tarefa, ou faz uma", () => {
    expect(toggleTask("- [ ] pagar")).toBe("- [x] pagar");
    expect(toggleTask("- [x] pagar")).toBe("- [ ] pagar");
    expect(toggleTask("- pagar")).toBe("- [ ] pagar");
    expect(toggleTask("pagar")).toBe("- [ ] pagar");
    expect(toggleTask("> - [ ] pagar")).toBe("> - [x] pagar");
    expect(toggleTask("1. pagar")).toBe("1. [ ] pagar");
  });

  test("com seleção de várias linhas, todas mudam e ficam selecionadas", () => {
    expect(apply("[um\ndois]\ntrês", (s) => mapLines(s, (ls) => toggleList(ls, "numbered")))).toBe("[1. um\n2. dois]\ntrês");
  });

  test("as partes da linha", () => {
    expect(lineParts("  > - [ ] ## x")).toEqual({ indent: "  ", quote: "> ", list: "- [ ] ", heading: "## ", body: "x" });
  });
});

describe("os atalhos", () => {
  test("todos os comandos têm atalho, sem repetir", () => {
    const keys = FORMAT_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["Mod-b", "Mod-i", "Shift-Mod-x", "Shift-Mod-h", "Mod-e", "Mod-/", "Mod-k", "Mod-\\", "Mod-1", "Mod-6", "Mod-0", "Shift-Mod-7", "Shift-Mod-8", "Shift-Mod-9", "Shift-Mod-.", "Mod-l"]) {
      expect(keys).toContain(k);
    }
  });
});
