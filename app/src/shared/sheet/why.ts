// Por que uma planilha recusa uma edição ou abre só para leitura (T29245): uma chave do catálogo
// (`files.sheet.why.*`) com os parâmetros. A tela mostra na língua dela; o `message` do erro, que vai ao agente e ao
// log, é a frase em português, a mesma de antes.

import { translate, type Locale, type TextKey } from "../i18n/index.ts";

/** Um parâmetro é um texto pronto (o nome de uma aba) ou outra chave, traduzida na mesma língua ("inserir linhas"). */
export type WhyParam = string | number | { key: TextKey };

export interface SheetWhy {
  key: TextKey;
  params?: Record<string, WhyParam>;
}

export const why = (key: TextKey, params?: Record<string, WhyParam>): SheetWhy => (params ? { key, params } : { key });

/** A frase do motivo numa língua. */
export function whyText(locale: Locale, w: SheetWhy): string {
  const params = w.params && Object.fromEntries(Object.entries(w.params).map(([k, v]) => [k, typeof v === "object" ? translate(locale, v.key) : v]));
  return translate(locale, w.key, params);
}

/** Um erro com o motivo: `message` em português, `why` para a tela traduzir. */
export class WhyError extends Error {
  constructor(readonly why: SheetWhy) {
    super(whyText("pt", why));
  }
}
