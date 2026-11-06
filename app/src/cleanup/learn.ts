// L23 (decisão do harry no #4767): a pessoa corrige logo depois de colar ("Pax" → "PACS"), e o Kiwi guarda a troca no
// dicionário sozinho. Aqui só a decisão, pura: o que foi colado, o mesmo trecho depois da edição, e se isso é a troca
// de um termo (aprende) ou uma reescrita (não aprende). A ideia vem do Auto-Learn do VoiceInk e do
// AutomaticDictionary do FluidVoice (GPL-3.0, só como ideia); o código é nosso.

import { type DictionaryTerm, MAX_ALIASES, MAX_TERM_LENGTH, MAX_TERMS } from "../store/dictionary.ts";
import { fold } from "../store/text.ts";

export interface LearnedPair {
  /** O que o STT escreveu: vira um alias. */
  from: string;
  /** O que a pessoa pôs no lugar: vira (ou já é) o termo. */
  to: string;
}

/** No máximo isto de palavras de cada lado: mais que isso é reescrever a frase, não corrigir um termo. */
const MAX_WORDS = 3;
/** A distância de edição (sem acento, maiúscula nem espaço) sobre o tamanho do maior: acima disso, é outra palavra. */
const MAX_DISTANCE = 0.5;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.\-_]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;

function words(text: string): string[] {
  return [...text.matchAll(WORD)].map((m) => m[0]);
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

const squash = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, "");

/** Só trocou a 1ª letra para maiúscula (ou tudo para minúscula): é a limpeza ou o gosto, não um termo. */
function onlyCapitalized(from: string, to: string): boolean {
  const lower = to.toLocaleLowerCase("pt-BR");
  if (from.toLocaleLowerCase("pt-BR") !== lower) return false;
  const title = lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
  return to === lower || to === title;
}

/**
 * A troca que a pessoa fez num trecho colado, se for a correção de um termo: o pedaço que mudou (tirando o começo e o
 * fim iguais, palavra por palavra) tem de 1 a 3 palavras de cada lado, soa parecido (a distância de edição sem acento,
 * maiúscula nem espaço é no máximo metade) e não é só maiúscula na 1ª letra. Inserir, apagar e reescrever não contam.
 */
export function learnedPair(pasted: string, edited: string): LearnedPair | null {
  const a = words(pasted);
  const b = words(edited);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const removed = a.slice(start, a.length - end);
  const added = b.slice(start, b.length - end);
  if (!removed.length || !added.length || removed.length > MAX_WORDS || added.length > MAX_WORDS) return null;
  const from = removed.join(" ");
  const to = added.join(" ");
  if (from.length > MAX_TERM_LENGTH || to.length > MAX_TERM_LENGTH) return null;
  if (!/\p{L}/u.test(to) || onlyCapitalized(from, to)) return null;
  const x = squash(from);
  const y = squash(to);
  if (!x || !y) return null;
  if (x !== y && distance(x, y) / Math.max(x.length, y.length) > MAX_DISTANCE) return null;
  return { from, to };
}

/**
 * O dicionário com a troca aprendida: o alias entra no termo que já existe (sem diferença de maiúscula e acento), ou
 * nasce um termo novo. Devolve `null` quando nada muda (o alias já está lá, ou o dicionário está cheio).
 */
export function withLearned(terms: DictionaryTerm[], pair: LearnedPair): DictionaryTerm[] | null {
  const key = fold(pair.to);
  const alias = fold(pair.from);
  const sameSpelling = alias === key;
  const index = terms.findIndex((t) => fold(t.term) === key);
  if (index < 0) {
    if (terms.length >= MAX_TERMS) return null;
    return [...terms, { term: pair.to, aliases: sameSpelling ? [] : [pair.from] }];
  }
  const term = terms[index]!;
  const spellingChanged = term.term !== pair.to;
  if (sameSpelling && !spellingChanged) return null;
  if (!sameSpelling && term.aliases.some((a) => fold(a) === alias) && !spellingChanged) return null;
  const aliases = sameSpelling || term.aliases.some((a) => fold(a) === alias) || term.aliases.length >= MAX_ALIASES
    ? term.aliases
    : [...term.aliases, pair.from];
  if (aliases === term.aliases && !spellingChanged) return null;
  return terms.map((t, i) => (i === index ? { term: pair.to, aliases } : t));
}
