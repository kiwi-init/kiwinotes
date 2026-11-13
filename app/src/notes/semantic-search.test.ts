// T6013: o BM25 somado ao sentido no `Vault.search`. Sem o sentido, a busca é a de antes; com ele, os filtros valem,
// o exato vem antes, o achado só pelo sentido vem marcado com o trecho, e o aproximado fica por último.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DIM, fakeEmbedder } from "./semantic/fake.ts";
import { SemanticIndex } from "./semantic/index.ts";
import { SEMANTIC_LIMIT, Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FILES = {
  "Infra/Backup.md": "#infra Configurar o backup do servidor PACS toda noite no storage.",
  "Infra/Rascunho backup.md": "#infra #velho rascunho antigo sobre storage e clientes",
  "Cozinha/Bolo.md": "Receita de bolo de cenoura com cobertura de chocolate.",
  "Viagem.md": "Ideias de férias: praia em janeiro, passagens baratas.",
  "Vendas.md": "Reunião de vendas: a meta do trimestre e os clientes novos. Precisamos de cópia do contrato.",
};

async function setup() {
  const base = tempDir("kn-semantic-search-");
  dirs.push(base);
  const root = path.join(base, "V");
  for (const [p, c] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  const v = new Vault({ root, trash: async () => {} });
  await v.open();
  const model = fakeEmbedder();
  const index = new SemanticIndex({ dir: path.join(base, "semantic"), engine: { start: async () => model, loaded: () => model }, dim: DIM, pause: async () => {} });
  index.sync(v.semanticDocuments());
  await index.idle();
  const search = async (q: string, limit?: number) => v.search(q, limit, await index.query(q.replace(/(?:^|\s)-?(?:tag|path):\S+|-\S+/g, " ").trim(), 50));
  return { v, index, search };
}

test("sem o sentido, igual à busca de antes; com o sentido vazio também", async () => {
  const { v } = await setup();
  for (const q of ["backup", "storage servidor", "tag:infra", '"meta do trimestre"', "bolo -chocolate", "receitta"]) {
    expect(v.search(q, 20, [])).toEqual(v.search(q));
    expect(v.search(q, 20, undefined)).toEqual(v.search(q));
  }
});

test("acha pelo sentido o que não tem a palavra, marcado e com o trecho da nota", async () => {
  const { v, search } = await setup();
  expect(v.search("cópia de segurança das imagens")).toEqual([]);
  const hits = await search("cópia de segurança das imagens");
  expect(hits[0]).toMatchObject({ path: "Infra/Backup.md", semantic: true });
  expect(hits[0]!.snippet).toContain("backup do servidor PACS");
  expect(hits.every((h) => h.semantic)).toBe(true);
  expect(hits.some((h) => h.path === "Cozinha/Bolo.md")).toBe(false);
});

test("o exato vem antes do achado só pelo sentido", async () => {
  const { search } = await setup();
  const hits = await search("cópia");
  expect(hits[0]).toMatchObject({ path: "Vendas.md" });
  expect(hits[0]!.semantic).toBeUndefined();
  expect(hits.slice(1).map((h) => h.path)).toContain("Infra/Backup.md");
  expect(hits.slice(1).every((h) => h.semantic)).toBe(true);
});

test("os filtros valem junto com o RRF: tag:, path: e as exclusões", async () => {
  const { search } = await setup();
  const paths = async (q: string) => (await search(q)).map((h) => h.path);
  expect(await paths("segurança das imagens tag:infra -tag:velho")).toEqual(["Infra/Backup.md"]);
  expect(await paths("segurança das imagens path:cozinha")).toEqual([]);
  expect(await paths("segurança das imagens -path:infra")).not.toContain("Infra/Backup.md");
  expect(await paths("segurança das imagens -pacs")).not.toContain("Infra/Backup.md");
  expect(await paths('segurança "toda noite"')).toEqual(["Infra/Backup.md"]);
  expect(await paths('segurança "nada disso"')).toEqual([]);
});

test("o sentido reordena o exato pelo RRF", async () => {
  const { v } = await setup();
  const lexical = v.search("storage");
  expect(lexical.map((h) => h.path).sort()).toEqual(["Infra/Backup.md", "Infra/Rascunho backup.md"]);
  const favorRascunho = v.search("storage", 20, [{ path: "Infra/Rascunho backup.md", score: 0.95, chunk: 0, near: false }]);
  const favorBackup = v.search("storage", 20, [{ path: "Infra/Backup.md", score: 0.95, chunk: 0, near: false }]);
  expect(favorRascunho[0]!.path).toBe("Infra/Rascunho backup.md");
  expect(favorBackup[0]!.path).toBe("Infra/Backup.md");
});

test("o que não está perto não entra sozinho; no máximo SEMANTIC_LIMIT pelo sentido; nota que sumiu não volta", async () => {
  const { v } = await setup();
  expect(v.search("xyz", 20, [{ path: "Viagem.md", score: 0.95, chunk: 0, near: false }])).toEqual([]);
  expect(v.search("xyz", 20, [{ path: "Sumiu.md", score: 0.99, chunk: 0, near: true }])).toEqual([]);
  const many = Object.keys(FILES).flatMap((p) => Array.from({ length: 3 }, () => ({ path: p, score: 0.9, chunk: 0, near: true })));
  expect(v.search("xyz", 20, many).length).toBeLessThanOrEqual(SEMANTIC_LIMIT);
  expect(v.search("xyz", 2, many).length).toBe(2);
});

test("o aproximado (erro de digitação) fica depois do achado pelo sentido", async () => {
  const { v } = await setup();
  const hits = v.search("receitta", 20, [{ path: "Viagem.md", score: 0.9, chunk: 0, near: true }]);
  expect(hits.map((h) => [h.path, !!h.semantic, !!h.approx])).toEqual([
    ["Viagem.md", true, false],
    ["Cozinha/Bolo.md", false, true],
  ]);
});

test("pelo contrato: o notes.search soma o sentido, o status conta as notas e desligar apaga modelo e vetores", async () => {
  const { uiCapabilities } = await import("../bun/ui-capabilities.ts");
  const { directInvoke } = await import("../bun/ui-engine.ts");
  const { DEFAULT_SETTINGS } = await import("../store/settings.ts");
  const { SemanticEngine } = await import("./semantic/engine.ts");
  type AppSettings = import("../store/settings.ts").AppSettings;
  const base = tempDir("kn-semantic-caps-");
  dirs.push(base);
  const root = path.join(base, "V");
  for (const [p, c] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
  const vault = new Vault({ root, trash: async () => {} });
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  const disabled: string[] = [];
  const model = fakeEmbedder();
  let loaded: typeof model | null = null;
  const engine = new SemanticEngine({
    modelsDir: path.join(base, "models"),
    enabled: async () => settings.semanticSearch,
    load: async () => (loaded = model),
    fetch: async () => new Response("x"),
  });
  engine.start = async () => {
    loaded = settings.semanticSearch ? model : null;
    return loaded;
  };
  engine.loaded = () => loaded;
  engine.state = () => ({ phase: loaded ? "ready" : "off" });
  engine.disable = async () => {
    disabled.push("model");
    loaded = null;
  };
  const semanticDir = path.join(base, "semantic");
  const index = new SemanticIndex({ dir: semanticDir, engine, dim: DIM, pause: async () => {} });
  const c = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: {
      load: async () => settings,
      save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }),
    },
    clipboardWrite: () => {},
    notes: vault,
    semantic: index,
    semanticSource: vault,
    semanticEngine: engine,
  });
  const call = (cap: string, args: unknown) => directInvoke(c, cap, args);
  await call("notes.list", {});
  await index.idle();
  expect(await call("notes.semanticStatus", {})).toMatchObject({ ok: true, value: { enabled: true, phase: "ready", notes: 5, indexed: 5 } });
  const r = (await call("notes.search", { query: "segurança das imagens tag:infra -tag:velho" })) as { ok: boolean; value: { path: string; semantic?: boolean }[] };
  expect(r.value).toMatchObject([{ path: "Infra/Backup.md", semantic: true }]);
  expect(await call("notes.search", { query: "tag:infra" })).toMatchObject({ ok: true, value: [{}, {}] });
  expect(await call("settings.set", { semanticSearch: "sim" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(await call("settings.set", { semanticSearch: false })).toMatchObject({ ok: true, value: { semanticSearch: false } });
  expect(disabled).toEqual(["model"]);
  expect(await call("notes.search", { query: "segurança das imagens" })).toMatchObject({ ok: true, value: [] });
  expect(await call("notes.semanticStatus", {})).toMatchObject({ ok: true, value: { enabled: false, indexed: 0 } });
  const { existsSync } = await import("node:fs");
  expect(existsSync(semanticDir)).toBe(false);
});
