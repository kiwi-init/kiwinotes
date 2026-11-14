// A cor da névoa (spec #9349): toda cor da lista aparece no fundo preto e no branco.
import { describe, expect, test } from "bun:test";

import {
  AGENT_CAT_COLORS,
  CAT_COLOR_PRESETS,
  catColorHex,
  catColorOptions,
  contrastRatio,
  isCatColorChoice,
} from "./kiwicat-colors.ts";

describe("as cores da névoa do Kiwi-cat", () => {
  const all = [...Object.values(AGENT_CAT_COLORS), ...CAT_COLOR_PRESETS.map((c) => c.hex)];

  test.each(all)("%s tem contraste de pelo menos 2:1 contra o branco e contra o preto", (hex) => {
    expect(contrastRatio(hex, "#ffffff")).toBeGreaterThanOrEqual(2);
    expect(contrastRatio(hex, "#000000")).toBeGreaterThanOrEqual(2);
  });

  test("a conta do contraste é a do WCAG", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    // O laranja do Claude Code dá cerca de 2,1:1 no branco (o número do spec).
    expect(contrastRatio(AGENT_CAT_COLORS.claude, "#ffffff")).toBeCloseTo(2.08, 2);
    // Branco e cores muito claras ou muito escuras não passariam.
    expect(contrastRatio("#faf9ff", "#ffffff")).toBeLessThan(2);
    expect(contrastRatio("#1a1a2e", "#000000")).toBeLessThan(2);
  });

  test("as amostras: a do agente primeiro e marcada por padrão, mais 6 a 8 prontas, sem repetir", () => {
    const options = catColorOptions();
    expect(options[0]).toEqual({ id: "agente", label: "A do agente", hex: "#ff9b5e" });
    expect(CAT_COLOR_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(CAT_COLOR_PRESETS.length).toBeLessThanOrEqual(8);
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    expect(new Set(options.map((o) => o.hex.toLowerCase())).size).toBe(options.length);
    for (const o of options) expect(o.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("a escolha guardada vira a cor do desenho; o que não é da lista cai na do agente", () => {
    expect(catColorHex("agente")).toBe(AGENT_CAT_COLORS.claude);
    expect(catColorHex("azul")).toBe("#6ea8ff");
    expect(catColorHex(undefined)).toBe(AGENT_CAT_COLORS.claude);
    expect(isCatColorChoice("verde")).toBe(true);
    for (const bad of ["#ffffff", "branco", "", null, 3, "padrao"]) expect(isCatColorChoice(bad)).toBe(false);
  });
});
