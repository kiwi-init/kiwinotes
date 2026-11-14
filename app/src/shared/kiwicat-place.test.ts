import { expect, test } from "bun:test";

import { CAT_POSITIONS, catPreviewRect, catSize, catSizeLabel, isCatPosition, isCatSize } from "./kiwicat-place.ts";

test("as seis posições e o tamanho de 0,6 a 1,6 (spec #12949)", () => {
  expect(CAT_POSITIONS.map((p) => p.id)).toEqual(["center", "bottom-center", "top-left", "top-right", "bottom-left", "bottom-right"]);
  expect(isCatPosition("top-left")).toBe(true);
  expect(isCatPosition("meio")).toBe(false);
  expect([0.6, 1, 1.6].every(isCatSize)).toBe(true);
  expect([0.5, 1.7, Number.NaN, "1"].some(isCatSize)).toBe(false);
  expect([catSize(0.2), catSize(2), catSize(1.26), catSize(undefined)]).toEqual([0.6, 1.6, 1.3, 1]);
  expect([catSizeLabel(1), catSizeLabel(1.3)]).toEqual(["1×", "1,3×"]);
});

test("a prévia põe o gato onde o helper põe, dentro da tela, em todas as posições e nos dois limites", () => {
  for (const { id } of CAT_POSITIONS)
    for (const t of [0.6, 1.6]) {
      const r = catPreviewRect(id, t);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThan(2.7); // abaixo da barra de menus
      expect(r.left + r.width).toBeLessThanOrEqual(100);
      expect(r.top + r.height).toBeLessThan(92.3); // acima do Dock
    }
  expect(catPreviewRect("top-left", 1)).toEqual({ left: 1.7, top: 5.4, width: 13.3, height: 26.7 });
  const c = catPreviewRect("center", 1);
  expect(c.left + c.width / 2).toBeCloseTo(50, 0);
});
