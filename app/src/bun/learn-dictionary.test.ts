// L23: o `paste.edited` vira dicionário no arquivo de verdade (o DictionaryStore numa pasta temporária).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { learnFromEdit } from "./learn-dictionary.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kn-learn-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("learnFromEdit", () => {
  test("a correção do termo fica salva, e a mesma de novo não muda o arquivo", async () => {
    const store = new DictionaryStore(dir);
    const edit = { pasted: "mandei para o Pax ontem.", edited: "mandei para o PACS ontem.", app: "com.tinyspeck.slackmacgap" };
    expect(await learnFromEdit(store, edit)).toEqual([{ term: "PACS", aliases: ["Pax"] }]);
    expect(await store.load()).toEqual([{ term: "PACS", aliases: ["Pax"] }]);
    expect(await learnFromEdit(store, edit)).toBeNull();
  });

  test("reescrever não aprende, e num terminal nada aprende", async () => {
    const store = new DictionaryStore(dir);
    expect(await learnFromEdit(store, { pasted: "a reunião é amanhã", edited: "a reunião é hoje" })).toBeNull();
    expect(await learnFromEdit(store, { pasted: "rode o cube control", edited: "rode o kubectl", app: "com.apple.Terminal" })).toBeNull();
    expect(await store.load()).toEqual([]);
  });
});
