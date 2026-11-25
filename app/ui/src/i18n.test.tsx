// O idioma das janelas (T28190): a língua do engine na partida, a troca pelo `app.localeChanged` e a seção
// "Idioma do app" na língua de agora.

import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AppLocale } from "../../src/shared/i18n/index.ts";
import { LanguageSection } from "../settings/LanguageSection.tsx";
import { appLocale, startLocale, t } from "./i18n.ts";

const handlers = new Map<string, (payload: unknown) => void>();
const g = globalThis as unknown as { window?: unknown };
const before = g.window;
g.window = {
  engine: {
    has: (cap: string) => cap === "app.locale" || cap === "settings.set",
    invoke: async (cap: string) => (cap === "app.locale" ? ({ setting: "en", locale: "en", system: "en" } satisfies AppLocale) : {}),
    on: (name: string, fn: (payload: unknown) => void) => void handlers.set(name, fn),
  },
};
afterAll(() => {
  g.window = before;
});

test("a janela sobe na língua do engine e troca na hora com o app.localeChanged", async () => {
  expect(t("settings.language.label")).toBe("Idioma do app");
  await startLocale();
  expect(appLocale()).toEqual({ setting: "en", locale: "en", system: "en" });
  expect(t("settings.language.label")).toBe("App language");
  const en = renderToStaticMarkup(<LanguageSection />);
  expect(en).toContain("App language");
  expect(en).toContain("Automatic");
  // A língua fixa: a dica sem a parte do Automático.
  expect(en).not.toContain("For now");

  // O Automático segue o macOS (T30629, `AUTO_FOLLOWS_SYSTEM`), e a dica diz em que língua está.
  handlers.get("app.localeChanged")!({ setting: "auto", locale: "en", system: "en" } satisfies AppLocale);
  const auto = renderToStaticMarkup(<LanguageSection />);
  expect(auto).toContain("From macOS, now in English.");
  expect(auto).not.toContain("For now");

  handlers.get("app.localeChanged")!({ setting: "pt", locale: "pt", system: "en" } satisfies AppLocale);
  expect(t("settings.topic.general")).toBe("Geral");
  const pt = renderToStaticMarkup(<LanguageSection />);
  expect(pt).toContain("Idioma do app");
  expect(pt).toContain("Automático");
  expect(pt).not.toContain("Por enquanto");
});
