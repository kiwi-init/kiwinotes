import { describe, expect, test } from "bun:test";
import { linguaDe, linguaOuNada, pontosDeLingua } from "./lingua.ts";

describe("linguaOuNada (T31029)", () => {
  test("frases em português", () => {
    for (const f of [
      "Anotei na nota Ideias.",
      "A reunião é amanhã às dez.",
      "Achei duas notas sobre o orçamento.",
      "Pronto, está salvo.",
      "Não encontrei nada com esse nome.",
      "O disco tem 60 TB livres.",
    ])
      expect(linguaOuNada(f), f).toBe("pt");
  });

  test("frases em inglês", () => {
    for (const f of [
      "I saved it in the Ideas note.",
      "The meeting is tomorrow at ten.",
      "Found two notes about the budget.",
      "It's done.",
      "There's nothing with that name.",
      "The disk has 60 TB free.",
    ])
      expect(linguaOuNada(f), f).toBe("en");
  });

  test("sem pista é null: só número, um nome, uma sigla, uma interjeição", () => {
    for (const f of ["Hmm.", "OK.", "42.", "Ana.", "PDF", "", "Projeto X."]) expect(linguaOuNada(f), f).toBeNull();
  });

  test("uma palavra acentuada fora das listas já é pista do português", () => {
    expect(linguaOuNada("Orçamento.")).toBe("pt");
    expect(pontosDeLingua("Orçamento aprovado.")).toEqual({ pt: 1, en: 0 });
  });

  test("as palavras que existem nas duas línguas não contam", () => {
    expect(pontosDeLingua("a do no")).toEqual({ pt: 0, en: 0 });
  });

  test("linguaDe cai na padrão quando não há pista", () => {
    expect(linguaDe("42.")).toBe("pt");
    expect(linguaDe("42.", "en")).toBe("en");
    expect(linguaDe("The note is ready.", "pt")).toBe("en");
  });
});
