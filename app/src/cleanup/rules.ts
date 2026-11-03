// O motor de regras: o caminho principal da limpeza (ADR 0002). Determinístico e
// conservador. Só tira o que não tem dúvida; o ambíguo fica como foi dito.

import { WORD_END as E, WORD_START as B } from "./dictionary.ts";
import type { Tone } from "./types.ts";

const re = (source: string, flags = "giu") => new RegExp(source, flags);
const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** Uma palavra sem pontuação em volta, em minúsculas, para comparar. */
const norm = (w: string) => w.toLocaleLowerCase("pt-BR").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// ------------------------------------------------------------ comandos falados

// O ponto antes do comando fica: "pensando. Novo parágrafo." → "pensando.\n\n".
const PARAGRAPH = re(`[\\s,;]*${B}(?:novo parágrafo|próximo parágrafo|new paragraph)${E}[\\s,.;:]*`);
const NEWLINE = re(`[\\s,;]*${B}(?:nova linha|quebra de linha|new line)${E}[\\s,.;:]*`);
// Só comandos que não são conteúdo de mensagem: "apaga isso do servidor" e "esquece isso, já
// resolvi" são frases normais (#241). O resto fica para o LLM.
const SCRATCH = re(`${B}(?:scratch that|apaga a (?:última|ultima) frase|apaga a frase anterior)${E}[\\s,.;:!]*`, "iu");

/** "nova linha", "novo parágrafo" e "apaga isso" (apaga a frase de antes). */
export function spokenCommands(text: string): string {
  let out = text.replace(PARAGRAPH, "\n\n").replace(NEWLINE, "\n");
  for (let m = SCRATCH.exec(out); m; m = SCRATCH.exec(out)) {
    // O ponto que fecha a frase apagada não conta como o começo dela.
    const before = out.slice(0, m.index).replace(/[\s.!?]+$/u, "");
    const boundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
    out = before.slice(0, boundary + 1) + (boundary >= 0 ? " " : "") + out.slice(m.index + m[0].length);
    SCRATCH.lastIndex = 0;
  }
  return out;
}

// ------------------------------------------------------------ autocorreção falada

interface Marker {
  re: RegExp;
}

// Só os marcadores que quase sempre são correção. "quer dizer" sozinho também é "ou seja",
// e "na verdade" é ênfase: ficam para o LLM.
const CORRECTION_MARKERS: Marker[] = [
  // "não quer dizer que…" é negação ("isso não quer dizer nada"), não correção.
  { re: re(`[\\s,;]*${B}não\\s*[,.]\\s*(?:quer dizer|digo|pera|espera)${E}[\\s,.:]*`, "iu") },
  { re: re(`[\\s,;]*${B}não\\s+quer dizer${E}(?!\\s+(?:que|nada|isso|muito|muita|necessariamente|tanto|grande)${E})[\\s,.:]*`, "iu") },
  // Só entre vírgulas, e nunca "ou melhor que", "ou melhor ainda" (comparação, #241).
  { re: re(`\\s*,\\s*${B}ou melhor${E}\\s*,(?!\\s*(?:que|do que|ainda)${E})\\s*`, "iu") },
  { re: re(`\\s*,\\s*digo${E}[\\s,.:]*`, "iu") },
  { re: re(`[\\s,;]*${B}(?:no[,.]?\\s+wait|wait[,.]?\\s+no|or rather)${E}[\\s,.:]*`, "iu") },
  // "I mean" só com vírgula depois, e no começo da frase ou depois de vírgula: "that's what I mean" é conteúdo.
  { re: re(`(?:(?<=^|[.!?]\\s*)|\\s*,\\s*)${B}(?:(?:no|sorry)[,.]?\\s+)?i mean\\s*,\\s*`, "iu") },
];

const SENTENCE_END = /[.!?\n]/;

/**
 * "às três, não, quer dizer, às quatro" → "às quatro". O que vem depois do marcador
 * substitui o trecho de antes que começa com a mesma palavra (ou uma parecida, "pro"/"pra");
 * sem nada parecido, substitui só a última palavra.
 */
export function selfCorrections(text: string): string {
  let out = text;
  for (const { re: marker } of CORRECTION_MARKERS) {
    for (let guard = 0; guard < 20; guard++) {
      marker.lastIndex = 0;
      const m = marker.exec(out);
      if (!m) break;
      const left = out.slice(0, m.index);
      const right = out.slice(m.index + m[0].length);
      out = replaceCorrected(left, right);
    }
  }
  return out;
}

function replaceCorrected(left: string, right: string): string {
  // Só olha a frase atual: a correção nunca atravessa um ponto final.
  let start = -1;
  for (let i = left.length - 1; i >= 0; i--) {
    if (SENTENCE_END.test(left[i]!)) {
      start = i;
      break;
    }
  }
  let head = left.slice(0, start + 1);
  let sentence = words(left.slice(start + 1));
  const fix = words(right);
  // "Vamos marcar sexta. Não, quer dizer, segunda.": o STT fechou a frase antes da correção,
  // então ela vale para a frase de antes.
  if (sentence.length === 0 && /[.!?]\s*$/u.test(head)) {
    const prev = head.replace(/[.!?]\s*$/u, "");
    let prevStart = -1;
    for (let i = prev.length - 1; i >= 0; i--) {
      if (SENTENCE_END.test(prev[i]!)) {
        prevStart = i;
        break;
      }
    }
    head = prev.slice(0, prevStart + 1);
    sentence = words(prev.slice(prevStart + 1));
  }
  if (sentence.length === 0 || fix.length === 0) return joinParts(head, sentence, right);

  const first = norm(fix[0]!);
  const window = Math.max(0, sentence.length - 8);
  let cut = -1;
  for (let i = sentence.length - 1; i >= window; i--) {
    if (norm(sentence[i]!) === first) {
      cut = i;
      break;
    }
  }
  if (cut < 0 && first.length >= 2) {
    for (let i = sentence.length - 1; i >= window; i--) {
      const w = norm(sentence[i]!);
      if (w.length <= 4 && first.length <= 4 && w.slice(0, 2) === first.slice(0, 2)) {
        cut = i;
        break;
      }
    }
  }
  if (cut < 0) cut = sentence.length - 1;
  return joinParts(head, sentence.slice(0, cut), right);
}

function joinParts(head: string, kept: string[], right: string): string {
  const middle = kept.join(" ").replace(/[\s,;:]+$/u, "");
  return [head.trimEnd(), middle, right.trimStart()].filter(Boolean).join(" ");
}

// ------------------------------------------------------------ muletas

// Hesitações que nunca são palavra de verdade. "um" fica de fora: em português é artigo.
const HESITATION = `(?:h[uú]m+|hm+|ahn+|ãh+|hã+|eh+|éh+|uh+|uhm+|umm+|erm?)`;
// Palavras antes das quais "tipo" é substantivo ("que tipo de arquivo").
const TIPO_NOUN_BEFORE = new Set(
  "o a um uma esse este aquele desse deste daquele nesse neste que qual quais mesmo outro novo do no ao cada todo algum nenhum seu meu teu nosso dele dela qualquer".split(" "),
);

/** Tira as muletas que dá para tirar sem mudar o sentido. Devolve o texto com a pontuação ainda bagunçada. */
export function removeFillers(text: string): string {
  let out = text;
  // "é" hesitante no começo da frase, colado numa hesitação: "é hum, me manda".
  out = out.replace(re(`(^|[.!?\\n]\\s*)é[\\s,.…]+(?=${HESITATION}${E})`), "$1");
  // A vírgula de antes vai junto: "acho que, ahn, dá" → "acho que dá".
  out = out.replace(re(`\\s*,?\\s*${B}${HESITATION}${E}[,.…]*`), " ");
  // "é, é" é hesitação. "é..." fica: o verbo seguido de pausa é comum ("o problema é... complicado", #241).
  out = out.replace(re(`${B}é[\\s,]+(?=é${E})`), "");
  // "né?" vira só "?": continua pergunta. "né" no resto do texto é muleta.
  out = out.replace(re(`[\\s,]*${B}né${E}\\s*\\?`), "?");
  out = out.replace(re(`[\\s,]*${B}né${E}`), "");
  // Entre vírgulas no meio da frase, a muleta leva as duas vírgulas: "ficou, tipo assim, lento" → "ficou lento".
  out = out.replace(re(`([\\p{L}\\p{N}\uE001])\\s*,\\s*(?:tipo(?:\\s+assim)?|you know|like|sabe)\\s*,\\s*`), "$1 ");
  // "tipo", "tipo assim": muleta, menos quando é substantivo.
  out = out.replace(re(`(^|[.!?\\n,]\\s*|\\s)(${B}tipo(?:\\s+assim)?${E})([\\s,]*)`), (all, before: string, _tipo: string, after: string, offset: number) => {
    const prev = norm(words(out.slice(0, offset + before.length)).at(-1) ?? "");
    const atClauseStart = /^$|[.!?\n,]\s*$/.test(before) || offset === 0;
    if (atClauseStart) {
      // No começo, só com vírgula ou "assim" ("Tipo de arquivo inválido" fica).
      return /assim/i.test(_tipo) || after.includes(",") ? before : all;
    }
    if (TIPO_NOUN_BEFORE.has(prev)) return all;
    return before.endsWith(" ") ? before : `${before} `;
  });
  // "então assim," / "assim," no começo da frase; ", sabe," e ", you know," no meio.
  out = out.replace(re(`(^|[.!?\\n]\\s*)(?:então\\s+)?assim\\s*,\\s*`), "$1");
  out = out.replace(re(`(^|[.!?\\n]\\s*)então\\s+assim\\s+`), "$1");
  out = out.replace(re(`[\\s,]*,\\s*(?:sabe|you know|like)${E}\\s*\\??(?=\\s*[,.!?]|\\s*$)`), "");
  out = out.replace(re(`,\\s*(?:you know|like),\\s*`), ", ");
  return out;
}

// Repetidas de propósito, para dar ênfase: ficam.
const EMPHASIS = new Set("muito mais bem não sim very really so no yes ha haha rs had that".split(" "));

/** "eu eu acho" → "eu acho". */
export function removeStutter(text: string): string {
  return text.replace(re(`${B}([\\p{L}']+)(?:[\\s,]+\\1${E})+`), (all, w: string) =>
    EMPHASIS.has(w.toLocaleLowerCase("pt-BR")) ? all : w,
  );
}

// ------------------------------------------------------------ listas

// Só as formas masculinas: "segunda", "quarta", "quinta" e "sexta" também são dias da semana.
const ORDINALS = [
  ["primeiro", "first", "em primeiro lugar"],
  ["segundo", "second", "em segundo lugar"],
  ["terceiro", "third", "em terceiro lugar"],
  ["quarto", "fourth"],
  ["quinto", "fifth"],
  ["sexto", "sixth"],
];

/**
 * "primeiro X, segundo Y, terceiro Z" → lista numerada. Cada ordinal tem que abrir uma
 * frase ou vir depois de vírgula, e precisa de pelo menos dois em sequência. "segundo ele"
 * é "de acordo com ele", não item.
 */
export function lists(text: string): string {
  const found: { index: number; length: number }[] = [];
  let from = 0;
  for (const forms of ORDINALS) {
    const alt = forms.join("|").replace(/ /g, "\\s+");
    // O hífen é parte da palavra ("segunda-feira"), e "primeiro de maio" ou "segundo ele" não são itens.
    const r = re(
      `(^|[.!?\\n,;:]\\s*)(${B}(?:${alt})(?![\\p{L}\\p{N}-])(?:\\s+lugar)?)(?!\\s+(?:ele|ela|eles|elas|o|a|os|as|de|do|da|fulano)${E})[\\s,:]*`,
      "iu",
    );
    const m = r.exec(text.slice(from));
    if (!m) break;
    const index = from + m.index + m[1]!.length;
    found.push({ index, length: m[0].length - m[1]!.length });
    from = index + found.at(-1)!.length;
  }
  if (found.length < 2) return text;
  const intro = text.slice(0, found[0]!.index).replace(/[\s,.;:]+$/u, "");
  const items = found.map((f, i) => {
    const end = i + 1 < found.length ? found[i + 1]!.index : text.length;
    return text.slice(f.index + f.length, end).replace(/^[\s,.;:]+|[\s,.;:]+$/gu, "");
  });
  const body = items.map((item, i) => `${i + 1}. ${capitalizeFirst(item)}`).join("\n");
  return intro ? `${intro}:\n${body}` : body;
}

// ------------------------------------------------------------ pontuação e maiúsculas

/** Arruma o que as outras regras deixaram: vírgula solta, espaço antes de ponto, linha vazia. */
export function tidyPunctuation(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.;:!?…])/g, "$1")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/[,;:]+(?=\s*[.!?])/g, "")
    .replace(/(?<!\.)([.!?])\s*\.(?!\.)/g, "$1") // "?." → "?", mas "..." fica
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|\n)[ \t,.;:]+(?=\S)/g, "$1")
    .replace(/[\s,;]+$/u, "")
    .trim();
}

function capitalizeFirst(s: string): string {
  return s.replace(/^(\s*["'(“]?)(\p{Ll})/u, (_, pre: string, c: string) => pre + c.toLocaleUpperCase("pt-BR"));
}

/** Maiúscula no começo e depois de ., !, ? e quebra de linha. Não pula marcador do dicionário. */
export function capitalize(text: string): string {
  return capitalizeFirst(text)
    // Depois de reticências não: "é... complicado" continua a mesma frase.
    .replace(/((?:(?<!\.)\.|[!?])\s+|\n["'(“]?)(\p{Ll})/gu, (_, pre: string, c: string) => pre + c.toLocaleUpperCase("pt-BR"))
    .replace(re(`${B}i${E}(?=\\s+\\p{L})`, "gu"), "I");
}

const QUESTION_START = re(
  `^(?:o que|que (?:tipo|horas|hora|dia)|qual|quais|quando|onde|por que|quem|quanto|quantos|quantas|será que|what|when|where|why|who|how|does|did|can|could|would|will|should)${E}`,
  "iu",
);

/** Põe o ponto final que falta. Pergunta só quando o STT não pontuou nada e a frase abre como pergunta. */
export function finalPunctuation(text: string, raw: string): string {
  if (!/[\p{L}\p{N}]$/u.test(text)) return text;
  const lastLine = text.split("\n").at(-1) ?? "";
  if (/^\d+\. /.test(lastLine)) return text; // termina num item de lista
  const unpunctuated = !/[.!?…]/.test(raw);
  return text + (unpunctuated && QUESTION_START.test(text) ? "?" : ".");
}

/** No tom casual, uma frase só sai sem ponto final ("ok, chego às 4"), como se digita no Slack. */
export function casualEnding(text: string): string {
  if (text.includes("\n")) return text;
  const inner = text.slice(0, -1);
  return text.endsWith(".") && !/[.!?]/.test(inner) ? inner : text;
}

// ------------------------------------------------------------ código no terminal

const CLI = "git|cd|ls|npm|npx|bun|bunx|yarn|pnpm|kubectl|docker|swift|gcloud|gsutil|make|python3?|pip3?|ssh|scp|cat|grep|rg|curl|brew|sudo|mkdir|rm|mv|cp|echo|export|go|cargo|node|deno|kiwi|claude|code|open|cat|tail|head";
const CODE = re(`[/\\\\=<>{}\\[\\]\`$|&]|(?:^|\\s)--?[\\p{L}]|\\w\\.\\w|\\w_\\w|^(?:${CLI})${E}`, "iu");

/** Parece comando ou código: no tom `literal`, isso sai sem maiúscula e sem ponto. */
export function looksLikeCode(text: string): boolean {
  return CODE.test(text.trim());
}

// ------------------------------------------------------------ pipeline

/** Tudo que as regras fazem, na ordem. O texto já vem com o dicionário protegido. */
export function applyRules(text: string, tone: Tone): string {
  let out = spokenCommands(text);
  out = selfCorrections(out);
  out = removeFillers(out);
  out = removeStutter(out);
  out = tidyPunctuation(out);
  if (tone === "literal" && looksLikeCode(out)) return out;
  if (tone !== "literal") out = lists(out);
  out = tidyPunctuation(out);
  out = capitalize(out);
  return out;
}

/** O que só pode rodar depois de voltar os termos do dicionário (precisa ver o fim real do texto). */
export function finishRules(text: string, raw: string, tone: Tone): string {
  if (tone === "literal" && looksLikeCode(text)) return text;
  let out = finalPunctuation(text, raw);
  if (tone === "casual") out = casualEnding(out);
  return out;
}
