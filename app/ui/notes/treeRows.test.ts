// T7875: a árvore virtual. As linhas que aparecem (o que está numa pasta fechada não entra) e a janela que é desenhada.

import { describe, expect, test } from "bun:test";

import { treeRows, VIRTUAL_FROM, visibleRange } from "./Sidebar.tsx";
import type { TreeNode } from "./tree.ts";

const note = (path: string): TreeNode => ({ kind: "note", path, name: path.slice(path.lastIndexOf("/") + 1, -3) }) as TreeNode;
const folder = (path: string, children: TreeNode[]): TreeNode =>
  ({ kind: "folder", path, name: path.slice(path.lastIndexOf("/") + 1), children, count: children.length }) as TreeNode;

describe("treeRows (T7875)", () => {
  const tree = [folder("A", [note("A/1.md"), folder("A/B", [note("A/B/2.md")])]), note("3.md")];
  test("com as pastas fechadas, só as de cima", () => {
    expect(treeRows(tree, new Set()).map((r) => [r.node.path, r.depth])).toEqual([["A", 0], ["3.md", 0]]);
  });
  test("a pasta aberta traz as de dentro logo depois, com o recuo; a de dentro fechada esconde as dela", () => {
    expect(treeRows(tree, new Set(["A"])).map((r) => [r.node.path, r.depth])).toEqual([["A", 0], ["A/1.md", 1], ["A/B", 1], ["3.md", 0]]);
    expect(treeRows(tree, new Set(["A", "A/B"])).map((r) => r.node.path)).toEqual(["A", "A/1.md", "A/B", "A/B/2.md", "3.md"]);
  });
});

describe("visibleRange (T7875)", () => {
  test("até o limite, tudo: a árvore pequena fica como antes", () => {
    expect(visibleRange(VIRTUAL_FROM, 28, 0, 5000, 600)).toEqual([0, VIRTUAL_FROM]);
  });
  test("acima dele, a janela da rolagem com a margem, sem passar das pontas", () => {
    // 10 mil linhas de 28 px; a lista começa 200 px abaixo do topo do que rola; a tela tem 560 px.
    expect(visibleRange(10_000, 28, 200, 0, 560)).toEqual([0, 53]);
    const [first, last] = visibleRange(10_000, 28, 200, 200 + 28 * 5000, 560);
    expect(first).toBe(4960);
    expect(last).toBe(5060);
    expect(visibleRange(10_000, 28, 200, 200 + 28 * 10_000, 560)).toEqual([9960, 10_000]);
  });
});
