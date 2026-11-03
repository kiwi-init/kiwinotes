// A barra lateral: as pastas e as notas do vault em árvore (B v4: só pastas e notas, sem contador nem ícone).

import { folderOf } from "./links.ts";
import type { NoteMeta, VaultListing } from "./types.ts";

export interface FolderNode {
  kind: "folder";
  path: string;
  name: string;
  children: TreeNode[];
}

export interface NoteNode {
  kind: "note";
  path: string;
  name: string;
}

export type TreeNode = FolderNode | NoteNode;

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, "pt-BR", { numeric: true });

/** Pastas primeiro, depois as notas, cada grupo em ordem alfabética (números em ordem de número: "2" antes de "10"). */
export function buildTree({ folders, notes }: VaultListing): TreeNode[] {
  const root: FolderNode = { kind: "folder", path: "", name: "", children: [] };
  const index = new Map<string, FolderNode>([["", root]]);
  const folderNode = (path: string): FolderNode => {
    const found = index.get(path);
    if (found) return found;
    const node: FolderNode = { kind: "folder", path, name: path.slice(path.lastIndexOf("/") + 1), children: [] };
    index.set(path, node);
    folderNode(folderOf(path)).children.push(node);
    return node;
  };
  for (const f of folders) folderNode(f);
  for (const n of notes) folderNode(folderOf(n.path)).children.push({ kind: "note", path: n.path, name: n.title });
  const sort = (node: FolderNode) => {
    node.children.sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === "folder" ? -1 : 1));
    for (const c of node.children) if (c.kind === "folder") sort(c);
  };
  sort(root);
  return root.children;
}

/** As pastas que contêm o path, para abrir a árvore até a nota aberta. */
export function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let f = folderOf(path); f; f = folderOf(f)) out.unshift(f);
  return out;
}

/** "editada hoje", "editada ontem" ou "editada em 28 de out". */
export function editedLabel(meta: Pick<NoteMeta, "mtime">, now = new Date()): string {
  const d = new Date(meta.mtime);
  const day = (x: Date) => x.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(now)) return "editada hoje";
  if (day(d) === day(yesterday)) return "editada ontem";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `editada em ${d.toLocaleDateString("pt-BR", opts).replace(/\.$/, "")}`;
}
