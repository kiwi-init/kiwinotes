// A célula editada no lugar (T19814, spec #19323): as funções puras do campo e o estado da tabela desenhada.
import { describe, expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { tableActionCommand } from "./index.ts";
import { setTableCell, tablePreview } from "./livePreview.ts";
import { cellDisplay, cellSource, moveCell, parseTable, setCell } from "./table.ts";

const raw = "| Nome | Valor |\n| :--- | ---: |\n| Bia | 10 |\n| Céu \\| mar | 30 |";

describe("o campo da célula", () => {
  test("mostra o pipe sem a barra e o escapa de volta", () => {
    expect(cellDisplay("Céu \\| mar")).toBe("Céu | mar");
    expect(cellSource(" Sol | lua ")).toBe("Sol \\| lua");
    expect(cellSource("já \\| escapado")).toBe("já \\| escapado");
    expect(cellSource("duas\nlinhas")).toBe("duas linhas");
  });
  test("grava só a célula e alinha a tabela", () => {
    const next = setCell(raw, 2, 0, "Beatriz | B")!;
    expect(parseTable(next)).toEqual({ header: ["Nome", "Valor"], align: ["left", "right"], rows: [["Beatriz \\| B", "10"], ["Céu \\| mar", "30"]] });
    expect(new Set(next.split("\n").map((l) => l.length)).size).toBe(1);
    expect(parseTable(setCell(raw, 0, 1, "Preço")!)!.header).toEqual(["Nome", "Preço"]);
    expect(setCell(raw, 9, 0, "x")).toBeNull();
    expect(setCell("não é tabela", 0, 0, "x")).toBeNull();
  });
  test("Tab, ⇧Tab e Enter andam de célula; passar da última abre uma linha", () => {
    expect(moveCell(raw, 0, 1, "next")).toEqual({ text: raw, row: 2, col: 0 });
    expect(moveCell(raw, 2, 0, "prev")).toEqual({ text: raw, row: 0, col: 1 });
    expect(moveCell(raw, 0, 0, "prev")).toEqual({ text: raw, row: 0, col: 0 });
    expect(moveCell(raw, 0, 1, "down")).toEqual({ text: raw, row: 2, col: 1 });
    const added = moveCell(raw, 3, 1, "next")!;
    expect(added).toMatchObject({ row: 4, col: 0 });
    expect(parseTable(added.text)!.rows.at(-1)).toEqual(["", ""]);
    expect(moveCell(raw, 3, 0, "down")).toMatchObject({ row: 4, col: 0 });
  });
});

const doc = `Antes\n\n${raw}\n\nDepois`;
const from = doc.indexOf("| Nome");
const state = (anchor: number) => {
  const s = EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), tablePreview] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
};
const widgets = (s: EditorState) => {
  const out: number[] = [];
  s.field(tablePreview).deco.between(0, s.doc.length, (f) => { out.push(f); });
  return out;
};

describe("a tabela desenhada", () => {
  test("o cursor fora deixa a tabela desenhada, e dentro dela (o Markdown cru) a desfaz", () => {
    expect(widgets(state(0))).toEqual([from]);
    expect(widgets(state(doc.indexOf("Bia")))).toEqual([]);
  });
  test("a célula aberta não move o cursor, e some quando a nota muda por fora", () => {
    const s = state(0);
    const open = s.update({ effects: setTableCell.of({ from, row: 2, col: 0 }) }).state;
    expect(open.field(tablePreview).cell).toEqual({ from, row: 2, col: 0 });
    expect(open.selection.main.head).toBe(0);
    expect(widgets(open)).toEqual([from]);
    expect(open.update({ changes: { from: 0, insert: "x" } }).state.field(tablePreview).cell).toBeNull();
  });
  test("a ação do menu numa célula desenhada não põe o cursor na tabela", () => {
    let s = state(0);
    const view = { get state() { return s; }, dispatch: (spec: Parameters<EditorState["update"]>[0]) => { s = s.update(spec).state; } };
    expect(tableActionCommand("row.duplicate")(view as unknown as EditorView, doc.indexOf("Bia"))).toBe(true);
    expect(parseTable(s.sliceDoc(from, s.doc.lineAt(s.doc.length - "Depois".length - 2).to))!.rows.map((r) => r[0])).toEqual(["Bia", "Bia", "Céu \\| mar"]);
    expect(s.selection.main.head).toBe(0);
  });
});
