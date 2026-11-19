// O pedaço da lista no `notes.changed` (T20249, spec #20118, U2): a lista que a janela tinha, com os pedaços de cada
// aviso por cima, fica igual à lista inteira pedida depois. Cofre inventado, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type ListingPatch, Vault } from "./vault.ts";
import { applyListingPatch } from "../../ui/notes/listing-patch.ts";
import type { VaultListing } from "../../ui/notes/types.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const files: Record<string, string> = {
  "Projetos/Plano.md": "# Plano\n\nVer [[Ideias]].\n",
  "Projetos/Velhos/Lista.md": "# Lista\n#arquivo\n",
  "Projetos/Velhos/dados.csv": "a,b\n1,2\n",
  "Projetos/Velhos/Mais velhos/Nota.md": "# Nota\n",
  "Ideias.md": "# Ideias\n\n[[Plano]]\n",
  "Diário/2026/Segunda.md": "# Segunda\n",
  "Diário/2026/foto.png": "png",
};

async function setup() {
  const dir = tempDir("kiwinotes-listing-patch-");
  dirs.push(dir);
  const root = path.join(dir, "Cofre");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true, force: true }) });
  vaults.push(v);
  await v.open();
  const patches: (ListingPatch | null)[] = [];
  v.onChanged((paths) => patches.push(v.listingPatch(paths)));
  return { v, root, patches };
}

const lazy = (v: Vault) => v.list({ lazy: true }) as VaultListing;
/** O que a árvore usa: as notas (com pasta, título e versão), as pastas e os contadores de arquivos. */
const shape = (l: VaultListing) => ({
  notes: l.notes.map((n) => `${n.path}|${n.folder}|${n.title}|${n.version}|${n.tags.join(",")}`),
  folders: l.folders,
  fileCounts: Object.fromEntries(Object.entries(l.fileCounts ?? {}).sort(([a], [b]) => a.localeCompare(b))),
});

describe("o pedaço da lista no notes.changed (spec #20118, U2)", () => {
  const ops: [string, (v: Vault) => Promise<unknown>][] = [
    ["criar nota", (v) => v.create("Projetos", "Nova")],
    ["criar nota numa pasta nova de cima", (v) => v.create("Novas/Mais", "Funda")],
    ["salvar", async (v) => v.save("Ideias.md", "# Ideias\n\n#nova\n", (await v.get("Ideias.md")).version)],
    ["renomear nota", (v) => v.rename("Ideias.md", "Ideias boas.md")],
    ["mover nota", (v) => v.moveNote("Projetos/Velhos/Lista.md", "Diário")],
    ["duplicar", (v) => v.duplicate("Projetos/Plano.md")],
    ["criar pasta", (v) => v.createFolder("Projetos/Vazia")],
    ["renomear pasta com subpastas e arquivos", (v) => v.moveFolder("Projetos/Velhos", "Projetos/Antigos")],
    ["mover pasta para outra que não existe", (v) => v.moveFolder("Projetos", "Trabalho/Projetos")],
    ["apagar nota", (v) => v.delete("Ideias.md")],
    ["apagar pasta", (v) => v.deleteFolder("Diário")],
    ["apagar e desfazer pasta", async (v) => { await v.deleteFolder("Diário"); await v.restore("Diário"); }],
  ];
  for (const [name, op] of ops) {
    test(name, async () => {
      const { v, patches } = await setup();
      const before = lazy(v);
      await op(v);
      expect(patches.length).toBeGreaterThan(0);
      expect(patches.every((p) => p !== null)).toBe(true);
      const patched = patches.reduce<VaultListing>((l, p) => applyListingPatch(l, p!), before);
      expect(shape(patched)).toEqual(shape(lazy(v)));
    });
  }

  test("repetir um pedaço não muda nada (o aviso atrasado do watcher)", async () => {
    const { v, patches } = await setup();
    const before = lazy(v);
    await v.moveFolder("Projetos/Velhos", "Arquivo");
    const once = patches.reduce<VaultListing>((l, p) => applyListingPatch(l, p!), before);
    const twice = patches.reduce<VaultListing>((l, p) => applyListingPatch(l, p!), once);
    expect(shape(twice)).toEqual(shape(once));
  });

  test("uma lista mais nova com o pedaço de novo por cima fica igual", async () => {
    const { v, patches } = await setup();
    await v.rename("Ideias.md", "Ideias boas.md");
    const after = lazy(v);
    expect(shape(applyListingPatch(after, patches[0]!))).toEqual(shape(after));
  });

  test("a raiz e um pedaço grande demais: null, e a janela pede a lista", async () => {
    const { v } = await setup();
    expect(v.listingPatch([""])).toBeNull();
    expect(v.listingPatch(["Projetos"], 1)).toBeNull();
    expect(v.listingPatch(["Projetos"])?.notes.length).toBe(3);
  });

  test("um caminho debaixo de outro entra uma vez só", async () => {
    const { v } = await setup();
    const p = v.listingPatch(["Projetos", "Projetos/Plano.md", "Projetos/Velhos"])!;
    expect(p.roots).toEqual(["Projetos"]);
    expect(p.notes.map((n) => n.path)).toEqual(["Projetos/Plano.md", "Projetos/Velhos/Lista.md", "Projetos/Velhos/Mais velhos/Nota.md"]);
    expect(p.folders).toEqual(["Projetos", "Projetos/Velhos", "Projetos/Velhos/Mais velhos"]);
    expect(p.fileCounts).toEqual({ "Projetos/Velhos": 1 });
  });
});
