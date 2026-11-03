import type { DictionaryEntry } from "./types.ts";

// Os limites de palavra do JS (\b) só conhecem ASCII; "é", "né" e "ção" precisam destes.
export const WORD_START = "(?<![\\p{L}\\p{N}])";
export const WORD_END = "(?![\\p{L}\\p{N}])";

// O termo do dicionário só casa como palavra solta, nunca dentro de URL, caminho, e-mail, nome de arquivo ou
// `nome:tag` (T896): não encosta em `_ / \ @ ~`, nem num `.` ou `:` grudado em outra letra ou número.
// "o DICOM." e "GitHub: …" continuam valendo, porque ali o `.` e o `:` não seguem de letra.
const TERM_START = "(?<![\\p{L}\\p{N}_/\\\\@~]|[\\p{L}\\p{N}][.:])";
const TERM_END = "(?![\\p{L}\\p{N}_/\\\\@~]|[.:][\\p{L}\\p{N}])";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marcadores de uso privado: as regras não os veem como letra e não mexem no que está dentro. */
const OPEN = "";
const CLOSE = "";
export const PLACEHOLDER_RE = /(\d+)/g;

interface Compiled {
  term: string;
  re: RegExp;
  /** Casa só a grafia do termo, sem diferença de maiúscula (não um alias). */
  same: RegExp;
  /** A posição no dicionário da pessoa (a lista é reordenada pelo tamanho do termo). */
  order: number;
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
    if (!term.trim()) continue;
    const forms = [term, ...(typeof entry === "string" ? [] : (entry.aliases ?? []))].filter((f) => f.trim());
    // Formas mais longas primeiro, para "Healthcare API" ganhar de "API".
    forms.sort((a, b) => b.length - a.length);
    const re = new RegExp(`${TERM_START}(?:${forms.map(pattern).join("|")})${TERM_END}`, "giu");
    const same = new RegExp(`^(?:${pattern(term)})$`, "iu");
    out.push({ term: term.trim(), re, same, order });
  }
  out.sort((a, b) => b.term.length - a.term.length);
  return out;
}

export interface Protected {
  text: string;
  /** Volta com a grafia exata do dicionário. */
  restore: (s: string) => string;
  /**
   * Para um comando (T896): o alias falado vira o termo ("cube control" → "kubectl"), mas o termo dito com outra
   * maiúscula fica como veio, porque num argumento a grafia importa (`kubectl -n pacs`, namespace com minúscula).
   */
  restoreAsTyped: (s: string) => string;
}

/**
 * Troca cada termo do dicionário por um marcador, para as regras não tirarem nem
 * recapitalizarem o termo.
 */
export function protect(text: string, dictionary: Compiled[]): Protected {
  const found: { term: string; typed: string }[] = [];
  let out = text;
  for (const { term, re, same } of dictionary) {
    out = out.replace(re, (match) => {
      found.push({ term, typed: same.test(match) ? match : term });
      return `${OPEN}${found.length - 1}${CLOSE}`;
    });
  }
  const back = (s: string, pick: (f: { term: string; typed: string }) => string) =>
    s.replace(PLACEHOLDER_RE, (_, i: string) => {
      const f = found[Number(i)];
      return f ? pick(f) : "";
    });
  return {
    text: out,
    restore: (s) => back(s, (f) => f.term),
    restoreAsTyped: (s) => back(s, (f) => f.typed),
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
