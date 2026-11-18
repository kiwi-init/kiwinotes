// O que o engine faz quando as notas recarregam (T20132, spec #20118): monta um cofre inventado grande num tmp e mede
// as chamadas que a janela das Notas faz depois de uma operação (a lista inteira, a lista preguiçosa, as tags, os
// projetos) e as operações em si (criar, renomear, mover, apagar, desfazer), com quantos scans do disco cada uma faz.
// Nada do Mac de ninguém: as pastas e as notas são "Pasta 12/Nota 345", e os arquivos, CSVs de duas linhas.
//
//   bun scripts/notes-reload-bench.ts [pastas] [notas] [arquivos] [rodadas]
//
// Padrão: 6.000 pastas, 12.000 notas e 60.000 arquivos (o tamanho do cofre do spec #13664), 5 rodadas. Pesado: pegue
// `kiwi lock bench` antes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "../src/notes/vault.ts";

const FOLDERS = Number(process.argv[2] ?? 6000);
const NOTES = Number(process.argv[3] ?? 12000);
const FILES = Number(process.argv[4] ?? 60000);
const ROUNDS = Math.max(1, Number(process.argv[5] ?? 5));

const root = mkdtempSync(path.join(tmpdir(), "kiwinotes-reload-bench-"));
// As pastas em dois níveis: 60 de cima, o resto embaixo delas.
const top = Math.min(60, FOLDERS);
const folders = Array.from({ length: FOLDERS }, (_, i) => (i < top ? `Pasta ${i}` : `Pasta ${i % top}/Sub ${i}`));
const t0 = performance.now();
for (const f of folders) mkdirSync(path.join(root, f), { recursive: true });
for (let i = 0; i < NOTES; i++) {
  const f = folders[(i * 7) % FOLDERS]!;
  writeFileSync(path.join(root, f, `Nota ${i}.md`), `---\ntags: [t${i % 40}]\n---\n# Nota ${i}\nTexto de exemplo ${i}.\n[[Nota ${(i + 1) % NOTES}]]\n`);
}
for (let i = 0; i < FILES; i++) writeFileSync(path.join(root, folders[(i * 13) % FOLDERS]!, `dados ${i}.csv`), "a,b\n1,2\n");
console.log(`cofre: ${FOLDERS} pastas, ${NOTES} notas, ${FILES} arquivos (montado em ${((performance.now() - t0) / 1000).toFixed(1)} s)`);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const kb = (x: unknown) => (JSON.stringify(x).length / 1024).toFixed(0);
const rows: string[][] = [];
const row = (...cols: string[]) => rows.push(cols);

try {
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true, force: true }) });
  // Conta e cronometra os scans (o `scan` é privado; aqui só se embrulha).
  const inner = v as unknown as { scan(o?: unknown): Promise<void> };
  const scan = inner.scan.bind(v);
  let scans = 0;
  let scanMs = 0;
  inner.scan = async (o?: unknown) => {
    scans++;
    const s = performance.now();
    try {
      await scan(o);
    } finally {
      scanMs += performance.now() - s;
    }
  };

  const open = performance.now();
  await v.open();
  row("abrir o cofre (1º scan, lê todas as notas)", `${(performance.now() - open).toFixed(0)} ms`, "", "");
  // Um scan com o cache (T5352): o que cada renomear, mover e apagar de pasta paga.
  const warm: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const s = performance.now();
    await inner.scan({ quiet: true });
    warm.push(performance.now() - s);
  }
  row("um scan com o cache (nada mudou)", `${median(warm).toFixed(0)} ms`, "", "");

  // As leituras que a janela faz no `after()`.
  const measure = (name: string, fn: () => unknown) => {
    const runs: number[] = [];
    let out: unknown;
    for (let r = 0; r < ROUNDS; r++) {
      const s = performance.now();
      out = fn();
      runs.push(performance.now() - s);
    }
    const s = performance.now();
    const size = kb(out);
    const json = performance.now() - s;
    row(name, `${median(runs).toFixed(1)} ms`, `${size} KB`, `${json.toFixed(0)} ms`);
    return out;
  };
  const full = measure("notes.list (inteira, o que o projects.list chama)", () => v.list()) as { filesVersion?: string };
  measure("notes.list { lazy } (a abertura e o after() da janela)", () => v.list({ lazy: true }));
  measure("notes.list { filesVersion } (sem os arquivos)", () => v.list({ filesVersion: full.filesVersion }));
  measure("notes.tags", () => v.tags());
  measure("notes.folders", () => v.folderList());
  measure("semanticDocuments (a cada notes.changed, com a busca pelo sentido)", () => v.semanticDocuments().length);

  // As operações: cada uma numa nota ou pasta diferente, para não medir o cache de uma rodada na outra.
  const op = async (name: string, fn: (r: number) => Promise<unknown>) => {
    const runs: number[] = [];
    const counts: number[] = [];
    const inScan: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      scans = 0;
      scanMs = 0;
      const s = performance.now();
      await fn(r);
      runs.push(performance.now() - s);
      counts.push(scans);
      inScan.push(scanMs);
    }
    row(name, `${median(runs).toFixed(0)} ms`, `${median(counts)} scan(s)`, `${median(inScan).toFixed(0)} ms em scan`);
  };
  await op("criar nota", (r) => v.create("Pasta 1", `Nova ${r}`, "# Nova\n"));
  await op("salvar nota", async (r) => {
    const n = await v.get(`Pasta 1/Nova ${r}.md`);
    return v.save(n.path, `${n.content}mais\n`, n.version);
  });
  await op("renomear nota", (r) => v.rename(`Pasta 1/Nova ${r}.md`, `Pasta 1/Renomeada ${r}.md`));
  await op("mover nota", (r) => v.moveNote(`Pasta 1/Renomeada ${r}.md`, "Pasta 2"));
  await op("apagar nota", (r) => v.delete(`Pasta 2/Renomeada ${r}.md`));
  await op("desfazer o apagar da nota", (r) => v.restore(`Pasta 2/Renomeada ${r}.md`));
  await op("criar pasta", (r) => v.createFolder(`Pasta 3/Nova pasta ${r}`));
  await op("renomear pasta (vazia)", (r) => v.moveFolder(`Pasta 3/Nova pasta ${r}`, `Pasta 3/Ideias ${r}`));
  // Uma pasta com notas dentro (as de `Pasta 10/Sub …` têm ~2 cada).
  await op("renomear pasta (com notas)", (r) => v.moveFolder(`Pasta 10/Sub ${70 + top * r}`, `Pasta 10/Sub renomeada ${r}`));
  await op("mover pasta", (r) => v.moveFolder(`Pasta 3/Ideias ${r}`, `Pasta 4/Ideias ${r}`));
  await op("apagar pasta", (r) => v.deleteFolder(`Pasta 4/Ideias ${r}`));
  await op("desfazer o apagar da pasta", (r) => v.restore(`Pasta 4/Ideias ${r}`));

  const w = Math.max(...rows.map((c) => c[0]!.length));
  for (const c of rows) console.log(`${c[0]!.padEnd(w)}  ${(c[1] ?? "").padStart(9)}  ${(c[2] ?? "").padStart(12)}  ${c[3] ?? ""}`);
  console.log(`(medianas de ${ROUNDS}; KB = o JSON da resposta, e o tempo de montá-lo, que a ponte paga)`);
  v.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
