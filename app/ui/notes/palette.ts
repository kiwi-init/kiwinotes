// A lógica da busca rápida (⌘K): o título casa na hora, sem ir ao engine; o texto vem do `notes.search`. Sem busca,
// as notas mais recentes. Por último, "Criar" quando nenhum título é exatamente o que foi digitado.

import { splitTagQuery } from "../../src/shared/tags.ts";
import type { NoteMeta, SearchHit } from "./types.ts";

export type PaletteItem =
  | { kind: "note"; path: string; title: string; detail: string; snippet?: string }
  | { kind: "create"; title: string }
  /** Um comando da janela (T2619: "Nova nota a partir de modelo…"). */
  | { kind: "command"; id: string; title: string };

/** Os comandos que o ⌘K oferece: aparecem sem busca, ou quando a busca bate com o nome (ou com `palavras`). */
export interface PaletteCommand {
  id: string;
  title: string;
  words?: string;
}

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

export function paletteItems(notes: NoteMeta[], query: string, textHits: SearchHit[], commands: PaletteCommand[] = []): PaletteItem[] {
  const q = query.trim();
  const folderOf = (path: string) => notes.find((n) => n.path === path)?.folder ?? "";
  const cmds = (all: boolean): PaletteItem[] =>
    commands
      .filter((c) => all || fold(`${c.title} ${c.words ?? ""}`).includes(fold(q)))
      .map((c) => ({ kind: "command", id: c.id, title: c.title }));
  if (!q) {
    return [
      ...[...notes]
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
        .slice(0, RECENT)
        .map((n): PaletteItem => ({ kind: "note", path: n.path, title: n.title, detail: n.folder })),
      ...cmds(true),
    ];
  }
  // `tag:x` ou `#x` (T2619): só o que o engine achou pelas tags; o título não casa com "tag:" e não há "Criar".
  if (splitTagQuery(q).tags.length) {
    return textHits.slice(0, MAX).map((h) => ({ kind: "note", path: h.path, title: h.title, detail: folderOf(h.path), snippet: h.snippet }));
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
  out.push(...cmds(false));
  if (!notes.some((n) => fold(n.title) === fold(q))) out.push({ kind: "create", title: q });
  return out;
}
