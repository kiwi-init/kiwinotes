// T2559: as fixadas seguem também o que muda por fora do app (o Obsidian, o Finder). Puro, e depois de ponta a ponta com
// o watcher de verdade, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { followPinned, reconcileMoves, Vault } from "./vault.ts";

const snap = (o: Record<string, [number, string]>) => new Map(Object.entries(o).map(([p, [ino, version]]) => [p, { ino, version }]));

describe("reconcileMoves", () => {
  test("o mesmo inode em outro caminho é um rename; o que some sem par é gone", () => {
    const r = reconcileMoves(snap({ "A.md": [1, "a"], "B.md": [2, "b"], "C.md": [3, "c"] }), snap({ "Pasta/A2.md": [1, "a"], "C.md": [3, "c"] }));
    expect([...r.moves]).toEqual([["A.md", "Pasta/A2.md"]]);
    expect(r.gone).toEqual(["B.md"]);
  });

  test("sem o inode, o mesmo conteúdo, se só um bate (copiar e apagar)", () => {
    expect([...reconcileMoves(snap({ "A.md": [1, "x"] }), snap({ "B.md": [9, "x"] })).moves]).toEqual([["A.md", "B.md"]]);
    // Dois com o mesmo conteúdo: ambíguo, não chuta.
    const r = reconcileMoves(snap({ "A.md": [1, "x"] }), snap({ "B.md": [8, "x"], "C.md": [9, "x"] }));
    expect(r.moves.size).toBe(0);
    expect(r.gone).toEqual(["A.md"]);
  });

  test("nada mudou de lugar: vazio", () => {
    const same = snap({ "A.md": [1, "a"] });
    expect(reconcileMoves(same, same)).toEqual({ moves: new Map(), gone: [] });
  });
});

describe("followPinned", () => {
  const now = (notes: string[], folders: string[]) => ({ notes: new Set(notes), folders: new Set(folders) });

  test("a nota vai junto; a que sumiu sai; a que não existe mais sai", () => {
    const r = { moves: new Map([["A.md", "B.md"]]), gone: ["C.md"] };
    expect(followPinned(["A.md", "C.md", "D.md", "E.md"], r, now(["B.md", "E.md"], []))).toEqual(["B.md", "E.md"]);
  });

  test("a pasta renomeada por fora vai para onde as notas dela foram", () => {
    const r = { moves: new Map([["Projetos/Sub/a.md", "Trabalho/Sub/a.md"]]), gone: [] };
    expect(followPinned(["Projetos", "Projetos/Sub"], r, now(["Trabalho/Sub/a.md"], ["Trabalho", "Trabalho/Sub"]))).toEqual([
      "Trabalho",
      "Trabalho/Sub",
    ]);
  });

  test("a pasta que sumiu sem notas (ou que foi apagada) sai; a que existe fica; sem repetir", () => {
    expect(followPinned(["Vazia", "Fica", "Fica"], { moves: new Map(), gone: [] }, now([], ["Fica"]))).toEqual(["Fica"]);
  });
});

describe("de ponta a ponta, com o watcher", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function setup(files: Record<string, string>, pinned: string[]) {
    const root = path.join(mkdtempSync(path.join(tmpdir(), "kn-pins-")), "V");
    dirs.push(path.dirname(root));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
    let settings: AppSettings = { ...DEFAULT_SETTINGS, notesShortcut: null, pinned };
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => settings, save: async (patch) => (settings = { ...settings, ...patch, appearance: { ...settings.appearance, ...patch.appearance } }) },
      clipboardWrite: () => {},
      notes: v,
    });
    await directInvoke(caps, "notes.list", {}); // abre o vault e liga as fixadas
    v.watch();
    await watcherReady(root, v);
    return { root, v, pinned: () => settings.pinned };
  }

  /**
   * Espera o watcher valer de verdade (T2792): no macOS o `fs.watch` vai pelo FSEvents, que leva um instante para
   * começar a mandar eventos. Um rename feito nesse instante (o teste renomeia logo depois do `watch()`) se perdia, e a
   * fixada ficava no caminho velho (#2790). Aqui um arquivo de prova é gravado até o watcher contar que viu.
   */
  const watcherReady = async (root: string, v: Vault) => {
    let seen = false;
    const off = v.onOtherFiles((paths) => (seen ||= paths.includes("prova-do-watcher.txt")));
    const probe = path.join(root, "prova-do-watcher.txt");
    for (let i = 0; i < 200 && !seen; i++) {
      writeFileSync(probe, String(i));
      await Bun.sleep(10);
    }
    off();
    rmSync(probe, { force: true });
    if (!seen) throw new Error("o watcher não começou a valer em 2 s");
    // O rm da prova também passa pelo watcher: espera ele assentar antes do teste mexer nos arquivos.
    await Bun.sleep(60);
  };

  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await Bun.sleep(20);
  };

  test("a limpeza das fixadas falhando (o settings) não derruba as notas (revisão #2574)", async () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), "kn-pins-")), "V");
    dirs.push(path.dirname(root));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "A.md"), "");
    let fail = true;
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: {
        load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null, pinned: ["Sumiu.md"] }),
        save: async () => {
          if (fail) throw new Error("EIO: disk");
          return { ...DEFAULT_SETTINGS, notesShortcut: null, pinned: [] };
        },
      },
      clipboardWrite: () => {},
      notes: new Vault({ root, trash: async () => {} }),
    });
    expect(await directInvoke(caps, "notes.list", {})).toMatchObject({ ok: true, value: { notes: [{ path: "A.md" }] } });
    fail = false;
    expect(await directInvoke(caps, "notes.get", { path: "A.md" })).toMatchObject({ ok: true });
  });

  test("no 1º uso, sai o que já não existia (lixo de antes)", async () => {
    const { v, pinned } = await setup({ "A.md": "" }, ["A.md", "Sumiu.md", "PastaQueNaoExiste"]);
    expect(pinned()).toEqual(["A.md"]);
    v.close();
  });

  test("um rename de nota no Obsidian (mv) leva a fixada junto; apagar por fora tira", async () => {
    const { root, v, pinned } = await setup({ "Ideia.md": "uma ideia", "Outra.md": "outra" }, ["Ideia.md", "Outra.md"]);
    mkdirSync(path.join(root, "Arquivo"));
    renameSync(path.join(root, "Ideia.md"), path.join(root, "Arquivo", "Ideia boa.md"));
    await until(() => pinned()[0] === "Arquivo/Ideia boa.md");
    expect(pinned()).toEqual(["Arquivo/Ideia boa.md", "Outra.md"]);
    rmSync(path.join(root, "Outra.md"));
    await until(() => pinned().length === 1);
    expect(pinned()).toEqual(["Arquivo/Ideia boa.md"]);
    v.close();
  });

  test("uma pasta renomeada no Finder leva as fixadas de dentro e ela mesma", async () => {
    const { root, v, pinned } = await setup({ "Projetos/a.md": "a", "Projetos/Sub/b.md": "b" }, ["Projetos", "Projetos/Sub/b.md"]);
    renameSync(path.join(root, "Projetos"), path.join(root, "Trabalho"));
    await until(() => pinned()[0] === "Trabalho");
    expect(pinned()).toEqual(["Trabalho", "Trabalho/Sub/b.md"]);
    v.close();
  });
});
