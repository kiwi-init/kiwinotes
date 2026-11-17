import { expect, test } from "bun:test";

import { overlayPlacement } from "./placement.ts";

test("a página lê a escala, o lado e o balão da URL do helper (spec #12949)", () => {
  expect(overlayPlacement(new URLSearchParams(""))).toMatchObject({ scale: 1, catW: 192, catH: 240, winH: 352, lado: "center", balao: "acima" });
  expect(overlayPlacement(new URLSearchParams("escala=1.60&lado=left&balao=abaixo"))).toMatchObject({ scale: 1.6, catW: 307, catH: 384, winH: 496, lado: "left", balao: "abaixo" });
  expect(overlayPlacement(new URLSearchParams("escala=0.60&lado=right&balao=acima"))).toMatchObject({ catW: 115, catH: 144, winH: 256, lado: "right" });
  expect(overlayPlacement(new URLSearchParams("escala=9&lado=x&balao=y"))).toMatchObject({ scale: 1.6, lado: "center", balao: "acima" });
  expect(overlayPlacement(new URLSearchParams("escala=abc"))).toMatchObject({ scale: 1 });
});

// T16754 (harry #16786): o balão ao lado do gato, com o rabo na quina mais perto dele e a ponta no corpo. As larguras
// são as do Swift (`testTheBubbleCornerTouchesTheCatBody`): a janela e a página têm de bater.
test("o balão fica do lado do gato, com a ponta do rabo no corpo dele (T16754)", () => {
  const center = overlayPlacement(new URLSearchParams(""));
  expect(center).toMatchObject({ winW: 192 + 239, catX: 239, tail: "bottom-right" });
  // A ponta: 7,5 px antes da quina direita da casca, na borda esquerda do corpo (28 % do quadro).
  expect(center.winW - center.bubble.right! - 7.5).toBeCloseTo(center.catX + 192 * 0.28, 0);
  // Em cima: a ponta 17,5 px abaixo do pé da casca, no alto do corpo (44 % do quadro, que encosta embaixo).
  expect(center.winH - center.bubble.bottom! + 17.5).toBeCloseTo(center.winH - 240 + 240 * 0.44, 0);

  const topLeft = overlayPlacement(new URLSearchParams("escala=1.60&lado=left&balao=abaixo"));
  expect(topLeft).toMatchObject({ winW: 307 + 213, catX: 0, tail: "top-left" });
  expect(topLeft.bubble.left! + 7.5).toBeCloseTo(307 * 0.74, 0);
  expect(topLeft.bubble.top! - 17.5).toBeCloseTo(384 * 0.77, 0);

  expect(overlayPlacement(new URLSearchParams("escala=0.60&lado=right&balao=acima"))).toMatchObject({ winW: 115 + 261, catX: 261, tail: "bottom-right" });
  expect(overlayPlacement(new URLSearchParams("lado=right&balao=abaixo")).tail).toBe("top-right");
  expect(overlayPlacement(new URLSearchParams("lado=left")).tail).toBe("bottom-left");
});
