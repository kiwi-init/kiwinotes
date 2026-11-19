import { afterEach, describe, expect, test } from "bun:test";

import { anchorScroll, clampZoom, forgetZooms, pinchFactor, recallZoom, rememberZoom, stepZoom, zoomCommand } from "./zoom.ts";

const key = (key: string, code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = { metaKey: true }) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("zoom", () => {
  afterEach(forgetZooms);

  test("clampZoom fica nos limites e troca o que não é número por 100%", () => {
    expect(clampZoom(5, 0.5, 3)).toBe(3);
    expect(clampZoom(0.1, 0.5, 3)).toBe(0.5);
    expect(clampZoom(1.3, 0.5, 3)).toBe(1.3);
    expect(clampZoom(Number.NaN, 0.5, 3)).toBe(1);
  });

  test("pinchFactor: abrir e fechar o mesmo tanto volta ao zoom de antes", () => {
    expect(pinchFactor(-50)).toBeGreaterThan(1);
    expect(pinchFactor(50)).toBeLessThan(1);
    expect(pinchFactor(-37) * pinchFactor(37)).toBeCloseTo(1, 12);
    expect(pinchFactor(-100 * Math.log(2))).toBeCloseTo(2, 12);
  });

  test("stepZoom anda pelos degraus, dentro dos limites", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.17, 1)).toBe(1.25);
    expect(stepZoom(1.17, -1)).toBe(1.1);
    expect(stepZoom(3, 1, 0.5, 3)).toBe(3);
    expect(stepZoom(0.5, -1, 0.5, 3)).toBe(0.5);
    // Um ajuste à janela fora dos degraus (a imagem em 0,37) vai ao degrau seguinte.
    expect(stepZoom(0.37, 1, 0.1, 8)).toBe(0.5);
  });

  test("zoomCommand: ⌘+, ⌘−, ⌘0, pela tecla ou pelo lugar dela", () => {
    expect(zoomCommand(key("=", "Equal"))).toBe("in");
    expect(zoomCommand(key("+", "Equal", { metaKey: true }))).toBe("in");
    expect(zoomCommand(key("+", "NumpadAdd"))).toBe("in");
    expect(zoomCommand(key("´", "Equal"))).toBe("in");
    expect(zoomCommand(key("-", "Minus"))).toBe("out");
    expect(zoomCommand(key("_", "Minus"))).toBe("out");
    expect(zoomCommand(key("0", "Digit0"))).toBe("reset");
    expect(zoomCommand(key("=", "Equal", {}))).toBeNull();
    expect(zoomCommand(key("=", "Equal", { metaKey: true, altKey: true }))).toBeNull();
    expect(zoomCommand(key("0", "Digit0", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(zoomCommand(key("f", "KeyF"))).toBeNull();
  });

  test("anchorScroll deixa parado o ponto embaixo dos dedos", () => {
    // O ponto 300,200 da área, com a rolagem em 100,50: o conteúdo em 400,250 vai a 800,500 no 2×.
    const s = anchorScroll({ left: 100, top: 50 }, { x: 300, y: 200 }, 1, 2);
    expect(s).toEqual({ left: 500, top: 300 });
    expect(s.left + 300).toBe(400 * 2);
    // Ir e voltar dá a rolagem de antes.
    expect(anchorScroll(s, { x: 300, y: 200 }, 2, 1)).toEqual({ left: 100, top: 50 });
    // A margem que não cresce.
    expect(anchorScroll({ left: 0, top: 0 }, { x: 124, y: 24 }, 1, 2, { x: 24, y: 24 })).toEqual({ left: 100, top: 0 });
    // Nunca negativa.
    expect(anchorScroll({ left: 0, top: 0 }, { x: 10, y: 10 }, 2, 1)).toEqual({ left: 0, top: 0 });
  });

  test("o zoom fica guardado por arquivo, e null volta ao padrão", () => {
    expect(recallZoom("Docs/a.pdf")).toBeNull();
    rememberZoom("Docs/a.pdf", 1.5);
    rememberZoom("Docs/b.pdf", 2);
    expect(recallZoom("Docs/a.pdf")).toBe(1.5);
    expect(recallZoom("Docs/b.pdf")).toBe(2);
    rememberZoom("Docs/a.pdf", null);
    expect(recallZoom("Docs/a.pdf")).toBeNull();
  });
});
