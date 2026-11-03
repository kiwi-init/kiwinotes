// Snippets por voz: dizer o gatilho ("meu e-mail") insere o texto (T57).
// Arquivo: <dados>/snippets.json, editável à mão.

import path from "node:path";

import { readJson, writeJson } from "./files.ts";
import { fold, foldWithMap, normalizePhrase } from "./text.ts";

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

/** As palavras do texto, com onde cada uma começa e termina ("e-mail" é uma palavra só). */
function words(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu)].map((m) => ({
    word: m[0],
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}

/**
 * Como a palavra soa em português, grosso modo: sem acento, com as grafias do mesmo som juntas ("ss", "ç" e "z" viram
 * "s"; "qu" e "c" duro viram "k"; "lh" vira "li"), o "l" no fim da sílaba como "u" ("mel" soa "meu") e o "e" e o "o"
 * finais fracos ("i", "u"). Não é fonética de verdade: só aproxima o que o STT troca numa frase curta (T985).
 */
export function soundKey(word: string): string {
  let w = fold(word).replace(/[^a-z0-9]/g, "");
  w = w
    .replace(/ch|sh/g, "x")
    .replace(/lh/g, "li")
    .replace(/nh/g, "ni")
    .replace(/ph/g, "f")
    .replace(/qu(?=[ei])|gu(?=[ei])/g, (m) => (m[0] === "q" ? "k" : "g"))
    .replace(/c(?=[ei])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/g(?=[ei])/g, "j")
    .replace(/z/g, "s")
    .replace(/h/g, "")
    .replace(/w/g, "u")
    .replace(/y/g, "i")
    .replace(/l(?![aeiou])/g, "u")
    .replace(/e$/, "i")
    .replace(/o$/, "u");
  return w.replace(/(.)\1+/g, "$1");
}

const SIMILAR_VOWELS = new Set(["ei", "ie", "ou", "uo"]);

/** Distância de edição entre dois sons; trocar "e" por "i" ou "o" por "u" custa meio. */
function soundDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const x = a[i - 1]!, y = b[j - 1]!;
      const sub = x === y ? 0 : SIMILAR_VOWELS.has(x + y) ? 0.5 : 1;
      row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + sub));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Até quanto do som do gatilho pode mudar: "meu imeio" (1,5 em 8) passa, "meu mais" (2 em 8) não. */
export const MAX_SOUND_CHANGE = 0.2;
/** Gatilho mais curto que isso (em som) só casa certo: sobra pouco para separar o gatilho de outra frase. */
const MIN_SOUND_LENGTH = 6;

/**
 * Se as palavras soam como o gatilho (T985). Só para gatilho de 2 palavras ou mais, com o mesmo 1º e último som: numa
 * palavra só, a forma aproximada pega o plural e as flexões ("assinaturas"), que não são o gatilho.
 */
export function soundsLike(spoken: string[], trigger: string): boolean {
  const parts = normalizePhrase(trigger).split(" ").filter(Boolean);
  if (parts.length < 2 || !spoken.length) return false;
  const target = parts.map(soundKey).join("");
  const heard = spoken.map(soundKey).join("");
  if (target.length < MIN_SOUND_LENGTH || !heard || heard[0] !== target[0]) return false;
  // O fim também: "meu emails" e "meu e mais" mudam só o último som, e não são o gatilho.
  const a = heard.at(-1)!, b = target.at(-1)!;
  if (a !== b && !SIMILAR_VOWELS.has(a + b)) return false;
  return soundDistance(heard, target) / target.length <= MAX_SOUND_CHANGE;
}

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
  const wholeText = text.replace(/[\s.!?…,;:]+$/u, "");
  const whole = squash(wholeText);
  for (const s of ordered) if (squash(s.trigger) === whole) return s.text;
  // O STT errou o gatilho por pouco ("meu imeio"): o ditado inteiro ainda é ele (T985).
  const wholeWords = words(wholeText);
  for (const s of ordered) if (soundsLike(wholeWords.map((w) => w.word), s.trigger)) return s.text;

  // Uma passada só, sobre o texto original: o texto que um snippet insere nunca dispara outro.
  const { folded, map } = foldWithMap(text);
  const found: { start: number; end: number; text: string }[] = [];
  for (const s of ordered) {
    // Separador opcional entre quaisquer duas letras, como o `squash` do ditado inteiro: "meu email" casa com
    // "meu e-mail" e "meu e mail" no meio da frase (T914).
    const chars = [...normalizePhrase(s.trigger).replace(/ /g, "")].map(escape);
    const re = new RegExp(chars.join("[\\s\\-‐–—_]*"), "gu");
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
  const free = (f: { start: number; end: number }) => chosen.every((c) => f.end <= c.start || f.start >= c.end);
  for (const f of found) if (free(f)) chosen.push(f);
  // Depois do que casou certo, o que só soa como o gatilho, no que sobrou do texto (T985).
  const tokens = words(text);
  for (const s of ordered) {
    const n = normalizePhrase(s.trigger).split(" ").length;
    for (const size of [n, n - 1]) {
      if (size < 1) continue;
      for (let i = 0; i + size <= tokens.length; i++) {
        const span = { start: tokens[i]!.start, end: tokens[i + size - 1]!.end, text: s.text };
        if (free(span) && soundsLike(tokens.slice(i, i + size).map((t) => t.word), s.trigger)) chosen.push(span);
      }
    }
  }
  chosen.sort((a, b) => a.start - b.start);

  let out = "";
  let last = 0;
  for (const c of chosen) {
    out += text.slice(last, c.start) + c.text;
    last = c.end;
  }
  return out + text.slice(last);
}
