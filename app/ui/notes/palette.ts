// A lógica da busca rápida (⌘K): o título casa na hora, sem ir ao engine; o texto vem do `notes.search`. Sem busca,
// as notas mais recentes. Por último, "Criar" quando nenhum título é exatamente o que foi digitado.

import { lexicalMatch, WORD } from "../../src/shared/lexical.ts";
import { highlightRanges, type Range, subsequence, subsequenceScore } from "../../src/shared/fuzzy.ts";
import { hasFilters, parseQuery } from "../../src/shared/query.ts";
import type { NoteMeta, SearchHit } from "./types.ts";

export type PaletteItem =
  /** `semantic` (T6013): achada só pelo sentido, sem nenhuma palavra da busca. */
  | { kind: "note"; path: string; title: string; detail: string; snippet?: string; semantic?: boolean }
  | { kind: "create"; title: string }
  /** Um comando da janela (T2619: "Nova nota a partir de modelo…"). */
  | { kind: "command"; id: string; title: string };

/** Os comandos que o ⌘K oferece: aparecem sem busca, ou quando a busca bate com o nome (ou com `palavras`). */
export interface PaletteCommand {
  id: string;
  title: string;
  words?: string;
  /** Aparece com qualquer busca, no fim (T2660: "Salvar esta busca"), e nunca sem busca. */
  withQuery?: boolean;
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

/** Já existe uma nota com este título (sem acento nem maiúscula)? A busca dobrada uma vez só (T8110). */
const hasTitle = (notes: NoteMeta[], q: string) => {
  const f = fold(q);
  return notes.some((n) => fold(n.title) === f);
};

const RECENT = 8;
const MAX = 12;

/**
 * Os títulos que casam, do mais exato ao mais aproximado: igual à busca, começa com ela, tem todas as palavras, e por
 * fim as letras em ordem (subsequência, T2966: "kg" acha `hgkjgkj`), pelo ponto do casamento. Empate pelo mais recente.
 */
export function titleMatches(notes: NoteMeta[], query: string): NoteMeta[] {
  return titleRanks(notes, query).map((x) => x.n);
}

/** O mesmo, com o grau de cada um: 0 a 2 é exato, 3 é aproximado. */
export function titleRanks(notes: NoteMeta[], query: string): { n: NoteMeta; rank: number }[] {
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return notes
    .map((n) => {
      const t = fold(n.title);
      let rank = t === q ? 0 : t.startsWith(q) ? 1 : words.every((w) => t.includes(w)) ? 2 : -1;
      let score = 0;
      if (rank < 0) {
        // O título já dobrado, e só o ponto (T8110): o `subsequence` dobrava de novo letra a letra e montava os trechos.
        const s = subsequenceScore(words, t);
        if (s !== null) [rank, score] = [3, s];
      }
      return { n, rank, score };
    })
    .filter((x) => x.rank >= 0)
    // A data ISO ordena como texto: o `<` basta, sem o `localeCompare`.
    .sort((a, b) => a.rank - b.rank || b.score - a.score || (a.n.mtime < b.n.mtime ? 1 : a.n.mtime > b.n.mtime ? -1 : 0))
    .map(({ n, rank }) => ({ n, rank }));
}

export function paletteItems(notes: NoteMeta[], query: string, textHits: SearchHit[], commands: PaletteCommand[] = [], ranked = false): PaletteItem[] {
  const q = query.trim();
  const folderOf = (path: string) => notes.find((n) => n.path === path)?.folder ?? "";
  const cmds = (all: boolean): PaletteItem[] =>
    commands
      .filter((c) => (c.withQuery ? !all : all || fold(`${c.title} ${c.words ?? ""}`).includes(fold(q))))
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
  // Com filtros (`tag:`, `path:`, "frase", `-excluir`: T2619, T2660), só o que o engine achou: o título não casa com o
  // operador, e não há "Criar". Os comandos que pedem a busca (Salvar) vêm no fim.
  if (hasFilters(parseQuery(q))) {
    return [
      ...textHits.slice(0, MAX).map((h): PaletteItem => ({ kind: "note", path: h.path, title: h.title, detail: folderOf(h.path), snippet: h.snippet, ...(h.semantic ? { semantic: true } : {}) })),
      ...commands.filter((c) => c.withQuery).map((c): PaletteItem => ({ kind: "command", id: c.id, title: c.title })),
    ];
  }
  // A ordem (T2966): título exato, texto exato, título aproximado, texto aproximado. O exato nunca fica abaixo do
  // aproximado.
  // Uma nota que casa aproximada no título e exata no texto fica com o texto, que é exato.
  if (ranked && textHits.length) {
    const seen = new Set(textHits.map(hit => hit.path));
    const out: PaletteItem[] = [
      ...textHits.map((h): PaletteItem => ({ kind: "note", path: h.path, title: h.title, detail: folderOf(h.path), snippet: h.snippet, ...(h.semantic ? { semantic: true } : {}) })),
      ...titleRanks(notes, q).filter(({ n }) => !seen.has(n.path)).map(({ n }): PaletteItem => ({ kind: "note", path: n.path, title: n.title, detail: n.folder })),
    ].slice(0, MAX);
    out.push(...cmds(false));
    if (!hasTitle(notes, q)) out.push({ kind: "create", title: q });
    return out;
  }
  const titles = titleRanks(notes, q);
  const seen = new Set<string>();
  const once = (path: string) => !seen.has(path) && !!seen.add(path);
  const titleItem = (n: NoteMeta): PaletteItem => ({ kind: "note", path: n.path, title: n.title, detail: n.folder });
  const textItem = (h: SearchHit): PaletteItem => ({ kind: "note", path: h.path, title: h.title, detail: folderOf(h.path), snippet: h.snippet, ...(h.semantic ? { semantic: true } : {}) });
  const items: PaletteItem[] = [];
  for (const x of titles) if (x.rank < 3 && once(x.n.path)) items.push(titleItem(x.n));
  for (const h of textHits) if (!h.approx && once(h.path)) items.push(textItem(h));
  for (const x of titles) if (x.rank === 3 && once(x.n.path)) items.push(titleItem(x.n));
  for (const h of textHits) if (h.approx && once(h.path)) items.push(textItem(h));
  const out = items.slice(0, MAX);
  out.push(...cmds(false));
  if (!hasTitle(notes, q)) out.push({ kind: "create", title: q });
  return out;
}

/**
 * O que destacar num título (T2966): as palavras exatas, se o título tem todas; senão as letras da subsequência. Com
 * filtros, só as palavras soltas e as "frases".
 */
export function titleRanges(title: string, query: string): Range[] {
  const q = parseQuery(query);
  const words = [...q.words, ...q.phrases];
  if (!words.length) return [];
  const t = fold(title);
  if (words.every((w) => t.includes(w))) return highlightRanges(title, words);
  if (hasFilters(q)) return highlightRanges(title, words);
  return subsequence(q.words.join(" "), title)?.ranges ?? highlightRanges(title, words);
}

/** O que destacar no trecho de um resultado: as palavras da busca, exatas ou com o erro que a busca aceitou. */
export function snippetRanges(snippet: string, query: string): Range[] {
  const q = parseQuery(query);
  const ranges = highlightRanges(snippet, [...q.words, ...q.phrases]);
  const words = parseQuery(query, { preserveWords: true }).words;
  for (const m of snippet.matchAll(WORD)) if (lexicalMatch(m[0], words)) ranges.push([m.index!, m.index! + m[0].length]);
  return ranges.sort((a,b)=>a[0]-b[0]).reduce<Range[]>((out, r) => {
    const prev = out.at(-1); if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]); else out.push(r);
    return out;
  }, []);
}
