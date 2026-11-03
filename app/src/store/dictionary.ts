// Dicionário pessoal: termos que o STT deve reconhecer e que a limpeza nunca muda (T57).
// Arquivo: <dados>/dictionary.json, editável à mão.

import path from "node:path";

import { readJson, writeJson } from "./files.ts";
import { fold } from "./text.ts";

export interface DictionaryTerm {
  /** A grafia certa, que vai para o texto: "DICOM", "kubectl", "Healthcare API". */
  term: string;
  /** Outras formas de dizer, que viram `term`: "cube control" → "kubectl". */
  aliases: string[];
}

interface DictionaryFile {
  version: 1;
  terms: DictionaryTerm[];
}

export const MAX_TERM_LENGTH = 60;
export const MAX_TERMS = 1000;

/** Limpa o que vem da UI ou do arquivo: apara, tira vazios e repetidos (sem diferença de maiúscula e acento). */
export function sanitizeTerms(input: unknown): DictionaryTerm[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: DictionaryTerm[] = [];
  for (const raw of input) {
    const item = typeof raw === "string" ? { term: raw, aliases: [] } : (raw as Partial<DictionaryTerm> | null);
    const term = typeof item?.term === "string" ? item.term.trim().slice(0, MAX_TERM_LENGTH) : "";
    const key = fold(term);
    if (!term || seen.has(key)) continue;
    seen.add(key);
    const aliasSeen = new Set<string>([key]);
    const aliases: string[] = [];
    for (const a of Array.isArray(item?.aliases) ? item.aliases : []) {
      const alias = typeof a === "string" ? a.trim().slice(0, MAX_TERM_LENGTH) : "";
      if (alias && !aliasSeen.has(fold(alias))) {
        aliasSeen.add(fold(alias));
        aliases.push(alias);
      }
    }
    out.push({ term, aliases });
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

export class DictionaryStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "dictionary.json");
  }

  async load(): Promise<DictionaryTerm[]> {
    const data = await readJson<DictionaryFile>(this.file);
    return sanitizeTerms(data?.terms);
  }

  async save(terms: unknown): Promise<DictionaryTerm[]> {
    const clean = sanitizeTerms(terms);
    await writeJson(this.file, { version: 1, terms: clean } satisfies DictionaryFile);
    return clean;
  }
}

/** Para o `config.set {dictionary}` do sidecar (vocabulário do STT): as grafias certas. */
export const sttVocabulary = (terms: DictionaryTerm[]): string[] => terms.map((t) => t.term);
