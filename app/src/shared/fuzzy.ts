// A busca aproximada (T2966, spec #2934), a mesma no ⌘K, na busca da árvore, no `notes.search` e no texto dos anexos:
//
// - **Títulos:** subsequência, no estilo fzf. As letras da busca aparecem em ordem, mas não precisam estar juntas
//   ("kg" acha `hgkjgkj`). Ganham ponto as letras seguidas, o início de palavra e o início do título.
// - **Texto:** cada palavra de 4 letras ou mais aceita 1 erro (trocar, faltar, sobrar ou inverter duas letras
//   vizinhas), e de 7 ou mais, 2. Subsequência no corpo traria lixo demais.
//
// Tudo sem acento nem maiúscula, como o resto da busca. O exato sempre vem antes do aproximado: quem chama decide a ordem.

/** "Ação É" → "acao e", com a posição no original de cada caractere dobrado (para destacar no texto de verdade). */
export function foldMap(s: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase("pt-BR");
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** Um trecho destacado: `[início, fim)` no texto original. */
export type Range = [number, number];

export interface SubsequenceMatch {
  score: number;
  /** As letras que casaram, juntas em trechos, no texto original. */
  ranges: Range[];
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

// Os pesos, perto dos do fzf: cada letra vale 16; letra logo depois da anterior, +8; início de palavra, +8; início do
// título, +12; cada letra pulada entre duas que casaram, -1.
const CHAR = 16;
const CONSECUTIVE = 8;
const WORD_START = 8;
const TEXT_START = 12;
const GAP = 1;

/** Junta posições soltas (já em ordem) em trechos `[início, fim)`, levando do dobrado ao original pelo `map`. */
function toRanges(positions: number[], map: number[]): Range[] {
  const out: Range[] = [];
  for (const p of positions) {
    const from = map[p]!;
    const to = map[p + 1] ?? from + 1;
    const last = out.at(-1);
    if (last && last[1] >= from) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * Uma palavra da busca (já dobrada, sem espaço) como subsequência de `folded`: o melhor alinhamento, por programação
 * dinâmica (o título é curto). `null` se as letras não aparecem em ordem.
 */
function alignWord(q: string, folded: string): { score: number; positions: number[] } | null {
  const n = folded.length;
  const m = q.length;
  if (!m || m > n) return null;
  // Corte rápido: as letras em ordem, gulosamente. Também dá a 1ª e a última coluna possíveis de cada letra.
  let j = 0;
  for (let i = 0; i < m; i++) {
    j = folded.indexOf(q[i]!, j);
    if (j < 0) return null;
    j++;
  }
  const bonus = new Float64Array(n);
  for (let k = 0; k < n; k++) bonus[k] = k === 0 ? TEXT_START : !isWordChar(folded[k - 1]) && isWordChar(folded[k]) ? WORD_START : 0;
  const NEG = -Infinity;
  // S[i*n + k]: o melhor ponto com as letras 0..i casadas e a letra i na coluna k.
  const S = new Float64Array(m * n).fill(NEG);
  for (let k = 0; k < n; k++) if (folded[k] === q[0]) S[k] = CHAR + bonus[k]!;
  for (let i = 1; i < m; i++) {
    let carry = NEG; // o melhor S[i-1][k'] - GAP * (letras puladas até a coluna de agora), para k' < k - 1
    for (let k = 1; k < n; k++) {
      const prev = S[(i - 1) * n + k - 1]!;
      if (folded[k] === q[i]) {
        const best = Math.max(carry, prev === NEG ? NEG : prev + CONSECUTIVE);
        if (best !== NEG) S[i * n + k] = best + CHAR + bonus[k]!;
      }
      carry = Math.max(carry - GAP, prev - GAP);
    }
  }
  let end = -1;
  let score = NEG;
  for (let k = 0; k < n; k++) {
    const s = S[(m - 1) * n + k]!;
    if (s > score) [score, end] = [s, k];
  }
  if (end < 0) return null;
  // De volta: para cada letra, a coluna anterior que deu o ponto (a vizinha, se empata: prefere letras juntas).
  const positions = [end];
  for (let i = m - 1, k = end; i > 0; i--) {
    const want = S[i * n + k]! - CHAR - bonus[k]!;
    let at = -1;
    if (S[(i - 1) * n + k - 1]! + CONSECUTIVE === want) at = k - 1;
    else {
      for (let p = k - 2; p >= 0; p--) {
        if (S[(i - 1) * n + p]! - GAP * (k - 1 - p) === want) {
          at = p;
          break;
        }
      }
    }
    if (at < 0) at = k - 1; // não acontece; só para não travar
    positions.unshift(at);
    k = at;
  }
  return { score, positions };
}

/**
 * A busca (as palavras separadas por espaço) como subsequência de `text`: cada palavra tem que casar. O ponto é a soma;
 * os trechos são os das letras que casaram.
 */
export function subsequence(query: string, text: string): SubsequenceMatch | null {
  const words = foldMap(query).folded.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const { folded, map } = foldMap(text);
  let score = 0;
  const positions = new Set<number>();
  for (const w of words) {
    const r = alignWord(w, folded);
    if (!r) return null;
    score += r.score;
    for (const p of r.positions) positions.add(p);
  }
  return { score, ranges: toRanges([...positions].sort((a, b) => a - b), map) };
}

/** Quantos erros a palavra aceita: 0 abaixo de 4 letras, 1 de 4 a 6, 2 de 7 em diante. Número puro não aceita erro. */
export function typoBudget(word: string): number {
  if (!/^[\p{L}\p{N}]+$/u.test(word) || !/\p{L}/u.test(word)) return 0;
  const len = [...word].length;
  return len >= 7 ? 2 : len >= 4 ? 1 : 0;
}

/**
 * `a` e `b` estão a no máximo `k` edições (trocar, faltar ou sobrar uma letra, ou inverter duas vizinhas: a distância
 * de Damerau-Levenshtein restrita), com corte cedo quando já passou de `k`.
 */
export function withinEdits(a: string, b: string, k: number): boolean {
  if (a === b) return true;
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > k) return false;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > k) return false;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m]! <= k;
}

/** As palavras de um texto já dobrado (letras e números). */
export const wordsOf = (folded: string): string[] => folded.match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Uma palavra da busca contra as palavras de um texto, com a tolerância a erro: devolve a palavra do texto que casou
 * (para o trecho), ou `null`. O `memo` guarda o resultado por palavra, para não refazer a conta em cada nota.
 */
export function approxWord(word: string, words: Iterable<string>, memo?: Map<string, boolean>): string | null {
  const k = typoBudget(word);
  if (!k) return null;
  for (const w of words) {
    let ok = memo?.get(w);
    if (ok === undefined) {
      ok = Math.abs(w.length - word.length) <= k && withinEdits(word, w, k);
      memo?.set(w, ok);
    }
    if (ok) return w;
  }
  return null;
}

/**
 * Os trechos a destacar num texto (o título ou o trecho de um resultado): onde cada palavra da busca aparece exata,
 * e as palavras do texto que casam com ela por aproximação.
 */
export function highlightRanges(text: string, queryWords: readonly string[]): Range[] {
  const qs = queryWords.map((w) => foldMap(w).folded).filter(Boolean);
  if (!qs.length || !text) return [];
  const { folded, map } = foldMap(text);
  const marks: Range[] = [];
  for (const q of qs) {
    for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + q.length)) marks.push([at, at + q.length]);
  }
  const k = Math.max(0, ...qs.map(typoBudget));
  if (k) {
    for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
      const w = m[0];
      if (qs.some((q) => typoBudget(q) && w.length >= 3 && withinEdits(q, w, typoBudget(q)))) marks.push([m.index!, m.index! + w.length]);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [f, t] of marks) {
    const from = map[f]!;
    const to = map[t] ?? text.length;
    const last = out.at(-1);
    if (last && last[1] >= from) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}
