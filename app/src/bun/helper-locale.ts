// O helper na língua do app (spec #28171, T28192): o `app.locale` ao conectar e a cada troca. Fora do `Session`, que é
// pesado de montar, para o `bun test` provar a ligação com um sidecar falso.

import type { Locale } from "../shared/i18n/index.ts";
import type { Command } from "../shared/ipc.ts";

/** O `send` do sidecar, só o que estas funções usam. */
export type HelperSend = (command: Command) => Promise<{ ok: boolean; error?: string }>;

/** Quem diz a língua do main e avisa a troca (o `mainLocale`). */
export interface LocaleSource {
  get(): Locale;
  onChange(fn: (locale: Locale) => void): () => void;
}

/**
 * Manda a língua ao helper. Nunca rejeita: um helper de antes do T28192 responde `unknown_type` e fica em português, e
 * um helper que caiu no meio só deixa a linha no log. O resto do `syncAll` segue.
 */
export async function sendLocale(send: HelperSend, locale: Locale): Promise<void> {
  const r = await send({ type: "app.locale", locale }).catch(() => undefined);
  if (r && !r.ok) console.warn(`[session] app.locale: ${r.error}`);
}

/** A cada troca da língua do main, o helper recebe a nova. Devolve o desligar. */
export function followLocale(source: LocaleSource, send: HelperSend): () => void {
  return source.onChange((locale) => void sendLocale(send, locale));
}

/** O que o `syncAll` manda ao helper a cada conexão: o dicionário, as Configurações e a língua, juntos. */
export interface HelperSync {
  dictionary(): Promise<void>;
  settings(): Promise<void>;
  locale(): Promise<void>;
}

export function syncHelper(sync: HelperSync): Promise<void> {
  return Promise.all([sync.dictionary(), sync.settings(), sync.locale()]).then(() => undefined);
}
