// O catálogo e o t() (spec #28171, T28190): as duas línguas com as mesmas chaves e os mesmos parâmetros, o plural,
// o Automático pela língua do macOS e as datas e números pelo Intl.

import { describe, expect, test } from "bun:test";

import { EN_PARTS } from "./en.ts";
import { AUTO_FOLLOWS_SYSTEM, appLocale, LANGUAGE_CHOICE, languageChoice, CATALOGS, formatDate, formatDateTime, formatNumber, formatTime, isLanguageSetting, type Entry, localeFromSystem, LOCALES, placeholders, resolveLocale, type TextKey, translate } from "./index.ts";
import { PT_PARTS } from "./pt.ts";

describe("catálogo", () => {
  // As áreas (`<área>.pt.ts`) entram no `pt.ts` pelo espalhar: uma chave em duas some calada, a última ganha (#29295).
  test("cada chave está numa parte só, e o catálogo é a soma de todas as partes, nas duas línguas", () => {
    for (const [parts, catalog] of [[PT_PARTS, CATALOGS.pt], [EN_PARTS, CATALOGS.en]] as const) {
      const where = new Map<string, string>();
      for (const [part, entries] of Object.entries(parts)) {
        for (const key of Object.keys(entries)) {
          expect({ key, alsoIn: where.get(key) ?? null }).toEqual({ key, alsoIn: null });
          where.set(key, part);
        }
      }
      expect([...where.keys()].sort()).toEqual(Object.keys(catalog).sort());
    }
    expect(Object.keys(EN_PARTS).sort()).toEqual(Object.keys(PT_PARTS).sort());
    for (const part of Object.keys(PT_PARTS) as (keyof typeof PT_PARTS)[]) {
      expect({ part, keys: Object.keys(EN_PARTS[part]).sort() }).toEqual({ part, keys: Object.keys(PT_PARTS[part]).sort() });
    }
  });

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

  // Uma tradução esquecida (o português copiado no `en`) passava em tudo: o `agent-english-check` pula, de propósito, o
  // texto igual nas duas línguas (T30218, revisão #30216). Aqui o igual só passa se estiver nesta lista, com o motivo.
  // Chave nova que fica igual de propósito entra aqui; uma que deixou de ser igual sai.
  const SAME_ON_PURPOSE: Record<string, string> = {
    "language.pt": "o nome da língua nela mesma",
    "language.en": "o nome da língua nela mesma",
    "app.name": "nome próprio",
    "about.window.hub": "nome próprio (o app)",
    "hub.cat.name": "nome próprio (o gato)",
    "shortcuts.group.Kiwi Cat": "nome próprio (o gato)",
    "agent.cat.color.soul-claro": "nome da cor, igual nas duas",
    "notes.draft.when": "só o parâmetro",
    "editor.attach.refused": "só os parâmetros",
    "agent.usage.sub.part": "só os parâmetros e o %",
    "agent.adapter.mb": "unidade",
    "meetings.duration.minutes": "unidade",
    "home.minutes": "unidade",
    "files.image.size": "só os parâmetros e a unidade (px)",
    "agent.usage.tokens": "palavra igual nas duas",
    "agent.placar.tokens": "palavra igual nas duas",
    "agent.placar.col.tokens": "palavra igual nas duas",
    "notes.export.pdf": "nome do formato",
    "notes.prop.link": "palavra igual nas duas",
    "editor.fmt.link": "palavra igual nas duas",
    "proposal.refs.links": "palavra igual nas duas",
    "notes.side.tags": "palavra igual nas duas",
    "snippets.section": "palavra igual nas duas",
    "agent.onboarding": "palavra igual nas duas",
    "onb.tone.formal": "palavra igual nas duas",
    "editor.menu.callout": "o nome do bloco do Obsidian",
    "editor.slash.callout": "o nome do bloco do Obsidian",
    "editor.slash.todo": "palavra igual nas duas",
    "editor.callout.info": "o nome do tipo do Obsidian",
    "editor.callout.bug": "o nome do tipo do Obsidian",
  };

  test("o inglês igual ao português só passa na lista de propósito (T30218)", () => {
    // No plural, forma por forma: o `other` esquecido com o `one` traduzido também conta (revisão #30448).
    const forms = (e: Entry) => (typeof e === "string" ? { text: e } : { ...e });
    const same = (Object.keys(CATALOGS.pt) as TextKey[]).filter((key) => {
      const pt = forms(CATALOGS.pt[key]), en = forms(CATALOGS.en[key]);
      return Object.entries(pt).some(([form, text]) => en[form as keyof typeof en] === text);
    });
    // A tradução esquecida aparece aqui pela chave: traduza no `<área>.en.ts`, ou, se for igual de propósito, ponha na lista.
    expect(same.filter((key) => !(key in SAME_ON_PURPOSE)).sort()).toEqual([]);
    // Uma chave da lista que já não é igual (ou sumiu) sai da lista, para ela não virar um buraco.
    expect(Object.keys(SAME_ON_PURPOSE).filter((key) => !same.includes(key as TextKey)).sort()).toEqual([]);
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
