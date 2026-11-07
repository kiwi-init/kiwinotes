// L23: o `paste.edited` vira dicionário no arquivo de verdade (o DictionaryStore numa pasta temporária), na 2ª vez.

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

const pax = { pasted: "mandei para o Pax ontem.", edited: "mandei para o PACS ontem.", app: "com.tinyspeck.slackmacgap" };

describe("learnFromEdit", () => {
  test("a mesma troca na 2ª vez entra no dicionário; na 3ª, nada muda", async () => {
    const store = new DictionaryStore(dir);
    expect(await learnFromEdit(store, pax)).toBeNull();
    expect(await store.load()).toEqual([]);
    // A contagem não liga para maiúscula e acento no que o STT escreveu; o alias é o da 2ª vez (o alias também não liga).
    expect(await learnFromEdit(store, { ...pax, pasted: "o pax caiu", edited: "o PACS caiu" })).toEqual([{ term: "PACS", aliases: ["pax"] }]);
    expect(await store.load()).toEqual([{ term: "PACS", aliases: ["pax"] }]);
    expect(await learnFromEdit(store, pax)).toBeNull();
  });

  test("uma troca de uma vez só nunca vira regra: gato → fato uma vez não aprende, duas aprende", async () => {
    const store = new DictionaryStore(dir);
    const gato = { pasted: "o gato saiu", edited: "o fato saiu" };
    expect(await learnFromEdit(store, gato)).toBeNull();
    expect(await learnFromEdit(store, { pasted: "o servidor caiu", edited: "o serviço caiu" })).toBeNull();
    expect(await store.load()).toEqual([]);
    expect(await learnFromEdit(store, gato)).toEqual([{ term: "fato", aliases: ["gato"] }]);
  });

  test("reescrever não aprende, e num terminal nada aprende, nem na 2ª vez", async () => {
    const store = new DictionaryStore(dir);
    const terminal = { pasted: "rode o cube control", edited: "rode o kubectl", app: "com.apple.Terminal" };
    for (let i = 0; i < 2; i++) {
      expect(await learnFromEdit(store, { pasted: "a reunião é amanhã", edited: "a reunião é hoje" })).toBeNull();
      expect(await learnFromEdit(store, terminal)).toBeNull();
    }
    expect(await store.load()).toEqual([]);
  });
});
