// T6011: local Portuguese word forms, shared by the index, query and result highlights.
import { stemmer } from "@orama/stemmers/portuguese";
import { fold } from "../store/text.ts";
export const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
/** Snowball removes derivational suffixes; normalize the regular nasal plural before it. */
export function lexicalForms(word: string): string[] {
  const raw = word.normalize("NFC").toLocaleLowerCase("pt-BR");
  const canonical = raw.replace(/ões$/u, "ão");
  const folded = fold(raw).replace(/oes$/u, "ao");
  return [...new Set([fold(stemmer(canonical)), fold(stemmer(folded))].filter(Boolean))];
}
export const lexicalWords = (text: string): string[] => text.match(WORD) ?? [];
export function lexicalMatch(word: string, query: readonly string[]): boolean {
  const plain = fold(word), forms = lexicalForms(word);
  return query.some(q => plain === fold(q) || (q.length >= 2 && !/^\d+$/.test(q) && plain.startsWith(fold(q))) || lexicalForms(q).some(s => forms.includes(s)));
}
