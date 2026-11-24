// Para que lado o nome do hover cresce (T26124, spec #26101).

import { describe, expect, test } from "bun:test";
import { growSide } from "./hover-label.ts";

describe("o lado da camada do hover", () => {
  test("a direita, se cabe", () => expect(growSide(200, 120, 90)).toBe("right"));
  test("a esquerda, se só ela cabe (o último botão da barra)", () => expect(growSide(200, 30, 90)).toBe("left"));
  test("sem lugar nos dois lados, o que tem mais espaço", () => {
    expect(growSide(60, 40, 90)).toBe("left");
    expect(growSide(40, 60, 90)).toBe("right");
  });
});
