import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { FileLog, teeConsole } from "../bun/file-log.ts";
import { tempDir } from "../../test/tmp.ts";
import { Vault } from "./vault.ts";

const undo: (() => void)[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("a Lixeira que falha não escreve o caminho da nota no kiwi.log (#457)", async () => {
  const d = tempDir("kiwinotes-varredura-log-");
  dirs.push(d);
  const log = new FileLog({ dir: path.join(d, "logs") });
  undo.push(teeConsole(log));
  const v = new Vault({
    root: path.join(d, "Notas"),
    debounceMs: 20,
    undoMs: 20,
    trash: async (abs: string) => {
      throw new Error(`sem Lixeira para ${abs}`);
    },
  });
  await v.open();
  await v.create("Projeto Sigiloso", "Conversa com a Ana", "oi");
  await v.delete("Projeto Sigiloso/Conversa com a Ana.md");
  await Bun.sleep(200);
  v.close();
  const text = readFileSync(log.file, "utf8");
  expect(text).toContain("couldn't move a note to the Trash");
  expect(text).not.toContain("Conversa com a Ana");
  expect(text).not.toContain("Projeto Sigiloso");
});
