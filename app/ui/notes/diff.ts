// A diferença entre duas versões de uma nota, linha por linha (T2680): o que saiu, o que entrou e o que ficou, como
// o "Versões…" mostra. LCS pelas linhas, sem lib de fora. Uma nota muito longa cai num resumo, para não travar a janela.

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Acima disto (linhas × linhas), em vez da tabela inteira, só o começo e o fim iguais e o meio como trocado. */
export const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // O começo e o fim iguais saem do meio: quase toda edição mexe numa parte só.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let mid: DiffLine[];
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    mid = [...midA.map((text) => ({ kind: "del" as const, text })), ...midB.map((text) => ({ kind: "add" as const, text }))];
  } else {
    // lcs[i][j]: o tamanho da maior sequência comum de midA[i..] e midB[j..].
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        mid.push({ kind: "same", text: midA[i]! });
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) mid.push({ kind: "del", text: midA[i++]! });
      else mid.push({ kind: "add", text: midB[j++]! });
    }
    while (i < n) mid.push({ kind: "del", text: midA[i++]! });
    while (j < m) mid.push({ kind: "add", text: midB[j++]! });
  }
  return [...head, ...mid, ...tail];
}

/** Quantas linhas entraram e saíram. */
export function diffStats(d: readonly DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((l) => l.kind === "add").length, removed: d.filter((l) => l.kind === "del").length };
}

/** O diff com as linhas iguais longe de uma mudança escondidas (`…`), como num diff de código. */
export function collapse(d: readonly DiffLine[], context = 2): (DiffLine | { kind: "gap"; count: number })[] {
  const near = new Set<number>();
  d.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) near.add(k);
  });
  const out: (DiffLine | { kind: "gap"; count: number })[] = [];
  let gap = 0;
  d.forEach((l, i) => {
    if (l.kind !== "same" || near.has(i)) {
      if (gap) out.push({ kind: "gap", count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: "gap", count: gap });
  return out;
}
