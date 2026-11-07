// L23: a troca logo depois de colar vira dicionário só quando é a correção de um termo.

import { describe, expect, test } from "bun:test";

import { learnedPair, withLearned } from "./learn.ts";

describe("learnedPair", () => {
  test("a troca de um termo que soa parecido aprende", () => {
    expect(learnedPair("Mandei o exame para o Pax ontem.", "Mandei o exame para o PACS ontem.")).toEqual({ from: "Pax", to: "PACS" });
    expect(learnedPair("rode o cube control get pods", "rode o kubectl get pods")).toEqual({ from: "cube control", to: "kubectl" });
    expect(learnedPair("o arquivo dicom chegou", "o arquivo DICOM chegou")).toEqual({ from: "dicom", to: "DICOM" });
    expect(learnedPair("o cluster de cubernetes caiu", "o cluster de Kubernetes caiu")).toEqual({ from: "cubernetes", to: "Kubernetes" });
  });

  test("gramática não vira regra: palavra comum, ou só acento e pontuação, não aprende (review do #266)", () => {
    expect(learnedPair("ele e o melhor", "ele é o melhor")).toBeNull();
    expect(learnedPair("ela esta aqui", "ela está aqui")).toBeNull();
    expect(learnedPair("tentei mas não deu", "tentei mais não deu")).toBeNull();
    expect(learnedPair("o carro de Ana", "o carro do Ana")).toBeNull();
    expect(learnedPair("falei com o Joao", "falei com o João")).toBeNull();
  });

  test("só concordância de gênero ou número não aprende (#6724)", () => {
    expect(learnedPair("a reunião foi ótimo", "a reunião foi ótima")).toBeNull();
    expect(learnedPair("o carro está pronto", "o carro está pronta")).toBeNull();
    expect(learnedPair("ele foi ao mercado", "ele foi ao mercados")).toBeNull();
    expect(learnedPair("vamos ao mercado amanhã", "vamos aos mercados amanhã")).toBeNull();
    expect(learnedPair("o carro é bonito", "o carro é bonita")).toBeNull();
    expect(learnedPair("a eleição de ontem", "a eleições de ontem")).toBeNull();
    expect(learnedPair("o pão chegou", "os pães chegou")).toBeNull();
    expect(learnedPair("mandei para o Pax", "mandei para o PACS")).toEqual({ from: "Pax", to: "PACS" });
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
