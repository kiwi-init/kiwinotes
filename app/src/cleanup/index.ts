// Motor de limpeza do ditado (T52): transcrição crua + app em foco → texto final.
// As regras sempre rodam e já entregam o texto; o LLM local é opcional (ADR 0002).

import { compileDictionary, protect } from "./dictionary.ts";
import { polish, vocabularyOf } from "./llm.ts";
import { isNumberWord } from "./numbers.ts";
import { systemMessage } from "./prompts.ts";
import { applyRules, capitalize, finishRules, looksLikeCode, spokenPunctuation, tidyPunctuation } from "./rules.ts";
import { toneFor } from "./tone.ts";
import type { CleanupInput, CleanupOptions, CleanupResult, DictionaryEntry, LlmMode, Tone } from "./types.ts";

export type * from "./types.ts";
export { toneFor } from "./tone.ts";
export { sidecarLlm } from "./sidecar.ts";

/**
 * A mensagem de sistema do LLM para um tom e um dicionário. Não depende do texto, então serve para
 * o `llm.prewarm` antes do ditado (T58): o próximo `llm.complete` com ela pega a sessão aquecida.
 */
export function llmSystemMessage(tone: Exclude<Tone, "literal">, dictionary: DictionaryEntry[] = []): string {
  return systemMessage(tone, vocabularyOf(compileDictionary(dictionary)));
}

// Palavras que as regras tiram de propósito (muletas e marcadores de correção): não contam na trava abaixo.
const EXPECTED_DROPS = new Set(
  [
    "tipo assim sabe então quer dizer digo melhor pera espera mean wait rather scratch apaga última ultima frase anterior like know",
    "nova novo linha quebra parágrafo próximo line paragraph lugar",
    "primeiro segundo terceiro quarto quinto sexto first second third fourth fifth sixth",
    "cento percent dollars dollar bucks horas hora minutos minuto vírgula ponto point meia",
  ]
    .join(" ")
    .split(" "),
);

function contentWords(s: string): string[] {
  return s
    .toLocaleLowerCase("pt-BR")
    .split(/[^\p{L}\p{N}]+/u)
    // Um número por extenso vira algarismo (T1974): "cinquenta" → "50" não é palavra perdida.
    .filter((w) => w.length > 3 && !EXPECTED_DROPS.has(w) && !isNumberWord(w));
}

/**
 * Trava das regras, como a guarda do LLM: se elas tiraram mais de 40% das palavras de conteúdo
 * do que a pessoa disse, alguma regra errou (#241), e fica o texto cru só com maiúscula e ponto.
 */
export function rulesDroppedTooMuch(raw: string, ruled: string): boolean {
  // Só os comandos realmente consumidos saem da conta; substantivos continuam protegidos pela trava.
  const before = contentWords(spokenPunctuation(raw));
  if (before.length < 3) return false;
  const after = new Set(contentWords(ruled));
  const lost = before.filter((w) => !after.has(w)).length;
  return lost / before.length > 0.4;
}

/** Só as regras: síncrono e em menos de 1 ms. É o que entra quando não há LLM. */
export function cleanupWithRules(input: CleanupInput): { text: string; tone: Tone } {
  const tone = input.tone ?? toneFor(input.bundleId);
  const dictionary = compileDictionary(input.dictionary);
  const protectedText = protect(input.raw, dictionary);
  // Comando ou não, decidido com os termos de volta: "kubectl get pods ." com `kubectl` no dicionário é comando.
  const code = tone === "literal" && looksLikeCode(protectedText.restoreAsTyped(protectedText.text));
  let marked = applyRules(protectedText.text, tone, code);
  // Um comando só perde espaços repetidos: a trava não vale ali, e o alias trocado pelo termo ("cube control" →
  // "kubectl") contaria como palavras perdidas e passaria o comando pelo `tidyPunctuation`.
  if (!code && rulesDroppedTooMuch(input.raw, protectedText.restore(marked))) {
    marked = capitalize(tidyPunctuation(protectedText.text));
  }
  // Num comando, o termo dito com outra maiúscula fica como veio (`kubectl -n pacs`, T896); o alias vira o termo.
  const typed = protectedText.restoreAsTyped(marked);
  const ruled = tone === "literal" && looksLikeCode(typed) ? typed : protectedText.restore(marked);
  return { text: finishRules(ruled, input.raw, tone), tone };
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function wantsLlm(mode: LlmMode, tone: Tone, text: string, longWords: number): boolean {
  if (mode === "off" || tone === "literal") return false;
  if (mode === "always") return true;
  return tone === "formal" || wordCount(text) >= longWords;
}

export async function cleanup(input: CleanupInput, options: CleanupOptions = {}): Promise<CleanupResult> {
  const started = performance.now();
  const { text: rulesText, tone } = cleanupWithRules(input);
  const done = (text: string, llm?: CleanupResult["llm"]): CleanupResult => ({
    text,
    tone,
    rulesText,
    llm,
    ms: Math.round((performance.now() - started) * 10) / 10,
  });

  const { llm, llmMode = "off", llmTimeoutMs = 1500, longDictationWords = 40 } = options;
  if (!llm || !llm.available() || !rulesText || !wantsLlm(llmMode, tone, rulesText, longDictationWords) || tone === "literal") {
    return done(rulesText);
  }
  const dictionary = compileDictionary(input.dictionary);
  const polished = await polish(rulesText, tone, dictionary, llm, llmTimeoutMs);
  return done(polished.text, polished.outcome);
}
