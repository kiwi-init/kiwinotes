// O título não repete (spec #12626, ponto 1): o H1 igual ao título some da vista e volta com a seleção na linha.

import { describe, expect, test } from "bun:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { editorFocused, focusChanged } from "./livePreview.ts";
import { hiddenTitle, sameTitle, titleCompartment, titleHeading, titleHeadingLines } from "./titleHeading.ts";

/** As linhas escondidas, de 1 em diante. */
function hidden(state: EditorState): number[] {
  const out: number[] = [];
  for (const deco of state.facet(EditorView.decorations)) {
    const set = typeof deco === "function" ? null : deco;
    set?.between(0, state.doc.length, (from, to) => {
      for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) out.push(n);
    });
  }
  return out;
}

function make(doc: string, title: string | null, cursor = doc.length, focused = true): EditorState {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [editorFocused, titleHeading(title)] });
  return state.update({ effects: focusChanged.of(focused) }).state;
}

describe("igual ao título", () => {
  test("a regra do nome do arquivo: NFC, trim e \\ / : viram -", () => {
    expect(sameTitle("Plano do trimestre", "Plano do trimestre")).toBe(true);
    expect(sameTitle("  Plano do trimestre  ", "Plano do trimestre")).toBe(true);
    expect(sameTitle("Reunião: plano", "Reunião- plano")).toBe(true);
    expect(sameTitle("A/B", "A-B")).toBe(true);
    // A mesma palavra, composta ou não.
    expect(sameTitle("Reunião", "Reunião")).toBe(true);
    // Sem mudar maiúsculas: outro título.
    expect(sameTitle("plano do trimestre", "Plano do trimestre")).toBe(false);
    expect(sameTitle("", "")).toBe(false);
  });

  test("o H1 é a primeira linha de texto, depois do frontmatter e das linhas em branco; o fecho ### também vale", () => {
    expect(titleHeadingLines(make("# Plano\n\nTexto.", "Plano"), "Plano")).toEqual({ first: 1, last: 2 });
    expect(titleHeadingLines(make("---\ntags: [a]\n---\n\n# Plano ##\nTexto.", "Plano"), "Plano")).toEqual({ first: 5, last: 5 });
    // Um H2, um H1 que não é o primeiro, ou outro texto: nada some.
    expect(titleHeadingLines(make("## Plano\n", "Plano"), "Plano")).toBeNull();
    expect(titleHeadingLines(make("Texto.\n\n# Plano\n", "Plano"), "Plano")).toBeNull();
    expect(titleHeadingLines(make("# Outro\n", "Plano"), "Plano")).toBeNull();
    expect(titleHeadingLines(make("# Plano\n", null), null)).toBeNull();
  });
});

describe("na vista", () => {
  const doc = "# Plano\n\nA migração termina em abril.\n";

  test("some com a linha em branco de depois, e o arquivo não muda", () => {
    const s = make(doc, "Plano");
    expect(hidden(s)).toEqual([1, 2]);
    expect(s.doc.toString()).toBe(doc);
  });

  test("volta quando a seleção toca a linha (⌘↑ leva o cursor ao começo, e ⌘A também)", () => {
    expect(hidden(make(doc, "Plano", 0))).toEqual([]);
    const all = make(doc, "Plano").update({ selection: EditorSelection.range(0, doc.length) }).state;
    expect(hidden(all)).toEqual([]);
    // O cursor sai da linha: some de novo.
    const away = make(doc, "Plano", 0).update({ selection: EditorSelection.cursor(doc.length) }).state;
    expect(hidden(away)).toEqual([1, 2]);
  });

  test("com o editor sem foco, a nota aberta mostra tudo como preview: o H1 fica escondido", () => {
    expect(hidden(make(doc, "Plano", 0, false))).toEqual([1, 2]);
  });

  test("renomeada pelo título, o H1 fica diferente e reaparece", () => {
    expect(hidden(make(doc, "Plano de abril"))).toEqual([]);
  });

  test("renomear com a nota aberta reconfigura o compartimento: o H1 volta, e o preview sabe o trecho escondido", () => {
    const s = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [editorFocused, titleCompartment.of(titleHeading("Plano"))] });
    expect(hiddenTitle(s)).toEqual({ from: 0, to: 8 });
    const renamed = s.update({ effects: titleCompartment.reconfigure(titleHeading("Plano de abril")) }).state;
    expect(hiddenTitle(renamed)).toBeNull();
    expect(hidden(renamed)).toEqual([]);
  });

  test("editar o H1 para outro texto o faz aparecer; voltar ao título o esconde", () => {
    const s = make(doc, "Plano");
    const changed = s.update({ changes: { from: 2, to: 7, insert: "Outro" }, selection: EditorSelection.cursor(s.doc.length) }).state;
    expect(hidden(changed)).toEqual([]);
  });
});
