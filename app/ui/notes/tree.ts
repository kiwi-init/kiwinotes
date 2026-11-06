// A barra lateral: as pastas, as notas e os outros arquivos do vault em árvore (T3370: cada tipo com o seu ícone).

import { subsequence } from "../../src/shared/fuzzy.ts";
import { folderOf } from "./links.ts";
import { extOf } from "../../src/shared/attachments.ts";
import type { NoteMeta, VaultListing } from "./types.ts";

export interface FolderNode {
  kind: "folder";
  path: string;
  name: string;
  children: TreeNode[];
  /** Quantos itens (notas e arquivos) há dentro, contando as subpastas (o contador discreto, T2469). */
  count: number;
}

export interface NoteNode {
  kind: "note";
  path: string;
  name: string;
}

/** Como ordenar as notas de cada pasta (T2469). As pastas ficam sempre antes, por nome. */
export type SortBy = "name" | "edited" | "created";

/** O tipo de um arquivo que não é nota, para o ícone (T3370). */
export type FileType = "image" | "pdf" | "canvas" | "audio" | "video" | "other";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "avif", "bmp", "tif", "tiff", "ico"]);
const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "ogg", "opus", "caf"]);
const VIDEO = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi"]);

export function fileType(name: string): FileType {
  const ext = extOf(name);
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "canvas") return "canvas";
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  return "other";
}

/** Um arquivo do vault que não é nota (T3370): abre no app padrão do Mac. `name` é sem a extensão, como o da nota. */
export interface FileNode {
  kind: "file";
  path: string;
  name: string;
  /** Sem o ponto, como está no disco (`PDF`, `png`); "" para um arquivo sem extensão. */
  ext: string;
  type: FileType;
}

export type TreeNode = FolderNode | NoteNode | FileNode;

/** O nome de um arquivo sem a extensão, e a extensão (`.gitignore` não tem nome: fica inteiro). */
export function splitExt(base: string): { name: string; ext: string } {
  const dot = base.lastIndexOf(".");
  return dot > 0 ? { name: base.slice(0, dot), ext: base.slice(dot + 1) } : { name: base, ext: "" };
}

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, "pt-BR", { numeric: true });

/**
 * Pastas primeiro (por nome), depois as notas: por nome (números em ordem de número: "2" antes de "10"), ou pela edição
 * ou criação mais recente primeiro. Uma nota sem `ctime` (um engine antigo) ordena pela edição.
 */
export function buildTree({ folders, notes, files = [] }: VaultListing, sortBy: SortBy = "name"): TreeNode[] {
  const root: FolderNode = { kind: "folder", path: "", name: "", children: [], count: 0 };
  const index = new Map<string, FolderNode>([["", root]]);
  const folderNode = (path: string): FolderNode => {
    const found = index.get(path);
    if (found) return found;
    const node: FolderNode = { kind: "folder", path, name: path.slice(path.lastIndexOf("/") + 1), children: [], count: 0 };
    index.set(path, node);
    folderNode(folderOf(path)).children.push(node);
    return node;
  };
  for (const f of folders) folderNode(f);
  const meta = new Map(notes.map((n) => [n.path, n]));
  for (const n of notes) {
    folderNode(folderOf(n.path)).children.push({ kind: "note", path: n.path, name: n.title });
    for (let f = folderOf(n.path); f; f = folderOf(f)) index.get(f)!.count++;
  }
  // Os outros arquivos (T3370) entram junto com as notas, na mesma ordem: um anexo fica perto da nota dele.
  const fileTimes = new Map(files.map((f) => [f.path, f.mtime]));
  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf("/") + 1);
    folderNode(folderOf(f.path)).children.push({ kind: "file", path: f.path, ...splitExt(base), type: fileType(base) });
    for (let d = folderOf(f.path); d; d = folderOf(d)) index.get(d)!.count++;
  }
  const when = (n: TreeNode) => {
    if (n.kind === "file") return fileTimes.get(n.path) ?? "";
    const m = meta.get(n.path);
    return (sortBy === "created" ? (m?.ctime ?? m?.mtime) : m?.mtime) ?? "";
  };
  const order = (a: TreeNode, b: TreeNode) => {
    if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
    if (a.kind === "folder" || sortBy === "name") return byName(a, b);
    return when(b).localeCompare(when(a)) || byName(a, b);
  };
  const sort = (node: FolderNode) => {
    node.children.sort(order);
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

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

/**
 * A busca na árvore (T2469): só as notas cujo título tem todas as palavras (sem acento nem maiúscula), ou as letras da
 * busca em ordem (subsequência, T2966), com as pastas até elas; e as pastas cujo nome tem as palavras, inteiras (a
 * pasta não casa por subsequência: abriria pastas inteiras por acaso). Devolve a árvore filtrada e as pastas a abrir.
 */
export function filterTree(tree: TreeNode[], query: string): { tree: TreeNode[]; open: Set<string> } {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const open = new Set<string>();
  if (!words.length) return { tree, open };
  const hit = (name: string) => {
    const f = fold(name);
    return words.every((w) => f.includes(w));
  };
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((n): TreeNode[] => {
      if (n.kind === "note") return hit(n.name) || subsequence(query, n.name) ? [n] : [];
      // Um arquivo casa pelo nome com a extensão (`pdf` acha os PDFs).
      if (n.kind === "file") return hit(n.ext ? `${n.name}.${n.ext}` : n.name) || subsequence(query, n.name) ? [n] : [];
      if (hit(n.name)) return [n];
      const children = walk(n.children);
      if (!children.length) return [];
      open.add(n.path);
      return [{ ...n, children }];
    });
  return { tree: walk(tree), open };
}

/** As notas editadas por último, para o grupo "Recentes" (sem guardar nada: vem do `mtime`). */
export function recentNotes(notes: NoteMeta[], limit = 5): NoteMeta[] {
  return [...notes].sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
}

/**
 * A busca da árvore com filtros (T2660: `tag:`, `path:`, "frase", `-`): o engine diz quais notas passam, e a árvore
 * mostra só elas, com as pastas até elas abertas.
 */
export function filterTreeToPaths(tree: TreeNode[], paths: ReadonlySet<string>, fileQuery?: string): { tree: TreeNode[]; open: Set<string> } {
  const open = new Set<string>();
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((n): TreeNode[] => {
      if (n.kind === "note" && fileQuery) {
        const words = fold(fileQuery).split(/\s+/).filter(Boolean);
        if (words.every(w => fold(n.name).includes(w)) || subsequence(fileQuery, n.name)) return [n];
      }
      if (n.kind === "file" && fileQuery) {
        const name = n.ext ? `${n.name}.${n.ext}` : n.name;
        if (fold(fileQuery).split(/\s+/).every(w => fold(name).includes(w)) || subsequence(fileQuery, name)) return [n];
      }
      if (n.kind !== "folder") return paths.has(n.path) ? [n] : [];
      if (fileQuery && fold(fileQuery).split(/\s+/).every(w => fold(n.name).includes(w))) return [n];
      const children = walk(n.children);
      if (!children.length) return [];
      open.add(n.path);
      return [{ ...n, children }];
    });
  return { tree: walk(tree), open };
}
