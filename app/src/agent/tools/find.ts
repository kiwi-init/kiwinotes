// O `find` e o erro que ensina (ADR 0013, peça 3; T14133): achar o alvo numa chamada só, pelo nome como a pessoa fala.
//
// - **Um nome é uma chave:** minúsculas, sem acento, sem espaço, `-` nem `_`, e sem a extensão ("Plano de Migração" acha
//   `Projetos/X/plano-de-migracao.md`). Igual à chave das pastas do T13427 (`folderNamed`).
// - **O parecido** é pelos pares de letras (o coeficiente de Dice): aguenta a letra trocada do ditado ("legasi" perto de
//   "legacy"), a palavra a mais e a ordem trocada. Sem modelo, sem rede.
// - **O erro que ensina:** um caminho que não existe volta com os 3 mais parecidos, cada um com o cartão. A chamada
//   seguinte acerta, sem listar pasta por pasta.

import type { ReaderNoteMeta } from "./reader.ts";

/** A chave de um nome: sem acento, minúsculas, sem espaço, `-`, `_` e `.`; sem a extensão de nota. */
export function nameKey(t: string): string {
  return t
    .replace(/\.(md|txt)$/i, "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[\s_.\-]+/g, "");
}

/** Os pares de letras de uma chave, com repetição. */
function bigrams(key: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < key.length - 1; i++) {
    const b = key.slice(i, i + 2);
    out.set(b, (out.get(b) ?? 0) + 1);
  }
  return out;
}

/** O quanto dois nomes se parecem, de 0 a 1 (Dice dos pares de letras das chaves). Iguais: 1. */
export function similarity(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const p = bigrams(x);
  const q = bigrams(y);
  let both = 0;
  for (const [g, n] of p) both += Math.min(n, q.get(g) ?? 0);
  return (2 * both) / (x.length - 1 + (y.length - 1));
}

/** Abaixo disto, o nome não é "parecido" o bastante para entrar na sugestão. */
export const SIMILAR_MIN = 0.3;

/**
 * O quanto `want` casa com um alvo: o melhor entre o último nome (o título ou a pasta), o caminho inteiro e, quando o
 * pedido é mais curto, o pedaço do nome do mesmo tamanho ("plano" dentro de "Plano de Migração").
 */
export function matchScore(want: string, names: readonly string[]): number {
  const w = nameKey(want);
  let best = 0;
  for (const n of names) {
    const k = nameKey(n);
    if (!k || !w) continue;
    if (k === w) return 1;
    let s = similarity(w, k);
    // Um nome que contém o pedido inteiro (ou o pedido contém o nome) vale quase tanto quanto o igual.
    if (w.length >= 3 && (k.includes(w) || w.includes(k))) s = Math.max(s, 0.9 * Math.min(w.length, k.length) / Math.max(w.length, k.length) + 0.1);
    best = Math.max(best, s);
  }
  return best;
}

/** Os `k` mais parecidos com `want`, do mais para o menos, só os que passam de `SIMILAR_MIN`. */
export function closest<T>(items: readonly T[], want: string, namesOf: (t: T) => readonly string[], k = 3): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: matchScore(want, namesOf(item)) }))
    .filter((x) => x.score >= SIMILAR_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Os nomes de uma nota: o título, o nome do arquivo sem a pasta, e o caminho. */
export const noteNames = (n: Pick<ReaderNoteMeta, "path" | "title">): string[] => [n.title, n.path.split("/").pop() ?? n.path, n.path];

/** Os nomes de uma pasta: o último nome e o caminho. */
export const folderNames = (f: string): string[] => [f.split("/").pop() ?? f, f];

/**
 * Uma nota pelo nome ou pelo caminho (ADR 0013 peça 3): o caminho exato, ou a única nota com a mesma chave no título,
 * no nome do arquivo ou no caminho. Mais de uma: `ambiguous` com as que casam. Nenhuma: `near`, as 3 mais parecidas.
 */
export function noteNamed(
  notes: readonly ReaderNoteMeta[],
  raw: string,
): { note: ReaderNoteMeta } | { ambiguous: ReaderNoteMeta[] } | { near: ReaderNoteMeta[] } {
  const want = raw.trim().replace(/^\/+/, "");
  const exact = notes.find((n) => n.path === want);
  if (exact) return { note: exact };
  const key = nameKey(want);
  const same = key ? notes.filter((n) => noteNames(n).some((x) => nameKey(x) === key)) : [];
  if (same.length === 1) return { note: same[0]! };
  if (same.length > 1) return { ambiguous: same.slice(0, 10) };
  // Um caminho com a pasta errada e o nome certo: o nome resolve, se for único.
  const last = want.split("/").pop() ?? "";
  if (last !== want) {
    const byName = notes.filter((n) => noteNames(n).slice(0, 2).some((x) => nameKey(x) === nameKey(last)));
    if (byName.length === 1) return { note: byName[0]! };
  }
  return { near: closest(notes, want, noteNames).map((x) => x.item) };
}

/** O cartão de uma nota no erro que ensina: o caminho, o título, a pasta, o tamanho e a última mudança, numa linha. */
export function noteCard(n: ReaderNoteMeta): string {
  const day = n.mtime ? n.mtime.slice(0, 10) : "";
  return `${n.path} ("${n.title}", ${n.size} caracteres${day ? `, mudou em ${day}` : ""})`;
}

/** As seções mais parecidas com a que o agente pediu, e todas quando são poucas. */
export function nearSections(titles: readonly string[], want: string, k = 3): string[] {
  const near = closest(titles, want, (t) => [t], k).map((x) => x.item);
  return near.length ? near : titles.slice(0, Math.max(k, 8));
}
