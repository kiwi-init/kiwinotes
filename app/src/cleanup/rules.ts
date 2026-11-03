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
  /**
   * Só é correção quando o que vem depois repete uma palavra da frase ("às três não quer dizer às quatro"). Sem isso
   * é o verbo: "Ele não quer dizer a verdade" (T913).
   */
  needsMatch?: boolean;
}

// Só os marcadores que quase sempre são correção. "quer dizer" sozinho também é "ou seja",
// e "na verdade" é ênfase: ficam para o LLM.
const CORRECTION_MARKERS: Marker[] = [
  // "não quer dizer que…" é negação ("isso não quer dizer nada"), não correção.
  { re: re(`[\\s,;]*${B}não\\s*[,.]\\s*(?:quer dizer|digo|pera|espera)${E}[\\s,.:]*`, "iu") },
  {
    re: re(`[\\s,;]*${B}não\\s+quer dizer${E}(?!\\s+(?:que|nada|isso|muito|muita|necessariamente|tanto|grande)${E})[\\s,.:]*`, "giu"),
    needsMatch: true,
  },
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
  for (const { re: marker, needsMatch } of CORRECTION_MARKERS) {
    let from = 0;
    for (let guard = 0; guard < 20; guard++) {
      marker.lastIndex = 0;
      const m = new RegExp(marker.source, "iu").exec(out.slice(from));
      if (!m) break;
      const at = from + m.index;
      const corrected = replaceCorrected(out.slice(0, at), out.slice(at + m[0].length), needsMatch);
      if (corrected === null) {
        from = at + m[0].length; // não é correção: segue procurando depois dele
        continue;
      }
      out = corrected;
      from = 0;
    }
  }
  return out;
}

/** `null` quando `needsMatch` e nada da frase corresponde ao começo da correção. */
function replaceCorrected(left: string, right: string, needsMatch = false): string | null {
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
  if (sentence.length === 0 || fix.length === 0) return needsMatch ? null : joinParts(head, sentence, right);

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
  if (cut < 0) {
    if (needsMatch) return null;
    cut = sentence.length - 1;
  }
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
  // Também depois de preposição: "erro de tipo", "busca por tipo", "sem tipo" (T913).
  "o a um uma esse este aquele desse deste daquele nesse neste que qual quais mesmo outro novo do no ao cada todo algum nenhum seu meu teu nosso dele dela qualquer de da por pelo pela sem com num numa em pro pra".split(" "),
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
  // "então assim," no começo da frase; ", sabe," e ", you know," no meio. "Assim," sozinho é conector ("Assim, o
  // projeto ficou pronto"), e "então assim que…" é a conjunção: ficam (T913).
  out = out.replace(re(`(^|[.!?\\n]\\s*)então\\s+assim\\s*,\\s*`), "$1");
  out = out.replace(re(`(^|[.!?\\n]\\s*)então\\s+assim\\s+(?!que${E})`), "$1");
  out = out.replace(re(`[\\s,]*,\\s*(?:sabe|you know|like)${E}\\s*\\??(?=\\s*[,.!?]|\\s*$)`), "");
  out = out.replace(re(`,\\s*(?:you know|like),\\s*`), ", ");
  return out;
}

// Repetidas de propósito, para dar ênfase: ficam.
const EMPHASIS = new Set("muito mais bem não sim very really so no yes ha haha rs had that".split(" "));

/**
 * "eu eu acho" → "eu acho". Com vírgula, três vezes ou terminando em "!" é ênfase e fica: "Vai, vai, vai!" (T913).
 */
export function removeStutter(text: string): string {
  return text.replace(re(`${B}([\\p{L}']+)(?:[\\s,]+\\1${E})+`), (all: string, w: string, offset: number, whole: string) => {
    if (EMPHASIS.has(w.toLocaleLowerCase("pt-BR"))) return all;
    const copies = words(all.replace(/,/g, " ")).length;
    const exclaimed = /^\s*!/.test(whole.slice(offset + all.length));
    return all.includes(",") && (copies >= 3 || exclaimed) ? all : w;
  });
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
    // "primeiro lugar" sem o "em" é o 1º colocado ("Primeiro lugar foi o Brasil"), não item (T913).
    const r = re(
      `(^|[.!?\\n,;:]\\s*)(${B}(?:${alt})(?![\\p{L}\\p{N}-]))(?!\\s+(?:ele|ela|eles|elas|o|a|os|as|de|do|da|fulano|lugar)${E})[\\s,:]*`,
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

// "Quando puder, me manda" é condição: "quando" + futuro do subjuntivo (puder, tiver, der, chegar) não pergunta (T913).
const QUESTION_START = re(
  `^(?:o que|que (?:tipo|horas|hora|dia)|qual|quais|quando(?!\\s+\\p{L}+r${E})|onde|por que|quem|quanto|quantos|quantas|será que|what|when|where|why|who|how|does|did|can|could|would|will|should)${E}`,
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
// Sinais de código em qualquer lugar do texto: path, flag, `=`, `.` ou `_` dentro de palavra.
// O ponto dentro de palavra conta com uma letra de um dos lados ("arquivo.txt", "v2.py"), não entre números ("2.1").
const CODE_SIGN = re(`[/\\\\=<>{}\\[\\]\`$|&]|(?:^|\\s)--?[\\p{L}]|\\p{L}\\.[\\p{L}\\p{N}]|\\p{N}\\.\\p{L}|\\w_\\w`, "iu");
const CLI_FIRST = re(`^(?:${CLI})${E}`, "iu");
/** Comandos que também começam frase em inglês ("Make sure…", "Open the file…", "Go ahead…"), comum no Claude Code. */
const PROSE_START = new Set("make open go code echo export head tail cat node claude kiwi".split(" "));
/** Até quantas palavras um desses, sem outro sinal de código, ainda é comando ("make build", "tail log"). */
const SHORT_COMMAND_WORDS = 2;
/** Uma frase com vírgula e pelo menos tantas palavras, sem sinal de código, é prosa ("Docker tá fora do ar, reinicia ele"). */
const PROSE_WORDS = 6;

/**
 * Parece comando ou código: no tom `literal`, isso sai sem maiúscula e sem ponto. Um comando que também começa
 * frase em inglês só conta com outro sinal de código, ou no texto curto (T684, #691).
 */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  if (CODE_SIGN.test(t)) return true;
  const first = t.match(CLI_FIRST)?.[0];
  if (!first) return false;
  const count = t.split(/\s+/).length;
  if (t.includes(",") && count >= PROSE_WORDS) return false;
  return !PROSE_START.has(first.toLowerCase()) || count <= SHORT_COMMAND_WORDS;
}

/**
 * O STT escreve o comando como frase ("Git status."); no tom `literal` ele volta a ser comando ("git status",
 * T684). Só sai a maiúscula da 1ª palavra, quando ela é um comando conhecido escrito como "Git" (não "GIT"),
 * e o ponto final colado numa palavra ("arquivo.txt." → "arquivo.txt"; "..." fica).
 */
export function asCommand(text: string): string {
  let out = text.trim().replace(/(?<=[\p{L}\p{N}])\.$/u, "");
  const first = out.match(CLI_FIRST)?.[0];
  if (first && /^\p{Lu}[\p{Ll}\p{N}]*$/u.test(first)) out = first.toLowerCase() + out.slice(first.length);
  return out;
}

// ------------------------------------------------------------ pipeline

/** Tudo que as regras fazem, na ordem. O texto já vem com o dicionário protegido. */
/**
 * `code`: no tom `literal`, se o texto é comando. Quem chama decide em cima do texto com os termos do dicionário de
 * volta: aqui o `kubectl` já virou marcador, e o `looksLikeCode` não o reconheceria (review do T913).
 */
export function applyRules(text: string, tone: Tone, code = tone === "literal" && looksLikeCode(text)): string {
  // No terminal, um comando sai como foi dito: o `tidyPunctuation` e as muletas quebravam "git add ." e "cd ../src"
  // (T913, regressão do T684). Só os espaços repetidos saem.
  if (code) return asCommand(text.replace(/\s+/g, " "));
  let out = spokenCommands(text);
  out = selfCorrections(out);
  out = removeFillers(out);
  out = removeStutter(out);
  out = tidyPunctuation(out);
  if (tone === "literal" && looksLikeCode(out)) return asCommand(out);
  if (tone !== "literal") out = lists(out);
  out = tidyPunctuation(out);
  out = capitalize(out);
  return out;
}

/** O que só pode rodar depois de voltar os termos do dicionário (precisa ver o fim real do texto). */
export function finishRules(text: string, raw: string, tone: Tone): string {
  if (tone === "literal" && looksLikeCode(text)) return asCommand(text);
  let out = finalPunctuation(text, raw);
  if (tone === "casual") out = casualEnding(out);
  return out;
}
