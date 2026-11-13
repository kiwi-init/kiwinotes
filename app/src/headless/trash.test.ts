// T7681: o lixo do headless fica na pasta de dados dele, nunca no Lixo do macOS. Nada aqui chama o `/usr/bin/trash`:
// o headless de ponta a ponta sobe com `KIWI_HEADLESS=1`, e o `macTrash` recusa nesse modo antes de rodar qualquer coisa.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { macTrash } from "../notes/vault.ts";
import { headlessTrash } from "./trash.ts";
import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const scratch = tempDir("kn-trash-");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("o lixo do headless (T7681)", () => {
  test("move o arquivo e a pasta para dentro do lixo, e dois com o mesmo nome não se sobrepõem", async () => {
    const dir = path.join(scratch, "unit");
    const trash = headlessTrash(path.join(dir, "trash"));
    mkdirSync(path.join(dir, "vault", "Pasta"), { recursive: true });
    writeFileSync(path.join(dir, "vault", "A.md"), "um");
    writeFileSync(path.join(dir, "vault", "Pasta", "B.md"), "b");
    await trash(path.join(dir, "vault", "A.md"));
    writeFileSync(path.join(dir, "vault", "A.md"), "dois");
    await trash(path.join(dir, "vault", "A.md"));
    await trash(path.join(dir, "vault", "Pasta"));
    expect(readdirSync(path.join(dir, "vault"))).toEqual([]);
    const items = readdirSync(path.join(dir, "trash")).sort();
    expect(items.filter((n) => n.endsWith("-A.md")).map((n) => readFileSync(path.join(dir, "trash", n), "utf8")).sort()).toEqual(["dois", "um"]);
    const pasta = items.find((n) => n.endsWith("-Pasta"))!;
    expect(readFileSync(path.join(dir, "trash", pasta, "B.md"), "utf8")).toBe("b");
  });

  test("com KIWI_HEADLESS=1, o macTrash recusa sem chamar o /usr/bin/trash", async () => {
    const file = path.join(scratch, "fica.md");
    writeFileSync(file, "x");
    const before = process.env.KIWI_HEADLESS;
    process.env.KIWI_HEADLESS = "1";
    try {
      await expect(macTrash(file)).rejects.toThrow("macOS Trash");
    } finally {
      if (before === undefined) delete process.env.KIWI_HEADLESS;
      else process.env.KIWI_HEADLESS = before;
    }
    expect(existsSync(file)).toBe(true);
  });

  const data = path.join(scratch, "data");
  const other = path.join(scratch, "outra");
  mkdirSync(other, { recursive: true });
  async function cli(args: string[]) {
    const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, KIWI_HEADLESS_DATA: "", KIWI_TEST_NOTES_FOLDER: other },
    });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(out);
    } catch {}
    return { code, out, json };
  }
  afterAll(async () => {
    await cli(["stop"]);
  });

  test(
    "de ponta a ponta: apagar e esvaziar a Lixeira, no vault interno e no de 'Abrir outra pasta', fica em <data>/trash",
    async () => {
      expect((await cli(["start", "--no-helper"])).code).toBe(0);
      expect((await cli(["invoke", "notes.create", JSON.stringify({ title: "Some", content: "interna" })])).code).toBe(0);
      expect((await cli(["invoke", "notes.delete", JSON.stringify({ path: "Some.md" })])).code).toBe(0);
      expect(await cli(["invoke", "trash.empty", "{}"])).toMatchObject({ code: 0, json: { ok: true, value: { trashed: 1 } } });
      const inTrash = () => readdirSync(path.join(data, "trash")).map((n) => readFileSync(path.join(data, "trash", n), "utf8"));
      expect(inTrash()).toEqual(["interna"]);
      expect(existsSync(path.join(data, "vault", "Some.md"))).toBe(false);

      // "Abrir outra pasta" (a pasta de teste do KIWI_TEST_NOTES_FOLDER): o mesmo lixo.
      expect((await cli(["invoke", "notes.openFolder", "{}"])).code).toBe(0);
      expect((await cli(["invoke", "notes.create", JSON.stringify({ title: "Fora", content: "de outra pasta" })])).code).toBe(0);
      expect(existsSync(path.join(other, "Fora.md"))).toBe(true);
      expect((await cli(["invoke", "notes.delete", JSON.stringify({ path: "Fora.md" })])).code).toBe(0);
      expect(await cli(["invoke", "trash.empty", "{}"])).toMatchObject({ code: 0, json: { ok: true } });
      expect(inTrash().sort()).toEqual(["de outra pasta", "interna"]);
      expect(existsSync(path.join(other, "Fora.md"))).toBe(false);
    },
    60_000,
  );
});
