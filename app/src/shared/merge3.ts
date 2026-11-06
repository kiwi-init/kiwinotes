// O merge de 3 vias de uma nota (T5454, issue #170): a base (o texto que o editor abriu), a minha (o editor) e a de
// fora (o disco, que o Obsidian ou um agente mudou). Por linha, como o diff3: o que só um lado mudou entra; o que os
// dois mudaram igual entra uma vez; o que os dois mudaram diferente, no mesmo trecho, é conflito, e só esse trecho
// precisa da pessoa. Ideia e regra do merge externo do SilverBullet (`client/external_merge.ts`, MIT, Zef Hemel); o
// código é daqui, sem dependência: um diff de Myers por linha e o diff3 clássico por cima.

import { rebaseMeetingEdit } from "./meeting-note.ts";

/** Um trecho que os dois lados mudaram diferente. `base` é como estava; as linhas guardam o `\n` do fim. */
export interface MergeConflict {
  base: string;
  mine: string;
  theirs: string;
}

export type MergeResult =
  | { clean: true; text: string }
  | { clean: false; conflicts: MergeConflict[]; resolve(choice: "mine" | "theirs" | readonly ("mine" | "theirs")[]): string };

/** As linhas com o `\n` do fim, para juntar de volta byte a byte. */
export function lines(text: string): string[] {
  if (!text) return [];
  const out = text.split(/(?<=\n)/);
  return out;
}

/**
 * Os pares (i em `a`, j em `b`) de linhas iguais de uma subsequência comum mais longa, pelo diff de Myers (O((N+M)·D)):
 * rápido quando as versões são parecidas, que é o caso de uma nota editada dos dois lados.
 */
export function matches(a: readonly string[], b: readonly string[]): [number, number][] {
  // As pontas iguais saem antes: a maior parte de uma nota não muda.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < start; i++) out.push([i, i]);
  const mid = myers(a.slice(start, endA), b.slice(start, endB));
  for (const [i, j] of mid) out.push([i + start, j + start]);
  for (let k = 0; k < a.length - endA; k++) out.push([endA + k, endB + k]);
  return out;
}

function myers(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
    v = next;
  }
  trace.push(v);
  // Volta pelo caminho e junta as diagonais (as linhas iguais).
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d === 0) break;
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
    x--;
    y--;
    pairs.push([x, y]);
  }
  return pairs.reverse();
}

type Chunk = { kind: "same"; text: string[] } | { kind: "changed"; base: string[]; mine: string[]; theirs: string[] };

/** O diff3: os trechos entre as linhas da base que os dois lados deixaram iguais. */
function chunks(base: string[], mine: string[], theirs: string[]): Chunk[] {
  const toMine = new Map(matches(base, mine));
  const toTheirs = new Map(matches(base, theirs));
  const out: Chunk[] = [];
  let b = 0;
  let m = 0;
  let t = 0;
  const flush = (bEnd: number, mEnd: number, tEnd: number) => {
    if (bEnd > b || mEnd > m || tEnd > t) {
      out.push({ kind: "changed", base: base.slice(b, bEnd), mine: mine.slice(m, mEnd), theirs: theirs.slice(t, tEnd) });
    }
  };
  for (let i = 0; i < base.length; i++) {
    const mi = toMine.get(i);
    const ti = toTheirs.get(i);
    if (mi === undefined || ti === undefined || mi < m || ti < t) continue;
    flush(i, mi, ti);
    const last = out.at(-1);
    if (last?.kind === "same") last.text.push(base[i]!);
    else out.push({ kind: "same", text: [base[i]!] });
    b = i + 1;
    m = mi + 1;
    t = ti + 1;
  }
  flush(base.length, mine.length, theirs.length);
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/**
 * Junta a minha e a de fora sobre a base. Limpo: o texto. Com conflito: os trechos, e `resolve` monta o texto inteiro
 * com o lado escolhido em cada trecho (um só para todos, ou um por trecho, na ordem), com o resto já junto.
 */
export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs) return { clean: true, text: mine };
  if (mine === base) return { clean: true, text: theirs };
  if (theirs === base) return { clean: true, text: mine };
  const parts = chunks(lines(base), lines(mine), lines(theirs));
  const conflicts: MergeConflict[] = [];
  const pieces: (string | number)[] = [];
  for (const c of parts) {
    if (c.kind === "same") pieces.push(c.text.join(""));
    else if (same(c.mine, c.base)) pieces.push(c.theirs.join(""));
    else if (same(c.theirs, c.base) || same(c.mine, c.theirs)) pieces.push(c.mine.join(""));
    else {
      pieces.push(conflicts.length);
      conflicts.push({ base: c.base.join(""), mine: c.mine.join(""), theirs: c.theirs.join("") });
    }
  }
  if (!conflicts.length) return { clean: true, text: pieces.join("") };
  return {
    clean: false,
    conflicts,
    resolve: (choice) =>
      pieces
        .map((p) => {
          if (typeof p === "string") return p;
          const side = typeof choice === "string" ? choice : (choice[p] ?? "mine");
          return conflicts[p]![side];
        })
        .join(""),
  };
}

/**
 * A edição da pessoa (`edited`, feita sobre `base`) por cima do que está no disco agora (`current`), ou null se os dois
 * mudaram o mesmo trecho. A nota de reunião passa antes pelo rebase dela (o escritor da reunião só acrescenta, T4945).
 */
export function mergeNoteEdit(base: string, edited: string, current: string): string | null {
  const meeting = rebaseMeetingEdit(base, edited, current);
  if (meeting !== null) return meeting;
  const r = merge3(base, edited, current);
  return r.clean ? r.text : null;
}

/**
 * As trocas por linha que levam `before` a `next`, nas posições de `before` (para o editor aplicar de uma vez): só o que
 * mudou é trocado, e o cursor de quem está escrevendo num trecho que não mudou fica onde está.
 */
export function lineChanges(before: string, next: string): { from: number; to: number; insert: string }[] {
  const a = lines(before);
  const b = lines(next);
  const offsets = [0];
  for (const l of a) offsets.push(offsets.at(-1)! + l.length);
  const out: { from: number; to: number; insert: string }[] = [];
  let ai = 0;
  let bi = 0;
  for (const [i, j] of [...matches(a, b), [a.length, b.length] as [number, number]]) {
    if (i > ai || j > bi) out.push({ from: offsets[ai]!, to: offsets[i]!, insert: b.slice(bi, j).join("") });
    ai = i + 1;
    bi = j + 1;
  }
  return out;
}
