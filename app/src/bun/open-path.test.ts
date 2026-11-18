// O clique num arquivo citado no balão do gato (spec #17683, T18127): o `notes.openPath` confere o caminho de novo e
// abre no lugar certo: `.md` e `.txt` nas Notas, um tipo com visualizador nas Notas, o resto no app padrão do Mac. Os
// dois "abrir" aqui são falsos e só anotam: nada abre na tela de ninguém.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Vault } from "../notes/vault.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { tempDir } from "../../test/tmp.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Tudo inventado (AGENTS.md).
const FILES: Record<string, string> = {
  "Feira.md": "# Feira\n",
  "Projeto X/lista.txt": "maçã\n",
  "Projeto X/plano.pdf": "%PDF-1.4",
  "Projeto X/contas.csv": "a,b\n",
  "Projeto X/relatorio.docx": "PK",
  "Projeto X/tabela.xlsx": "PK",
  "Projeto X/foto.png": "png",
  "Projeto X/quadro.canvas": "{}",
  "Projeto X/apresentacao.key": "k",
  "Projeto X/rodar.sh": "#!/bin/sh\n",
};

async function setup() {
  const dir = tempDir("kiwinotes-open-path-test-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  for (const [rel, content] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content, rel.endsWith(".sh") ? { mode: 0o755 } : undefined);
  }
  // Fora da pasta: um arquivo ao lado dela, e um link simbólico de dentro para ele.
  writeFileSync(path.join(dir, "fora.pdf"), "%PDF-1.4");
  writeFileSync(path.join(dir, "fora.md"), "# fora\n");
  symlinkSync(path.join(dir, "fora.pdf"), path.join(root, "atalho.pdf"));
  symlinkSync(path.join(dir, "fora.md"), path.join(root, "atalho.md"));
  symlinkSync(dir, path.join(root, "Pasta link"));
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  const inNotes: string[] = [];
  const inApp: [string, string][] = [];
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS }), save: async () => ({ ...DEFAULT_SETTINGS }) },
    clipboardWrite: () => {},
    notes: v,
    openFile: (abs, mode) => void inApp.push([path.relative(root, abs), mode]),
    openInNotes: (p) => void inNotes.push(p),
  });
  const openPath = (p: unknown) => directInvoke(caps, "notes.openPath", { path: p } as { path: string });
  return { openPath, inNotes, inApp };
}

test("nota e .txt abrem nas Notas; pdf, csv, docx, xlsx, imagem e quadro no visualizador; o resto no app do Mac", async () => {
  const { openPath, inNotes, inApp } = await setup();
  const opened: Record<string, unknown> = {};
  for (const p of Object.keys(FILES)) {
    const r = await openPath(p);
    opened[p] = r.ok ? (r.value as { opened: string }).opened : r;
  }
  expect(opened).toEqual({
    "Feira.md": "note",
    "Projeto X/lista.txt": "note",
    "Projeto X/plano.pdf": "viewer",
    "Projeto X/contas.csv": "viewer",
    "Projeto X/relatorio.docx": "viewer",
    "Projeto X/tabela.xlsx": "viewer",
    "Projeto X/foto.png": "viewer",
    "Projeto X/quadro.canvas": "viewer",
    "Projeto X/apresentacao.key": "app",
    "Projeto X/rodar.sh": "app",
  });
  expect(inNotes).toEqual([
    "Feira.md",
    "Projeto X/lista.txt",
    "Projeto X/plano.pdf",
    "Projeto X/contas.csv",
    "Projeto X/relatorio.docx",
    "Projeto X/tabela.xlsx",
    "Projeto X/foto.png",
    "Projeto X/quadro.canvas",
  ]);
  // O que rodaria algo (o bit de execução) só aparece no Finder, como no `files.open`.
  expect(inApp).toEqual([["Projeto X/apresentacao.key", "app"], ["Projeto X/rodar.sh", "finder"]]);
});

test("fora da pasta, por link simbólico, uma pasta ou o que não existe: erro, e nada abre", async () => {
  const { openPath, inNotes, inApp } = await setup();
  const asked = [
    "../fora.pdf",
    "../fora.md",
    "/etc/hosts",
    "Projeto X/../../fora.pdf",
    "atalho.pdf",
    "atalho.md",
    "Pasta link/fora.pdf",
    "Pasta link/fora.md",
    "Projeto X",
    "Projeto X/sumiu.pdf",
    "Sumiu.md",
    "",
    42,
  ];
  for (const p of asked) {
    const r = await openPath(p);
    expect({ p, ok: r.ok }).toEqual({ p, ok: false });
  }
  expect(inNotes).toEqual([]);
  expect(inApp).toEqual([]);
});

test("sem quem abra (o headless): só confere o caminho e diz onde abriria", async () => {
  const dir = tempDir("kiwinotes-open-path-test-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "plano.pdf"), "%PDF-1.4");
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS }), save: async () => ({ ...DEFAULT_SETTINGS }) },
    clipboardWrite: () => {},
    notes: v,
  });
  expect(await directInvoke(caps, "notes.openPath", { path: "plano.pdf" })).toEqual({ ok: true, value: { opened: "viewer" } });
});
