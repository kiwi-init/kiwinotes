import type { DictionaryEntry } from "./types.ts";

// Os limites de palavra do JS (\b) só conhecem ASCII; "é", "né" e "ção" precisam destes.
export const WORD_START = "(?<![\\p{L}\\p{N}])";
export const WORD_END = "(?![\\p{L}\\p{N}])";

const HAS_WORD = /[\p{L}\p{N}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marcadores de uso privado: as regras não os veem como letra e não mexem no que está dentro. */
const OPEN = "";
const CLOSE = "";
export const PLACEHOLDER_RE = /(\d+)/g;

interface Compiled {
  term: string;
  re: RegExp;
  /** A posição no dicionário da pessoa (a lista é reordenada pela forma falada mais longa). */
  order: number;
  /** A forma falada mais longa (termo ou alias): quem tem a mais longa casa primeiro. */
  longest: number;
}

/** Uma forma falada vira regex: sem diferença de maiúscula, e espaço ou hífen entre as palavras. */
function pattern(spoken: string): string {
  return spoken
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escape)
    .join("[\\s-]*");
}

export function compileDictionary(entries: DictionaryEntry[] = []): Compiled[] {
  const out: Compiled[] = [];
  for (const [order, entry] of entries.entries()) {
    const term = typeof entry === "string" ? entry : entry.term;
    // Sem letra nem número ("-", "."), a forma vira uma regex que casa em todo canto e enche o texto (T913).
    if (!HAS_WORD.test(term)) continue;
    const forms = [term, ...(typeof entry === "string" ? [] : (entry.aliases ?? []))].filter((f) => HAS_WORD.test(f));
    // Formas mais longas primeiro, para "Healthcare API" ganhar de "API".
    forms.sort((a, b) => b.length - a.length);
    const re = new RegExp(`${WORD_START}(?:${forms.map(pattern).join("|")})${WORD_END}`, "giu");
    out.push({ term: term.trim(), re, order, longest: forms[0]!.trim().length });
  }
  // Pela forma falada, não pelo termo: com {kubectl: ["kube control"]} e {Kubernetes: ["kube"]}, "kube control" tem
  // que ganhar de "kube" (T913).
  out.sort((a, b) => b.longest - a.longest);
  return out;
}

/**
 * Troca cada termo do dicionário por um marcador, para as regras não tirarem nem
 * recapitalizarem o termo. `restore` volta com a grafia exata do dicionário.
 */
export function protect(text: string, dictionary: Compiled[]): { text: string; restore: (s: string) => string } {
  const terms: string[] = [];
  let out = text;
  for (const { term, re } of dictionary) {
    out = out.replace(re, () => {
      terms.push(term);
      return `${OPEN}${terms.length - 1}${CLOSE}`;
    });
  }
  return {
    text: out,
    restore: (s) => s.replace(PLACEHOLDER_RE, (_, i: string) => terms[Number(i)] ?? ""),
  };
}

/** Aplica a grafia do dicionário num texto que já saiu (por exemplo, a saída do LLM). */
export function canonicalize(text: string, dictionary: Compiled[]): string {
  const p = protect(text, dictionary);
  return p.restore(p.text);
}

/** Os termos do dicionário que aparecem no texto (para a guarda do LLM). */
export function termsIn(text: string, dictionary: Compiled[]): string[] {
  const found: string[] = [];
  for (const { term, re } of dictionary) {
    re.lastIndex = 0;
    if (re.test(text)) found.push(term);
    re.lastIndex = 0;
  }
  return found;
}

export type CompiledDictionary = Compiled[];
