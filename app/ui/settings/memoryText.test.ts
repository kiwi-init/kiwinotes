// A memória do agente em Ajustes (spec #11469, T11668): os textos.

import { expect, test } from "bun:test";

import { clearQuestion, countLine, dropFact, instructionsCount, replaceFact } from "./memoryText.ts";

test("a contagem dos fatos, o aviso de cheia, os caracteres das instruções e a pergunta de apagar tudo", () => {
  expect(countLine(3, 60)).toBe("3 de 60 fatos");
  expect(countLine(60, 60)).toBe("60 de 60 fatos: cheia. O agente tem de esquecer um antes de anotar outro.");
  expect(instructionsCount(120)).toBe("120 de 2.000 caracteres");
  expect(clearQuestion(1)).toBe("Apagar o fato da memória?");
  expect(clearQuestion(3)).toBe("Apagar os 3 fatos da memória?");
});

test("editar e apagar acham o fato pelo texto: se o agente muda a lista no meio, o fato certo muda, ou nada (revisão do T11668)", () => {
  const before = ["a", "b", "c", "d"];
  // A pessoa abre o 3º ("c") e o agente esquece o 1º: a troca acha "c", não o que ficou na posição 2.
  const live = before.filter((f) => f !== "a");
  expect(replaceFact(live, "c", "c editado")).toEqual(["b", "c editado", "d"]);
  // O agente esqueceu o próprio fato em edição: nada é salvo.
  expect(replaceFact(["b", "d"], "c", "c editado")).toBeNull();
  expect(dropFact(live, "c")).toEqual(["b", "d"]);
  expect(dropFact(["b", "d"], "c")).toBeNull();
});
