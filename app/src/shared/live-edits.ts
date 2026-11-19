// O que o Kiwi mudou numa escrita, em pedaços que a janela das Notas anima (spec #20843, T20868).
//
// - **As posições** são do texto de antes da escrita, o arquivo inteiro como está no disco (com o frontmatter), em
//   unidades de `String.prototype.slice`. As `edits` vêm em ordem crescente e não se sobrepõem.
// - **A garantia:** `applyLiveEdits(antes, liveEdits(antes, depois))` é exatamente `depois`. A janela confere o
//   `removed` de cada edit antes de animar; se algo não bate, ela recarrega como antes.
// - **O diff** é por linha (Myers) e depois só os caracteres de cada trecho: uma nota reescrita vira uns trechos
//   pequenos, não uma troca do arquivo inteiro. Grande demais, ele cai num trecho só, que continua certo.

/** Um trecho trocado: `removed` é `antes.slice(from, to)`, e `inserted` entra no lugar. */
export interface LiveEdit {
  from: number;
  to: number;
  removed: string;
  inserted: string;
}

/** Até quantas diferenças de linha o diff procura antes de cair num trecho só. */
const MAX_DIFF = 1000;

/** O texto de antes com as `edits` aplicadas; `null` se elas não servem para ele (fora de ordem, sobrepostas, ou o `removed` não bate). */
export function applyLiveEdits(before: string, edits: readonly LiveEdit[]): string | null {
  let out = "";
  let at = 0;
  for (const e of edits) {
    if (!Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < at || e.to < e.from || e.to > before.length) return null;
    if (before.slice(e.from, e.to) !== e.removed) return null;
    out += before.slice(at, e.from) + e.inserted;
    at = e.to;
  }
  return out + before.slice(at);
}

/** Os trechos que levam `before` a `after`, em ordem crescente. Textos iguais: nenhum. */
export function liveEdits(before: string, after: string): LiveEdit[] {
  if (before === after) return [];
  const a = lines(before);
  const b = lines(after);
  // As linhas iguais do começo e do fim saem antes do diff: é o caso comum (um trecho no meio da nota).
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const hunks = diffLines(a.slice(head, a.length - tail), b.slice(head, b.length - tail));
  // As posições em caracteres de cada linha de antes e de depois.
  const offA = offsets(a);
  const offB = offsets(b);
  const out: LiveEdit[] = [];
  for (const h of hunks) {
    const from = offA[head + h.a0]!;
    const to = offA[head + h.a1]!;
    const removed = before.slice(from, to);
    const inserted = after.slice(offB[head + h.b0]!, offB[head + h.b1]!);
    out.push(refine(from, removed, inserted));
  }
  return out;
}

/** Só os caracteres que mudaram no trecho: tira o começo e o fim iguais (sem partir um par UTF-16). */
function refine(from: number, removed: string, inserted: string): LiveEdit {
  let p = 0;
  const max = Math.min(removed.length, inserted.length);
  while (p < max && removed[p] === inserted[p]) p++;
  if (p > 0 && p < max && isLowSurrogate(removed.charCodeAt(p))) p--;
  let s = 0;
  while (s < max - p && removed[removed.length - 1 - s] === inserted[inserted.length - 1 - s]) s++;
  if (s > 0 && isLowSurrogate(removed.charCodeAt(removed.length - s))) s--;
  return { from: from + p, to: from + removed.length - s, removed: removed.slice(p, removed.length - s), inserted: inserted.slice(p, inserted.length - s) };
}

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** As linhas com o fim de cada uma (`\n`), para que juntas voltem ao texto. */
function lines(t: string): string[] {
  return t.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Onde começa cada linha, e no fim o tamanho do texto. */
function offsets(ls: string[]): number[] {
  const o = [0];
  for (const l of ls) o.push(o[o.length - 1]! + l.length);
  return o;
}

/** Um trecho do diff: as linhas `[a0, a1)` de antes viram as `[b0, b1)` de depois. */
interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** O diff de Myers por linha; com mais de `MAX_DIFF` diferenças, um trecho só. */
function diffLines(a: string[], b: string[]): Hunk[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ a0: 0, a1: n, b0: 0, b1: m }];
  const max = Math.min(n + m, MAX_DIFF);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [{ a0: 0, a1: n, b0: 0, b1: m }];
  // De trás para a frente: cada passo é uma linha que saiu ou entrou; as iguais ficam entre eles.
  const ops: ("del" | "ins" | "eq")[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && vd[off + k - 1]! < vd[off + k + 1]!);
    const pk = down ? k + 1 : k - 1;
    const px = vd[off + pk]!;
    const py = px - pk;
    while (x > (down ? px : px + 1) && y > (down ? py + 1 : py)) {
      ops.push("eq");
      x--;
      y--;
    }
    if (down) {
      ops.push("ins");
      y--;
    } else {
      ops.push("del");
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push("eq");
    x--;
    y--;
  }
  ops.reverse();
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op === "eq") {
      if (cur) hunks.push(cur);
      cur = null;
      i++;
      j++;
      continue;
    }
    cur ??= { a0: i, a1: i, b0: j, b1: j };
    if (op === "del") cur.a1 = ++i;
    else cur.b1 = ++j;
  }
  if (cur) hunks.push(cur);
  return hunks;
}
