// As abas na janela estreita (#496, T34348): quais bordas esmaecem e quanto a faixa rola para mostrar a aba escolhida.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABS_FADE, tabsClip, tabsFade, tabsScrollToShow } from "./tabs-fit.ts";

describe("tabsClip", () => {
  test("cabe tudo: nada esmaece (e a faixa não rola)", () => {
    expect(tabsClip(0, 500, 500)).toBe("");
    expect(tabsClip(0, 500, 500.6)).toBe("");
  });
  test("no começo, só o fim esconde abas; no fim, só o começo; no meio, os dois", () => {
    expect(tabsClip(0, 300, 500)).toBe("end");
    expect(tabsClip(200, 300, 500)).toBe("start");
    expect(tabsClip(80, 300, 500)).toBe("start end");
  });
});

describe("tabsScrollToShow", () => {
  // Uma faixa de 300 px com 500 de abas.
  const at = (left: number, width: number, scroll: number) => tabsScrollToShow(left, width, scroll, 300, 500);
  test("a aba já à vista, longe do esmaecido, não mexe na faixa", () => {
    expect(at(100, 80, 0)).toBe(0);
    expect(at(150, 80, 100)).toBe(100);
  });
  test("a aba escondida no fim (o \"Configurações\") vem para dentro, fora do esmaecido", () => {
    const s = at(400, 100, 0);
    expect(s).toBe(200);
    expect(400 + 100).toBeLessThanOrEqual(s + 300);
  });
  test("a aba no esmaecido do fim também vem para dentro", () => {
    expect(at(220, 70, 0)).toBe(220 + 70 + TABS_FADE - 300);
  });
  test("a aba escondida no começo volta, com o esmaecido de folga, sem passar do começo", () => {
    expect(at(120, 80, 200)).toBe(120 - TABS_FADE);
    expect(at(0, 80, 200)).toBe(0);
  });
});

describe("tabsFade", () => {
  test("com folga, os 24 px", () => {
    expect(tabsFade(260, 80)).toBe(TABS_FADE);
  });
  test("faixa curta (o Ditado a 480 px, #34567): encolhe para a aba caber inteira entre as duas bordas", () => {
    const fade = tabsFade(102, 80);
    expect(fade).toBe(11);
    expect(80 + 2 * fade).toBeLessThanOrEqual(102);
  });
  test("a aba maior que a faixa: sem esmaecido", () => {
    expect(tabsFade(60, 80)).toBe(0);
  });
  test("com o esmaecido menor, a aba no fim vem inteira para dentro", () => {
    // Faixa de 102 px, aba de 80 px em x 300: termina a 11 px da borda.
    expect(tabsScrollToShow(300, 80, 0, 102, 500, tabsFade(102, 80))).toBe(300 + 80 + 11 - 102);
  });
});

test("o hub.css esmaece pelo --tabs-fade, com os px do TABS_FADE como padrão", () => {
  const css = readFileSync(join(import.meta.dir, "hub.css"), "utf8");
  const fades = [...css.matchAll(/\.kn-tabs-track\[data-clip="[^"]+"\] \{\s*mask-image: ([^;]+);/g)].map((m) => m[1]!);
  expect(fades).toHaveLength(3);
  for (const f of fades) expect(f).toContain(`var(--tabs-fade, ${TABS_FADE}px)`);
});
