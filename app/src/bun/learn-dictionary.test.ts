// L26: a correção depois de colar vira pergunta no cartão, no arquivo de verdade (o DictionaryStore numa pasta temporária).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { DictionaryStore, type DictionaryTerm } from "../store/dictionary.ts";
import { CorrectionOffers, declinedFile, type SendOffer } from "./learn-dictionary.ts";
import { tempDir } from "../../test/tmp.ts";

let dir = "";
beforeEach(() => {
  dir = tempDir("kn-learn-");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cilo = { pasted: "mandei para o Cilo ontem.", edited: "mandei para o SILO ontem.", app: "com.tinyspeck.slackmacgap" };

function setup(shown = true) {
  const store = new DictionaryStore(dir);
  const sent: { from: string; to: string }[] = [];
  const learned: DictionaryTerm[][] = [];
  const send: SendOffer = async (c) => {
    sent.push({ from: c.from, to: c.to });
    return { ok: shown };
  };
  const offers = new CorrectionOffers(store, send, async (terms) => void learned.push(terms));
  return { store, sent, learned, offers };
}

describe("CorrectionOffers", () => {
  test("a 1ª correção já vira pergunta, e Adicionar grava e avisa o STT", async () => {
    const { store, sent, learned, offers } = setup();
    expect(await offers.edited(cilo)).toBe(true);
    expect(sent).toEqual([{ from: "Cilo", to: "SILO" }]);
    expect(await store.load()).toEqual([]);
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "add" })).toBe("learned");
    expect(await store.load()).toEqual([{ term: "SILO", aliases: ["Cilo"] }]);
    expect(learned).toEqual([[{ term: "SILO", aliases: ["Cilo"] }]]);
    // Com o termo no dicionário, a mesma correção não pergunta de novo.
    expect(await offers.edited(cilo)).toBe(false);
    expect(sent.length).toBe(1);
  });

  test("Agora não: nada grava, e a mesma troca nunca mais é oferecida, nem com outra maiúscula", async () => {
    const { store, sent, offers } = setup();
    await offers.edited(cilo);
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "notNow" })).toBe("declined");
    expect(await store.load()).toEqual([]);
    expect(await offers.edited({ pasted: "o cilo caiu", edited: "o SILO caiu" })).toBe(false);
    expect(sent.length).toBe(1);
    expect(JSON.parse(readFileSync(declinedFile(store), "utf8")).version).toBe(2);
  });

  test("sem resposta (expired), nada grava e a troca pode ser oferecida de novo", async () => {
    const { store, sent, offers } = setup();
    await offers.edited(cilo);
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "expired" })).toBe("expired");
    expect(await store.load()).toEqual([]);
    expect(await offers.edited(cilo)).toBe(true);
    expect(sent.length).toBe(2);
  });

  test("só vale a resposta da troca que está no cartão", async () => {
    const { store, offers } = setup();
    await offers.edited(cilo);
    expect(await offers.answered({ from: "cube control", to: "kubectl", answer: "add" })).toBeNull();
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "add" })).toBe("learned");
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "add" })).toBeNull();
    expect(await store.load()).toEqual([{ term: "SILO", aliases: ["Cilo"] }]);
  });

  test("reescrever não pergunta, e num terminal nada pergunta", async () => {
    const { sent, offers } = setup();
    expect(await offers.edited({ pasted: "a reunião é amanhã", edited: "a reunião é hoje" })).toBe(false);
    expect(await offers.edited({ pasted: "rode o cube control", edited: "rode o kubectl", app: "com.apple.Terminal" })).toBe(false);
    expect(sent).toEqual([]);
  });

  test("um helper que não mostra o cartão (antigo, ou sem tela) não deixa oferta de pé", async () => {
    const { store, offers } = setup(false);
    expect(await offers.edited(cilo)).toBe(false);
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "add" })).toBeNull();
    expect(await store.load()).toEqual([]);
  });

  test("o arquivo das candidatas da L23 (versão 1) não vira recusa", async () => {
    const { store, offers } = setup();
    writeFileSync(declinedFile(store), JSON.stringify({ version: 1, candidates: { "cilo→SILO": { count: 1, at: "2026-11-06T00:00:00.000Z" } } }));
    expect(await offers.edited(cilo)).toBe(true);
  });

  // Issue #1: por que não perguntou, para o log, sem o texto.
  test("lastRefusal diz o motivo da última correção que não virou cartão", async () => {
    const { offers } = setup();
    expect(await offers.edited({ ...cilo, app: "com.apple.Terminal" })).toBe(false);
    expect(offers.lastRefusal).toBe("literal");
    expect(await offers.edited({ pasted: "mas eu fui", edited: "mais eu fui" })).toBe(false);
    expect(offers.lastRefusal).toBe("common");
    expect(await offers.edited(cilo)).toBe(true);
    expect(offers.lastRefusal).toBeNull();
    expect(await offers.answered({ from: "Cilo", to: "SILO", answer: "add" })).toBe("learned");
    expect(await offers.edited(cilo)).toBe(false);
    expect(offers.lastRefusal).toBe("in_dictionary");
  });

  test("lastRefusal: recusada antes, ou o cartão não apareceu", async () => {
    const a = setup();
    await a.offers.edited(cilo);
    await a.offers.answered({ from: "Cilo", to: "SILO", answer: "notNow" });
    expect(await a.offers.edited(cilo)).toBe(false);
    expect(a.offers.lastRefusal).toBe("declined");
    // A mesma pasta: outra troca, que ninguém recusou.
    const b = setup(false);
    expect(await b.offers.edited({ pasted: "o cluster de cubernetes caiu", edited: "o cluster de Kubernetes caiu" })).toBe(false);
    expect(b.offers.lastRefusal).toBe("card");
  });
});
