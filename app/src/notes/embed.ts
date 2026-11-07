// Embutir uma nota em outra (T6594, E15, issue 191), como o Obsidian: `![[nota]]` traz a nota inteira, `![[nota#Título]]`
// a seção daquele título (até o próximo título do mesmo nível ou acima) e `![[nota#^id]]` o bloco marcado com `^id` no
// fim (o parágrafo ou o item de lista). O corte é no engine: a UI recebe o texto pronto. Ideia do SilverBullet
// (`syntax/inline_content.ts`, MIT).

import { headingFor, markdownStructure } from "../shared/markdown-structure.ts";

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** O `^id` no fim de uma linha, como o Obsidian escreve: letras, números e hífen. */
export const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;

export type EmbedKind = "note" | "heading" | "block";

export interface EmbedTarget {
  target: string;
  /** O título (`#Título`) ou o bloco (`#^id`), sem o `#`; vazio para a nota inteira. */
  fragment: string;
}

/** `![[nota#Título|apelido]]` → a nota e o pedaço. O apelido não muda o que é embutido. */
export function parseEmbed(link: string): EmbedTarget | null {
  const inner = link.trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0]!;
  const hash = inner.indexOf("#");
  const target = (hash === -1 ? inner : inner.slice(0, hash)).trim();
  const fragment = hash === -1 ? "" : inner.slice(hash + 1).trim();
  if (!target && !fragment) return null;
  return { target, fragment };
}

/** As linhas do bloco que tem a linha `n`: o item de lista sozinho, ou o parágrafo inteiro (as linhas não vazias). */
function blockAround(lines: readonly string[], n: number): [number, number] {
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[n]!)) return [n, n];
  let from = n;
  let to = n;
  while (from > 0 && lines[from - 1]!.trim() && !/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s/.test(lines[from - 1]!)) from--;
  while (to < lines.length - 1 && lines[to + 1]!.trim() && !/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s/.test(lines[to + 1]!)) to++;
  return [from, to];
}

/**
 * O pedaço da nota que o embed mostra, sem o frontmatter e sem as marcas `^id`. `null` quando o título ou o bloco não
 * existe (a UI diz isso no lugar do embed).
 */
export function embedContent(content: string, fragment: string): { kind: EmbedKind; content: string } | null {
  const clean = (text: string) => text.split("\n").map((l) => l.replace(BLOCK_ID, "")).join("\n").trim();
  if (!fragment) return { kind: "note", content: clean(content.replace(FRONTMATTER, "")) };
  if (fragment.startsWith("^")) {
    const id = fragment.slice(1);
    const lines = content.replace(FRONTMATTER, "").split("\n");
    const at = lines.findIndex((l) => BLOCK_ID.exec(l)?.[1] === id);
    if (at === -1) return null;
    const [from, to] = blockAround(lines, at);
    return { kind: "block", content: clean(lines.slice(from, to + 1).join("\n")) };
  }
  const headings = markdownStructure(content).headings;
  const heading = headingFor(headings, fragment);
  if (!heading) return null;
  const next = headings.find((h) => h.from > heading.from && h.level <= heading.level);
  return { kind: "heading", content: clean(content.slice(heading.from, next ? next.from : content.length)) };
}
