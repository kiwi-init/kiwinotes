// Motor de limpeza do ditado (T52): transcrição crua + app em foco → texto final.
// As regras sempre rodam e já entregam o texto; o LLM local é opcional (ADR 0002).

import { compileDictionary, protect } from "./dictionary.ts";
import { polish } from "./llm.ts";
import { applyRules, finishRules } from "./rules.ts";
import { toneFor } from "./tone.ts";
import type { CleanupInput, CleanupOptions, CleanupResult, LlmMode, Tone } from "./types.ts";

export type * from "./types.ts";
export { toneFor } from "./tone.ts";
export { sidecarLlm } from "./sidecar.ts";

/** Só as regras: síncrono e em menos de 1 ms. É o que entra quando não há LLM. */
export function cleanupWithRules(input: CleanupInput): { text: string; tone: Tone } {
  const tone = input.tone ?? toneFor(input.bundleId);
  const dictionary = compileDictionary(input.dictionary);
  const protectedText = protect(input.raw, dictionary);
  const ruled = protectedText.restore(applyRules(protectedText.text, tone));
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
