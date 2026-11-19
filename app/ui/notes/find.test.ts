import { describe, expect, test } from "bun:test";
import { findCount, findIds, stepFind } from "./find.ts";

describe("o ⌘F do quadro e do diagrama (T22217)", () => {
  const items = [
    { id: "a", text: "Comprar Caju\ne pitanga" },
    { id: "b", text: "Ligar para a Ana" },
    { id: "c", text: "caju maduro" },
    { id: "a", text: "Feira de sábado" },
  ];

  test("acha sem acento, sem maiúscula e por cima da quebra de linha, na ordem e sem repetir", () => {
    expect(findIds(items, "CAJU")).toEqual(["a", "c"]);
    expect(findIds(items, "caju e pitanga")).toEqual(["a"]);
    expect(findIds(items, "sabado")).toEqual(["a"]);
    expect(findIds(items, "  ")).toEqual([]);
    expect(findIds(items, "manga")).toEqual([]);
  });

  test("as setas dão a volta", () => {
    expect(stepFind(-1, 3, 1)).toBe(0);
    expect(stepFind(-1, 3, -1)).toBe(2);
    expect(stepFind(2, 3, 1)).toBe(0);
    expect(stepFind(0, 3, -1)).toBe(2);
    expect(stepFind(0, 0, 1)).toBe(-1);
  });

  test("a contagem", () => {
    expect(findCount("", -1, 0)).toBe("");
    expect(findCount("x", -1, 0)).toBe("Nada encontrado");
    expect(findCount("caju", 1, 2)).toBe("2 de 2");
  });
});
