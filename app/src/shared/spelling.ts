export interface SpellingResult { available: boolean; misspelled: boolean; suggestions: string[] }
export const NO_SPELLING: SpellingResult = { available: false, misspelled: false, suggestions: [] };
export const isSpellingWord = (word: unknown): word is string =>
  typeof word === "string" && word.length > 0 && word.length <= 128 && /^\p{L}[\p{L}\p{M}'’-]*$/u.test(word);
export const isSpellingLanguage = (language: unknown): language is string =>
  typeof language === "string" && language.length <= 32 && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(language);
export function spellingResult(value: unknown, word: string): SpellingResult {
  const r = value as Partial<SpellingResult> | null;
  if (r?.available !== true) return { ...NO_SPELLING, suggestions: [] };
  if (r.misspelled !== true) return { available: true, misspelled: false, suggestions: [] };
  const seen = new Set<string>();
  for (const value of (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, 64)) {
    if (typeof value !== "string") continue;
    const candidate = value.trim();
    if (!candidate || candidate === word || candidate.length > 128 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(candidate)) continue;
    seen.add(candidate);
    if (seen.size === 8) break;
  }
  return { available: true, misspelled: true, suggestions: [...seen] };
}
