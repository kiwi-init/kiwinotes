/**
 * A língua de uma frase, pt ou en (T31029, T31030, harry #31028): para a fala do gato ler os números na língua da frase
 * e tocar a voz daquela língua. Local e sem IA: conta as palavras comuns de cada língua e os acentos do português.
 * Funções puras, sem nada do Mac.
 */

export type Lingua = "pt" | "en";

// As palavras curtas e frequentes de cada língua. Ficam de fora as que existem nas duas ("a", "do", "no", "me", "se").
const PT = new Set([
  "de", "que", "não", "nao", "uma", "um", "para", "pra", "com", "os", "as", "da", "das", "dos", "em", "na", "nas", "nos",
  "é", "está", "estão", "você", "vocês", "eu", "ele", "ela", "eles", "elas", "mas", "por", "mais", "como", "isso", "isto",
  "essa", "esse", "esta", "este", "sua", "seu", "suas", "seus", "minha", "meu", "foi", "tem", "têm", "são", "já", "também",
  "aqui", "agora", "ao", "aos", "pelo", "pela", "sobre", "quando", "onde", "porque", "muito", "hoje", "amanhã", "ontem",
  "nota", "notas", "reunião", "pasta", "anotei", "achei", "pronto", "tudo", "nada", "ou", "o", "e", "às", "à",
]);
const EN = new Set([
  "the", "and", "of", "to", "is", "are", "was", "were", "in", "on", "at", "for", "with", "you", "your", "it", "its", "this",
  "that", "these", "those", "not", "have", "has", "had", "i", "my", "we", "our", "they", "their", "from", "by", "will",
  "be", "been", "can", "could", "would", "should", "an", "or", "there", "here", "what", "when", "where", "which", "who",
  "how", "about", "today", "tomorrow", "yesterday", "note", "notes", "meeting", "folder", "found", "done", "all", "just",
  "if", "but", "up", "out", "into", "than", "then", "now", "it's", "i'm", "don't", "doesn't", "can't", "won't", "isn't",
  "you're", "that's", "there's", "let's", "it’s", "i’m", "don’t",
]);

const ACENTO_PT = /[ãõçâêôáéíóúà]/i;

/**
 * Os pontos de cada língua num texto. O acento do português (ã, ç, é…) conta a favor do pt numa palavra que não está
 * nas listas: inglês não tem.
 */
export function pontosDeLingua(texto: string): { pt: number; en: number } {
  let pt = 0;
  let en = 0;
  for (const bruta of texto.toLowerCase().match(/[\p{L}'’]+/gu) ?? []) {
    const p = bruta.replace(/^['’]+|['’]+$/g, "");
    if (EN.has(p)) en++;
    else if (PT.has(p)) pt++;
    else if (ACENTO_PT.test(p)) pt++;
    else if (/['’](?:s|t|re|ve|ll|d|m)$/.test(p)) en++;
  }
  return { pt, en };
}

/** A língua do texto, ou `null` quando ele não dá pista (só números, um nome, uma sigla). */
export function linguaOuNada(texto: string): Lingua | null {
  const { pt, en } = pontosDeLingua(texto);
  if (pt === en) return null;
  return pt > en ? "pt" : "en";
}

/** A língua do texto; sem pista, a `padrao` (o português, como a fala sempre foi). */
export const linguaDe = (texto: string, padrao: Lingua = "pt"): Lingua => linguaOuNada(texto) ?? padrao;
