import { describe, expect, test } from "bun:test";

import { WINDOW_SPECS } from "./window-specs.ts";
import { clampToAreas, defaultHubFrame, HUB_CORNER_RADIUS, hubFrame, INTRO_SHADOW_PAD, introWindow, parseHubFrame } from "./intro-layout.ts";

// Uma tela de 1512×982 com a barra de menus de 33 px: a área útil começa em y=33.
const AREA = { x: 0, y: 33, width: 1512, height: 949 };
const HUB = WINDOW_SPECS.hub;
const BOX = WINDOW_SPECS.intro;

describe("onde o hub abre", () => {
  test("sem lugar salvo: 1380×820 no meio da área útil", () => {
    expect(hubFrame(null, AREA, [AREA], HUB)).toEqual({ x: 66, y: 98, width: 1380, height: 820 });
  });

  test("numa tela menor que o hub, ele cabe nela", () => {
    const small = { x: 0, y: 25, width: 1280, height: 775 };
    expect(defaultHubFrame(small, HUB)).toEqual({ x: 0, y: 25, width: 1280, height: 775 });
  });

  test("o lugar salvo, se cabe na tela, fica igual", () => {
    const saved = { x: 200, y: 140, width: 1000, height: 700 };
    expect(hubFrame(saved, AREA, [AREA], HUB)).toEqual(saved);
  });

  test("o lugar salvo num monitor que saiu volta para a tela que sobrou", () => {
    const saved = { x: 1800, y: 100, width: 1000, height: 700 };
    expect(clampToAreas(saved, [AREA])).toEqual({ x: 512, y: 100, width: 1000, height: 700 });
  });

  test("o arquivo salvo: só um retângulo de números, não menor que o mínimo", () => {
    expect(parseHubFrame('{"x":10.4,"y":50,"width":900,"height":600}')).toEqual({ x: 10, y: 50, width: 900, height: 600 });
    expect(parseHubFrame(null)).toBeNull();
    expect(parseHubFrame("não é json")).toBeNull();
    expect(parseHubFrame('{"x":1,"y":2,"width":"900","height":600}')).toBeNull();
    expect(parseHubFrame('{"x":1,"y":2,"width":100,"height":80}')).toBeNull();
  });
});

describe("a janela da intro e o retângulo que a página recebe", () => {
  test("com o hub padrão: a janela cobre o hub com a folga da sombra, e o alvo é o hub nas coordenadas dela", () => {
    const hub = hubFrame(null, AREA, [AREA], HUB);
    const { frame, layout } = introWindow(AREA, BOX, hub);
    expect(frame).toEqual({ x: 66 - INTRO_SHADOW_PAD, y: 98 - INTRO_SHADOW_PAD, width: 1380 + 2 * INTRO_SHADOW_PAD, height: 820 + 2 * INTRO_SHADOW_PAD });
    // O alvo, somado à origem da janela, é o hub na tela, ao pixel.
    expect({ ...layout!.target, x: layout!.target.x + frame.x, y: layout!.target.y + frame.y }).toEqual(hub);
    expect(layout!.radius).toBe(HUB_CORNER_RADIUS);
    // O gato nasce no meio da área útil, como antes, e no tamanho da caixa de antes.
    expect({ x: layout!.center.x + frame.x, y: layout!.center.y + frame.y }).toEqual({ x: 756, y: 33 + 949 / 2 });
    expect(layout!.box).toEqual({ width: BOX.width, height: BOX.height });
  });

  test("com um hub salvo pequeno e no canto: a janela junta a caixa do meio e o hub, e o alvo bate", () => {
    const saved = { x: 20, y: 40, width: 700, height: 480 };
    const { frame, layout } = introWindow(AREA, BOX, hubFrame(saved, AREA, [AREA], HUB));
    // A folga não passa da área útil (nem para cima da barra de menus).
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(33);
    expect(frame.x + frame.width).toBe(396 + 720 + INTRO_SHADOW_PAD);
    expect(frame.y + frame.height).toBe(268 + 480 + INTRO_SHADOW_PAD);
    expect({ ...layout!.target, x: layout!.target.x + frame.x, y: layout!.target.y + frame.y }).toEqual(saved);
    expect({ x: layout!.center.x + frame.x, y: layout!.center.y + frame.y }).toEqual({ x: 756, y: 33 + 949 / 2 });
  });

  test("sem o hub, ou com ele noutro monitor: a caixa de antes, sem alvo", () => {
    const before = { x: 396, y: 268, width: 720, height: 480 };
    expect(introWindow(AREA, BOX, null)).toEqual({ frame: before, layout: null });
    expect(introWindow(AREA, BOX, { x: 1600, y: 100, width: 1000, height: 700 })).toEqual({ frame: before, layout: null });
  });
});
