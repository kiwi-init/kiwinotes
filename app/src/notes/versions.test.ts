// T2680: o histórico de versões das notas, fora do vault. Tudo num tmp, com o relógio na mão.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault } from "./vault.ts";
import { atOf, NoteVersions } from "./versions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "kn-2680-"));
  dirs.push(d);
  return d;
};

function versions(o: { maxCount?: number; maxAgeMs?: number } = {}) {
  let t = Date.parse("2026-11-04T10:00:00.000Z");
  const dir = path.join(tmp(), "history", "notes");
  const v = new NoteVersions({ dir, now: () => t, minGapMs: 120_000, ...o });
  return { v, dir, advance: (ms: number) => (t += ms), at: () => t };
}

describe("NoteVersions", () => {
  test("a 1ª mudança guarda o texto de antes e o novo; dentro de 2 min, a próxima espera; depois, entra", async () => {
    const { v, advance } = versions();
    await v.record("A.md", "um", "original");
    expect((await v.list("A.md")).length).toBe(2);
    advance(30_000);
    await v.record("A.md", "dois");
    advance(10_000);
    await v.record("A.md", "três"); // a pendente troca, sem versão nova
    // O list grava o pendente antes de listar (é o que a pessoa quer ver).
    const list = await v.list("A.md");
    expect(list.length).toBe(3);
    expect((await v.get("A.md", list[0]!.id)).content).toBe("três");
    expect((await v.get("A.md", list[2]!.id)).content).toBe("original");
    advance(200_000);
    await v.record("A.md", "quatro");
    expect((await v.list("A.md")).length).toBe(4);
  });

  test("uma versão igual à última não entra, e o snapshot grava na hora", async () => {
    const { v, advance } = versions();
    await v.record("A.md", "x", "x");
    expect((await v.list("A.md")).length).toBe(1);
    advance(500_000);
    await v.record("A.md", "x");
    expect((await v.list("A.md")).length).toBe(1);
    await v.snapshot("A.md", "y");
    expect((await v.list("A.md")).map((i) => i.size)).toEqual([1, 1]);
  });

  test("o histórico segue a nota renomeada, e o que estava pendente também", async () => {
    const { v, advance } = versions();
    await v.record("Pasta/A.md", "um", "zero");
    advance(10_000);
    await v.record("Pasta/A.md", "pendente");
    await v.move((p) => (p.startsWith("Pasta/") ? `Outra/${p.slice(6)}` : p));
    expect(await v.list("Pasta/A.md")).toEqual([]);
    const list = await v.list("Outra/A.md");
    expect(list.length).toBe(3);
    expect((await v.get("Outra/A.md", list[0]!.id)).content).toBe("pendente");
  });

  test("o limite: 50 versões (aqui 3) e 30 dias, e a mais nova sempre fica", async () => {
    const { v, advance } = versions({ maxCount: 3 });
    for (let i = 0; i < 6; i++) {
      await v.snapshot("A.md", `v${i}`);
      advance(1000);
    }
    const list = await v.list("A.md");
    expect(list.length).toBe(3);
    expect((await v.get("A.md", list[0]!.id)).content).toBe("v5");
    const old = versions({ maxAgeMs: 86_400_000 });
    await old.v.snapshot("B.md", "velha");
    old.advance(2 * 86_400_000);
    await old.v.snapshot("B.md", "nova");
    expect((await old.v.list("B.md")).length).toBe(1);
  });

  test("close grava o pendente; o índice fica no disco e outro processo lê", async () => {
    const { v, dir, advance } = versions();
    await v.record("A.md", "um", "zero");
    advance(5_000);
    await v.record("A.md", "fim");
    await v.close();
    const again = new NoteVersions({ dir });
    const list = await again.list("A.md");
    expect(list.length).toBe(3);
    expect((await again.get("A.md", list[0]!.id)).content).toBe("fim");
    expect(existsSync(path.join(dir, "index.json"))).toBe(true);
  });

  test("duas versões no mesmo milissegundo: a 2ª ordena depois (revisão #2826)", async () => {
    const { v } = versions();
    await v.snapshot("A.md", "um");
    await v.snapshot("A.md", "dois");
    const list = await v.list("A.md");
    expect(list.length).toBe(2);
    expect(list[0]!.id.endsWith("~2")).toBe(true);
    expect((await v.get("A.md", list[0]!.id)).content).toBe("dois");
  });

  test("move para um caminho que já tinha histórico: fica o da nota que se moveu (revisão #2826)", async () => {
    const { v, advance } = versions();
    await v.snapshot("B.md", "a velha B, apagada");
    advance(1000);
    await v.snapshot("A.md", "a A");
    await v.move((p) => (p === "A.md" ? "B.md" : p));
    const list = await v.list("B.md");
    expect(list.length).toBe(1);
    expect((await v.get("B.md", list[0]!.id)).content).toBe("a A");
    expect(await v.list("A.md")).toEqual([]);
  });

  test("ids: o carimbo volta a ser a hora; um id inventado dá E_BAD_ARGS ou E_NOT_FOUND", async () => {
    const { v } = versions();
    expect(atOf("2026-11-04T05-10-00-000Z")).toBe("2026-11-04T05:10:00.000Z");
    await v.snapshot("A.md", "x");
    await expect(v.get("A.md", "../../etc/passwd")).rejects.toMatchObject({ code: "E_BAD_ARGS" });
    await expect(v.get("A.md", "2020-01-01T00-00-00-000Z")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(v.get("Nada.md", "2020-01-01T00-00-00-000Z")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
});

describe("pelas capacidades (contrato 1.11.0)", () => {
  async function setup() {
    const data = tmp();
    const root = path.join(data, "V");
    mkdirSync(path.join(root, "P"), { recursive: true });
    writeFileSync(path.join(root, "P", "Nota.md"), "original");
    let t = Date.parse("2026-11-04T10:00:00.000Z");
    const vault = new Vault({ root, trash: async () => {} });
    const versions = new NoteVersions({ dir: path.join(data, "history", "notes"), now: () => t });
    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (x) => x },
      snippets: { load: async () => [], save: async (x) => x },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => settings, save: async (p) => (settings = { ...settings, ...p, appearance: { ...settings.appearance, ...p.appearance } }) },
      clipboardWrite: () => {},
      notes: vault,
      versions,
    });
    const call = (cap: string, args: unknown) => directInvoke(caps, cap, args) as Promise<{ ok: boolean; value?: any; code?: string }>;
    return { call, data, advance: (ms: number) => (t += ms) };
  }

  test("o save guarda versões; restaurar volta o texto e vira versão; o histórico segue o move de pasta", async () => {
    const { call, data, advance } = await setup();
    const get = async () => (await call("notes.get", { path: "P/Nota.md" })).value;
    await call("notes.save", { path: "P/Nota.md", content: "editada", baseVersion: (await get()).version });
    let list = (await call("notes.versions", { path: "P/Nota.md" })).value.versions;
    expect(list.length).toBe(2);
    const original = list[1].id;
    expect((await call("notes.version", { path: "P/Nota.md", id: original })).value.content).toBe("original");
    advance(300_000);
    const r = await call("notes.restoreVersion", { path: "P/Nota.md", id: original });
    expect(r).toMatchObject({ ok: true, value: { saved: true } });
    expect((await get()).content).toBe("original");
    list = (await call("notes.versions", { path: "P/Nota.md" })).value.versions;
    expect((await call("notes.version", { path: "P/Nota.md", id: list[0].id })).value.content).toBe("original");
    await call("folders.rename", { path: "P", newPath: "Q" });
    expect((await call("notes.versions", { path: "Q/Nota.md" })).value.versions.length).toBe(list.length);
    // Nada disso entrou no vault.
    expect(readdirSync(path.join(data, "V")).sort()).toEqual(["Q"]);
    expect(await call("notes.version", { path: "Q/Nota.md", id: "x" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call("notes.versions", { path: "../fora.md" })).toMatchObject({ ok: false, code: "E_OUTSIDE_VAULT" });
  });
});
