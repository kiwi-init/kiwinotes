// A busca com filtros (T2660, spec #2457 ponto 3), a mesma no ⌘K, na busca da árvore e no `notes.search` do engine:
//
//   reunião "frase exata" tag:projeto #ideia path:Projetos/2026 path:"Minha pasta" -rascunho -"não quero" -tag:velho
//
// Sem acento nem maiúscula. `tag:` acha a tag e as filhas (`#projeto/kiwi` está em `projeto`); `path:` é um pedaço do
// caminho da nota (pasta ou nome); `-` exclui uma palavra, uma frase, uma tag ou um caminho.

import { cleanTag } from "./tags.ts";

export interface ParsedQuery {
  /** Palavras soltas: cada uma no título ou no texto. */
  words: string[];
  /** "Frases exatas", já sem as aspas. */
  phrases: string[];
  tags: string[];
  paths: string[];
  /** O que não pode aparecer: palavras e frases. */
  notText: string[];
  notTags: string[];
  notPaths: string[];
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

/** Os pedaços da busca: `"…"` junto, `path:"…"` junto, o resto por espaço. Aspas sem fechar vão até o fim. */
function tokens(q: string): { neg: boolean; key: string; value: string; quoted: boolean }[] {
  const out: { neg: boolean; key: string; value: string; quoted: boolean }[] = [];
  const re = /(-?)(?:(tag|path):)?(?:"([^"]*)"?|(\S+))/giy;
  let i = 0;
  while (i < q.length) {
    if (/\s/.test(q[i]!)) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(q);
    if (!m) break;
    i = re.lastIndex;
    const quoted = m[3] !== undefined;
    out.push({ neg: m[1] === "-", key: (m[2] ?? "").toLowerCase(), value: quoted ? m[3]! : m[4]!, quoted });
  }
  return out;
}

/** Espaços, tabs e quebras de linha viram um espaço só: uma "frase" casa mesmo quebrada no meio da nota (T2751). */
export const oneSpace = (s: string) => s.replace(/\s+/g, " ");

export function parseQuery(query: string, options: { preserveWords?: boolean } = {}): ParsedQuery {
  const r: ParsedQuery = { words: [], phrases: [], tags: [], paths: [], notText: [], notTags: [], notPaths: [] };
  for (const t of tokens(query)) {
    const value = t.value.trim();
    // Um "tag:" ou "path:" ainda sem nada, ou um "-" sozinho: nada a buscar ainda.
    if (!value || /^(tag|path):$/i.test(value) || (!t.quoted && !/[\p{L}\p{N}]/u.test(value))) continue;
    if (t.key === "tag" || (!t.key && !t.quoted && value.startsWith("#"))) {
      const tag = cleanTag(value);
      if (tag) (t.neg ? r.notTags : r.tags).push(tag);
    } else if (t.key === "path") {
      (t.neg ? r.notPaths : r.paths).push(fold(value.replace(/^\/+|\/+$/g, "")));
    } else if (t.neg) {
      // Um "-" sozinho (ou "--") não é exclusão de nada.
      if (/[\p{L}\p{N}]/u.test(value)) r.notText.push(oneSpace(fold(value)));
    } else if (t.quoted) {
      r.phrases.push(oneSpace(fold(value)));
    } else {
      r.words.push(options.preserveWords ? value.normalize("NFC").toLocaleLowerCase("pt-BR") : fold(value));
    }
  }
  return r;
}

/** A busca tem filtro além de palavras soltas (o ⌘K então não casa título nem oferece "Criar"). */
export function hasFilters(q: ParsedQuery): boolean {
  return !!(q.phrases.length || q.tags.length || q.paths.length || q.notText.length || q.notTags.length || q.notPaths.length);
}

/** Tem algo que escolhe notas (só exclusões não escolhem: a busca vazia continua vazia). */
export function hasPositive(q: ParsedQuery): boolean {
  return !!(q.words.length || q.phrases.length || q.tags.length || q.paths.length);
}

/** Uma busca salva (as `AppSettings.savedSearches`, T2660). */
export interface SavedSearch {
  name: string;
  query: string;
}

export const MAX_SAVED_SEARCHES = 50;

/** Do arquivo: só as que têm nome e busca, sem repetir a busca, até o máximo. */
export function sanitizeSavedSearches(input: unknown): SavedSearch[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SavedSearch[] = [];
  for (const s of input) {
    if (!s || typeof s !== "object") continue;
    const { name, query } = s as Record<string, unknown>;
    if (typeof name !== "string" || typeof query !== "string") continue;
    const n = name.trim().slice(0, 120);
    const q = query.trim().slice(0, 500);
    if (!n || !q || seen.has(q)) continue;
    seen.add(q);
    out.push({ name: n, query: q });
    if (out.length >= MAX_SAVED_SEARCHES) break;
  }
  return out;
}
