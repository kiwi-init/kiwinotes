// A saudação e a frase da tela de Início (spec #15728, harry #15805): pela hora, e uma frase de uma lista local que
// muda a cada abertura do hub. Nada aqui chama o agente nem a rede.

import type { TextKey } from "../../src/shared/i18n/index.ts";
import { t } from "../src/i18n.ts";

/** As frases, no catálogo (spec #28171): a ordem é a da volta, uma por abertura. */
export const PHRASES: readonly TextKey[] = ["home.phrase.1", "home.phrase.2", "home.phrase.3", "home.phrase.4", "home.phrase.5", "home.phrase.6"];

/** Bom dia das 5h ao meio-dia, boa tarde até as 18h, boa noite no resto (a madrugada também). */
export function greeting(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return t("home.greeting.morning");
  if (h >= 12 && h < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

const KEY = "kiwi.home.phrase";

/**
 * A frase desta abertura: a seguinte à da abertura anterior, guardada no `localStorage` da janela. Sem ele (ou com um
 * valor estranho), a primeira.
 */
export function nextPhrase(storage: Pick<Storage, "getItem" | "setItem"> | null): string {
  return t(nextPhraseKey(storage));
}

/** A chave da frase desta abertura: a tela a guarda, e a frase troca de língua junto com o app. */
export function nextPhraseKey(storage: Pick<Storage, "getItem" | "setItem"> | null): TextKey {
  let last = -1;
  try {
    const text = storage?.getItem(KEY);
    const raw = text ? Number(text) : NaN;
    if (Number.isInteger(raw) && raw >= 0) last = raw;
  } catch {}
  const i = (last + 1) % PHRASES.length;
  try {
    storage?.setItem(KEY, String(i));
  } catch {}
  return PHRASES[i]!;
}
