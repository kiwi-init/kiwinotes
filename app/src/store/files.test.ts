// T7816: um JSON do app que não é JSON não derruba quem lê; ele volta ao padrão, e o arquivo da pessoa fica guardado.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DictionaryStore } from "./dictionary.ts";
import { readJson } from "./files.ts";
import { tempDir } from "../../test/tmp.ts";

const root = tempDir("kn-files-");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("readJson (T7816)", () => {
  test("sem o arquivo, undefined; com JSON, o valor", async () => {
    expect(await readJson(path.join(root, "nao-existe.json"))).toBeUndefined();
    writeFileSync(path.join(root, "bom.json"), '{"a": 1}');
    expect(await readJson<{ a: number }>(path.join(root, "bom.json"))).toEqual({ a: 1 });
  });

  test("um arquivo que não é JSON volta undefined e fica guardado ao lado, com o texto da pessoa", async () => {
    const dir = mkdtempSync(path.join(root, "torto-"));
    const broken = '{"cues": false, "dailyFolder": "Diário/2026", ';
    writeFileSync(path.join(dir, "settings.json"), broken);
    expect(await readJson(path.join(dir, "settings.json"))).toBeUndefined();
    const names = readdirSync(dir);
    expect(names).not.toContain("settings.json");
    const kept = names.filter((n) => n.startsWith("settings.json.broken-"));
    expect(kept.length).toBe(1);
    expect(readFileSync(path.join(dir, kept[0]!), "utf8")).toBe(broken);
  });

  test("os outros stores que usam o readJson também seguem: o dicionário torto vira o padrão", async () => {
    const dir = mkdtempSync(path.join(root, "dic-"));
    writeFileSync(path.join(dir, "dictionary.json"), "{ nao é json");
    expect(await new DictionaryStore(dir).load()).toEqual([]);
  });
});
