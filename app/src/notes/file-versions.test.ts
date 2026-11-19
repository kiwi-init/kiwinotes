// T21239 (spec #21160): o histórico de versões em todo arquivo que o Kiwi grava, não só na nota. Um cofre de verdade
// num tmp, as capacidades das janelas e o relógio na mão. Tudo inventado: o estoque de uma loja.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { writerFromCapabilities } from "../agent/tools/writer.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";
import { NoteVersions } from "./versions.ts";
import { tempDir } from "../../test/tmp.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close?.();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FILES: Record<string, string> = {
  "Loja/lista.txt": "café\naçúcar\n",
  "Loja/estoque.py": "PRECO_CAFE = 12\n",
  "Loja/estoque.json": '{ "cafe": 40 }\n',
};

function setup(o: { maxBinaryBytes?: number } = {}) {
  const data = tempDir("kn-21239-");
  dirs.push(data);
  const root = path.join(data, "V");
  for (const [rel, content] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  let t = Date.parse("2026-11-04T10:00:00.000Z");
  const vault = new Vault({ root, trash: async () => {} });
  vaults.push(vault);
  const versions = new NoteVersions({ dir: path.join(data, "history", "notes"), now: () => t, ...o });
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
    const r = (await directInvoke(caps, cap, args)) as { ok: boolean; value?: unknown; code?: string };
    if (!r.ok) throw Object.assign(new Error(`${cap}: ${r.code}`), { code: r.code });
    return r.value;
  };
  const read = async (p: string) => call("files.read", { path: p, as: "text" });
  const save = async (p: string, content: string, extra: object = {}) =>
    call("files.save", { path: p, content, baseVersion: (await read(p)).version, ...extra });
  const list = async (p: string) => (await call("files.versions", { path: p })).versions as { id: string; at: string; size: number }[];
  const text = async (p: string, id: string) => (await call("files.version", { path: p, id })).content as string;
  return { call, caps, data, root, vault, read, save, list, text, advance: (ms: number) => (t += ms) };
}

describe("files.save guarda versões (T21239)", () => {
  test("um .txt, um .py e um .json: o original e o novo; em 2 min, a próxima espera; depois, entra", async () => {
    const { save, list, text, advance } = setup();
    for (const p of Object.keys(FILES)) {
      await save(p, `${FILES[p]}um\n`);
      let l = await list(p);
      expect(l.length).toBe(2);
      expect(await text(p, l[1]!.id)).toBe(FILES[p]!);
      expect(await text(p, l[0]!.id)).toBe(`${FILES[p]}um\n`);
      advance(30_000);
      await save(p, `${FILES[p]}dois\n`);
      advance(10_000);
      // Dentro dos 2 min, a pendente troca: o "dois" nunca vira versão (a pendente entra ao listar).
      await save(p, `${FILES[p]}três\n`);
      l = await list(p);
      expect(l.length).toBe(3);
      expect(await text(p, l[0]!.id)).toBe(`${FILES[p]}três\n`);
      advance(200_000);
      await save(p, `${FILES[p]}quatro\n`);
      expect((await list(p)).length).toBe(4);
    }
  });

  test("o histórico fica fora do cofre", async () => {
    const { save, root } = setup();
    await save("Loja/lista.txt", "pão\n");
    expect(readdirSync(path.join(root, "Loja")).sort()).toEqual(["estoque.json", "estoque.py", "lista.txt"]);
  });

  test("restaurar volta o texto, e o de antes do restaurar vira versão", async () => {
    const { call, save, list, read, advance } = setup();
    await save("Loja/lista.txt", "pão\n");
    advance(300_000);
    await save("Loja/lista.txt", "leite\n");
    const original = (await list("Loja/lista.txt")).at(-1)!.id;
    advance(300_000);
    expect(await call("files.restoreVersion", { path: "Loja/lista.txt", id: original })).toMatchObject({ saved: true });
    expect((await read("Loja/lista.txt")).text).toBe(FILES["Loja/lista.txt"]);
    const l = await list("Loja/lista.txt");
    const texts = await Promise.all(l.map((v) => call("files.version", { path: "Loja/lista.txt", id: v.id }).then((x) => x.content)));
    expect(texts[0]).toBe(FILES["Loja/lista.txt"]);
    expect(texts).toContain("leite\n");
  });

  test("um id inventado e um caminho de fora dão erro", async () => {
    const { call } = setup();
    await expect(call("files.version", { path: "Loja/lista.txt", id: "x" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(call("files.versions", { path: "../fora.txt" })).rejects.toMatchObject({ code: "E_OUTSIDE_VAULT" });
    await expect(call("files.save", { path: "Loja/lista.txt", content: "x", baseVersion: "1", snapshot: "sim" })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });
});

describe("o agente guarda a versão de antes (T21239)", () => {
  test("a escrita do agente falso num .txt guarda o de antes na hora, mesmo dentro dos 2 min", async () => {
    const { caps, save, list, text, advance } = setup();
    await save("Loja/lista.txt", "pão\n"); // a pessoa: original + pão
    advance(20_000);
    await save("Loja/lista.txt", "pão\nleite\n"); // pendente, dentro dos 2 min
    advance(20_000);
    const writer = writerFromCapabilities(caps as never);
    const cur = (await directInvoke(caps, "files.read", { path: "Loja/lista.txt", as: "text" })) as { value: { version: string } };
    await writer.save!("Loja/lista.txt", "pão\nleite\nmanteiga\n", cur.value.version);
    const l = await list("Loja/lista.txt");
    const texts = await Promise.all(l.map((v) => text("Loja/lista.txt", v.id)));
    // O de antes do gato (a da pessoa, que ainda esperava os 2 min) está lá.
    expect(texts).toContain("pão\nleite\n");
    expect(texts).toContain(FILES["Loja/lista.txt"]);
  });

  test("a escrita do agente falso numa planilha (em bytes) também guarda o de antes na hora", async () => {
    const { caps, call, root, list, advance } = setup();
    writeFileSync(path.join(root, "Loja/vendas.csv"), "dia;total\nseg;10\n");
    const b64 = (t: string) => Buffer.from(t).toString("base64");
    let cur = await call("files.read", { path: "Loja/vendas.csv", as: "binary" });
    await call("files.save", { path: "Loja/vendas.csv", base64: b64("dia;total\nseg;11\n"), baseVersion: cur.version });
    advance(20_000);
    cur = await call("files.read", { path: "Loja/vendas.csv", as: "binary" });
    await call("files.save", { path: "Loja/vendas.csv", base64: b64("dia;total\nseg;12\n"), baseVersion: cur.version });
    advance(20_000);
    cur = await call("files.read", { path: "Loja/vendas.csv", as: "binary" });
    const writer = writerFromCapabilities(caps as never);
    expect(await writer.saveBytes!("Loja/vendas.csv", b64("dia;total\nseg;13\n"), cur.version)).toMatchObject({ saved: true });
    const l = await list("Loja/vendas.csv");
    const texts = await Promise.all(
      l.map((v) => call("files.version", { path: "Loja/vendas.csv", id: v.id }).then((x) => Buffer.from(x.base64, "base64").toString())),
    );
    expect(texts).toContain("dia;total\nseg;12\n");
    expect(texts).toContain("dia;total\nseg;10\n");
  });
});

describe("o histórico segue o arquivo (T21239)", () => {
  test("renomear e mover o arquivo, e mover a pasta: as versões vão junto", async () => {
    const { call, save, list } = setup();
    await save("Loja/lista.txt", "pão\n");
    const n = (await list("Loja/lista.txt")).length;
    await call("files.rename", { path: "Loja/lista.txt", newPath: "Loja/compras.txt" });
    expect((await list("Loja/compras.txt")).length).toBe(n);
    expect(await list("Loja/lista.txt")).toEqual([]);
    await call("folders.create", { path: "Arquivo" }).catch(() => {});
    await call("files.rename", { path: "Loja/compras.txt", newPath: "Arquivo/compras.txt" });
    expect((await list("Arquivo/compras.txt")).length).toBe(n);
    await call("folders.rename", { path: "Arquivo", newPath: "Antigo" });
    expect((await list("Antigo/compras.txt")).length).toBe(n);
  });

  test("o arquivo vai para a Lixeira e volta: o histórico volta com ele", async () => {
    const { call, save, list, read } = setup();
    await save("Loja/estoque.json", '{ "cafe": 41 }\n');
    const n = (await list("Loja/estoque.json")).length;
    expect(n).toBe(2);
    await call("files.delete", { path: "Loja/estoque.json" });
    await call("notes.restore", { path: "Loja/estoque.json" });
    expect((await read("Loja/estoque.json")).text).toBe('{ "cafe": 41 }\n');
    expect((await list("Loja/estoque.json")).length).toBe(n);
  });
});

describe("arquivos em bytes (T21239)", () => {
  test("as versões guardam os bytes e o teto por arquivo tira as mais antigas, a mais nova sempre fica", async () => {
    let t = Date.parse("2026-11-04T10:00:00.000Z");
    const data = tempDir("kn-21239-bin-");
    dirs.push(data);
    const v = new NoteVersions({ dir: path.join(data, "h"), now: () => t, maxBinaryBytes: 2500 });
    const blob = (n: number, fill: number) => new Uint8Array(n).fill(fill);
    await v.record("Loja/vendas.xlsx", blob(1000, 2), blob(1000, 1));
    let l = await v.list("Loja/vendas.xlsx");
    expect(l.length).toBe(2);
    expect(l.every((x) => x.size === 1000)).toBe(true);
    const back = await v.read("Loja/vendas.xlsx", l[1]!.id);
    expect(back.content).toBeInstanceOf(Uint8Array);
    expect((back.content as Uint8Array)[0]).toBe(1);
    await expect(v.get("Loja/vendas.xlsx", l[1]!.id)).rejects.toMatchObject({ code: "E_BINARY" });
    t += 300_000;
    await v.record("Loja/vendas.xlsx", blob(1000, 3));
    // 3000 > 2500: a mais antiga sai.
    l = await v.list("Loja/vendas.xlsx");
    expect(l.length).toBe(2);
    expect(((await v.read("Loja/vendas.xlsx", l[1]!.id)).content as Uint8Array)[0]).toBe(2);
    t += 300_000;
    await v.record("Loja/vendas.xlsx", blob(5000, 4));
    l = await v.list("Loja/vendas.xlsx");
    expect(l.length).toBe(1);
    expect(l[0]!.size).toBe(5000);
  });

  test("o files.save de um csv em base64 guarda versões, e o files.version devolve base64", async () => {
    const { call, root, list } = setup();
    writeFileSync(path.join(root, "Loja/vendas.csv"), "dia;total\nseg;10\n");
    const cur = await call("files.read", { path: "Loja/vendas.csv", as: "binary" });
    const novo = Buffer.from("dia;total\nseg;12\n").toString("base64");
    await call("files.save", { path: "Loja/vendas.csv", base64: novo, baseVersion: cur.version });
    const l = await list("Loja/vendas.csv");
    expect(l.length).toBe(2);
    const old = await call("files.version", { path: "Loja/vendas.csv", id: l[1]!.id });
    expect(Buffer.from(old.base64, "base64").toString()).toBe("dia;total\nseg;10\n");
    expect(await call("files.restoreVersion", { path: "Loja/vendas.csv", id: l[1]!.id })).toMatchObject({ saved: true });
    expect(readFileSync(path.join(root, "Loja/vendas.csv"), "utf8")).toBe("dia;total\nseg;10\n");
  });
});

describe("o quadro branco (T22432, issue #182)", () => {
  const board = (texto: string) =>
    JSON.stringify({ nodes: [{ id: "a", type: "text", text: texto, x: 0, y: 0, width: 200, height: 80 }], edges: [] });

  test("gravar o quadro guarda versões, restaurar volta, e renomear leva o histórico", async () => {
    const { call, list, advance } = setup();
    const c = await call("notes.canvasCreate", { folder: "Loja", title: "Plano", content: board("comprar café") });
    expect(c.path).toBe("Loja/Plano.canvas");
    const s1 = await call("notes.canvasSave", { path: c.path, content: board("comprar pão"), baseVersion: c.version });
    expect(s1.saved).toBe(true);
    let l = await list(c.path);
    expect(l.length).toBe(2);
    expect((await call("files.version", { path: c.path, id: l[1]!.id })).content).toBe(board("comprar café"));
    advance(300_000);
    expect(await call("files.restoreVersion", { path: c.path, id: l[1]!.id })).toMatchObject({ saved: true });
    expect((await call("notes.canvasGet", { path: c.path })).content).toBe(board("comprar café"));
    l = await list(c.path);
    const texts = await Promise.all(l.map((v) => call("files.version", { path: c.path, id: v.id }).then((x) => x.content)));
    expect(texts).toContain(board("comprar pão"));
    const n = l.length;
    await call("notes.canvasRename", { from: c.path, to: "Loja/Plano da semana.canvas" });
    expect((await list("Loja/Plano da semana.canvas")).length).toBe(n);
    expect(await list(c.path)).toEqual([]);
  });

  test("restaurar não grava um quadro que não abre", async () => {
    const { call, list } = setup();
    const c = await call("notes.canvasCreate", { folder: "Loja", title: "Plano", content: board("um") });
    await call("notes.canvasSave", { path: c.path, content: board("dois"), baseVersion: c.version });
    const l = await list(c.path);
    expect(l.length).toBe(2);
    // A versão guardada é sempre um quadro que abriu: o restaurar passa pelo mesmo `saveCanvas`.
    expect(await call("files.restoreVersion", { path: c.path, id: l[1]!.id })).toMatchObject({ saved: true });
  });
});

describe("gravar não lê o arquivo inteiro à toa (T22576)", () => {
  /** Conta as vezes que a capacidade lê o arquivo (`readFile`) e o quadro (`getCanvas`) por fora do próprio save. */
  function spy(vault: Vault) {
    const n = { file: 0, canvas: 0 };
    const readFile = vault.readFile.bind(vault);
    const getCanvas = vault.getCanvas.bind(vault);
    vault.readFile = ((...a: Parameters<typeof vault.readFile>) => (n.file++, readFile(...a))) as typeof vault.readFile;
    vault.getCanvas = ((...a: Parameters<typeof vault.getCanvas>) => (n.canvas++, getCanvas(...a))) as typeof vault.getCanvas;
    return n;
  }

  test("com histórico, o files.save só lê o que o próprio save confere; a 1ª versão e o snapshot ainda leem o de antes", async () => {
    const { call, vault, read, list, text, advance } = setup();
    const p = "Loja/lista.txt";
    const save = async (content: string, extra: object = {}) => {
      const baseVersion = (await read(p)).version;
      const n = spy(vault);
      await call("files.save", { path: p, content, baseVersion, ...extra });
      return n.file;
    };
    // A 1ª: sem histórico, lê o de antes (para a versão original) e o save confere a dele.
    expect(await save("café\n")).toBe(2);
    expect(await text(p, (await list(p))[1]!.id)).toBe(FILES[p]!);
    // Com histórico: só a leitura do save (a da versão de base).
    advance(300_000);
    expect(await save("café\nleite\n")).toBe(1);
    advance(10_000);
    expect(await save("café\nleite\npão\n")).toBe(1);
    // A cópia do agente (`snapshot`) ainda lê o de antes, e guarda na hora.
    advance(10_000);
    const before = (await list(p)).length;
    expect(await save("chá\n", { snapshot: true })).toBe(2);
    const l = await list(p);
    expect(l.length).toBeGreaterThan(before);
    expect(await Promise.all(l.map((v) => text(p, v.id)))).toContain("café\nleite\npão\n");
  });

  test("com histórico, o notes.canvasSave não relê o quadro antes de gravar", async () => {
    const { call, vault, list } = setup();
    const board = (t: string) => JSON.stringify({ nodes: [{ id: "a", type: "text", text: t, x: 0, y: 0, width: 200, height: 80 }], edges: [] });
    const c = await call("notes.canvasCreate", { folder: "Loja", title: "Plano", content: board("um") });
    let version = c.version;
    const save = async (t: string) => {
      const n = spy(vault);
      version = (await call("notes.canvasSave", { path: c.path, content: board(t), baseVersion: version })).version;
      return n.canvas;
    };
    expect(await save("dois")).toBe(2);
    expect((await call("files.version", { path: c.path, id: (await list(c.path))[1]!.id })).content).toBe(board("um"));
    expect(await save("três")).toBe(1);
    expect(await save("quatro")).toBe(1);
  });
});
