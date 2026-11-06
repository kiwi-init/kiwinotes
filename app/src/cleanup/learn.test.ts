// L23: a troca logo depois de colar vira dicionário só quando é a correção de um termo.

import { describe, expect, test } from "bun:test";

import { learnedPair, withLearned } from "./learn.ts";

describe("learnedPair", () => {
  test("a troca de um termo que soa parecido aprende", () => {
    expect(learnedPair("Mandei o exame para o Pax ontem.", "Mandei o exame para o PACS ontem.")).toEqual({ from: "Pax", to: "PACS" });
    expect(learnedPair("rode o cube control get pods", "rode o kubectl get pods")).toEqual({ from: "cube control", to: "kubectl" });
    expect(learnedPair("o arquivo dicom chegou", "o arquivo DICOM chegou")).toEqual({ from: "dicom", to: "DICOM" });
    expect(learnedPair("falei com o Joao", "falei com o João")).toEqual({ from: "Joao", to: "João" });
  });

  test("reescrever, trocar por outra palavra, inserir ou apagar não aprende", () => {
    expect(learnedPair("a reunião é amanhã", "a reunião é hoje")).toBeNull();
    expect(learnedPair("vou mandar o relatório", "vou mandar o relatório agora")).toBeNull();
    expect(learnedPair("vou mandar o relatório agora", "vou mandar o relatório")).toBeNull();
    expect(learnedPair("pode ver isso hoje à tarde", "consegue olhar amanhã cedo por favor")).toBeNull();
    expect(learnedPair("igual", "igual")).toBeNull();
  });

  test("só maiúscula na 1ª letra, ou número no lugar de palavra, não aprende", () => {
    expect(learnedPair("bom dia ana", "bom dia Ana")).toBeNull();
    expect(learnedPair("Bom dia Ana", "bom dia ana")).toBeNull();
    expect(learnedPair("são três horas", "são 3 horas")).toBeNull();
  });

  test("mais de 3 palavras de um lado é reescrita", () => {
    expect(learnedPair("um dois três quatro cinco", "um dois tres quarto cinco seis sete oito")).toBeNull();
  });
});

describe("withLearned", () => {
  test("termo novo, com o que o STT escreveu como alias", () => {
    expect(withLearned([], { from: "Pax", to: "PACS" })).toEqual([{ term: "PACS", aliases: ["Pax"] }]);
  });

  test("termo que já existe ganha o alias, e o mesmo alias de novo não muda nada", () => {
    const terms = [{ term: "PACS", aliases: ["packs"] }];
    expect(withLearned(terms, { from: "Pax", to: "PACS" })).toEqual([{ term: "PACS", aliases: ["packs", "Pax"] }]);
    expect(withLearned([{ term: "PACS", aliases: ["Pax"] }], { from: "pax", to: "PACS" })).toBeNull();
  });

  test("só a grafia: o termo fica com a grafia da pessoa, sem alias", () => {
    expect(withLearned([], { from: "dicom", to: "DICOM" })).toEqual([{ term: "DICOM", aliases: [] }]);
    expect(withLearned([{ term: "Dicom", aliases: [] }], { from: "dicom", to: "DICOM" })).toEqual([{ term: "DICOM", aliases: [] }]);
    expect(withLearned([{ term: "DICOM", aliases: [] }], { from: "dicom", to: "DICOM" })).toBeNull();
  });
});
