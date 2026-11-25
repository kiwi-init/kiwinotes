// O ⌘F do quadro branco e do diagrama (T22217, item 3 da régua): o que tem o texto procurado, na ordem de leitura.

import { fold } from "../../src/store/text.ts";
import { formatNumber, type Locale, translate } from "../../src/shared/i18n/index.ts";

export interface Findable {
  id: string;
  text: string;
}

const flat = (s: string) => fold(s).replace(/\s+/g, " ");

/**
 * Os ids cujo texto tem a busca, sem diferenciar acento, maiúscula nem quebra de linha, na ordem da lista e sem
 * repetir (um cartão com dois trechos achados conta uma vez). Busca vazia não acha nada.
 */
export function findIds(items: readonly Findable[], query: string): string[] {
  const q = flat(query).trim();
  if (!q) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id) || !flat(it.text).includes(q)) continue;
    seen.add(it.id);
    out.push(it.id);
  }
  return out;
}

/** O próximo achado (dir 1) ou o anterior (dir −1), dando a volta; sem achados, −1. */
export function stepFind(index: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (index < 0) return dir > 0 ? 0 : total - 1;
  return (index + dir + total) % total;
}

/** "2 de 5", "Nada encontrado", ou nada com a busca vazia. */
export function findCount(query: string, index: number, total: number, locale: Locale = "pt"): string {
  if (!query.trim()) return "";
  if (!total) return translate(locale, "notes.find.none");
  return translate(locale, "notes.find.count", { at: index < 0 ? 0 : index + 1, total: formatNumber(locale, total) });
}
