// A lógica da busca rápida (⌘K): o título casa na hora, sem ir ao engine; o texto vem do `notes.search`. Sem busca,
// as notas mais recentes. Por último, "Criar" quando nenhum título é exatamente o que foi digitado.

import type { NoteMeta, SearchHit } from "./types.ts";

export type PaletteItem =
  | { kind: "note"; path: string; title: string; detail: string; snippet?: string }
  | { kind: "create"; title: string };

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

const RECENT = 8;
const MAX = 12;

/** Título que começa com a busca primeiro, depois o que tem todas as palavras; empate pelo mais recente. */
export function titleMatches(notes: NoteMeta[], query: string): NoteMeta[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  return notes
    .map((n) => {
      const t = fold(n.title);
      const rank = t === q ? 0 : t.startsWith(q) ? 1 : words.every((w) => t.includes(w)) ? 2 : -1;
      return { n, rank };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.n.mtime.localeCompare(a.n.mtime))
    .map((x) => x.n);
}

export function paletteItems(notes: NoteMeta[], query: string, textHits: SearchHit[]): PaletteItem[] {
  const q = query.trim();
  const folderOf = (path: string) => notes.find((n) => n.path === path)?.folder ?? "";
  if (!q) {
    return [...notes]
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
      .slice(0, RECENT)
      .map((n) => ({ kind: "note", path: n.path, title: n.title, detail: n.folder }));
  }
  const byTitle = titleMatches(notes, q);
  const seen = new Set(byTitle.map((n) => n.path));
  const items: PaletteItem[] = byTitle.map((n) => ({ kind: "note", path: n.path, title: n.title, detail: n.folder }));
  for (const h of textHits) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    items.push({ kind: "note", path: h.path, title: h.title, detail: folderOf(h.path), snippet: h.snippet });
  }
  const out = items.slice(0, MAX);
  if (!notes.some((n) => fold(n.title) === fold(q))) out.push({ kind: "create", title: q });
  return out;
}
