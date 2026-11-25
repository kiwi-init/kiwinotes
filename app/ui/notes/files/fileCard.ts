// O que o cartão do arquivo sem visualizador diz (T19316, spec #19277): o tipo e a data, em palavras, e quando o
// tamanho não vale.

import { INTL_TAG, type Locale, translate } from "../../../src/shared/i18n/index.ts";
import { extOf, PACKAGE_MARKS } from "../../../src/shared/attachments.ts";

/**
 * O tipo, pela extensão, na língua: "Arquivo ZIP" ("ZIP file"), ou "Arquivo sem extensão". Como na árvore (`splitExt`), o ponto do começo
 * (`.gitignore`) não é extensão, e um nome que termina em ponto também não tem.
 */
export function typeLabel(name: string, locale: Locale = "pt"): string {
  const base = name.split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  return ext ? translate(locale, "files.card.typeExt", { ext: ext.toUpperCase() }) : translate(locale, "files.card.typeNone");
}

/** A data da última mudança, na língua ("18 de nov. de 2026, 14:05", "Nov 18, 2026, 2:05 PM"); "" se a data não é válida. */
export function modified(iso: string, locale: Locale = "pt"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(INTL_TAG[locale], { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Um documento-pacote (`.pages`, `.numbers`, `.key`, `.rtfd`): no disco é uma pasta, e o `size` da lista é o da
 * entrada da pasta (uns 96 B), não o do documento. O cartão não mostra esse tamanho (revisão #19798). Um `.pages`
 * antigo, de arquivo só, também fica sem: melhor faltar que mentir.
 */
export const isPackageName = (name: string): boolean => Object.hasOwn(PACKAGE_MARKS, extOf(name));
