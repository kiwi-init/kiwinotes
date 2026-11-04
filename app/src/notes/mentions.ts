// "Mencionada sem link" (T2593, como no Obsidian): onde o texto de uma nota cita o título de outra sem `[[ ]]`. Sem
// acento nem maiúscula, palavra inteira, e nunca dentro de um link, de um link Markdown, de código ou do frontmatter.

import { fold, foldWithMap } from "../store/text.ts";

/** Um trecho do texto original, `[start, end)`. */
export interface Span {
  start: number;
  end: number;
}

/** Um título curto demais (uma letra, "Ok") viraria ruído: só a partir daqui. */
export const MIN_MENTION = 3;

const MASKS = [
  /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/g, // o frontmatter
  /```[\s\S]*?(?:```|$)/g, // bloco de código
  /`[^`\n]*`/g, // código na linha
  /!?\[\[[^\]\n]*\]\]/g, // [[link]] e ![[embed]]
  /!?\[[^\]\n]*\]\([^)\n]*\)/g, // [texto](url)
  /<[^>\n]+>/g, // HTML e <url>
  /https?:\/\/\S+/g, // url solta
];

/** O texto com o que não conta trocado por espaços do mesmo tamanho: os índices continuam valendo no original. */
function masked(content: string): string {
  let out = content;
  for (const re of MASKS) out = out.replace(re, (m) => " ".repeat(m.length));
  return out;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** Os trechos de `content` que citam `title` sem link. */
export function unlinkedSpans(content: string, title: string): Span[] {
  const want = fold(title.trim());
  if (want.length < MIN_MENTION) return [];
  const { folded, map } = foldWithMap(masked(content));
  const out: Span[] = [];
  for (let at = folded.indexOf(want); at >= 0; at = folded.indexOf(want, at + want.length)) {
    if (isWordChar(folded[at - 1]) || isWordChar(folded[at + want.length])) continue;
    out.push({ start: map[at]!, end: map[at + want.length]! });
  }
  return out;
}

/** A linha em volta de um trecho, curta, para o painel. */
export function contextOf(content: string, span: Span): string {
  const from = content.lastIndexOf("\n", span.start - 1) + 1;
  const to = content.indexOf("\n", span.end);
  const line = content.slice(from, to < 0 ? content.length : to).trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/**
 * Troca os trechos por `[[alvo]]`, ou `[[alvo|texto]]` quando o texto escrito difere do alvo (outra maiúscula, sem
 * acento), para a frase continuar como estava.
 */
export function linkSpans(content: string, spans: readonly Span[], target: string): string {
  let out = content;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    const text = out.slice(s.start, s.end);
    out = `${out.slice(0, s.start)}[[${text === target ? target : `${target}|${text}`}]]${out.slice(s.end)}`;
  }
  return out;
}
