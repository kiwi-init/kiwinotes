// O cursor que anda numa nota grande (spec #13385): os blocos desenhados são remendados só onde o cursor estava e onde
// está (`patchRendered`), e o resultado é sempre o mesmo de refazer tudo (`buildRendered`). Sem DOM: só as decorações.

import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type SelectionRange, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";

import { wikiLinkSyntax } from "./index.ts";
import { editorFocused, focusChanged } from "./livePreview.ts";
import { buildRendered, renderedPreview } from "./renderedWidget.tsx";

const md = markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] });
const resolver = { status: () => "exists" as const };
const actions = {} as never;

const NOTE = [
  "# Plano",
  "",
  "Um parágrafo com **negrito**.",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "> [!note] Lembrete",
  "> texto",
  "",
  "- um",
  "- dois",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
  "",
  "Outro parágrafo com nota[^1].",
  "",
  "[^1]: Palavra",
  "    continua aqui na nota",
  "",
  "O último parágrafo.",
].join("\n");

/** As decorações como dá para comparar: o trecho e o tipo do widget. */
function shape(set: DecorationSet): string[] {
  const out: string[] = [];
  for (let c = set.iter(); c.value; c.next()) {
    const w = (c.value.spec as { widget?: { constructor: { name: string } } }).widget;
    out.push(`${c.from}-${c.to}:${w?.constructor.name ?? "?"}`);
  }
  return out;
}

describe("o cursor que anda remenda só os blocos dele (spec #13385)", () => {
  test("em cada posição, com ou sem seleção, o remendo é igual a refazer tudo", () => {
    const [field] = renderedPreview(resolver as never, actions) as [StateField<DecorationSet>];
    let state = EditorState.create({ doc: NOTE, selection: EditorSelection.cursor(0), extensions: [md, editorFocused, field] });
    state = state.update({ effects: focusChanged.of(true) }).state;
    // Passa por todas as linhas, para a frente e para trás, e por seleções que cruzam blocos.
    const lines = NOTE.split("\n").map((_, i) => state.doc.line(i + 1).from);
    const moves: (EditorSelection | SelectionRange)[] = [
      ...lines.map((p) => EditorSelection.cursor(p)),
      ...[...lines].reverse().map((p) => EditorSelection.cursor(Math.min(p + 1, NOTE.length))),
      EditorSelection.single(lines[2]!, lines[6]!),
      EditorSelection.single(lines[8]!, lines[16]!),
      EditorSelection.cursor(NOTE.length),
      EditorSelection.cursor(0),
    ];
    for (const sel of moves) {
      state = state.update({ selection: sel instanceof EditorSelection ? sel : EditorSelection.create([sel]) }).state;
      expect(shape(state.field(field))).toEqual(shape(buildRendered(state, resolver as never, actions)));
    }
  });

  test("o cursor fora do parágrafo desenha o parágrafo; dentro, ele fica cru", () => {
    const [field] = renderedPreview(resolver as never, actions) as [StateField<DecorationSet>];
    let state = EditorState.create({ doc: NOTE, selection: EditorSelection.cursor(0), extensions: [md, editorFocused, field] });
    state = state.update({ effects: focusChanged.of(true) }).state;
    const para = NOTE.indexOf("Um parágrafo");
    const has = () => shape(state.field(field)).some((d) => d.startsWith(`${para}-`));
    expect(has()).toBe(true);
    state = state.update({ selection: EditorSelection.cursor(para + 2) }).state;
    expect(has()).toBe(false);
    state = state.update({ selection: EditorSelection.cursor(NOTE.length) }).state;
    expect(has()).toBe(true);
  });

  // Spec #17690: numa lista, só o item do cursor fica cru. Andar de um item a outro muda os desenhos de cima e de baixo,
  // e o remendo refaz a lista inteira.
  test("andar entre os itens de uma lista: o remendo é igual a refazer tudo", () => {
    const doc = "Antes.\n\n- um\n- dois\n- três\n- quatro\n  - quatro e meio\n- cinco\n\n1. a\n2. b\n3. c\n\nDepois.";
    const [field] = renderedPreview(resolver as never, actions) as [StateField<DecorationSet>];
    let state = EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: [md, editorFocused, field] });
    state = state.update({ effects: focusChanged.of(true) }).state;
    const words = ["um", "três", "dois", "quatro e", "cinco", "um", "Antes", "b", "c", "a", "Depois", "cinco", "dois"];
    for (const w of words) {
      state = state.update({ selection: EditorSelection.cursor(doc.indexOf(w)) }).state;
      expect(shape(state.field(field))).toEqual(shape(buildRendered(state, resolver as never, actions)));
    }
    state = state.update({ selection: EditorSelection.single(doc.indexOf("dois"), doc.indexOf("três")) }).state;
    expect(shape(state.field(field))).toEqual(shape(buildRendered(state, resolver as never, actions)));
  });
});
