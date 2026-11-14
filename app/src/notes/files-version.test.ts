// Os arquivos que não são nota só quando mudam (spec #13384, T13408): no cofre do harry, 150 mil arquivos (15 MB) iam
// para a tela a cada save de nota. Com o `filesVersion`, vem nada, só a diferença, ou a lista inteira.

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
  const dir = tempDir("kiwinotes-files-version-");
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

describe("notes.list com filesVersion", () => {
  test("a mesma versão: sem os arquivos; um save de nota não muda a versão", async () => {
    const { v } = await vault({ "A.md": "# A\n", "docs/relatorio.pdf": "pdf", "img/foto.png": "png" });
    const full = v.list();
    expect(full.files.map((f) => f.path)).toEqual(["docs/relatorio.pdf", "img/foto.png"]);
    expect(full.filesVersion).toBeString();
    const same = v.list({ filesVersion: full.filesVersion });
    expect(same.files).toBeUndefined();
    expect(same.filesDelta).toBeUndefined();
    expect(same.notes.map((n) => n.path)).toEqual(["A.md"]);
    const note = await v.get("A.md");
    await v.save("A.md", "# A\n\nmais texto\n", note.version);
    expect(v.list({ filesVersion: full.filesVersion }).files).toBeUndefined();
    // Uma conferência do disco sem mudança nenhuma também não muda a versão.
    await v.reconcile();
    expect(v.list().filesVersion).toBe(full.filesVersion);
  });

  test("um arquivo que entra, muda ou sai: só a diferença", async () => {
    const { v, root } = await vault({ "A.md": "# A\n", "docs/relatorio.pdf": "pdf", "img/foto.png": "png" });
    const v0 = v.list().filesVersion;
    writeFileSync(path.join(root, "docs/novo.txt"), "oi");
    writeFileSync(path.join(root, "img/foto.png"), "png maior");
    await v.reconcile();
    const d = v.list({ filesVersion: v0 });
    expect(d.files).toBeUndefined();
    expect(d.filesDelta!.set.map((f) => f.path).sort()).toEqual(["docs/novo.txt", "img/foto.png"]);
    expect(d.filesDelta!.set.find((f) => f.path === "img/foto.png")!.size).toBe(9);
    expect(d.filesDelta!.removed).toEqual([]);
    expect(d.filesVersion).not.toBe(v0);

    const pdf = await v.readFile("docs/relatorio.pdf");
    await v.deleteFile("docs/relatorio.pdf", "version" in pdf ? pdf.version : "");
    const d2 = v.list({ filesVersion: d.filesVersion });
    expect(d2.filesDelta).toEqual({ set: [], removed: ["docs/relatorio.pdf"] });
    // De mais atrás, as duas mudanças juntas.
    const d3 = v.list({ filesVersion: v0 });
    expect(d3.filesDelta!.removed).toEqual(["docs/relatorio.pdf"]);
    expect(d3.filesDelta!.set.map((f) => f.path).sort()).toEqual(["docs/novo.txt", "img/foto.png"]);
  });

  test("a versão de outro cofre, uma que não existe ou um texto qualquer: a lista inteira", async () => {
    const { v } = await vault({ "A.md": "# A\n", "x.pdf": "pdf" });
    const { v: other } = await vault({ "B.md": "# B\n" });
    for (const filesVersion of [other.list().filesVersion, "abc.999", "banana", ""]) {
      const r = v.list({ filesVersion });
      expect(r.files?.map((f) => f.path)).toEqual(["x.pdf"]);
      expect(r.filesDelta).toBeUndefined();
    }
  });

  test("o resolvedor dos [[arquivo.pdf]] acompanha a versão", async () => {
    const { v, root } = await vault({ "A.md": "# A\n\n[[relatorio.pdf]] e [[novo.pdf]]\n", "docs/relatorio.pdf": "pdf" });
    expect((await v.linkWarnings("A.md")).map((w) => w.target)).toEqual(["novo.pdf"]);
    writeFileSync(path.join(root, "docs/novo.pdf"), "pdf");
    await v.reconcile();
    expect(await v.linkWarnings("A.md")).toEqual([]);
  });

  test("pela capacidade: o filesVersion vai e volta, e só texto é aceito", async () => {
    const { v } = await vault({ "A.md": "# A\n", "x.pdf": "pdf" });
    const caps = uiCapabilities({
      notes: v,
      settings: { load: async () => DEFAULT_SETTINGS, save: async () => DEFAULT_SETTINGS },
    } as never);
    const invoke = (args: unknown) => directInvoke(caps, "notes.list", args) as Promise<{ ok: boolean; code?: string; value?: { files?: unknown[]; filesVersion: string } }>;
    const full = await invoke({});
    expect(full.value!.files).toHaveLength(1);
    const same = await invoke({ filesVersion: full.value!.filesVersion });
    expect(same.ok).toBe(true);
    expect(same.value!.files).toBeUndefined();
    expect(await invoke({ filesVersion: 3 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await invoke({ outro: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});
