import { expect, test } from "bun:test";

import { overlayPlacement } from "./placement.ts";

test("a página lê a escala, o lado e o balão da URL do helper (spec #12949)", () => {
  expect(overlayPlacement(new URLSearchParams(""))).toEqual({ scale: 1, catW: 192, catH: 240, winW: 300, winH: 352, lado: "center", balao: "acima" });
  expect(overlayPlacement(new URLSearchParams("escala=1.60&lado=left&balao=abaixo"))).toEqual({ scale: 1.6, catW: 307, catH: 384, winW: 307, winH: 496, lado: "left", balao: "abaixo" });
  expect(overlayPlacement(new URLSearchParams("escala=0.60&lado=right&balao=acima"))).toMatchObject({ catW: 115, catH: 144, winW: 300, winH: 256, lado: "right" });
  expect(overlayPlacement(new URLSearchParams("escala=9&lado=x&balao=y"))).toMatchObject({ scale: 1.6, lado: "center", balao: "acima" });
  expect(overlayPlacement(new URLSearchParams("escala=abc"))).toMatchObject({ scale: 1 });
});
