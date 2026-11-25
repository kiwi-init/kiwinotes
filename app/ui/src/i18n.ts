// O idioma das janelas (spec #28171, T28190): o `t("chave")` das telas, na língua que o engine diz (`app.locale`), e a
// troca na hora quando ela muda (`app.localeChanged`), em todas as janelas, sem reiniciar.
//
// Como a Aparência: uma cópia local pinta a primeira tela já na língua certa; o `mount()` espera o engine (até um
// limite) e troca se a resposta for outra. Um engine sem o `app.locale` (anterior ao 1.104.0) deixa em português.

import { useSyncExternalStore } from "react";

import { type AppLocale, formatDate, formatDateTime, formatNumber, formatTime, type Locale, LOCALES, type Params, type TextKey, translate } from "../../src/shared/i18n/index.ts";

const CACHE_KEY = "kiwi.locale";

let current: AppLocale = { setting: "auto", locale: "pt", system: "pt" };
const listeners = new Set<() => void>();

function cached(): Locale | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : null;
  } catch {
    return null;
  }
}

/** Troca a língua desta janela: o `lang` do documento, a cópia local e cada tela que usa o `useT()`. */
export function setAppLocale(next: AppLocale): void {
  const same = next.locale === current.locale && next.setting === current.setting && next.system === current.system;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next.locale === "en" ? "en" : "pt-BR";
  try {
    localStorage.setItem(CACHE_KEY, next.locale);
  } catch {
    // Sem localStorage (o teste): só a memória.
  }
  if (!same) for (const fn of listeners) fn();
}

let started: Promise<void> | null = null;

/** Lê a língua do engine e escuta a troca. Chamado uma vez pelo `mount()`. */
export function startLocale(): Promise<void> {
  if (started) return started;
  if (typeof window === "undefined") return Promise.resolve();
  const local = cached();
  if (local) setAppLocale({ ...current, locale: local });
  const engine = window.engine;
  if (!engine?.has("app.locale")) return (started = Promise.resolve());
  engine.on("app.localeChanged", (payload) => setAppLocale(payload as AppLocale));
  started = engine.invoke("app.locale", {}).then(
    (l) => setAppLocale(l as AppLocale),
    () => {},
  );
  return started;
}

/** A língua de agora (fora do React: um texto montado por código). */
export const appLocale = (): AppLocale => current;

/** O texto na língua de agora. Numa tela, prefira o `useT()`, que redesenha quando a língua muda. */
export const t = (key: TextKey, params?: Params): string => translate(current.locale, key, params);

/**
 * Os textos de uma lista feita uma vez só, no carregamento (os menus do editor, T29842): cada campo em `keys` vira um
 * getter que lê a língua de agora. O mesmo objeto sai em português ou em inglês, conforme a língua de quando é lido.
 * Uma função no lugar da chave monta o texto (um parâmetro).
 */
export function localized<const T extends object, K extends string>(base: T, keys: { readonly [P in K]: TextKey | (() => string) }): T & { readonly [P in K]: string } {
  for (const [field, key] of Object.entries(keys) as [string, TextKey | (() => string)][]) {
    Object.defineProperty(base, field, { enumerable: true, configurable: true, get: typeof key === "function" ? key : () => t(key) });
  }
  return base as T & { readonly [P in K]: string };
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const snapshot = () => current;

/** A língua de agora, e a tela redesenha quando ela muda. */
export function useAppLocale(): AppLocale {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** O `t()` da tela: redesenha quando a língua muda. Traz também as datas e os números na língua. */
export function useT() {
  const { locale } = useAppLocale();
  return {
    locale,
    t: (key: TextKey, params?: Params) => translate(locale, key, params),
    number: (n: number, opts?: Intl.NumberFormatOptions) => formatNumber(locale, n, opts),
    date: (d: Date, now?: Date) => formatDate(locale, d, now),
    time: (d: Date) => formatTime(locale, d),
    dateTime: (d: Date, now?: Date) => formatDateTime(locale, d, now),
  };
}
