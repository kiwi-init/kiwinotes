// A memória do agente em Ajustes (spec #11469, T11668): os textos.

import { expect, test } from "bun:test";

import { clearQuestion, countLine, dropFact, factCount, instructionsCount, outsideLine, overLine, replaceFact, skippedLine, skippedReason } from "./memoryText.ts";
import { memoryBubbleLine } from "../hub/MemoryBubble.tsx";

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

test("a memória escrita à mão que passou do limite (spec #12749): o balão diz o motivo, e Ajustes diz o que fica de fora", () => {
  const tail = "Apague ou encurte um em Ajustes › Agente › Memória.";
  expect(overLine({ facts: 61, long: 0 })).toBe(`A memória passou do limite: tem 61 fatos. ${tail}`);
  expect(overLine({ facts: 5, long: 1 })).toBe(`A memória passou do limite: um fato passa de 300 caracteres. ${tail}`);
  expect(overLine({ facts: 5, long: 2 })).toBe(`A memória passou do limite: 2 fatos passam de 300 caracteres. ${tail}`);
  expect(overLine({ facts: 62, long: 1 })).toBe(`A memória passou do limite: tem 62 fatos, e um passa de 300 caracteres. ${tail}`);
  expect(memoryBubbleLine({ id: "1", action: "over", fact: "tem um gato", at: "", over: { facts: 61, long: 0 } })).toBe(overLine({ facts: 61, long: 0 }));
  expect(skippedLine(1)).toBe("Um fato escrito no arquivo fica de fora: o agente não lê, e não muda a memória até você encurtar ou apagar. Nada foi apagado.");
  expect(skippedLine(2)).toStartWith("2 fatos escritos no arquivo ficam de fora");
  expect(skippedReason("long")).toBe("passa de 300 caracteres");
  expect(skippedReason("over")).toBe("depois dos 60 fatos");
  expect(outsideLine(1)).toStartWith("O arquivo tem uma linha que não é fato");
  expect(outsideLine(3)).toStartWith("O arquivo tem 3 linhas que não são fato");
  expect(factCount(412)).toBe("412 de 300 caracteres");
});
