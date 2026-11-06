// A árvore com todos os arquivos do cofre (T3370, spec #3272): os tipos, o nome sem a extensão, o contador e a busca.

import { expect, test } from "bun:test";

import { isDailyNote } from "./Sidebar.tsx";
import { buildTree, fileType, filterTree, splitExt, type FolderNode, type TreeNode } from "./tree.ts";
import type { NoteMeta, VaultListing } from "./types.ts";

const note = (path: string, title: string, mtime = "2026-11-01T10:00:00.000Z"): NoteMeta =>
  ({ path, title, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", mtime, ctime: mtime, tags: [], version: "v", size: 1 }) as unknown as NoteMeta;
const file = (path: string, mtime = "2026-11-01T10:00:00.000Z") => ({ path, size: 1, mtime });

const listing: VaultListing = {
  folders: ["Anexos", "Projetos"],
  notes: [note("Projetos/Plano.md", "Plano"), note("Inbox.md", "Inbox")],
  files: [file("Anexos/planta.png"), file("Projetos/quadro.canvas"), file("Projetos/Contrato.PDF"), file("LEIAME"), file("Projetos/.nada")],
};

const names = (nodes: TreeNode[]) => nodes.map((n) => `${n.kind}:${n.name}${n.kind === "file" && n.ext ? `.${n.ext}` : ""}`);

test("os arquivos entram nas pastas, junto das notas e depois das subpastas, com o tipo de cada um", () => {
  const tree = buildTree(listing);
  expect(names(tree)).toEqual(["folder:Anexos", "folder:Projetos", "note:Inbox", "file:LEIAME"]);
  const projetos = tree[1] as FolderNode;
  expect(names(projetos.children)).toEqual(["file:.nada", "file:Contrato.PDF", "note:Plano", "file:quadro.canvas"]);
  expect(projetos.count).toBe(4);
  expect((tree[0] as FolderNode).children).toEqual([{ kind: "file", path: "Anexos/planta.png", name: "planta", ext: "png", type: "image" }]);
  const pdf = projetos.children.find((n) => n.path === "Projetos/Contrato.PDF");
  expect(pdf).toMatchObject({ kind: "file", type: "pdf", ext: "PDF" });
});

test("um engine antigo (sem `files`) dá a árvore de antes", () => {
  expect(names(buildTree({ folders: listing.folders, notes: listing.notes }))).toEqual(["folder:Anexos", "folder:Projetos", "note:Inbox"]);
});

test("pela edição, o arquivo mais recente vem antes da nota", () => {
  const tree = buildTree(
    { folders: [], notes: [note("a.md", "a", "2026-11-01T10:00:00.000Z")], files: [file("b.pdf", "2026-11-03T10:00:00.000Z")] },
    "edited",
  );
  expect(names(tree)).toEqual(["file:b.pdf", "note:a"]);
});

test("a busca da árvore acha arquivo pelo nome e pela extensão", () => {
  const tree = buildTree(listing);
  expect(names((filterTree(tree, "planta").tree[0] as FolderNode).children)).toEqual(["file:planta.png"]);
  const pdfs = filterTree(tree, "pdf");
  expect(names((pdfs.tree[0] as FolderNode).children)).toEqual(["file:Contrato.PDF"]);
  expect([...pdfs.open]).toEqual(["Projetos"]);
});

test("splitExt e fileType", () => {
  expect(splitExt("foto.final.jpeg")).toEqual({ name: "foto.final", ext: "jpeg" });
  expect(splitExt(".gitignore")).toEqual({ name: ".gitignore", ext: "" });
  expect(splitExt("LEIAME")).toEqual({ name: "LEIAME", ext: "" });
  expect(["a.HEIC", "a.pdf", "a.canvas", "a.m4a", "a.mov", "a.zip", "a"].map(fileType)).toEqual(["image", "pdf", "canvas", "audio", "video", "other", "other"]);
});

test("nota do dia: AAAA-MM-DD.md na pasta das notas do dia", () => {
  expect(isDailyNote("Diário/2026-11-04.md", "Diário")).toBe(true);
  expect(isDailyNote("2026-11-04.md", "")).toBe(true);
  expect(isDailyNote("Outra/2026-11-04.md", "Diário")).toBe(false);
  expect(isDailyNote("Diário/Reunião.md", "Diário")).toBe(false);
  expect(isDailyNote("Diário/2026-11-04.md", undefined)).toBe(false);
});
test("L16 engine body hits keep file and folder navigation in the tree", async () => {
  const { filterTreeToPaths } = await import('./tree.ts');
  const tree = buildTree(listing);
  expect(names(filterTreeToPaths(tree, new Set(['Inbox.md']), 'pdf').tree)).toEqual(['folder:Projetos','note:Inbox']);
  expect(names(filterTreeToPaths(tree, new Set(), 'projetos').tree)).toEqual(['folder:Projetos']);
  expect(names(filterTreeToPaths(tree, new Set(['Inbox.md'])).tree)).toEqual(['note:Inbox']);
});
