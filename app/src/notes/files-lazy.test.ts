// A abertura das Notas sem a lista inteira dos arquivos (spec #13664, T13694): no cofre do harry, 150 mil arquivos que
// não são nota (16,6 MB) iam para a tela na primeira lista, e as Notas levavam de 9 a 12 s para abrir. Com o `lazy`,
// a abertura traz só as notas, as pastas e quantos arquivos há em cada pasta; os arquivos vêm por pasta, quando ela
// abre, e os links `[[arquivo]]` se resolvem em lote.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string>) {
  const dir = tempDir("kiwinotes-files-lazy-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

const FILES = {
  "A.md": "# A\n\nVer [[relatorio.pdf]] e [[foto]].\n",
  "capa.png": "png",
  "docs/relatorio.pdf": "pdf",
  "docs/planilha.xlsx": "xlsx",
  "docs/fundo/velho.pdf": "pdf",
  "img/foto.png": "png",
};

describe("notes.list com lazy (spec #13664)", () => {
  test("a abertura vem sem os arquivos, com quantos há direto em cada pasta", async () => {
    const { v } = await vault(FILES);
    const l = v.list({ lazy: true });
    expect(l.files).toBeUndefined();
    expect(l.filesDelta).toBeUndefined();
    expect(l.notes.map((n) => n.path)).toEqual(["A.md"]);
    expect(l.folders).toEqual(["docs", "docs/fundo", "img"]);
    expect(l.fileCounts).toEqual({ "": 1, docs: 2, "docs/fundo": 1, img: 1 });
    expect(l.filesVersion).toBe(v.list().filesVersion);
    // Sem o `lazy`, a lista inteira, como antes (o leitor do agente usa).
    expect(v.list().files.map((f) => f.path)).toEqual(["capa.png", "docs/fundo/velho.pdf", "docs/planilha.xlsx", "docs/relatorio.pdf", "img/foto.png"]);
  });

  test("os arquivos de uma pasta, em ordem, só os diretos; a raiz é \"\"; uma pasta que não existe dá E_NOT_FOUND", async () => {
    const { v } = await vault(FILES);
    expect(v.filesIn("docs").files.map((f) => f.path)).toEqual(["docs/planilha.xlsx", "docs/relatorio.pdf"]);
    expect(v.filesIn("/docs/").folder).toBe("docs");
    expect(v.filesIn("").files.map((f) => f.path)).toEqual(["capa.png"]);
    expect(v.filesIn("img").filesVersion).toBe(v.filesVersion());
    expect(() => v.filesIn("nada")).toThrow();
    // Por partes: o começo e o resto, com o total.
    const first = v.filesIn("docs", { limit: 1 });
    expect(first.files.map((f) => f.path)).toEqual(["docs/planilha.xlsx"]);
    expect(first.total).toBe(2);
    expect(v.filesIn("docs", { offset: 1 }).files.map((f) => f.path)).toEqual(["docs/relatorio.pdf"]);
  });

  test("um arquivo novo muda o contador e a lista da pasta", async () => {
    const { v, root } = await vault(FILES);
    const before = v.list({ lazy: true });
    writeFileSync(path.join(root, "docs", "novo.pdf"), "pdf");
    await v.reconcile();
    const after = v.list({ lazy: true });
    expect(after.fileCounts!.docs).toBe(3);
    expect(after.filesVersion).not.toBe(before.filesVersion);
    expect(v.filesIn("docs").files.map((f) => f.path)).toContain("docs/novo.pdf");
  });

  test("a busca da barra lateral acha arquivos de pastas fechadas, sem acento nem maiúscula", async () => {
    const { v } = await vault({ ...FILES, "docs/Relatório final.docx": "docx" });
    expect(v.filesMatching("relatorio").files.map((f) => f.path)).toEqual(["docs/Relatório final.docx", "docs/relatorio.pdf"]);
    expect(v.filesMatching("docs pdf").files.map((f) => f.path)).toEqual(["docs/fundo/velho.pdf", "docs/relatorio.pdf"]);
    expect(v.filesMatching("   ").files).toEqual([]);
    const capped = v.filesMatching("o", 2);
    expect(capped.files).toHaveLength(2);
    expect(capped.more).toBe(true);
    // Com o corte, os primeiros do alfabeto (revisão do #540).
    expect(capped.files.map((f) => f.path)).toEqual(v.filesMatching("o").files.slice(0, 2).map((f) => f.path));
  });

  test("os links para arquivos se resolvem em lote, sem a lista", async () => {
    const { v } = await vault(FILES);
    expect(v.resolveFiles(["relatorio.pdf", "foto.png", "docs/planilha.xlsx", "não existe.pdf"])).toEqual({
      "relatorio.pdf": "docs/relatorio.pdf",
      "foto.png": "img/foto.png",
      "docs/planilha.xlsx": "docs/planilha.xlsx",
      "não existe.pdf": null,
    });
  });
});

describe("as capacidades da árvore preguiçosa (spec #13664)", () => {
  async function invoker() {
    const { v } = await vault(FILES);
    const caps = uiCapabilities({ notes: v, settings: { load: async () => DEFAULT_SETTINGS, save: async () => DEFAULT_SETTINGS } } as never);
    return (cap: string, args: unknown) => directInvoke(caps, cap as never, args) as Promise<{ ok: boolean; code?: string; value?: any }>;
  }

  test("notes.list {lazy}, notes.files e files.resolve", async () => {
    const invoke = await invoker();
    const l = (await invoke("notes.list", { lazy: true })).value;
    expect(l.files).toBeUndefined();
    expect(l.fileCounts.docs).toBe(2);
    const f = (await invoke("notes.files", { folder: "docs" })).value;
    expect(f.files.map((x: { path: string }) => x.path)).toEqual(["docs/planilha.xlsx", "docs/relatorio.pdf"]);
    expect((await invoke("files.resolve", { targets: ["relatorio.pdf"] })).value.paths).toEqual({ "relatorio.pdf": "docs/relatorio.pdf" });
    expect(await invoke("notes.files", { folder: "nada" })).toMatchObject({ ok: false });
    expect((await invoke("notes.files", { query: "foto" })).value.files.map((x: { path: string }) => x.path)).toEqual(["img/foto.png"]);
    expect(await invoke("notes.files", { query: "foto", folder: "img" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("os argumentos errados são recusados", async () => {
    const invoke = await invoker();
    expect(await invoke("notes.list", { lazy: "sim" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await invoke("notes.files", { folder: 3 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await invoke("files.resolve", { targets: Array.from({ length: 501 }, () => "a") })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await invoke("files.resolve", { targets: [1] })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});
