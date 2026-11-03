// Snippets por voz: dizer o gatilho ("meu e-mail") insere o texto (T57).
// Arquivo: <dados>/snippets.json, editável à mão.

import path from "node:path";

import { readJson, writeJson } from "./files.ts";
import { foldWithMap, normalizePhrase } from "./text.ts";

export interface Snippet {
  /** O que a pessoa fala. Sem diferença de maiúscula, acento ou hífen ("meu email" = "Meu e-mail"). */
  trigger: string;
  /** O que entra no lugar, exatamente como está. */
  text: string;
}

interface SnippetsFile {
  version: 1;
  snippets: Snippet[];
}

export const MAX_TRIGGER_LENGTH = 60;
export const MAX_SNIPPET_LENGTH = 5000;

export function sanitizeSnippets(input: unknown): Snippet[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const raw of input) {
    const s = raw as Partial<Snippet> | null;
    const trigger = typeof s?.trigger === "string" ? s.trigger.trim().slice(0, MAX_TRIGGER_LENGTH) : "";
    const text = typeof s?.text === "string" ? s.text.slice(0, MAX_SNIPPET_LENGTH) : "";
    // Mesma chave do `expandSnippets`: "meu e-mail" e "meu email" são o mesmo gatilho.
    const key = normalizePhrase(trigger).replace(/ /g, "");
    // Um gatilho de uma letra só dispararia em todo lugar.
    if (key.length < 2 || !text.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push({ trigger, text });
  }
  return out;
}

export class SnippetStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "snippets.json");
  }

  async load(): Promise<Snippet[]> {
    const data = await readJson<SnippetsFile>(this.file);
    return sanitizeSnippets(data?.snippets);
  }

  async save(snippets: unknown): Promise<Snippet[]> {
    const clean = sanitizeSnippets(snippets);
    await writeJson(this.file, { version: 1, snippets: clean } satisfies SnippetsFile);
    return clean;
  }
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Troca os gatilhos pelo texto dos snippets. Roda depois da limpeza (T58):
 * - o ditado inteiro é o gatilho ("Meu e-mail.") → sai só o texto, sem ponto nem maiúscula a mais;
 * - o gatilho no meio da frase → troca só ele ("manda pro meu e-mail" → "manda pro davi@…").
 * Gatilhos mais longos primeiro, para "meu e-mail do trabalho" ganhar de "meu e-mail".
 */
export function expandSnippets(text: string, snippets: Snippet[]): string {
  if (!snippets.length || !text) return text;
  const ordered = [...snippets].sort((a, b) => normalizePhrase(b.trigger).length - normalizePhrase(a.trigger).length);

  // Sem espaços na comparação: o STT escreve "email", "e-mail" ou "e mail".
  const squash = (x: string) => normalizePhrase(x).replace(/ /g, "");
  const whole = squash(text.replace(/[\s.!?…,;:]+$/u, ""));
  for (const s of ordered) if (squash(s.trigger) === whole) return s.text;

  // Uma passada só, sobre o texto original: o texto que um snippet insere nunca dispara outro.
  const { folded, map } = foldWithMap(text);
  const found: { start: number; end: number; text: string }[] = [];
  for (const s of ordered) {
    const words = normalizePhrase(s.trigger).split(" ").map(escape);
    const re = new RegExp(words.join("[\\s\\-‐–—_]*"), "gu");
    for (const m of folded.matchAll(re)) {
      const start = map[m.index!]!;
      const end = map[m.index! + m[0].length]!;
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
      found.push({ start, end, text: s.text });
    }
  }
  // Nas sobreposições ganha o trecho mais longo; depois, o que vem primeiro.
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: typeof found = [];
  for (const f of found) if (chosen.every((c) => f.end <= c.start || f.start >= c.end)) chosen.push(f);
  chosen.sort((a, b) => a.start - b.start);

  let out = "";
  let last = 0;
  for (const c of chosen) {
    out += text.slice(last, c.start) + c.text;
    last = c.end;
  }
  return out + text.slice(last);
}
