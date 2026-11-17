// T2619: as tags e os modelos no engine, pelo vault e pelo caminho da UI.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { directInvoke } from "../bun/ui-engine.ts";
import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup(files: Record<string, string>) {
  const root = path.join(tempDir("kn-tags-"), "V");
  dirs.push(path.dirname(root));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  const v = new Vault({ root, trash: async () => {} });
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => settings, save: async (p) => (settings = { ...settings, ...p, appearance: { ...settings.appearance, ...p.appearance } }) },
    clipboardWrite: () => {},
    notes: v,
  });
  return { v, call: (cap: string, args: unknown = {}) => directInvoke(caps, cap, args) };
}

test("notes.tags: a árvore com as do texto e as do frontmatter, sem diferença de maiúscula", async () => {
  const { call } = await setup({
    "A.md": "---\ntags: [Projeto/kiwi, leitura]\n---\nTexto #ideia.",
    "B.md": "Sobre o #projeto/site e o #projeto/kiwi. `#codigo` #2026",
  });
  const r = (await call("notes.tags")) as { ok: true; value: { tags: { tag: string; count: number; children: { tag: string; count: number }[] }[] } };
  // A grafia é a que apareceu primeiro; a contagem junta as duas.
  const low = (list: { tag: string; count: number }[]) => list.map((t) => [t.tag.toLowerCase(), t.count]);
  expect(low(r.value.tags)).toEqual([
    ["ideia", 1],
    ["leitura", 1],
    ["projeto", 2],
  ]);
  expect(low(r.value.tags[2]!.children)).toEqual([
    ["projeto/kiwi", 2],
    ["projeto/site", 1],
  ]);
});

test("notes.search com tag: e #, sozinho ou com texto", async () => {
  const { call } = await setup({
    "A.md": "#projeto/kiwi reunião de segunda",
    "B.md": "#projeto/site reunião",
    "C.md": "reunião sem tag",
  });
  const paths = async (q: string) => ((await call("notes.search", { query: q })) as { value: { path: string }[] }).value.map((h) => h.path).sort();
  expect(await paths("tag:projeto")).toEqual(["A.md", "B.md"]);
  expect(await paths("#projeto/kiwi")).toEqual(["A.md"]);
  expect(await paths("tag:projeto segunda")).toEqual(["A.md"]);
  expect(await paths("tag:outra")).toEqual([]);
});

test("modelos: a pasta das settings, e o notes.create com template troca as variáveis", async () => {
  const { v, call } = await setup({
    "Modelos/Ata.md": "---\ntags: [ata]\n---\n# {{title}}\n\nData: {{date:DD/MM/AAAA}}, {{time}}\n",
    "Modelos/Diário.md": "{{date}}",
    "Outra.md": "não é modelo",
  });
  const t = (await call("notes.templates")) as { value: { folder: string; templates: { path: string }[] } };
  expect(t.value.folder).toBe("Modelos");
  expect(t.value.templates.map((m) => m.path)).toEqual(["Modelos/Ata.md", "Modelos/Diário.md"]);

  const n = await v.create("Reuniões", "Ata", "", "Modelos/Ata.md", new Date(2026, 10, 4, 14, 30));
  expect(n.path).toBe("Reuniões/Ata.md");
  expect(n.content).toBe("---\ntags: [ata]\n---\n# Ata\n\nData: 04/11/2026, 14:30\n");
  const again = await v.create("Reuniões", "Ata", "", "Modelos/Ata.md", new Date(2026, 10, 4, 14, 30));
  expect(again.content).toContain("# Ata 2");

  expect(await call("notes.create", { title: "X", content: "a", template: "Modelos/Ata.md" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(await call("notes.create", { title: "X", template: "Modelos/Sumiu.md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
  expect(await call("settings.set", { templatesFolder: "" })).toMatchObject({ ok: false });
  expect(await call("settings.set", { templatesFolder: "../fora" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
  expect(await call("settings.set", { templatesFolder: "Coisas/Modelos" })).toMatchObject({ ok: true, value: { templatesFolder: "Coisas/Modelos" } });
});

test("settings.set { savedSearches } (T2660): nome e busca, sem repetir a busca", async () => {
  const { call } = await setup({});
  expect(await call("settings.set", { savedSearches: [{ name: "Projetos", query: "tag:projeto -tag:velho" }] })).toMatchObject({
    ok: true,
    value: { savedSearches: [{ name: "Projetos", query: "tag:projeto -tag:velho" }] },
  });
  expect(await call("settings.set", { savedSearches: [{ name: "", query: "x" }] })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(await call("settings.set", { savedSearches: [{ name: "a", query: "x" }, { name: "b", query: "x" }] })).toMatchObject({ ok: false });
  expect(await call("settings.set", { savedSearches: "x" })).toMatchObject({ ok: false });
});
