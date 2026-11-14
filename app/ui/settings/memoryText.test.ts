// A memória do agente em Ajustes (spec #11469, T11668): os textos.

import { expect, test } from "bun:test";

import { clearQuestion, countLine, instructionsCount } from "./memoryText.ts";

test("a contagem dos fatos, o aviso de cheia, os caracteres das instruções e a pergunta de apagar tudo", () => {
  expect(countLine(3, 60)).toBe("3 de 60 fatos");
  expect(countLine(60, 60)).toBe("60 de 60 fatos: cheia. O agente tem de esquecer um antes de anotar outro.");
  expect(instructionsCount(120)).toBe("120 de 2.000 caracteres");
  expect(clearQuestion(1)).toBe("Apagar o fato da memória?");
  expect(clearQuestion(3)).toBe("Apagar os 3 fatos da memória?");
});
