// Quanto o histórico custa em cada gravação (T22576, spec #21160): 20 gravações seguidas de uma planilha de uns 3,6 MB
// e de um quadro branco, pelo `files.save` e pelo `notes.canvasSave` de verdade, num cofre num tmp. Conta quantas vezes
// a gravação leu o arquivo inteiro do disco antes de gravar, e mede quanto leva cada uma. Tudo inventado (as vendas de
// uma loja de exemplo e um quadro de tarefas).
//
//   bun scripts/historico-gravacao-medida.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as XLSX from "xlsx";

import { uiCapabilities } from "../src/bun/ui-capabilities.ts";
import { directInvoke } from "../src/bun/ui-engine.ts";
import { Vault } from "../src/notes/vault.ts";
import { NoteVersions } from "../src/notes/versions.ts";
import { DEFAULT_SETTINGS } from "../src/store/settings.ts";

const SAVES = 20;

/** As vendas de uma loja inventada: o bastante para uns 3,6 MB de xlsx. `edit` muda uma quantidade. */
function xlsx(edit: number): Uint8Array {
  const rows: unknown[][] = [["Pedido", "Data", "Produto", "Qtd", "Preço", "Total", "Vendedor", "Cidade", "Nota"]];
  for (let i = 1; i <= 27_000; i++)
    rows.push([i, `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, `Produto ${i % 97}`, i === edit ? 999 : (i * 7) % 40, ((i * 13) % 900) / 10, ((i * 91) % 9000) / 10, `Vendedor ${i % 23}`, `Cidade ${i % 31}`, `pedido de exemplo ${i}`]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Vendas");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}

/** Um quadro de tarefas inventado, com 300 cartões. `edit` muda o texto de um. */
function board(edit: number): string {
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, type: "text", text: i === edit ? `tarefa ${i} (feita)` : `tarefa ${i}`, x: (i % 20) * 280, y: Math.floor(i / 20) * 120, width: 250, height: 80 }));
  return JSON.stringify({ nodes, edges: [] }, null, 2);
}

const data = mkdtempSync(path.join(tmpdir(), "kn-22576-"));
try {
  const root = path.join(data, "V");
  mkdirSync(path.join(root, "Loja"), { recursive: true });
  writeFileSync(path.join(root, "Loja", "vendas.xlsx"), xlsx(0));
  writeFileSync(path.join(root, "Loja", "Tarefas.canvas"), board(-1));
  const vault = new Vault({ root, trash: async () => {} });
  const versions = new NoteVersions({ dir: path.join(data, "history", "notes") });

  // Conta as leituras do arquivo inteiro que a gravação faz antes de gravar.
  const reads = { file: 0, fileBytes: 0, canvas: 0 };
  const readFile = vault.readFile.bind(vault);
  vault.readFile = (async (...args: Parameters<typeof vault.readFile>) => {
    const r = await readFile(...args);
    reads.file++;
    if (r && "base64" in r) reads.fileBytes += Math.floor((r.base64.length * 3) / 4);
    return r;
  }) as typeof vault.readFile;
  const getCanvas = vault.getCanvas.bind(vault);
  vault.getCanvas = (async (...args: Parameters<typeof vault.getCanvas>) => {
    reads.canvas++;
    return getCanvas(...args);
  }) as typeof vault.getCanvas;

  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (x) => x },
    snippets: { load: async () => [], save: async (x) => x },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS }), save: async () => ({ ...DEFAULT_SETTINGS }) },
    clipboardWrite: () => {},
    notes: vault,
    versions,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (cap: string, args: unknown): Promise<any> => {
    const r = (await directInvoke(caps, cap, args)) as { ok: boolean; value?: unknown; code?: string; message?: string };
    if (!r.ok) throw new Error(`${cap}: ${r.code} ${r.message ?? ""}`);
    return r.value;
  };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  // A planilha: a 1ª gravação cria o histórico (aí ler o de antes é preciso); as outras 19, não.
  const files = Array.from({ length: SAVES }, (_, i) => Buffer.from(xlsx(i + 1)).toString("base64"));
  const first = await readFile("Loja/vendas.xlsx", "binary");
  if ("tooLarge" in first) throw new Error("a planilha passou do teto de leitura");
  let version = first.version;
  const ms: number[] = [];
  const perSave: number[] = [];
  for (const b64 of files) {
    const before = reads.file;
    const t0 = performance.now();
    const r = await call("files.save", { path: "Loja/vendas.xlsx", base64: b64, baseVersion: version });
    ms.push(performance.now() - t0);
    perSave.push(reads.file - before);
    version = r.version;
  }
  await versions.flush();
  const size = Math.round((files[0]!.length * 3) / 4 / 1024 / 102.4) / 10;
  console.log(
    `xlsx de ${size} MB, ${SAVES} gravações: ${reads.file} leituras do arquivo inteiro (${(reads.fileBytes / 1024 / 1024).toFixed(1)} MB lidos); ` +
      `por gravação: a 1ª leu ${perSave[0]}, as outras ${perSave.slice(1).reduce((a, b) => a + b, 0)} no total; ` +
      `mediana ${median(ms.slice(1)).toFixed(0)} ms (a 1ª, ${ms[0]!.toFixed(0)} ms)`,
  );

  // O quadro: o mesmo, pelo notes.canvasSave.
  let cv = (await getCanvas("Loja/Tarefas.canvas")).version;
  reads.canvas = 0;
  const cms: number[] = [];
  const cper: number[] = [];
  for (let i = 0; i < SAVES; i++) {
    const before = reads.canvas;
    const t0 = performance.now();
    const r = await call("notes.canvasSave", { path: "Loja/Tarefas.canvas", content: board(i), baseVersion: cv });
    cms.push(performance.now() - t0);
    cper.push(reads.canvas - before);
    cv = r.version;
  }
  console.log(
    `quadro de 300 cartões, ${SAVES} gravações: ${reads.canvas} leituras do quadro; a 1ª leu ${cper[0]}, as outras ${cper.slice(1).reduce((a, b) => a + b, 0)} no total; ` +
      `mediana ${median(cms.slice(1)).toFixed(1)} ms`,
  );
  vault.close?.();
  await versions.close();
} finally {
  rmSync(data, { recursive: true, force: true });
}
