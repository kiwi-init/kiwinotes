// T6385: o parágrafo do modo foco e as extensões que ligam e desligam sem recriar o editor.
import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";

import { focusCompartment, focusExtension, paragraphAt, typewriterCompartment, typewriterExtension } from "./focus.ts";

const doc = "# Título\n\nprimeira linha\nsegunda linha\n\noutro parágrafo\n";
const state = EditorState.create({ doc });
const at = (text: string) => doc.indexOf(text) + 2;

describe("o parágrafo do cursor", () => {
  test("as linhas não vazias juntas em volta do cursor", () => {
    expect(paragraphAt(state, at("primeira"))).toEqual({ from: 3, to: 4 });
    expect(paragraphAt(state, at("segunda"))).toEqual({ from: 3, to: 4 });
    expect(paragraphAt(state, at("outro"))).toEqual({ from: 6, to: 6 });
    expect(paragraphAt(state, 0)).toEqual({ from: 1, to: 1 });
  });

  test("numa linha vazia, só ela; no fim do documento, sem passar do fim", () => {
    expect(paragraphAt(state, doc.indexOf("\n\n") + 1)).toEqual({ from: 2, to: 2 });
    expect(paragraphAt(state, doc.length)).toEqual({ from: 7, to: 7 });
  });
});

test("desligado não põe nada; ligar e desligar troca só o compartimento", () => {
  expect(focusExtension(false)).toEqual([]);
  expect(typewriterExtension(false)).toEqual([]);
  const s = EditorState.create({ doc, extensions: [focusCompartment.of(focusExtension(false)), typewriterCompartment.of(typewriterExtension(false))] });
  const on = s.update({ effects: [focusCompartment.reconfigure(focusExtension(true)), typewriterCompartment.reconfigure(typewriterExtension(true))] }).state;
  expect(focusCompartment.get(on)).not.toEqual([]);
  expect(typewriterCompartment.get(on)).not.toEqual([]);
  const off = on.update({ effects: [focusCompartment.reconfigure(focusExtension(false))] }).state;
  expect(focusCompartment.get(off)).toEqual([]);
  expect(off.doc.toString()).toBe(doc);
});
