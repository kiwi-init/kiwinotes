// O recorte do rostinho da etiqueta (T21806): a cabeça do gato do app, sem a névoa fraca de volta.

import { describe, expect, test } from "bun:test";

import { HEAD_ALPHA, headSquare, kiwiFace, kiwiFaceUrl } from "./kiwi-face.ts";

/** Um quadro `w`×`h` transparente, com retângulos de opacidade `a`. */
function frame(w: number, h: number, rects: { x: number; y: number; w: number; h: number; a: number }[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) d[(y * w + x) * 4 + 3] = r.a;
  return d;
}

describe("headSquare", () => {
  test("o quadrado da cabeça: o lado da maior medida, centrado nela", () => {
    // Uma cabeça larga (40×20) no meio de um quadro de 100.
    expect(headSquare(frame(100, 100, [{ x: 30, y: 50, w: 40, h: 20, a: 255 }]), 100, 100)).toEqual({ left: 30, top: 40, side: 40 });
  });

  test("a névoa fraca de volta fica fora; a forte entra", () => {
    const weak = { x: 0, y: 0, w: 100, h: 100, a: HEAD_ALPHA - 1 };
    expect(headSquare(frame(100, 100, [weak, { x: 40, y: 40, w: 20, h: 20, a: 255 }]), 100, 100)).toEqual({ left: 40, top: 40, side: 20 });
    expect(headSquare(frame(100, 100, [{ x: 40, y: 40, w: 20, h: 20, a: HEAD_ALPHA }]), 100, 100)).toEqual({ left: 40, top: 40, side: 20 });
  });

  test("perto da borda, o quadrado fica dentro do quadro", () => {
    expect(headSquare(frame(100, 100, [{ x: 0, y: 90, w: 30, h: 10, a: 255 }]), 100, 100)).toEqual({ left: 0, top: 70, side: 30 });
  });

  test("sem gato no quadro, nada", () => {
    expect(headSquare(frame(10, 10, []), 10, 10)).toBeNull();
  });
});

test("sem DOM, o rosto é vazio e a etiqueta cai no ponto", async () => {
  expect(await kiwiFace("kiwi-neon")).toBe("");
  expect(kiwiFaceUrl("kiwi-neon")).toBe("");
});
