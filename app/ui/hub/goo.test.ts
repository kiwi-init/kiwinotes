// A gota da barra do Hub (spec #17725, T18646): as fases de cada lado e as medidas. O movimento em si é conferido no
// WebKit (T18648); aqui, as regras que dá para conferir sem DOM e o contrato do CSS com a camada.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { type GooBox, type GooPhase, gooOnAnimationEnd, gooOnButtons, gooRect, gooVars } from "./goo.ts";

describe("as fases", () => {
  test("a primeira medida não anima: com botões já está na barra, sem botões não há gota", () => {
    expect(gooOnButtons("hidden", true, true)).toBe("shown");
    expect(gooOnButtons("hidden", false, true)).toBe("hidden");
  });

  test("entrar em Notas brota a gota, e o fim dela vira os botões", () => {
    const p = gooOnButtons("hidden", true);
    expect(p).toBe("entering");
    expect(gooOnAnimationEnd(p)).toBe("shown");
  });

  test("ir para uma seção sem botões pinga de volta, e o fim some na pílula", () => {
    const p = gooOnButtons("shown", false);
    expect(p).toBe("leaving");
    expect(gooOnAnimationEnd(p)).toBe("hidden");
  });

  test("trocar no meio vira para o outro lado, sem pular nem prender", () => {
    expect(gooOnButtons("entering", false)).toBe("leaving");
    expect(gooOnButtons("leaving", true)).toBe("entering");
  });

  test("o que não muda o lado não reinicia a animação", () => {
    const same: [GooPhase, boolean][] = [["shown", true], ["entering", true], ["hidden", false], ["leaving", false]];
    for (const [p, has] of same) expect(gooOnButtons(p, has)).toBe(p);
    expect(gooOnAnimationEnd("shown")).toBe("shown");
    expect(gooOnAnimationEnd("hidden")).toBe("hidden");
  });
});

describe("as medidas", () => {
  const box = (offsetLeft: number, offsetTop: number, offsetWidth: number, offsetHeight: number, offsetParent: unknown) =>
    ({ offsetLeft, offsetTop, offsetWidth, offsetHeight, offsetParent }) as unknown as GooBox;
  const bar = box(0, 0, 900, 52, null) as unknown as Element;

  test("o retângulo é relativo à barra, somando os pais, em px inteiros, e nada na tela dá null", () => {
    const slot = box(600, 0, 280, 52, bar);
    expect(gooRect(box(140.4, 10.6, 80.2, 32, slot), bar)).toEqual({ x: 740, y: 11, w: 80, h: 32 });
    expect(gooRect(box(10, 10, 0, 32, bar), bar)).toBeNull();
    // Fora da barra (ela não é um dos pais): sem medida, em vez de uma medida errada.
    expect(gooRect(box(10, 10, 40, 32, null), bar)).toBeNull();
  });

  test("as variáveis levam o nome do lado", () => {
    expect(gooVars("end", { x: 1, y: 2, w: 3, h: 4 })).toEqual({ "--goo-end-x": "1px", "--goo-end-y": "2px", "--goo-end-w": "3px", "--goo-end-h": "4px" });
  });
});

describe("o CSS", () => {
  const css = readFileSync(new URL("./goo.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  test("a gota tem a cor da barra, nunca uma cor fixa", () => {
    const body = css.match(/\.kn-goo-base,\s*\.kn-goo-drop \{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("background: var(--float)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  test("cada fase que anda tem a sua animação, e reduzir movimento tira a gota", () => {
    for (const k of ["kn-goo-in-start", "kn-goo-in-end", "kn-goo-out-start", "kn-goo-out-end"]) expect(css).toContain(`@keyframes ${k}`);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kn-goo \{\s*display: none;/);
    expect(css).toMatch(/:root\[data-motion="reduced"\] \.kn-goo \{\s*display: none;/);
  });
});
