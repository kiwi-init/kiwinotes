// A troca entre os balões (spec #11652): as camadas da passagem e as escalas do FLIP, puras.
import { describe, expect, test } from "bun:test";

import { type ReactNode } from "react";

import { BUBBLE_ENTER_DELAY_MS, BUBBLE_ENTER_MS, BUBBLE_EXIT_MS, BUBBLE_FADE_MS, flipFrames, nextItems } from "./BubblePresence";

/** Sem o id da instância (que só cresce), para comparar. */
const plain = (items: { key: string; node: ReactNode; leaving: boolean }[]) => items.map(({ key, node, leaving }) => ({ key, node, leaving }));

describe("nextItems", () => {
  test("a chave nova entra e a de antes sai", () => {
    const a = nextItems([], "a", "A");
    expect(plain(a)).toEqual([{ key: "a", node: "A", leaving: false }]);
    const b = nextItems(a, "b", "B");
    expect(plain(b)).toEqual([
      { key: "a", node: "A", leaving: true },
      { key: "b", node: "B", leaving: false },
    ]);
  });

  test("a mesma chave só troca o conteúdo", () => {
    const a = nextItems([], "a", "A");
    expect(plain(nextItems(a, "a", "A2"))).toEqual([{ key: "a", node: "A2", leaving: false }]);
  });

  test("sem chave, o que estava sai com o conteúdo de antes", () => {
    const a = nextItems([], "a", "A");
    expect(plain(nextItems(a, null, null))).toEqual([{ key: "a", node: "A", leaving: true }]);
  });

  test("a chave que volta enquanto saía entra de novo, sem ficar duas vezes", () => {
    const first = nextItems([], "a", "A");
    const out = nextItems(nextItems(first, "b", "B"), "a", "A3");
    expect(out.map((i) => `${i.key}:${i.leaving}`)).toEqual(["b:true", "a:false"]);
    // Um nó novo: a instância que volta não é a que saía.
    expect(out[1]!.id).not.toBe(first[0]!.id);
  });
});

describe("os tempos", () => {
  test("a entrada fica entre 220 e 280 ms, a saída entre 160 e 200, e o esmaecer em 120", () => {
    expect(BUBBLE_ENTER_MS).toBeGreaterThanOrEqual(220);
    expect(BUBBLE_ENTER_MS).toBeLessThanOrEqual(280);
    expect(BUBBLE_EXIT_MS).toBeGreaterThanOrEqual(160);
    expect(BUBBLE_EXIT_MS).toBeLessThanOrEqual(200);
    expect(BUBBLE_FADE_MS).toBe(120);
  });

  test("a entrada começa antes de a saída acabar (nunca um quadro sem balão)", () => {
    expect(BUBBLE_ENTER_DELAY_MS).toBeLessThan(BUBBLE_EXIT_MS);
  });
});

describe("flipFrames", () => {
  test("a casca vai do tamanho de antes ao de agora, e o conteúdo faz o inverso", () => {
    const { shell, content } = flipFrames(0.5, 2, 4);
    expect(shell[0]!.transform).toBe("scale(0.5, 2)");
    expect(shell.at(-1)!.transform).toBe("scale(1, 1)");
    expect(content[0]!.transform).toBe("scale(2, 0.5)");
    expect(content.at(-1)!.transform).toBe("scale(1, 1)");
    expect(shell.map((k) => k.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});
