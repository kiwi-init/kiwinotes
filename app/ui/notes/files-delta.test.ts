// A árvore e a lista dos arquivos pela diferença (spec #13384, T13408): o resultado é o mesmo da lista inteira, a
// tela pede só o que mudou, e um engine antigo (sem `filesVersion`) segue recebendo tudo.

import { describe, expect, test } from "bun:test";

import { engineNotes } from "./api.ts";
import { applyFilesDelta } from "./files-delta.ts";
import { buildTree, type SortBy, type TreeNode } from "./tree.ts";
import type { NoteMeta, VaultFile } from "./types.ts";

const note = (path: string, mtime = "2026-11-01T10:00:00.000Z"): NoteMeta =>
  ({ path, title: path.slice(path.lastIndexOf("/") + 1, -3), folder: "", mtime, ctime: mtime, tags: [], version: "v", size: 1 }) as unknown as NoteMeta;
const file = (path: string, mtime = "2026-11-01T10:00:00.000Z", size = 1): VaultFile => ({ path, size, mtime });

/** A árvore em texto: cada nó com o caminho, e as pastas com o contador. */
const flat = (nodes: TreeNode[], out: string[] = []): string[] => {
  for (const n of nodes) {
    out.push(n.kind === "folder" ? `${n.path} (${n.count})` : `${n.kind}:${n.path}`);
    if (n.kind === "folder") flat(n.children, out);
  }
  return out;
};

describe("a árvore pela diferença", () => {
  const folders = ["A", "A/sub", "B"];
  const notes = [note("A/Plano.md", "2026-11-03T00:00:00.000Z"), note("Inbox.md")];
  const base = [file("A/a10.pdf"), file("A/a2.pdf", "2026-11-02T00:00:00.000Z"), file("A/sub/x.png"), file("B/y.txt"), file("raiz.txt")];
  const delta = {
    set: [file("A/a3.pdf", "2026-11-05T00:00:00.000Z"), file("B/y.txt", "2026-11-06T00:00:00.000Z", 9), file("C/novo.md.bak")],
    removed: ["A/sub/x.png", "raiz.txt"],
  };

  for (const sortBy of ["name", "edited", "created"] as SortBy[]) {
    test(`a mesma árvore da lista inteira (ordem: ${sortBy})`, () => {
      // A árvore da lista de antes monta o índice que a diferença aproveita.
      buildTree({ folders, notes, files: base }, sortBy);
      const next = applyFilesDelta(base, delta);
      const whole = [...next].sort((a, b) => a.path.localeCompare(b.path));
      expect(flat(buildTree({ folders, notes, files: next }, sortBy))).toEqual(flat(buildTree({ folders, notes, files: whole }, sortBy)));
    });
  }

  test("o contador desce e sobe, e a pasta que fica sem arquivo some do índice", () => {
    buildTree({ folders, notes, files: base });
    const next = applyFilesDelta(base, delta);
    const tree = flat(buildTree({ folders, notes, files: next }));
    expect(tree).toContain("A (4)");
    expect(tree).toContain("A/sub (0)");
    expect(tree).toContain("C (1)");
    expect(tree).not.toContain("file:raiz.txt");
    // Os números em ordem de número: a2 antes de a3 antes de a10.
    expect(tree.filter((l) => l.startsWith("file:A/a"))).toEqual(["file:A/a2.pdf", "file:A/a3.pdf", "file:A/a10.pdf"]);
  });
});

describe("a lista dos arquivos no engineNotes", () => {
  /** Um engine de mentira: a versão e os arquivos de agora, e o que cada `notes.list` pediu. */
  function engine(o: { versioned: boolean }) {
    const state = { version: 1, files: [file("a.pdf"), file("b.png")], asked: [] as unknown[] };
    const invoke = async (cap: string, args?: unknown) => {
      if (cap !== "notes.list") return null;
      state.asked.push(args);
      const base = { folders: [], notes: [] };
      if (!o.versioned) return { ...base, files: state.files };
      const want = (args as { filesVersion?: string } | undefined)?.filesVersion;
      const v = `id.${state.version}`;
      if (want === v) return { ...base, filesVersion: v };
      if (want === `id.${state.version - 1}`) return { ...base, filesVersion: v, filesDelta: { set: [state.files.at(-1)!], removed: [] } };
      return { ...base, files: state.files, filesVersion: v };
    };
    return { state, api: engineNotes(invoke, () => () => {}, (c) => c === "notes.list") };
  }

  test("a 1ª vez, tudo; depois, a versão vai no pedido e a mesma lista volta", async () => {
    const { state, api } = engine({ versioned: true });
    const first = await api.list();
    expect(first.files?.map((f) => f.path)).toEqual(["a.pdf", "b.png"]);
    const again = await api.list();
    expect(again.files).toBe(first.files);
    expect(state.asked).toEqual([{}, { filesVersion: "id.1" }]);
  });

  test("um arquivo novo: só a diferença, e a lista nova a partir da de antes", async () => {
    const { state, api } = engine({ versioned: true });
    await api.list();
    state.files = [...state.files, file("c.txt")];
    state.version = 2;
    const next = await api.list();
    expect(next.files?.map((f) => f.path)).toEqual(["a.pdf", "b.png", "c.txt"]);
    expect("filesDelta" in next).toBe(false);
    expect(state.asked.at(-1)).toEqual({ filesVersion: "id.1" });
  });

  test("um engine antigo (sem versão): nunca manda o filesVersion, que ele recusaria", async () => {
    const { state, api } = engine({ versioned: false });
    await api.list();
    await api.list();
    expect(state.asked).toEqual([{}, {}]);
  });
});
