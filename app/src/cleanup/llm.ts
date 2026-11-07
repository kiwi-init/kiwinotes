// A passada opcional do LLM local, por cima do texto das regras (ADR 0002).
// O prompt e o filtro da saída vêm do VoiceInk (prompts.ts, outputFilter.ts). O LLM só melhora;
// quem decide se a saída vale é a guarda, nunca o modelo.

import { canonicalize, type CompiledDictionary, termsIn } from "./dictionary.ts";
import { filterOutput } from "./outputFilter.ts";
import { systemMessage, transcriptMessage } from "./prompts.ts";
import type { LlmBackend, LlmOutcome, Tone } from "./types.ts";

// Começos típicos de assistente respondendo, em vez de revisar.
// O fim é `(?![\p{L}\p{N}])`, não `\b`: o `\b` do JS só conhece ASCII, e "aqui está" nunca casava (T913).
const ASSISTANT_PREAMBLE = /^(?:claro|certo|aqui está|segue|desculpe|não (?:foi possível|consigo|posso)|sure|here(?:'s| is)|sorry|i can(?:not|'t)|as an ai)(?![\p{L}\p{N}])/iu;

/** Palavras que invertem o sentido: o LLM não pode tirar nem pôr nenhuma (T913). */
// Sem o "no" do inglês: em português é "em + o" ("no servidor"), e o LLM pode reescrever isso à vontade.
const NEGATIONS = new Set("não nao nunca nem sem jamais nenhum nenhuma ninguém nada not never nobody nothing none without".split(" "));
const negations = (s: string) => {
  const count = new Map<string, number>();
  for (const w of s.toLocaleLowerCase("pt-BR").split(/[^\p{L}\p{N}']+/u)) {
    const base = w === "don't" || w === "doesn't" || w === "didn't" || w === "won't" || w === "can't" || w.endsWith("n't") ? "not" : w;
    if (NEGATIONS.has(base)) count.set(base, (count.get(base) ?? 0) + 1);
  }
  return count;
};

const contentWords = (s: string) =>
  new Set(
    s
      .toLocaleLowerCase("pt-BR")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3),
  );

// Palavras que só um dos dois idiomas usa. Fora as que os dois têm ("a", "no", "do", "as", "me", "for", "um"):
// "um" é muleta no inglês e artigo no português, e "se for" é português (T6592).
const STOPWORDS: Record<Language, Set<string>> = {
  pt: new Set(
    "o os e de da das dos em na nas nos uma umas uns que é para pra com não por mais se eu você ele ela isso esse essa este esta tá está estão são foi vai ao aos pelo pela mas também já ainda quando onde como porque meu minha seu sua nosso nossa".split(" "),
  ),
  en: new Set(
    "the an of to in is are was were it that this and with on at you we they he she be will not by from have has does did can what how why when where which who but also just still there their my your our".split(" "),
  ),
};
type Language = "pt" | "en";

/** O idioma do texto pelas stopwords, ou `null` quando são poucas ou misturadas demais para dizer. */
export function languageOf(text: string): Language | null {
  const count: Record<Language, number> = { pt: 0, en: 0 };
  for (const w of text.toLocaleLowerCase("pt-BR").split(/[^\p{L}']+/u)) {
    const word = w.replace(/'(?:s|re|ll|ve|d|m)$/u, "");
    if (STOPWORDS.pt.has(word)) count.pt++;
    if (STOPWORDS.en.has(word)) count.en++;
  }
  // Texto curto conta com uma stopword só, desde que não tenha nenhuma do outro idioma: "kubectl tá fora do path".
  if (count.pt > 0 && count.en === 0) return "pt";
  if (count.en > 0 && count.pt === 0) return "en";
  if (count.pt >= 2 && count.pt >= 2 * count.en) return "pt";
  if (count.en >= 2 && count.en >= 2 * count.pt) return "en";
  return null;
}

const EN_THOUSANDS = /\d,\d{3}(?!\d)/u;

// O começo de uma pergunta ditada: o STT nem sempre põe o "?", então a primeira palavra também conta.
const QUESTION_START =
  /^(?:qual|quais|quem|como|quando|onde|quanto|quanta|quantos|quantas|por que|porque|o que|será que|você (?:pode|poderia|sabe)|what|which|who|whom|whose|how|when|where|why|can you|could you|would you|do you|is there|are there)(?![\p{L}\p{N}])/iu;

/**
 * A entrada é pergunta e a saída virou resposta: perdeu o "?" e não começa mais como pergunta.
 * Pega o "Canberra." de "qual é a capital da austrália", que não tem começo de assistente.
 */
function answeredQuestion(input: string, output: string): boolean {
  const opening = QUESTION_START.exec(input.trim())?.[0].toLocaleLowerCase("pt-BR");
  if (!input.includes("?") && !opening) return false;
  if (output.includes("?")) return false;
  return !opening || QUESTION_START.exec(output.trim())?.[0].toLocaleLowerCase("pt-BR") !== opening;
}

/**
 * Por que a saída do LLM não serve, ou `null` se serve. Pega os erros que medimos no
 * Foundation Models (#144): responder a pergunta, inventar coisa, cortar termo do dicionário, traduzir.
 */
export function rejectReason(input: string, output: string, dictionary: CompiledDictionary): string | null {
  const out = output.trim();
  if (!out) return "empty";
  // Só conta se o ditado não começa do mesmo jeito: "Segue o link…", "Certo, pode mandar…" são ditados (#309).
  const preamble = ASSISTANT_PREAMBLE.exec(out)?.[0].toLocaleLowerCase();
  if (preamble && ASSISTANT_PREAMBLE.exec(input.trim())?.[0].toLocaleLowerCase() !== preamble) return "answered";
  if (answeredQuestion(input, out)) return "answered";
  const langIn = languageOf(input);
  const langOut = languageOf(out);
  if (langIn && langOut && langIn !== langOut) return "language";
  // Em português a vírgula é decimal: "20,000" é o milhar do inglês, que o FM escreveu em PT (T1208).
  if (langIn === "pt" && EN_THOUSANDS.test(out) && !EN_THOUSANDS.test(input)) return "number_format";
  const ratio = out.length / Math.max(1, input.length);
  if (ratio > 1.4) return "grew";
  if (ratio < 0.5) return "shrank";
  const before = termsIn(input, dictionary);
  const after = new Set(termsIn(out, dictionary));
  const lost = before.find((t) => !after.has(t));
  if (lost) return `lost_term:${lost}`;
  // Uma negação a mais ou a menos inverte o que a pessoa disse, e as palavras curtas ficam fora da conta abaixo.
  const negIn = negations(input);
  const negOut = negations(out);
  for (const w of new Set([...negIn.keys(), ...negOut.keys()])) {
    if ((negIn.get(w) ?? 0) !== (negOut.get(w) ?? 0)) return `negation:${w}`;
  }
  // Quase toda palavra de conteúdo da saída tem que vir da entrada: senão é texto novo.
  const source = contentWords(input);
  const produced = [...contentWords(out)];
  if (produced.length >= 3) {
    const novel = produced.filter((w) => !source.has(w)).length / produced.length;
    if (novel > 0.35) return "novel_words";
  }
  return null;
}

/** Do Kiwi: o modelo às vezes devolve o texto ainda dentro do `<TRANSCRIPT>`, entre aspas ou com espaços no fim da linha. */
function stripWrapping(s: string): string {
  return s
    .trim()
    .replace(/^<TRANSCRIPT>\s*([\s\S]*?)\s*<\/TRANSCRIPT>$/u, "$1")
    .replace(/^["“'](.*)["”']$/su, "$1")
    .replace(/[ \t]+$/gmu, "")
    .trim();
}

/**
 * O vocabulário do prompt: os termos na ordem em que a pessoa os pôs (quando o limite corta, ficam os
 * primeiros) e sem repetição, como o `RecordingVocabulary` do VoiceInk.
 */
export function vocabularyOf(dictionary: CompiledDictionary): string[] {
  const seen = new Set<string>();
  return [...dictionary]
    .sort((a, b) => a.order - b.order)
    .map((d) => d.term.split(/\s+/u).join(" "))
    .filter((t) => {
      const key = t.normalize("NFC").toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Quanto o modelo pode gerar, como no `VoiceInkRefineInferenceEngine.maximumOutputTokens`: o dobro
 * da entrada, entre 256 e 8192. A entrada em tokens é estimada em ~3 caracteres por token.
 */
export function maxTokensFor(text: string): number {
  const inputTokens = Math.ceil(text.length / 3);
  return Math.min(Math.max(inputTokens * 2, 256), 8192);
}

export async function polish(
  text: string,
  tone: Exclude<Tone, "literal">,
  dictionary: CompiledDictionary,
  backend: LlmBackend,
  timeoutMs: number,
): Promise<{ text: string; outcome: LlmOutcome }> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      // Marca antes de abortar: o backend abortado rejeita, e isso não é um erro dele.
      timedOut = true;
      resolve("timeout");
      controller.abort();
    }, timeoutMs);
  });
  try {
    const request = {
      system: systemMessage(tone, vocabularyOf(dictionary)),
      prompt: transcriptMessage(text),
      maxTokens: maxTokensFor(text),
      temperature: 0,
      timeoutMs,
    };
    const answer = await Promise.race([backend.complete(request, controller.signal), timeout]);
    if (answer === "timeout") return { text, outcome: { used: false, backend: backend.name, ms: ms(), reason: "timeout" } };
    const candidate = canonicalize(stripWrapping(filterOutput(answer)), dictionary);
    const why = rejectReason(text, candidate, dictionary);
    if (why) return { text, outcome: { used: false, backend: backend.name, ms: ms(), reason: "rejected", detail: why } };
    return { text: candidate, outcome: { used: true, backend: backend.name, ms: ms() } };
  } catch (e) {
    if (timedOut) return { text, outcome: { used: false, backend: backend.name, ms: ms(), reason: "timeout" } };
    return { text, outcome: { used: false, backend: backend.name, ms: ms(), reason: "error", detail: String(e) } };
  } finally {
    clearTimeout(timer);
  }
}
