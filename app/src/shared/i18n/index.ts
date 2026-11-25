// O app em outras línguas (spec #28171, T28190): os textos visíveis saem de um catálogo por língua, pela chave.
// O português é a fonte (`pt.ts`); o inglês (`en.ts`) tem as mesmas chaves, e o `tsc` quebra se faltar ou sobrar uma.
// Uma língua nova é mais um arquivo aqui e mais um valor em `LOCALES`.
//
// Sem biblioteca: `translate(locale, chave, parâmetros)`, com `{nome}` trocado pelo parâmetro e o plural pelo
// `Intl.PluralRules` quando o texto tem `one`/`other` e o parâmetro `n`. Datas e números pelo `Intl` na língua.

import { en } from "./en.ts";
import { pt } from "./pt.ts";

export const LOCALES = ["pt", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** O que a pessoa escolhe em Ajustes › Geral: Automático (a língua do macOS) ou uma língua fixa. */
export type LanguageSetting = "auto" | Locale;
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", ...LOCALES];
export const isLanguageSetting = (v: unknown): v is LanguageSetting => (LANGUAGE_SETTINGS as readonly unknown[]).includes(v);
export const DEFAULT_LANGUAGE: LanguageSetting = "auto";

/** Um texto do catálogo: uma frase, ou as formas do plural (escolhidas pelo parâmetro `n`). */
export type Plural = { one: string; other: string };
export type Entry = string | Plural;
export type TextKey = keyof typeof pt;
export type Catalog = { readonly [K in TextKey]: Entry };
export type Params = Record<string, string | number>;

export const CATALOGS: Record<Locale, Catalog> = { pt, en };

/** A etiqueta do `Intl` de cada língua. */
export const INTL_TAG: Record<Locale, string> = { pt: "pt-BR", en: "en-US" };

/**
 * A língua do Automático, pela primeira língua do macOS: português (qualquer variante) é português, qualquer outra é
 * inglês. Sem a língua do sistema (headless, erro na leitura), português, como o app era antes.
 */
export function localeFromSystem(languages: readonly string[]): Locale {
  const first = languages.find((l) => typeof l === "string" && l.trim());
  if (!first) return "pt";
  return /^pt(?:[-_]|$)/i.test(first.trim()) ? "pt" : "en";
}

/**
 * A chave do spec #28171 (lead, #28346): enquanto as telas não estão todas no catálogo (T28191, T28192, T28297), o
 * Automático fica em português, para um Mac em inglês não ver o app misturado. O English se escolhe à mão. A última
 * parte do spec vira esta chave para `true` e troca o teste que a marca (`i18n.test.ts`).
 */
export const AUTO_FOLLOWS_SYSTEM = false;

/**
 * O harry (#29311, #29314): o app em inglês não entra na v2026.11.14 (T29319). Com esta chave desligada, os Ajustes não
 * mostram o Idioma do app, e o app fica em português qualquer que seja a escolha salva: quem escolheu English num
 * build de antes volta ao português, e não fica num app misturado sem o menu para voltar. A última parte do spec
 * #28171 liga esta chave junto com a `AUTO_FOLLOWS_SYSTEM`.
 *
 * `KIWI_LANGUAGE_CHOICE=1` no ambiente liga a escolha só no main e no headless, nunca no app de release: o `bun test`
 * (o preload põe) e os prints em inglês das partes do spec, pelo `settings.set`.
 */
export const LANGUAGE_CHOICE = false;

/** A escolha da língua vale agora: a chave, ou o `KIWI_LANGUAGE_CHOICE=1` do main e do headless. */
export function languageChoice(): boolean {
  return LANGUAGE_CHOICE || (typeof process !== "undefined" && process.env?.KIWI_LANGUAGE_CHOICE === "1");
}

export function resolveLocale(
  setting: LanguageSetting,
  systemLanguages: readonly string[],
  followSystem = AUTO_FOLLOWS_SYSTEM,
  choice = languageChoice(),
): Locale {
  if (!choice) return "pt";
  if (setting !== "auto") return setting;
  return followSystem ? localeFromSystem(systemLanguages) : "pt";
}

const PLURALS = new Map<Locale, Intl.PluralRules>();
const pluralRules = (l: Locale) => {
  let r = PLURALS.get(l);
  if (!r) PLURALS.set(l, (r = new Intl.PluralRules(INTL_TAG[l])));
  return r;
};

/** Os `{nomes}` de um texto (o teste confere que as duas línguas pedem os mesmos). */
export function placeholders(entry: Entry): string[] {
  const texts = typeof entry === "string" ? [entry] : [entry.one, entry.other];
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort();
}

/** O texto da chave na língua, com os parâmetros. Um número vai formatado na língua (`1.234` / `1,234`). */
export function translate(locale: Locale, key: TextKey, params?: Params): string {
  const entry = CATALOGS[locale][key] ?? CATALOGS.pt[key];
  let text: string;
  if (typeof entry === "string") text = entry;
  else {
    // O zero vai no plural nas duas línguas: o CLDR põe o 0 no "one" do pt-BR ("0 nota"), e o costume é "0 notas".
    const n = typeof params?.n === "number" ? params.n : Number.NaN;
    text = Number.isFinite(n) && n !== 0 && pluralRules(locale).select(n) === "one" ? entry.one : entry.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = params[name];
    if (v === undefined) return all;
    return typeof v === "number" ? formatNumber(locale, v) : v;
  });
}

// ---------------------------------------------------------------- Datas e números

export function formatNumber(locale: Locale, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(INTL_TAG[locale], opts).format(n);
}

/** A data curta (`25 de nov.` / `Nov 25`); com o ano, se for de outro ano que o de `now`. */
export function formatDate(locale: Locale, date: Date, now: Date = new Date()): string {
  const year = date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {};
  return new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short", ...year }).format(date);
}

/** A hora (`14:05` / `2:05 PM`), no costume da língua. */
export function formatTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { hour: "numeric", minute: "2-digit" }).format(date);
}

/** A data e a hora juntas (`25 de nov., 14:05` / `Nov 25, 2:05 PM`). */
export function formatDateTime(locale: Locale, date: Date, now: Date = new Date()): string {
  const year = date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {};
  return new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...year }).format(date);
}

// ---------------------------------------------------------------- A língua do app no engine

/** O que o `app.locale` devolve e o `app.localeChanged` leva (1.104.0). */
export interface AppLocale {
  /** O que está em Ajustes › Geral. */
  setting: LanguageSetting;
  /** A língua em que o app está agora. */
  locale: Locale;
  /** A língua do macOS, a que o Automático segue quando `AUTO_FOLLOWS_SYSTEM` estiver ligado. */
  system: Locale;
}

export function appLocale(
  setting: LanguageSetting,
  systemLanguages: readonly string[],
  followSystem = AUTO_FOLLOWS_SYSTEM,
  choice = languageChoice(),
): AppLocale {
  return { setting, locale: resolveLocale(setting, systemLanguages, followSystem, choice), system: localeFromSystem(systemLanguages) };
}

