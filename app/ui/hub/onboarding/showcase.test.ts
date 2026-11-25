// A tela do que o Kiwi faz (T20838, spec #20828): os 4 exemplos, a linha do tempo de cada um e o nome do mascote.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as text from "./showcaseText.ts";
import { catState, exampleMs, nextIndex, PAUSE_MS, sceneAt, SHOWCASE, showcase, stillScene, TYPE_MS, WORK_MS } from "./showcaseText.ts";

const EXAMPLES = showcase().examples;

describe("os exemplos (spec #20828)", () => {
  test("são os 4 do spec, na ordem", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(["organizar", "documento", "reuniao", "achar"]);
  });

  test("só a reunião não tem pedido: ela termina, e o Kiwi propõe", () => {
    expect(EXAMPLES.filter((e) => e.ask === null).map((e) => e.id)).toEqual(["reuniao"]);
  });

  test("nas telas do mascote, o nome é Kiwi, nunca Kiwi Cat", () => {
    const strings = JSON.stringify(text);
    const component = readFileSync(join(import.meta.dir, "KiwiShowcase.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    for (const s of [strings, component]) expect(s).not.toMatch(/Kiwi[ -][Cc]at/);
  });

  test("em inglês, os mesmos exemplos, na mesma ordem e com o pedido nos mesmos", () => {
    const shape = (l: keyof typeof SHOWCASE) => SHOWCASE[l].examples.map((e) => [e.id, e.ask === null]);
    expect(shape("en")).toEqual(shape("pt"));
    expect(SHOWCASE.en.sheet.map((r) => r.length)).toEqual(SHOWCASE.pt.sheet.map((r) => r.length));
    expect(SHOWCASE.en.dot(2, 4, "Create a document")).toBe("Example 2 of 4: Create a document");
  });
});

describe("a linha do tempo", () => {
  const organizar = EXAMPLES[0]!;
  const ask = organizar.ask!;

  test("o pedido é digitado letra a letra", () => {
    expect(sceneAt(0, 0)).toEqual({ index: 0, phase: "pedido", typed: 0, ask });
    expect(sceneAt(0, TYPE_MS * 5 + 1).typed).toBe(5);
    expect(sceneAt(0, ask.length * TYPE_MS + PAUSE_MS - 1)).toMatchObject({ phase: "pedido", typed: ask.length });
  });

  test("depois do pedido, o Kiwi trabalha, e então o resultado aparece e fica", () => {
    const asked = ask.length * TYPE_MS + PAUSE_MS;
    expect(sceneAt(0, asked).phase).toBe("trabalhando");
    expect(sceneAt(0, asked + WORK_MS).phase).toBe("resultado");
    expect(sceneAt(0, exampleMs(organizar) + 10_000).phase).toBe("resultado");
  });

  test("a reunião vai direto ao trabalho, depois de uma pausa", () => {
    expect(sceneAt(2, 0)).toEqual({ index: 2, phase: "pedido", typed: 0, ask: null });
    expect(sceneAt(2, PAUSE_MS).phase).toBe("trabalhando");
  });

  test("parado (Reduzir movimento), cada exemplo mostra o resultado, com o pedido inteiro", () => {
    for (let i = 0; i < EXAMPLES.length; i++) {
      expect(stillScene(i)).toEqual({ index: i, phase: "resultado", typed: EXAMPLES[i]!.ask?.length ?? 0, ask: EXAMPLES[i]!.ask });
    }
  });

  test("depois do último, volta ao primeiro", () => {
    expect([0, 1, 2, 3].map(nextIndex)).toEqual([1, 2, 3, 0]);
  });

  test("cada exemplo cabe em menos de 10 s", () => {
    for (const e of EXAMPLES) expect(exampleMs(e)).toBeLessThan(10_000);
  });

  test("o gato ouve, pensa e termina", () => {
    expect(["pedido", "trabalhando", "resultado"].map((p) => catState(p as never))).toEqual(["ouvindo", "thinking", "pronto"]);
  });
});
