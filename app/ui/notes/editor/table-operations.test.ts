import { describe, expect, test } from "bun:test";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo, redo } from "@codemirror/commands";
import { tableActionCommand, tableAt } from "./index.ts";
import { TABLE_ACTIONS, cellAt, formatTable, parseTable, tableAction, type TableAction, type TableEdit } from "./table.ts";

const raw = "| Nome | Valor |\n| :--- | ---: |\n| Bia | 10 |\n| Ana | 2 |\n| Céu \\| mar | 30 |";
const at = (text: string, value: string) => text.indexOf(value);
const edit = (action: TableAction, value = "Bia", text = raw) => tableAction(text, at(text, value), action)!;
const parsed = (result: TableEdit) => parseTable(result.text)!;
const selected = (result: TableEdit) => result.text.slice(result.anchor, result.head);

describe("table operations preserve data and a usable cursor", () => {
  test("insert above/below a data row or the header without replacing it", () => {
    const above = edit("row.insertAbove"), below = edit("row.insertBelow");
    expect(parsed(above).rows).toEqual([["", ""], ["Bia", "10"], ["Ana", "2"], ["Céu \\| mar", "30"]]);
    expect(parsed(below).rows[1]).toEqual(["", ""]);
    expect(cellAt(above.text, above.anchor)).toMatchObject({ row: 2, col: 0 });
    for (const action of ["row.insertAbove", "row.insertBelow"] as const) {
      const result = edit(action, "Nome");
      expect(parsed(result).header).toEqual(["Nome", "Valor"]); expect(parsed(result).rows[0]).toEqual(["", ""]);
    }
  });
  test("move keeps whole rows and follows the selected cell", () => {
    const moved = edit("row.moveDown", "10");
    expect(parsed(moved).rows).toEqual([["Ana", "2"], ["Bia", "10"], ["Céu \\| mar", "30"]]);
    expect(selected(moved)).toBe("10"); expect(cellAt(moved.text, moved.anchor)).toEqual({ row: 3, col: 1 });
    expect(tableAction(moved.text, moved.anchor, "row.moveUp")!.text).toBe(formatTable(parseTable(raw)!));
    expect(edit("row.moveUp")).toBeNull(); expect(edit("row.moveDown", "30")).toBeNull();
    expect(edit("row.moveDown", "Nome")).toBeNull();
  });
  test("duplicate copies a data row or inserts a copy of the header as data", () => {
    expect(parsed(edit("row.duplicate")).rows.slice(0, 2)).toEqual([["Bia", "10"], ["Bia", "10"]]);
    expect(parsed(edit("row.duplicate", "Nome")).rows[0]).toEqual(["Nome", "Valor"]);
    expect(selected(edit("row.duplicate", "30"))).toBe("30");
  });
  test("deleting a row retains the header, including when it is the last data row", () => {
    expect(parsed(edit("row.delete")).rows[0]).toEqual(["Ana", "2"]);
    expect(edit("row.delete", "Nome")).toBeNull();
    const only = "| Coluna |\n| --- |\n| última |";
    const result = edit("row.delete", "última", only);
    expect(parsed(result).rows).toEqual([]); expect(selected(result)).toBe("Coluna");
    expect(parsed(tableAction(result.text, result.anchor, "row.insertBelow")!).rows).toEqual([[""]]);
  });
  test("insert columns pads every row and selects the new column", () => {
    const left = edit("column.insertLeft", "10"), right = edit("column.insertRight", "10");
    expect(parsed(left).header).toEqual(["Nome", "", "Valor"]);
    expect(parsed(left).rows[2]).toEqual(["Céu \\| mar", "", "30"]);
    expect(parsed(left).align).toEqual(["left", null, "right"]);
    expect(cellAt(right.text, right.anchor)).toEqual({ row: 2, col: 2 });
  });
  test("moving columns moves the header, alignment and all cells together", () => {
    const result = edit("column.moveLeft", "10");
    expect(parsed(result)).toEqual({ header: ["Valor", "Nome"], align: ["right", "left"], rows: [["10", "Bia"], ["2", "Ana"], ["30", "Céu \\| mar"]] });
    expect(selected(result)).toBe("10");
    expect(tableAction(result.text, result.anchor, "column.moveRight")!.text).toBe(formatTable(parseTable(raw)!));
    expect(edit("column.moveLeft")).toBeNull(); expect(edit("column.moveRight", "10")).toBeNull();
  });
  test("duplicate and delete columns preserve alignment and protect the final column", () => {
    const duplicate = edit("column.duplicate", "10");
    expect(parsed(duplicate).rows[0]).toEqual(["Bia", "10", "10"]); expect(parsed(duplicate).align).toEqual(["left", "right", "right"]);
    expect(tableAction(duplicate.text, duplicate.anchor, "column.delete")!.text).toBe(formatTable(parseTable(raw)!));
    const result = edit("column.delete", "10");
    expect(parsed(result).header).toEqual(["Nome"]); expect(selected(result)).toBe("Bia");
    expect(tableAction(result.text, result.anchor, "column.delete")).toBeNull();
  });
  test("alignment changes one whole column and keeps the selected value", () => {
    for (const [action, align] of [["align.left", "left"], ["align.center", "center"], ["align.right", "right"], ["align.default", null]] as const) {
      const result = edit(action, "10"); expect(parsed(result).align).toEqual(["left", align]); expect(selected(result)).toBe("10");
    }
  });
  test("sort is natural, stable for case/accent ties and leaves empty cells last in both directions", () => {
    const text = "| Nome | ID |\n| --- | --- |\n| bia | 1 |\n| Bia | 2 |\n| Ana | 3 |\n| | 4 |";
    const asc = edit("sort.asc", "bia", text), desc = edit("sort.desc", "bia", text);
    expect(parsed(asc).rows.map((r) => r[1])).toEqual(["3", "1", "2", "4"]);
    expect(parsed(desc).rows.map((r) => r[1])).toEqual(["1", "2", "3", "4"]);
    expect(selected(asc)).toBe("bia"); expect(cellAt(asc.text, asc.anchor).row).toBe(3);
    expect(parsed(edit("sort.asc", "10")).rows.map((r) => r[1])).toEqual(["2", "10", "30"]);
    expect(parsed(edit("sort.desc", "Nome")).header).toEqual(["Nome", "Valor"]);
  });
  test("all available actions keep escaped pipes, rectangular rows and an in-bounds cell selection", () => {
    for (const definition of TABLE_ACTIONS) {
      const result = edit(definition.id, "2");
      if (!result) continue;
      const table = parsed(result);
      expect(table.rows.every((row) => row.length === table.header.length)).toBe(true);
      expect(table.align).toHaveLength(table.header.length);
      expect(result.anchor).toBeGreaterThanOrEqual(0); expect(result.head).toBeLessThanOrEqual(result.text.length);
      expect(formatTable(table)).toBe(result.text);
    }
    expect(tableAction("not a table", 0, "row.insertBelow")).toBeNull();
  });
});

function target(doc = raw, position = raw.indexOf("Bia")) {
  let state = EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), history({ newGroupDelay: 10_000 })] });
  return { get state() { return state; }, dispatch(spec: TransactionSpec | Transaction) { state = spec instanceof Transaction ? spec.state : state.update(spec).state; } };
}
test("commands target only this table, including the start boundary, never fenced code", () => {
  const doc = "Antes\n\n" + raw + "\n\nDepois";
  const view = target(doc, doc.indexOf("Bia"));
  expect(tableActionCommand("row.duplicate")(view as EditorView)).toBe(true);
  expect(view.state.doc.toString()).toStartWith("Antes\n\n"); expect(view.state.doc.toString()).toEndWith("\n\nDepois");
  const start = target(raw, 0); expect(tableAt(start.state)).not.toBeNull();
  const code = "```md\n" + raw + "\n```";
  const fenced = target(code, code.indexOf("Bia")); expect(tableActionCommand("row.duplicate")(fenced as EditorView)).toBe(false); expect(fenced.state.doc.toString()).toBe(code);
});
test("each structural command is its own undo/redo step even when invoked quickly", () => {
  const view = target();
  tableActionCommand("row.duplicate")(view as EditorView); const first = view.state.doc.toString();
  tableActionCommand("column.duplicate")(view as EditorView); const second = view.state.doc.toString();
  expect(first).not.toBe(second); expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(first);
  expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(raw);
  expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe(first);
});

test("an unavailable table shortcut is consumed so it cannot fall through to text deletion", () => {
  const header = target(raw, raw.indexOf("Nome"));
  expect(tableActionCommand("row.delete")(header as EditorView)).toBe(true);
  expect(header.state.doc.toString()).toBe(raw);
  const single = "| Coluna |\n| --- |\n| dado |";
  const lastColumn = target(single, single.indexOf("dado"));
  expect(tableActionCommand("column.delete")(lastColumn as EditorView)).toBe(true);
  expect(lastColumn.state.doc.toString()).toBe(single);
});
