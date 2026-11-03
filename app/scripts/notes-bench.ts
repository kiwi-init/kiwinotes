// Mede o vault com 1.000 notas sintéticas (T1316, meta do spec #1107: busca em < ~200 ms no M1 Pro). Numa pasta
// temporária: não toca no ~/KiwiNotes.
//
//   bun scripts/notes-bench.ts [notas]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "../src/notes/vault.ts";

const N = Number(process.argv[2] ?? 1000);
const root = mkdtempSync(path.join(tmpdir(), "kiwinotes-bench-"));
const words = "kiwi nota reunião projeto ditado vault obsidian markdown índice busca semana time pauta ideia cliente prazo".split(" ");
for (let i = 0; i < N; i++) {
  const body = Array.from({ length: 300 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
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
  for (const q of ["reunião", "reunião projeto prazo", "nota 999", "xyzzy"]) {
    const runs: number[] = [];
    let hits = 0;
    for (let r = 0; r < 11; r++) {
      const { out, ms } = await time(() => v.search(q, 20));
      runs.push(ms);
      hits = out.length;
    }
    console.log(`busca "${q}": mediana ${median(runs).toFixed(1)} ms, pior ${Math.max(...runs).toFixed(1)} ms (${hits} resultados)`);
  }
  const bl = await time(() => v.backlinks("Pasta 1/Nota 1.md"));
  console.log(`backlinks: ${bl.ms.toFixed(1)} ms (${bl.out.length})`);
  const rn = await time(() => v.rename("Pasta 1/Nota 1.md", "Pasta 1/Nota um.md"));
  console.log(`rename com links: ${rn.ms.toFixed(0)} ms (${rn.out.updatedLinks} links atualizados)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
