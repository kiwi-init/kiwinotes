// O `files.read` (T7103, spec #7079): as Notas leem um arquivo do cofre que não é nota para mostrar na própria janela.
// Texto ou binário, com limite de tamanho, só de dentro do cofre e só arquivo de verdade.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uiCapabilities } from "../bun/ui-capabilities.ts";
import { directInvoke } from "../bun/ui-engine.ts";
import { fileSize, MAX_VIEW_BYTES, MAX_VIEW_TEXT_BYTES } from "../shared/file-view.ts";
import { UI_CAPABILITIES } from "../shared/ui-contract.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { Vault, versionOf } from "./vault.ts";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function vault(files: Record<string, string | Uint8Array>) {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwinotes-read-test-"));
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
  return { v, root, dir };
}

describe("ler um arquivo do cofre (T7103)", () => {
  test("como texto: o conteúdo em UTF-8, o tamanho em bytes e a versão", async () => {
    const text = "linha um\nação, coração\n";
    const { v } = await vault({ "Docs/lista.txt": text });
    expect(await v.readFile("Docs/lista.txt", "text")).toEqual({
      path: "Docs/lista.txt",
      size: Buffer.byteLength(text),
      version: versionOf(text),
      text,
    });
  });

  test("em binário (o padrão): os bytes em base64, iguais aos do disco", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    const { v } = await vault({ "contrato.pdf": bytes });
    const r = await v.readFile("contrato.pdf");
    expect(r).toMatchObject({ path: "contrato.pdf", size: 7 });
    expect("base64" in r && Buffer.from(r.base64, "base64").equals(Buffer.from(bytes))).toBe(true);
    expect("text" in r).toBe(false);
  });

  test("acima do limite, volta o tamanho e o limite, sem o conteúdo", async () => {
    const { v, root } = await vault({ "grande.txt": "x", "grande.pdf": "x", "no-limite.txt": "x" });
    // Arquivos esparsos: o tamanho sem escrever os bytes.
    truncateSync(path.join(root, "grande.txt"), MAX_VIEW_TEXT_BYTES + 1);
    truncateSync(path.join(root, "grande.pdf"), MAX_VIEW_BYTES + 1);
    truncateSync(path.join(root, "no-limite.txt"), MAX_VIEW_TEXT_BYTES);
    expect(await v.readFile("grande.txt", "text")).toEqual({ path: "grande.txt", size: MAX_VIEW_TEXT_BYTES + 1, tooLarge: true, limit: MAX_VIEW_TEXT_BYTES });
    expect(await v.readFile("grande.pdf", "binary")).toEqual({ path: "grande.pdf", size: MAX_VIEW_BYTES + 1, tooLarge: true, limit: MAX_VIEW_BYTES });
    // O mesmo arquivo de texto cabe no limite do binário.
    expect(await v.readFile("grande.txt", "binary")).toMatchObject({ size: MAX_VIEW_TEXT_BYTES + 1, version: expect.any(String) });
    expect(await v.readFile("no-limite.txt", "text")).toMatchObject({ size: MAX_VIEW_TEXT_BYTES, text: expect.any(String) });
  });

  test("só arquivo de verdade de dentro do cofre: nota, pasta, link simbólico e caminho de fora são recusados", async () => {
    const { v, root, dir } = await vault({ "Kiwi.md": "oi", "Docs/a.txt": "a" });
    writeFileSync(path.join(dir, "segredo.txt"), "de fora");
    symlinkSync(path.join(dir, "segredo.txt"), path.join(root, "atalho.txt"));
    symlinkSync(dir, path.join(root, "pasta-de-fora"));
    const code = (p: unknown, as?: unknown) => v.readFile(p, as).then(() => "ok", (e) => (e as { code?: string }).code);
    expect(await code("Kiwi.md")).toBe("E_BAD_ARGS");
    expect(await code("Docs")).toBe("E_NOT_FOUND");
    expect(await code("nada.txt")).toBe("E_NOT_FOUND");
    expect(await code("atalho.txt")).toBe("E_OUTSIDE_VAULT");
    expect(await code("pasta-de-fora/segredo.txt")).toBe("E_OUTSIDE_VAULT");
    expect(await code("../segredo.txt")).toBe("E_OUTSIDE_VAULT");
    expect(await code("/etc/hosts")).not.toBe("ok");
    expect(await code("Docs/a.txt", "utf16")).toBe("E_BAD_ARGS");
    expect(await code(42)).toBe("E_BAD_ARGS");
  });

  test("pela capacidade `files.read` do contrato", async () => {
    const { v } = await vault({ "Docs/a.txt": "abc" });
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used") }, append: async () => { throw new Error("not used") } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: v,
    });
    const call = (args: unknown) => directInvoke(caps, "files.read", args);
    expect(UI_CAPABILITIES).toContain("files.read");
    expect(await call({ path: "Docs/a.txt", as: "text" })).toMatchObject({ ok: true, value: { path: "Docs/a.txt", size: 3, text: "abc" } });
    expect(await call({ path: "Docs/a.txt" })).toMatchObject({ ok: true, value: { base64: "YWJj" } });
    expect(await call({ path: "Docs/a.txt", as: "hex" })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ path: "Docs/a.txt", extra: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(await call({ path: "nada.txt" })).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
  });
});

test("o tamanho como o Finder diz", () => {
  expect(fileSize(12)).toBe("12 B");
  expect(fileSize(1024)).toBe("1 KB");
  expect(fileSize(340 * 1024)).toBe("340 KB");
  expect(fileSize(1.2 * 1024 * 1024)).toBe("1,2 MB");
  expect(fileSize(MAX_VIEW_BYTES)).toBe("25 MB");
  expect(fileSize(3 * 1024 ** 3)).toBe("3 GB");
});
