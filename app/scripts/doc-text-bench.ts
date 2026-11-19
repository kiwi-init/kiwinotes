// O custo de tirar o texto de dentro do pdf, do docx e do xlsx (T22218, issue #156): 200 arquivos inventados de cada
// tipo, gerados num tmp, e o tempo e a RAM (o medidor do #149, o `phys_footprint`) de ler todos, um tipo por vez.
//
//   kiwi lock bench --ttl 10m && bun scripts/doc-text-bench.ts [--n 200] [--json]
//
// O conteúdo é inventado aqui (a loja de exemplo); nada sai da máquina.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { processMemory } from "../src/bun/memory.ts";
import { docText } from "../src/notes/doc-text.ts";
import { zipBytes } from "../test/office-files.ts";

const arg = (name: string) => process.argv.indexOf(name);
const N = arg("--n") > 0 ? Number(process.argv[arg("--n") + 1]) : 200;
const JSON_OUT = arg("--json") > 0;

const PALAVRAS = "caixa fita parafuso prateleira contagem estoque seção entrada saída loja exemplo azul verde fundo frente sexta".split(" ");
/** Um gerador fixo: o mesmo lote a cada rodada. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const frase = (r: () => number, n: number) => Array.from({ length: n }, () => PALAVRAS[Math.floor(r() * PALAVRAS.length)]).join(" ");

/** Um pdf de 1 a 20 páginas, ~40 linhas de texto em cada. */
async function pdf(r: () => number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = 1 + Math.floor(r() * 20);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    for (let l = 0; l < 40; l++) page.drawText(frase(r, 10), { x: 40, y: 800 - l * 19, size: 10, font });
  }
  return doc.save();
}

/** Um docx de 20 a 600 parágrafos, com uma tabela de 20 linhas. */
function docx(r: () => number): Uint8Array {
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r></w:p>`;
  const n = 20 + Math.floor(r() * 580);
  const rows = Array.from({ length: 20 }, () => `<w:tr>${[frase(r, 2), String(Math.floor(r() * 100))].map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`).join("");
  const body = Array.from({ length: n }, () => p(frase(r, 18))).join("") + `<w:tbl>${rows}</w:tbl>`;
  return zipBytes(
    { "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>` },
    { deflate: true },
  );
}

/** Um xlsx de 1 a 3 abas, 50 a 3.000 linhas de 6 colunas cada. */
function xlsx(r: () => number): Uint8Array {
  const wb = XLSX.utils.book_new();
  const abas = 1 + Math.floor(r() * 3);
  for (let a = 0; a < abas; a++) {
    const linhas = 50 + Math.floor(r() * 2950);
    const aoa: (string | number)[][] = [["Produto", "Seção", "Qtd", "Preço", "Local", "Nota"]];
    for (let i = 0; i < linhas; i++) aoa.push([frase(r, 2), frase(r, 1), Math.floor(r() * 500), Math.round(r() * 10000) / 100, frase(r, 1), frase(r, 4)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Aba ${a + 1}`);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}

const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;

const dir = mkdtempSync(path.join(tmpdir(), "kiwi-doc-text-bench-"));
try {
  const gens = { pdf, docx, xlsx } as const;
  const results: Record<string, unknown>[] = [];
  for (const [ext, gen] of Object.entries(gens)) {
    const r = rng(ext.length * 7919);
    let bytesTotal = 0;
    for (let i = 0; i < N; i++) {
      const b = await gen(r);
      bytesTotal += b.byteLength;
      writeFileSync(path.join(dir, `${ext}-${i}.${ext}`), b);
    }
    Bun.gc(true);
    const before = processMemory(process.pid);
    let peak = before?.now ?? 0;
    const times: number[] = [];
    let chars = 0;
    let segments = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const file = path.join(dir, `${ext}-${i}.${ext}`);
      const t = performance.now();
      const d = await docText(file, new Uint8Array(readFileSync(file)));
      times.push(performance.now() - t);
      segments += d.segments.length;
      for (const s of d.segments) chars += s.text.length;
      const m = processMemory(process.pid);
      if (m && m.now > peak) peak = m.now;
    }
    const total = performance.now() - t0;
    Bun.gc(true);
    const after = processMemory(process.pid);
    results.push({
      tipo: ext,
      arquivos: N,
      mbArquivos: mb(bytesTotal),
      mbTexto: mb(chars),
      pedacos: segments,
      totalMs: Math.round(total),
      medioMs: Math.round(total / N),
      p95Ms: Math.round(pct(times, 0.95)),
      maxMs: Math.round(Math.max(...times)),
      ramAntesMb: before ? mb(before.now) : null,
      ramPicoMb: mb(peak),
      ramDepoisMb: after ? mb(after.now) : null,
      subiuNoPicoMb: before ? mb(peak - before.now) : null,
    });
    for (let i = 0; i < N; i++) rmSync(path.join(dir, `${ext}-${i}.${ext}`), { force: true });
  }
  if (JSON_OUT) console.log(JSON.stringify(results, null, 2));
  else console.table(results);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
