import { expect, test } from "bun:test";

import { checkAppearancePatch, DEFAULT_APPEARANCE, resolveMode, sanitizeAppearance, TEXT_SCALE, TEXT_SIZES } from "./appearance.ts";

test("o patch do settings.set: só campos conhecidos, cada um válido (T2503)", () => {
  expect(checkAppearancePatch({})).toEqual({ ok: true, patch: {} });
  expect(checkAppearancePatch({ mode: "light", textSize: "larger" })).toEqual({ ok: true, patch: { mode: "light", textSize: "larger" } });
  expect(checkAppearancePatch({ mode: "sepia" }).ok).toBe(false);
  expect(checkAppearancePatch({ lightTheme: "Glacier Mint" }).ok).toBe(false);
  expect(checkAppearancePatch({ other: 1 }).ok).toBe(false);
  expect(checkAppearancePatch(null).ok).toBe(false);
  expect(checkAppearancePatch([]).ok).toBe(false);
});

test("do arquivo: o que não vale volta ao padrão, campo a campo", () => {
  expect(sanitizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  expect(sanitizeAppearance({ mode: "dark", font: 3 })).toEqual({ ...DEFAULT_APPEARANCE, mode: "dark" });
});

test("o modo Sistema segue o Mac; os outros mandam", () => {
  expect(resolveMode("system", true)).toBe("dark");
  expect(resolveMode("system", false)).toBe("light");
  expect(resolveMode("light", true)).toBe("light");
});

test("os tamanhos crescem em ordem, e o Padrão é o tamanho de hoje", () => {
  const scales = TEXT_SIZES.map((s) => TEXT_SCALE[s]);
  expect([...scales].sort((a, b) => a - b)).toEqual(scales);
  expect(TEXT_SCALE.default).toBe(1);
});
