// A língua do processo principal (spec #28171, T28192): o menu do app, a bandeja, as notificações, os diálogos e as
// mensagens da pílula do ditado saem nela. Ela vem dos Ajustes pela mesma função das telas (`appLocale`, com o
// `AUTO_FOLLOWS_SYSTEM`), ao abrir e a cada `app.localeChanged`; até lá, português, como o app era antes.

import { type Locale, type Params, type TextKey, translate } from "../shared/i18n/index.ts";

type Listener = (locale: Locale) => void;

export class MainLocale {
  private current: Locale = "pt";
  private readonly listeners = new Set<Listener>();

  get(): Locale {
    return this.current;
  }

  /** Troca a língua e avisa quem a usa (o menu, a bandeja, o helper). A mesma língua de novo não avisa. */
  set(locale: Locale): void {
    if (locale === this.current) return;
    this.current = locale;
    for (const fn of this.listeners) fn(locale);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  t(key: TextKey, params?: Params): string {
    return translate(this.current, key, params);
  }
}

/** A do app: uma por processo, como as janelas. */
export const mainLocale = new MainLocale();
