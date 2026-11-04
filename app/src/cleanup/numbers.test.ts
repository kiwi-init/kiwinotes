// T1974: número por extenso vira algarismo (harry #1968), e o que fica por extenso de propósito.

import { describe, expect, test } from "bun:test";

import { cleanupWithRules, rulesDroppedTooMuch } from "./index.ts";
import { isNumberWord, spokenNumbers } from "./numbers.ts";

const cases = (list: [string, string][]) => {
  for (const [raw, want] of list) test(raw, () => expect(spokenNumbers(raw)).toBe(want));
};

describe("spokenNumbers (T1974)", () => {
  describe("cardinais", () =>
    cases([
      ["são três arquivos", "são 3 arquivos"],
      ["duzentos e trinta e quatro exames", "234 exames"],
      ["vinte mil exames", "20.000 exames"],
      ["dois mil e vinte e seis", "2026"],
      ["cento e um", "101"],
      ["two thousand files", "2000 files"],
      ["twenty-one tests", "21 tests"],
      ["twenty twenty-six", "2026"],
    ]));

  describe("datas e horas", () =>
    cases([
      ["dia cinco de março", "dia 5 de março"],
      ["um de março", "1º de março"],
      ["às três e meia", "às 3h30"],
      ["chego às quatro.", "chego às 4h."],
      ["sexta às oito e quinze", "sexta às 8h15"],
      ["à uma da tarde", "à 1h da tarde"],
      ["at three thirty", "at 3:30"],
      ["march fifth", "March 5"],
      ["the fifth of march", "March 5"],
      // "may" é verbo também: só com o ordinal.
      ["I may go", "I may go"],
    ]));

  describe("dinheiro, porcentagem, decimal", () =>
    cases([
      ["cinquenta reais", "50 reais"],
      ["ten dollars", "$10"],
      ["dez por cento", "10%"],
      ["cem por cento", "100%"],
      ["sete vírgula cinco", "7,5"],
      ["versão dois ponto um", "versão 2.1"],
      ["nove nove oito sete seis", "99876"],
    ]));

  describe("fica por extenso", () =>
    cases([
      ["um dia desses", "um dia desses"],
      ["uma vez", "uma vez"],
      ["de um lado", "de um lado"],
      ["um arquivo e uma pasta", "um arquivo e uma pasta"],
      ["one of them", "one of them"],
      ["the two of us", "the two of us"],
      ["os dois vão", "os dois vão"],
      ["um ou dois minutos", "um ou dois minutos"],
      ["do zero", "do zero"],
      ["mil vezes", "mil vezes"],
      ["meia hora", "meia hora"],
      ["o primeiro lugar", "o primeiro lugar"],
    ]));

  describe("o resto", () =>
    cases([
      // "os dois" com substantivo é quantidade.
      ["os dois arquivos", "os 2 arquivos"],
      // A gagueira some.
      ["três três arquivos", "3 arquivos"],
      // Dois números colados que não formam nada ficam como foram ditos.
      ["vinte trinta", "vinte trinta"],
    ]));

  test("isNumberWord: as palavras que viram algarismo", () => {
    for (const w of ["três", "Cinquenta", "mil", "twenty-one", "hundred"]) expect(isNumberWord(w)).toBe(true);
    for (const w of ["arquivo", "meia", "primeiro", "segunda"]) expect(isNumberWord(w)).toBe(false);
  });
});

describe("nas regras (T1974)", () => {
  test("a trava de palavras perdidas não conta o número que virou algarismo", () => {
    expect(rulesDroppedTooMuch("cinquenta reais trinta dólares quarenta euros", "50 reais 30 dólares 40 euros")).toBe(false);
    expect(cleanupWithRules({ raw: "cinquenta reais trinta dólares quarenta euros" }).text).toBe("50 reais 30 dólares 40 euros.");
  });

  test("a autocorreção recebe algarismo (T1955)", () => {
    expect(cleanupWithRules({ raw: "me encontra às três, não, quer dizer, às quatro" }).text).toBe("Me encontra às 4h.");
  });

  test("uma frase que termina em % ganha o ponto final", () => {
    expect(cleanupWithRules({ raw: "o uso subiu dez por cento" }).text).toBe("O uso subiu 10%.");
  });

  test("no Terminal: a prosa vira algarismo, o comando fica como foi dito", () => {
    const terminal = "com.apple.Terminal";
    expect(cleanupWithRules({ raw: "pede para o claude criar três testes", bundleId: terminal }).text).toBe("Pede para o claude criar 3 testes.");
    expect(cleanupWithRules({ raw: "git checkout -b dois", bundleId: terminal }).text).toBe("git checkout -b dois");
  });
});
