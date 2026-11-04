// Mede o vault com 1.000 notas sintéticas (T1316, meta do spec #1107: busca em < ~200 ms no M1 Pro). Numa pasta
// temporária: não toca no ~/KiwiNotes. Desde o T2966 (busca fuzzy, meta do spec #2934: < 50 ms com 1.000 notas), o
// texto mistura as palavras de sempre com um vocabulário de 8.000 palavras inventadas, como um vault de verdade, e
// mede também a busca com erro de digitação e o ⌘K por subsequência nos títulos.
//
//   bun scripts/notes-bench.ts [notas]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "../src/notes/vault.ts";
import { titleMatches } from "../ui/notes/palette.ts";

const N = Number(process.argv[2] ?? 1000);
const root = mkdtempSync(path.join(tmpdir(), "kiwinotes-bench-"));
const words = "kiwi nota reunião projeto ditado vault obsidian markdown índice busca semana time pauta ideia cliente prazo".split(" ");
// Um gerador fixo: o mesmo vault a cada rodada.
let seed = 2966;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const letters = "abcdefghijlmnoprstuvçãéí";
const vocab = Array.from({ length: 8000 }, () => Array.from({ length: 4 + Math.floor(rand() * 7) }, () => letters[Math.floor(rand() * letters.length)]).join(""));
for (let i = 0; i < N; i++) {
  const body = Array.from({ length: 300 }, (_, k) => (k % 3 ? vocab[Math.floor(rand() * vocab.length)] : words[(i * 7 + k * 3) % words.length])).join(" ");
  const rel = `Pasta ${i % 25}/Nota ${i}.md`;
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), `---\ntags: [t${i % 10}]\n---\n# Nota ${i}\n${body}\n[[Nota ${(i + 1) % N}]] [[Nota ${(i + 7) % N}]]\n`);
}

const time = async <T>(fn: () => T | Promise<T>) => {
  const t0 = performance.now();
  const out = await fn();
  return { out, ms: performance.now() - t0 };
};
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

try {
  const v = new Vault({ root });
  const open = await time(() => v.open());
  console.log(`${N} notas: abrir e indexar ${open.ms.toFixed(0)} ms`);
  // As três últimas são aproximadas (T2966): "reunaio" e "pjoreto prazo" pelo erro de digitação; "xyzzyw" não casa nada
  // e passa pela conta de erros em todas as palavras.
  for (const q of ["reunião", "reunião projeto prazo", "nota 999", "xyzzy", "reunaio", "pjoreto prazo", "xyzzyw"]) {
    const runs: number[] = [];
    let hits = 0;
    for (let r = 0; r < 11; r++) {
      const { out, ms } = await time(() => v.search(q, 20));
      runs.push(ms);
      hits = out.length;
    }
    console.log(`busca "${q}": mediana ${median(runs).toFixed(1)} ms, pior ${Math.max(...runs).toFixed(1)} ms (${hits} resultados)`);
  }
  // O ⌘K casa os títulos na UI, sem o engine (T2966: subsequência).
  const metas = v.list().notes;
  for (const q of ["nt99", "nota 999", "xq"]) {
    const runs: number[] = [];
    let hits = 0;
    for (let r = 0; r < 11; r++) {
      const { out, ms } = await time(() => titleMatches(metas, q));
      runs.push(ms);
      hits = out.length;
    }
    console.log(`⌘K títulos "${q}": mediana ${median(runs).toFixed(1)} ms, pior ${Math.max(...runs).toFixed(1)} ms (${hits} resultados)`);
  }
  const bl = await time(() => v.backlinks("Pasta 1/Nota 1.md"));
  console.log(`backlinks: ${bl.ms.toFixed(1)} ms (${bl.out.length})`);
  const rn = await time(() => v.rename("Pasta 1/Nota 1.md", "Pasta 1/Nota um.md"));
  console.log(`rename com links: ${rn.ms.toFixed(0)} ms (${rn.out.updatedLinks} links atualizados)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
