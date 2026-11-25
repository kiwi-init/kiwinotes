// O catálogo e o t() (spec #28171, T28190): as duas línguas com as mesmas chaves e os mesmos parâmetros, o plural,
// o Automático pela língua do macOS e as datas e números pelo Intl.

import { describe, expect, test } from "bun:test";

import { AUTO_FOLLOWS_SYSTEM, appLocale, LANGUAGE_CHOICE, languageChoice, CATALOGS, formatDate, formatDateTime, formatNumber, formatTime, isLanguageSetting, localeFromSystem, LOCALES, placeholders, resolveLocale, type TextKey, translate } from "./index.ts";

describe("catálogo", () => {
  test("todas as línguas têm exatamente as chaves do português", () => {
    const keys = Object.keys(CATALOGS.pt).sort();
    for (const l of LOCALES) expect(Object.keys(CATALOGS[l]).sort()).toEqual(keys);
  });

  test("cada chave pede os mesmos parâmetros e tem a mesma forma (frase ou plural) em todas as línguas", () => {
    for (const key of Object.keys(CATALOGS.pt) as TextKey[]) {
      const base = CATALOGS.pt[key];
      for (const l of LOCALES) {
        const e = CATALOGS[l][key];
        expect({ key, l, plural: typeof e !== "string" }).toEqual({ key, l, plural: typeof base !== "string" });
        expect({ key, l, params: placeholders(e) }).toEqual({ key, l, params: placeholders(base) });
      }
    }
  });

  test("nenhum texto vazio", () => {
    for (const l of LOCALES)
      for (const [key, e] of Object.entries(CATALOGS[l])) {
        const texts = typeof e === "string" ? [e] : [e.one, e.other];
        for (const s of texts) expect({ key, l, empty: !s.trim() }).toEqual({ key, l, empty: false });
      }
  });
});

describe("translate", () => {
  test("a frase na língua", () => {
    expect(translate("pt", "settings.language.label")).toBe("Idioma do app");
    expect(translate("en", "settings.language.label")).toBe("App language");
  });

  test("os parâmetros entram no lugar; um que falta fica como está", () => {
    expect(translate("en", "settings.language.autoNow", { language: "English" })).toBe("From macOS, now in English.");
    expect(translate("pt", "settings.language.autoNow")).toBe("Pelo macOS, agora em {language}.");
  });

  test("o plural pelo n, com o número no costume da língua", () => {
    expect(translate("pt", "common.notes", { n: 1 })).toBe("1 nota");
    expect(translate("pt", "common.notes", { n: 0 })).toBe("0 notas");
    expect(translate("pt", "common.notes", { n: 1234 })).toBe("1.234 notas");
    expect(translate("en", "common.notes", { n: 1 })).toBe("1 note");
    expect(translate("en", "common.notes", { n: 0 })).toBe("0 notes");
    expect(translate("en", "common.notes", { n: 1234 })).toBe("1,234 notes");
  });
});

describe("a língua do app", () => {
  test("Automático segue a primeira língua do macOS", () => {
    expect(localeFromSystem(["pt-BR", "en-US"])).toBe("pt");
    expect(localeFromSystem(["pt-PT"])).toBe("pt");
    expect(localeFromSystem(["pt"])).toBe("pt");
    expect(localeFromSystem(["en-US", "pt-BR"])).toBe("en");
    expect(localeFromSystem(["es-ES"])).toBe("en");
    expect(localeFromSystem(["ptx"])).toBe("en");
    expect(localeFromSystem([])).toBe("pt");
  });

  test("a escolha fixa vale por cima do macOS", () => {
    expect(resolveLocale("en", ["pt-BR"])).toBe("en");
    expect(resolveLocale("pt", ["en-US"])).toBe("pt");
    expect(resolveLocale("auto", ["en-GB"], true)).toBe("en");
  });

  test("a chave do spec #28171: até a última parte, o Automático fica em português (lead, #28346)", () => {
    // A última parte (T28191/T28192/T28297) liga a chave e troca este teste.
    expect(AUTO_FOLLOWS_SYSTEM).toBe(false);
    expect(resolveLocale("auto", ["en-US"])).toBe("pt");
    expect(appLocale("auto", ["en-US"])).toEqual({ setting: "auto", locale: "pt", system: "en" });
    // O English, à mão, já vale.
    expect(appLocale("en", ["pt-BR"])).toEqual({ setting: "en", locale: "en", system: "pt" });
    expect(appLocale("auto", ["en-US"], true)).toEqual({ setting: "auto", locale: "en", system: "en" });
  });

  test("T29319 (harry #29314): sem a escolha, o app fica em português, também com English salvo de um build de antes", () => {
    expect(LANGUAGE_CHOICE).toBe(false);
    for (const setting of ["en", "pt", "auto"] as const) {
      expect(resolveLocale(setting, ["en-US"], true, false)).toBe("pt");
      expect(appLocale(setting, ["en-US"], true, false)).toEqual({ setting, locale: "pt", system: "en" });
    }
    // O `bun test` liga a escolha pelo ambiente (o preload), para os testes do inglês.
    expect(languageChoice()).toBe(process.env.KIWI_LANGUAGE_CHOICE === "1");
  });

  test("só auto, pt e en são escolhas válidas", () => {
    expect(["auto", "pt", "en"].every(isLanguageSetting)).toBe(true);
    expect(["es", "", null, 1].some(isLanguageSetting)).toBe(false);
  });
});

describe("datas e números pelo Intl", () => {
  const now = new Date(2030, 10, 25, 9, 0);
  const d = new Date(2030, 10, 5, 14, 5);

  test("números", () => {
    expect(formatNumber("pt", 1234.5)).toBe("1.234,5");
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
  });

  test("data curta, com o ano só se for de outro ano", () => {
    expect(formatDate("pt", d, now)).toBe("5 de nov.");
    expect(formatDate("en", d, now)).toBe("Nov 5");
    expect(formatDate("pt", new Date(2029, 0, 2), now)).toBe("2 de jan. de 2029");
    expect(formatDate("en", new Date(2029, 0, 2), now)).toBe("Jan 2, 2029");
  });

  test("hora no costume da língua", () => {
    expect(formatTime("pt", d)).toBe("14:05");
    expect(formatTime("en", d).replace(/\s/g, " ")).toBe("2:05 PM");
  });

  test("data e hora juntas", () => {
    expect(formatDateTime("pt", d, now)).toContain("14:05");
    expect(formatDateTime("en", d, now).replace(/\s/g, " ")).toContain("2:05 PM");
  });
});
