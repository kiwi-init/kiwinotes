// T2680: o diff por linha do "Versões…".

import { expect, test } from "bun:test";

import { collapse, diffStats, lineDiff, MAX_CELLS } from "./diff.ts";

test("linhas que entram, saem e ficam, na ordem", () => {
  const d = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne");
  expect(d).toEqual([
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "same", text: "c" },
    { kind: "same", text: "d" },
    { kind: "add", text: "e" },
  ]);
  expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
});

test("iguais e vazias", () => {
  expect(diffStats(lineDiff("x\ny", "x\ny"))).toEqual({ added: 0, removed: 0 });
  expect(lineDiff("", "novo")).toEqual([{ kind: "del", text: "" }, { kind: "add", text: "novo" }]);
});

test("muito grande: resume o meio como trocado, sem travar", () => {
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
  const s = diffStats(lineDiff(a, b));
  expect(s).toEqual({ added: n, removed: n });
});

test("collapse: as iguais longe de uma mudança viram um …", () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
  const after = before.replace("l10", "L10");
  const c = collapse(lineDiff(before, after), 1);
  expect(c[0]).toEqual({ kind: "gap", count: 9 });
  expect(c.filter((l) => l.kind === "del" || l.kind === "add").length).toBe(2);
  expect(c.at(-1)).toEqual({ kind: "gap", count: 8 });
});
