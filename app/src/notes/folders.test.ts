// T2468: o engine de pastas. Pastas de verdade (como no Obsidian), os [[links]] que seguem o que muda de lugar, o
// "Desfazer" do apagar e as fixadas. Tudo num tmp, com a Lixeira de mentira.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { directInvoke } from "./../bun/ui-engine.ts";
import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { buildTree, UNDO_DIR, Vault } from "./vault.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string> = {}, undoMs = 60_000) {
  const tmp = mkdtempSync(path.join(tmpdir(), "kn-folders-"));
  dirs.push(tmp);
  const root = path.join(tmp, "KiwiNotes");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    if (rel.endsWith("/")) mkdirSync(path.join(root, rel), { recursive: true });
    else writeFileSync(path.join(root, rel), content);
  }
  const trashed: string[] = [];
  const changes: string[][] = [];
  const v = new Vault({
    root,
    undoMs,
    trash: async (abs) => {
      trashed.push(path.relative(root, abs));
      rmSync(abs, { recursive: true });
    },
  });
  await v.open();
  v.onChanged((p) => changes.push(p));
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  return { v, root, trashed, changes, read };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("pastas (T2468)", () => {
  test("createFolder: cria os pais, entra no list e no tree mesmo vazia; já existe dá E_EXISTS", async () => {
    const { v, root, changes } = await vault({ "Solta.md": "x" });
    expect(await v.createFolder("Projetos/2026")).toEqual({ path: "Projetos/2026" });
    expect(existsSync(path.join(root, "Projetos", "2026"))).toBe(true);
    expect(v.list().folders).toEqual(["Projetos", "Projetos/2026"]);
    expect(v.list().tree).toEqual({
      path: "",
      name: "",
      notes: ["Solta.md"],
      folders: [{ path: "Projetos", name: "Projetos", notes: [], folders: [{ path: "Projetos/2026", name: "2026", notes: [], folders: [] }] }],
    });
    expect(changes).toEqual([["Projetos/2026"]]);
    expect(await code(v.createFolder("Projetos/2026"))).toBe("E_EXISTS");
    expect(await code(v.createFolder(""))).toBe("E_BAD_ARGS");
    expect(await code(v.createFolder("../fora"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.createFolder(".obsidian/x"))).toBe("E_OUTSIDE_VAULT");
  });

  test("moveFolder: renomeia com tudo dentro, e os [[links]] de fora e de dentro seguem", async () => {
    const { v, root, read, changes } = await vault({
      "Projetos/Plano.md": "ver [[Projetos/Sub/Detalhe]] e [[Plano]]",
      "Projetos/Sub/Detalhe.md": "volta para [[Projetos/Plano|o plano]]",
      "Índice.md": "[[Projetos/Plano#Metas]] · [[Detalhe]] · ![[Projetos/Sub/Detalhe]] · [[Outra]]",
      "Outra.md": "",
    });
    const r = await v.moveFolder("Projetos", "Trabalho/Projetos 2026");
    expect(r).toEqual({ path: "Trabalho/Projetos 2026", moved: 2, updatedLinks: 4 });
    expect(existsSync(path.join(root, "Projetos"))).toBe(false);
    expect(v.list().notes.map((n) => n.path)).toEqual(["Índice.md", "Outra.md", "Trabalho/Projetos 2026/Plano.md", "Trabalho/Projetos 2026/Sub/Detalhe.md"]);
    // Pelo nome que ainda acha a nota, fica; pelo caminho, vira o nome (como o Obsidian escreve), com seção, apelido e embed.
    expect(read("Índice.md")).toBe("[[Plano#Metas]] · [[Detalhe]] · ![[Detalhe]] · [[Outra]]");
    expect(read("Trabalho/Projetos 2026/Plano.md")).toBe("ver [[Detalhe]] e [[Plano]]");
    expect(read("Trabalho/Projetos 2026/Sub/Detalhe.md")).toBe("volta para [[Plano|o plano]]");
    expect(changes.at(-1)).toEqual(
      expect.arrayContaining(["Projetos", "Trabalho/Projetos 2026", "Projetos/Plano.md", "Trabalho/Projetos 2026/Plano.md"]),
    );
  });

  test("moveFolder: o nome repetido em outra pasta faz o link levar o caminho", async () => {
    const { v, read } = await vault({ "A/Nota.md": "", "B/Nota.md": "", "Lista.md": "[[A/Nota]] e [[B/Nota]]" });
    await v.moveFolder("A", "C/A");
    expect(read("Lista.md")).toBe("[[C/A/Nota]] e [[B/Nota]]");
  });

  test("moveFolder: para dentro dela mesma, que não existe, destino ocupado e o mesmo lugar", async () => {
    const { v } = await vault({ "A/x.md": "", "B/": "" });
    expect(await code(v.moveFolder("A", "A/Dentro"))).toBe("E_BAD_ARGS");
    expect(await code(v.moveFolder("Nada", "Z"))).toBe("E_NOT_FOUND");
    expect(await code(v.moveFolder("A", "B"))).toBe("E_EXISTS");
    expect(await v.moveFolder("A", "A")).toEqual({ path: "A", moved: 0, updatedLinks: 0 });
    // A mesma pasta com outra maiúscula (o disco do Mac não diferencia): vale.
    expect((await v.moveFolder("A", "a")).path).toBe("a");
  });

  test("moveNote e duplicate", async () => {
    const { v, read } = await vault({ "Ideia.md": "texto", "Ref.md": "[[Ideia]]", "Arquivo/": "" });
    const moved = await v.moveNote("Ideia.md", "Arquivo");
    expect(moved.meta.path).toBe("Arquivo/Ideia.md");
    expect(read("Ref.md")).toBe("[[Ideia]]"); // pelo nome, ainda acha
    expect((await v.moveNote("Arquivo/Ideia.md", "")).meta.path).toBe("Ideia.md");
    const copy = await v.duplicate("Ideia.md");
    expect(copy).toMatchObject({ path: "Ideia 2.md", title: "Ideia 2", content: "texto" });
    expect((await v.duplicate("Ideia.md")).path).toBe("Ideia 3.md");
    expect(await code(v.moveNote("Nada.md", ""))).toBe("E_NOT_FOUND");
  });

  test("ctime: quando a nota nasceu", async () => {
    const { v } = await vault({ "A.md": "" });
    const meta = v.list().notes[0]!;
    expect(Number.isNaN(Date.parse(meta.ctime))).toBe(false);
  });
});

describe("o Desfazer do apagar (T2468)", () => {
  test("nota: some do vault, volta pelo caminho original, e o índice volta", async () => {
    const { v, root, trashed } = await vault({ "Pasta/Nota.md": "oi" });
    await v.delete("Pasta/Nota.md");
    expect(existsSync(path.join(root, "Pasta", "Nota.md"))).toBe(false);
    expect(v.list().notes).toEqual([]);
    expect(await v.restore("Pasta/Nota.md")).toEqual({ path: "Pasta/Nota.md" });
    expect(readFileSync(path.join(root, "Pasta", "Nota.md"), "utf8")).toBe("oi");
    expect(v.list().notes.map((n) => n.path)).toEqual(["Pasta/Nota.md"]);
    expect(trashed).toEqual([]);
    expect(await code(v.restore("Pasta/Nota.md"))).toBe("E_NOT_FOUND"); // só uma vez
  });

  test("pasta inteira: some com o que tem dentro e volta igual", async () => {
    const { v, root } = await vault({ "P/a.md": "1", "P/Sub/b.md": "2" });
    expect(await v.deleteFolder("P")).toBe(true);
    expect(v.list()).toMatchObject({ folders: [], notes: [] });
    await v.restore("P");
    expect(v.list().notes.map((n) => n.path)).toEqual(["P/a.md", "P/Sub/b.md"]);
    expect(readFileSync(path.join(root, "P", "Sub", "b.md"), "utf8")).toBe("2");
    expect(await code(v.deleteFolder(""))).toBe("E_BAD_ARGS");
    expect(await code(v.deleteFolder("Nada"))).toBe("E_NOT_FOUND");
  });

  test("lugar ocupado de novo: E_EXISTS, e o apagado continua esperando", async () => {
    const { v } = await vault({ "N.md": "velha" });
    await v.delete("N.md");
    await v.create("", "N", "nova");
    expect(await code(v.restore("N.md"))).toBe("E_EXISTS");
    await v.rename("N.md", "N nova.md");
    expect(await v.restore("N.md")).toEqual({ path: "N.md" });
  });

  test("passado o tempo, vai para a Lixeira do macOS e não dá mais para desfazer", async () => {
    const { v, root, trashed } = await vault({ "N.md": "x" }, 30);
    await v.delete("N.md");
    await Bun.sleep(100);
    expect(trashed).toHaveLength(1);
    expect(await code(v.restore("N.md"))).toBe("E_NOT_FOUND");
    expect(existsSync(path.join(root, "N.md"))).toBe(false);
  });

  test("o que sobrou de antes (o app fechou no meio) vai para a Lixeira ao abrir", async () => {
    const { root } = await vault({ "x.md": "" });
    mkdirSync(path.join(root, UNDO_DIR, "123-abcd"), { recursive: true });
    writeFileSync(path.join(root, UNDO_DIR, "123-abcd", "Esquecida.md"), "x");
    const trashed: string[] = [];
    const v = new Vault({ root, trash: async (abs) => void trashed.push(path.relative(root, abs)) });
    await v.open();
    expect(trashed).toEqual([".kiwi-trash/123-abcd/Esquecida.md"]);
    expect(existsSync(path.join(root, UNDO_DIR, "123-abcd"))).toBe(false);
    // E a pasta oculta nunca aparece como pasta do vault.
    expect(v.list().folders).toEqual([]);
  });
});

describe("pelas capacidades (contrato 1.7.0)", () => {
  async function caps(files: Record<string, string>, pinned: string[] = []) {
    const { v, read } = await vault(files);
    let settings: AppSettings = { ...DEFAULT_SETTINGS, notesShortcut: null, pinned };
    const revealed: string[] = [];
    const c = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => settings, save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }) },
      clipboardWrite: () => {},
      notes: v,
      reveal: (abs) => revealed.push(abs),
    });
    const call = (cap: string, args: unknown) => directInvoke(c, cap, args);
    return { call, read, settings: () => settings, revealed, v };
  }

  test("folders.* e notes.move/duplicate/restore/reveal pelo caminho da UI, com os códigos", async () => {
    const { call, revealed } = await caps({ "A/n.md": "x" });
    expect(await call("folders.create", { path: "B" })).toEqual({ ok: true, value: { path: "B" } });
    expect(await call("folders.move", { path: "A", parent: "B" })).toMatchObject({ ok: true, value: { path: "B/A", moved: 1 } });
    expect(await call("folders.rename", { path: "B/A", newPath: "B/Z" })).toMatchObject({ ok: true, value: { path: "B/Z" } });
    expect(await call("notes.move", { path: "B/Z/n.md", folder: "" })).toMatchObject({ ok: true, value: { meta: { path: "n.md" } } });
    expect(await call("notes.duplicate", { path: "n.md" })).toMatchObject({ ok: true, value: { path: "n 2.md" } });
    expect(await call("notes.reveal", { path: "B" })).toEqual({ ok: true, value: true });
    expect(revealed).toHaveLength(1);
    expect(await call("folders.delete", { path: "B" })).toEqual({ ok: true, value: true });
    expect(await call("notes.restore", { path: "B" })).toEqual({ ok: true, value: { path: "B" } });
    expect(await call("folders.move", { path: "B", parent: "B/Z" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("folders.create", { path: "../x" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    expect(await call("notes.reveal", { path: "Nada.md" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
    expect(await call("folders.create", { path: "C", extra: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.list", {})).toMatchObject({ ok: true, value: { tree: { path: "" } } });
  });

  test("as fixadas seguem a nota e a pasta, e somem com elas", async () => {
    const { call, settings } = await caps({ "P/a.md": "", "P/Sub/b.md": "", "c.md": "" }, ["P/a.md", "P/Sub", "c.md"]);
    await call("folders.rename", { path: "P", newPath: "Q" });
    expect(settings().pinned).toEqual(["Q/a.md", "Q/Sub", "c.md"]);
    await call("notes.move", { path: "c.md", folder: "Q" });
    expect(settings().pinned).toEqual(["Q/a.md", "Q/Sub", "Q/c.md"]);
    await call("notes.rename", { path: "Q/a.md", newPath: "Q/A1.md" });
    expect(settings().pinned).toEqual(["Q/A1.md", "Q/Sub", "Q/c.md"]);
    await call("folders.delete", { path: "Q/Sub" });
    expect(settings().pinned).toEqual(["Q/A1.md", "Q/c.md"]);
    await call("notes.delete", { path: "Q/c.md" });
    expect(settings().pinned).toEqual(["Q/A1.md"]);
  });

  test("settings.set { pinned }: só caminhos do vault, sem repetir", async () => {
    const { call } = await caps({});
    expect(await call("settings.set", { pinned: ["A.md", "Pasta", "A.md"] })).toMatchObject({ ok: true, value: { pinned: ["A.md", "Pasta"] } });
    expect(await call("settings.set", { pinned: ["../fora.md"] })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
    expect(await call("settings.set", { pinned: [""] })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("settings.set", { pinned: "A.md" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});

test("buildTree: pastas de nota sem entrada própria entram, em ordem", () => {
  const t = buildTree([], [{ path: "Z/x.md", folder: "Z" }, { path: "A/B/y.md", folder: "A/B" }]);
  expect(t.folders.map((f) => f.path)).toEqual(["A", "Z"]);
  expect(t.folders[0]!.folders[0]).toEqual({ path: "A/B", name: "B", folders: [], notes: ["A/B/y.md"] });
});
