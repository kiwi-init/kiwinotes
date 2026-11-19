// O `files.save` com bytes (T21107, spec #21065): a planilha (xlsx, csv, tsv) grava pelo cofre com a versão dos bytes, e
// um xlsx só de leitura nunca é trocado. Dados inventados (o estoque de uma loja).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { readDelimited, writeDelimited } from "../shared/sheet/delimited.ts";
import { patchXlsx, readXlsx } from "../shared/sheet/xlsx.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { bytesVersion, Vault } from "./vault.ts";
import { tempDir } from "../../test/tmp.ts";

const ESTOQUE = new Uint8Array(readFileSync(path.join(import.meta.dir, "../../test/fixtures/sheet/estoque.xlsx")));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string | Uint8Array>) {
  const dir = tempDir("kiwinotes-sheet-save-");
  dirs.push(dir);
  const root = path.join(dir, "KiwiNotes");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  const v = new Vault({ root, debounceMs: 20, trash: async (abs) => rmSync(abs, { recursive: true }) });
  vaults.push(v);
  await v.open();
  return { v, root };
}

const code = (p: Promise<unknown>) => p.then((r) => ((r as { saved: boolean }).saved ? "saved" : "stale"), (e) => (e as { code?: string }).code);

describe("gravar uma planilha do cofre (T21107)", () => {
  test("xlsx: grava os bytes com a versão do read binário, e reabre com a mudança", async () => {
    const { v, root } = await vault({ "Loja/estoque.xlsx": ESTOQUE });
    const changed: string[][] = [];
    v.onOtherFiles((paths) => changed.push(paths));
    const before = await v.readFile("Loja/estoque.xlsx", "binary");
    if (!("base64" in before)) throw new Error("no bytes");
    expect(before.version).toBe(bytesVersion(ESTOQUE));
    const next = patchXlsx(ESTOQUE, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 }], "estoque.xlsx");
    const r = await v.saveFileBytes("Loja/estoque.xlsx", b64(next), before.version);
    expect(r).toEqual({ saved: true, path: "Loja/estoque.xlsx", size: next.length, version: bytesVersion(next) });
    const disk = new Uint8Array(readFileSync(path.join(root, "Loja/estoque.xlsx")));
    expect(disk).toEqual(new Uint8Array(next));
    expect(readXlsx(disk, "estoque.xlsx").sheets[0]!.rows[1]![2]!.value).toBe(8);
    expect(changed.flat()).toContain("Loja/estoque.xlsx");
    expect(await v.readFile("Loja/estoque.xlsx", "binary")).toMatchObject({ version: bytesVersion(next) });
    expect(readdirSync(path.join(root, "Loja"))).toEqual(["estoque.xlsx"]);
  });

  test("versão velha não escreve e devolve o arquivo de agora", async () => {
    const { v, root } = await vault({ "estoque.xlsx": ESTOQUE });
    const next = patchXlsx(ESTOQUE, [{ op: "set", sheet: "Estoque", row: 1, col: 2, value: 8 }], "estoque.xlsx");
    const r = await v.saveFileBytes("estoque.xlsx", b64(next), "velha");
    expect(r).toMatchObject({ saved: false, current: { version: bytesVersion(ESTOQUE), base64: b64(ESTOQUE) } });
    expect(new Uint8Array(readFileSync(path.join(root, "estoque.xlsx")))).toEqual(ESTOQUE);
  });

  test("xlsx só de leitura, ou bytes que não são xlsx: E_BAD_ARGS, e o disco fica igual", async () => {
    const cfb = new Uint8Array(512);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const { v, root } = await vault({ "senha.xlsx": cfb, "estoque.xlsx": ESTOQUE });
    expect(await code(v.saveFileBytes("senha.xlsx", b64(ESTOQUE), bytesVersion(cfb)))).toBe("E_BAD_ARGS");
    expect(new Uint8Array(readFileSync(path.join(root, "senha.xlsx")))).toEqual(cfb);
    expect(await code(v.saveFileBytes("estoque.xlsx", b64(new TextEncoder().encode("não é zip")), bytesVersion(ESTOQUE)))).toBe("E_BAD_ARGS");
    expect(new Uint8Array(readFileSync(path.join(root, "estoque.xlsx")))).toEqual(ESTOQUE);
  });

  test("csv em windows-1252 grava em windows-1252 (o save de texto recusaria)", async () => {
    const original = Uint8Array.of(0x50, 0xe3, 0x6f, 0x3b, 0x31, 0x0a); // "Pão;1\n"
    const { v, root } = await vault({ "padaria.csv": original });
    const { rows, format } = readDelimited(original, "padaria.csv");
    rows[0]![1] = "2";
    const next = writeDelimited(rows, format);
    expect(await code(v.saveFileBytes("padaria.csv", b64(next), bytesVersion(original)))).toBe("saved");
    expect(new Uint8Array(readFileSync(path.join(root, "padaria.csv")))).toEqual(Uint8Array.of(0x50, 0xe3, 0x6f, 0x3b, 0x32, 0x0a));
  });

  test("os limites: só xlsx, csv e tsv, base64 de verdade, arquivo que já existe", async () => {
    const { v } = await vault({ "a.txt": "oi", "b.tsv": "A\tB\n", "Nota.md": "oi" });
    const tsv = b64(new TextEncoder().encode("A\tC\n"));
    expect(await code(v.saveFileBytes("a.txt", tsv, bytesVersion(new TextEncoder().encode("oi"))))).toBe("E_BAD_ARGS");
    expect(await code(v.saveFileBytes("Nota.md", tsv, "x"))).toBe("E_BAD_ARGS");
    expect(await code(v.saveFileBytes("b.tsv", "não é base64!", "x"))).toBe("E_BAD_ARGS");
    expect(await code(v.saveFileBytes("b.tsv", tsv, 1))).toBe("E_BAD_ARGS");
    expect(await code(v.saveFileBytes("../fora.csv", tsv, "x"))).toBe("E_OUTSIDE_VAULT");
    expect(await code(v.saveFileBytes("nao-existe.csv", tsv, "x"))).not.toBe("saved");
    expect(await code(v.saveFileBytes("b.tsv", tsv, bytesVersion(new TextEncoder().encode("A\tB\n"))))).toBe("saved");
  });

  test("pela capacidade `files.save`: `base64` no lugar de `content`, nunca os dois", async () => {
    const { v, root } = await vault({ "estoque.xlsx": ESTOQUE });
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: v,
    });
    const call = (args: unknown) => directInvoke(caps, "files.save", args);
    const next = patchXlsx(ESTOQUE, [{ op: "renameSheet", sheet: "Estoque", name: "Loja centro" }], "estoque.xlsx");
    const base = bytesVersion(ESTOQUE);
    expect(await call({ path: "estoque.xlsx", base64: b64(next), content: "x", baseVersion: base })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ path: "estoque.xlsx", base64: b64(next), baseVersion: base })).toMatchObject({ ok: true, value: { saved: true, version: bytesVersion(next) } });
    expect(readXlsx(new Uint8Array(readFileSync(path.join(root, "estoque.xlsx"))), "estoque.xlsx").sheets[0]!.name).toBe("Loja centro");
    // O texto continua pelo `content`: uma planilha não grava como texto.
    expect(await call({ path: "estoque.xlsx", content: "x", baseVersion: bytesVersion(next) })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});
