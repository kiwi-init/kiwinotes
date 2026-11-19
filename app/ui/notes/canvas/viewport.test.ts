import { describe, expect, test } from "bun:test";

import { fit, MAX_ZOOM, MIN_ZOOM, pan, reveal, toWorld, wheelFactor, zoomAt } from "./viewport.ts";

describe("a vista do quadro (T6600)", () => {
  test("o ponto do mundo sob a tela, com zoom e deslocamento", () => {
    expect(toWorld({ tx: 100, ty: 50, zoom: 2 }, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
  });

  test("o zoom deixa parado o ponto do mouse, e fica entre o mínimo e o máximo", () => {
    const v = { tx: 0, ty: 0, zoom: 1 };
    const z = zoomAt(v, { x: 200, y: 100 }, 2);
    expect(z.zoom).toBe(2);
    expect(toWorld(z, { x: 200, y: 100 })).toEqual(toWorld(v, { x: 200, y: 100 }));
    expect(zoomAt(v, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  test("andar com o quadro", () => {
    expect(pan({ tx: 10, ty: 20, zoom: 1.5 }, 5, -5)).toEqual({ tx: 15, ty: 15, zoom: 1.5 });
  });

  test("enquadrar: tudo à vista, centrado, sem passar de 100%", () => {
    const v = fit({ x: 0, y: 0, width: 1000, height: 500 }, 600, 400, 50);
    expect(v.zoom).toBe(0.5);
    // O meio do conteúdo (500, 250) cai no meio do quadro (300, 200).
    expect(v.tx + 500 * v.zoom).toBe(300);
    expect(v.ty + 250 * v.zoom).toBe(200);
    expect(fit({ x: 0, y: 0, width: 10, height: 10 }, 600, 400).zoom).toBe(1);
    expect(fit(null, 600, 400)).toEqual({ zoom: 1, tx: 300, ty: 200 });
  });

  test("a rolagem com ⌘ e a pinça: para cima aproxima, e um salto enorme não explode", () => {
    expect(wheelFactor(-10, false)).toBeGreaterThan(1);
    expect(wheelFactor(10, true)).toBeLessThan(1);
    expect(wheelFactor(1e9, true)).toBeCloseTo(Math.exp(-1), 6);
  });
});

describe("o achado do ⌘F no meio da tela (T22217)", () => {
  const card = { x: 1000, y: 2000, width: 200, height: 100 };
  const middle = (v: { tx: number; ty: number; zoom: number }) => ({ x: (400 - v.tx) / v.zoom, y: (300 - v.ty) / v.zoom });

  test("mantém o zoom de quem já está perto, e põe o cartão no meio", () => {
    const v = reveal({ tx: 0, ty: 0, zoom: 1.5 }, card, 800, 600);
    expect(v.zoom).toBe(1.5);
    expect(middle(v)).toEqual({ x: 1100, y: 2050 });
  });

  test("de muito longe, chega perto o bastante para ler", () => {
    expect(reveal({ tx: 0, ty: 0, zoom: 0.1 }, card, 800, 600).zoom).toBe(0.6);
  });

  test("um grupo maior que a tela cabe inteiro", () => {
    const v = reveal({ tx: 0, ty: 0, zoom: 1 }, { x: 0, y: 0, width: 4000, height: 1000 }, 800, 600);
    expect(v.zoom).toBeCloseTo(640 / 4000);
    expect(middle(v).x).toBeCloseTo(2000);
  });
});
