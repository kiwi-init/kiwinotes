// O que a barra das Notas lembra entre aberturas do app (T7390, spec #7383): as seções recolhidas e as pastas abertas
// da árvore. Fica no navegador da janela, como a ordem da árvore e o painel de propriedades: é uma conveniência de quem
// vê, não um dado do cofre. Sem armazenamento (janela privada, teste), a barra só abre como no padrão: tudo aberto.

import type { TreeNode } from "./tree.ts";

/** As seções da barra que recolhem pelo título. */
export const SECTIONS = ["pinned", "saved", "recent", "notes", "tags"] as const;
export type SectionId = (typeof SECTIONS)[number];

const SECTIONS_KEY = "kiwi.notes.sections";
/** As pastas abertas são de um cofre: a chave leva o caminho dele, para outro cofre não abrir pastas de mesmo nome. */
const foldersKey = (vault: string) => `kiwi.notes.openFolders:${vault}`;

type Store = Pick<Storage, "getItem" | "setItem">;
const browser = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

function readList(key: string, store: Store | null): string[] {
  try {
    const value: unknown = JSON.parse(store?.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: Iterable<string>, store: Store | null): void {
  try {
    store?.setItem(key, JSON.stringify([...list]));
  } catch {
    // Sem armazenamento: a barra só não lembra na próxima vez.
  }
}

export const loadCollapsed = (store = browser()): Set<SectionId> =>
  new Set(readList(SECTIONS_KEY, store).filter((s): s is SectionId => (SECTIONS as readonly string[]).includes(s)));

export const saveCollapsed = (collapsed: ReadonlySet<SectionId>, store = browser()): void =>
  writeList(SECTIONS_KEY, SECTIONS.filter((s) => collapsed.has(s)), store);

export const loadOpenFolders = (vault: string, store = browser()): Set<string> => new Set(readList(foldersKey(vault), store));

/**
 * Grava as pastas abertas. Com `known` (as pastas que o cofre tem agora), as apagadas saem da lista: ela não cresce
 * para sempre. Só escreve quando a lista muda.
 */
export function saveOpenFolders(vault: string, open: ReadonlySet<string>, known?: ReadonlySet<string>, store = browser()): void {
  const list = JSON.stringify([...open].filter((f) => !known || known.has(f)).sort());
  try {
    if (store && store.getItem(foldersKey(vault)) !== list) store.setItem(foldersKey(vault), list);
  } catch {
    // Sem armazenamento: a barra só não lembra na próxima vez.
  }
}

/** Todas as pastas da árvore, também as de dentro: o que o Expandir tudo abre. */
export function allFolders(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "folder" ? [n.path, ...allFolders(n.children)] : []));
}

/** Liga ou desliga um item de um conjunto, sem mexer no de antes. */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}
