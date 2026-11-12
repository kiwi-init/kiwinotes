// T8110: o ⌘K confere os títulos de todas as notas a cada letra. Num cofre de 10 mil, dobrar cada título letra a letra
// (o `foldMap` do `subsequence`) e montar os trechos custava ~40 ms por letra no JavaScriptCore, o motor do WebKit.
import { afterEach, describe, expect, test } from "bun:test";

import { foldMap, subsequence, subsequenceScore } from "../../src/shared/fuzzy.ts";
import { fold, paletteItems, titleRanks } from "./palette.ts";
import type { NoteMeta } from "./types.ts";

const notes: NoteMeta[] = [];
for (let f = 0; f < 20; f++)
  for (let i = 0; i < 50; i++) {
    const title = `Nota ${String(f).padStart(3, "0")}-${String(i).padStart(3, "0")}`;
    notes.push({ path: `Pasta ${f}/${title}.md`, title, folder: `Pasta ${f}`, mtime: new Date(Date.UTC(2026, 10, 1) + (f * 50 + i) * 1000).toISOString(), ctime: "", size: 0, version: "", tags: [] } as NoteMeta);
  }

const original = String.prototype.toLocaleLowerCase;
afterEach(() => {
  String.prototype.toLocaleLowerCase = original;
});

describe("o custo do ⌘K por letra (T8110)", () => {
  test("cada título é dobrado uma ou duas vezes por letra, não uma vez por caractere", () => {
    let calls = 0;
    String.prototype.toLocaleLowerCase = function (this: string, ...args: Parameters<typeof original>) {
      calls++;
      return original.apply(this, args);
    };
    // "nota 01" não começa nenhum título de 18 das 20 pastas: elas caem no aproximado (a subsequência).
    paletteItems(notes, "nota 01", [], [], false);
    String.prototype.toLocaleLowerCase = original;
    expect(calls).toBeLessThan(notes.length * 3);
  });

  test("o subsequenceScore dá o mesmo ponto do subsequence, e a mesma ordem", () => {
    const titles = ["Nota 077-012", "hgkjgkj", "Ação É boa", "Reunião com a Ana", "x", "Projeto do site 2026"];
    for (const query of ["kg", "nt7", "acao", "rna", "pjt site", "zz", "ana reu"])
      for (const t of titles) {
        const words = fold(query).split(/\s+/).filter(Boolean);
        expect(subsequenceScore(words, foldMap(t).folded)).toBe(subsequence(query, t)?.score ?? null);
      }
    // A ordem do titleRanks é a do jeito de antes (o subsequence com o texto cru e o localeCompare na data).
    const before = (query: string) => {
      const q = fold(query.trim()), words = q.split(/\s+/);
      return notes
        .map((n) => {
          const t = fold(n.title);
          let rank = t === q ? 0 : t.startsWith(q) ? 1 : words.every((w) => t.includes(w)) ? 2 : -1, score = 0;
          if (rank < 0) { const m = subsequence(q, n.title); if (m) [rank, score] = [3, m.score]; }
          return { n, rank, score };
        })
        .filter((x) => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || b.score - a.score || b.n.mtime.localeCompare(a.n.mtime))
        .map((x) => `${x.rank} ${x.n.path}`);
    };
    for (const query of ["nt0107", "nota 01", "n 9-4", "Nota 003-033", "019"])
      expect(titleRanks(notes, query).map((x) => `${x.rank} ${x.n.path}`)).toEqual(before(query));
  });
});
