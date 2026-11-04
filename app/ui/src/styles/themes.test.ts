import { describe, expect, test } from "bun:test";

import { DEFAULT_APPEARANCE, isThemeId } from "../../../src/shared/appearance.ts";
import { fromSettings, textOn, themeVars } from "./appearance.ts";
import { FALLBACK_THEME, THEME_TOKENS, THEMES, themeFor } from "./themes.ts";

const COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3} \d{1,3} \d{1,3} \/ (0|1|0?\.\d+)\))$/;

describe("os temas do Channels (T2503)", () => {
  test("os 44, 29 escuros e 15 claros, com ids únicos que o engine aceita", () => {
    expect(THEMES).toHaveLength(44);
    expect(THEMES.filter((t) => t.appearance === "dark")).toHaveLength(29);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(44);
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true);
    // Os três da casa primeiro, como no Channels.
    expect(THEMES.slice(0, 3).map((t) => t.name)).toEqual(["OLED Black", "Channels Dark", "Channels Light"]);
  });

  test("cada tema tem os 33 tokens, todos cor de verdade", () => {
    for (const t of THEMES) {
      expect(Object.keys(t.colors).sort()).toEqual([...THEME_TOKENS].sort());
      for (const k of THEME_TOKENS) expect(t.colors[k].toLowerCase()).toMatch(COLOR);
    }
  });

  test("os padrões da Aparência existem, e cada um é do seu lado", () => {
    expect(themeFor(DEFAULT_APPEARANCE.darkTheme, "dark").name).toBe("OLED Black");
    expect(themeFor(DEFAULT_APPEARANCE.lightTheme, "light").name).toBe("Channels Light");
  });

  test("um id que sumiu, ou do outro lado, cai no padrão do lado", () => {
    expect(themeFor("nao-existe", "dark")).toBe(FALLBACK_THEME.dark);
    expect(themeFor("channels-light", "dark")).toBe(FALLBACK_THEME.dark);
    expect(themeFor("abyssal-trench", "dark").name).toBe("Abyssal Trench");
  });
});

describe("os tokens que a janela recebe", () => {
  test("os do Channels com o nome dele, e os do Kiwi derivados", () => {
    const t = themeFor("abyssal-trench", "dark");
    const v = themeVars(t);
    for (const k of THEME_TOKENS) expect(v[`--${k}`]).toBe(t.colors[k]);
    expect(v["--surface"]).toBe(t.colors.bg);
    expect(v["--text"]).toBe(t.colors.ink);
    expect(v["--text-3"]).toBe(t.colors["ink-3"]);
    expect(v["--border"]).toBe(t.colors.line);
    expect(v["--danger"]).toBe(t.colors.alert);
    expect(v["--float"]).toBe(t.colors["bg-3"]);
    expect(themeVars(FALLBACK_THEME.light)["--float"]).toBe(FALLBACK_THEME.light.colors.bg);
  });

  test("o texto em cima do accent contrasta (preto no accent claro, branco no escuro)", () => {
    expect(textOn("#8ab4ff")).toBe("#000000");
    expect(textOn("#1a56db")).toBe("#ffffff");
    for (const t of THEMES) {
      const on = themeVars(t)["--on-accent"];
      expect(on === "#000000" || on === "#ffffff").toBe(true);
    }
  });

  test("um engine de antes do 1.7.0 (sem appearance) fica no padrão", () => {
    expect(fromSettings({ notesShortcut: null })).toEqual(DEFAULT_APPEARANCE);
    expect(fromSettings(null)).toEqual(DEFAULT_APPEARANCE);
  });
});
