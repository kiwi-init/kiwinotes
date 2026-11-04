// Pequenas ajudas do editor (T2469): colar um link sobre um texto selecionado e a contagem de palavras.

import { externalUrl } from "../links.ts";

/**
 * Colar um link com um texto selecionado vira `[texto](url)`, como no Notion e no Obsidian. Só com um link que pode
 * abrir fora (http, https, mailto: o `externalUrl`) e com uma seleção de uma linha só. Senão, `null`: cola como sempre.
 */
export function linkFromPaste(selected: string, pasted: string): string | null {
  const text = selected.trim();
  const url = externalUrl(pasted.trim());
  if (!text || !url || /\n/.test(selected) || /^\s*\S+:\/\//.test(text)) return null;
  // O que fecharia o link antes da hora vai escapado.
  const label = text.replace(/([\[\]])/g, "\\$1");
  // O encodeURIComponent não troca "(" nem ")", e um ")" no endereço fecharia o link.
  return `[${label}](${url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

/**
 * As palavras do texto da nota, sem a marcação: frontmatter, blocos de código, `#`, `>`, marcadores de lista e de tarefa,
 * ênfase, o endereço dos links (fica o texto) e os `[[…]]` (fica o nome ou o apelido). Uma palavra com hífen conta uma.
 */
export function wordCount(markdown: string): number {
  const text = markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/%%[\s\S]*?%%/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => ` ${a || t} `)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/^\s*(?:#+|>|[-*+](?:\s+\[[ xX]\])?|\d+\.)\s+/gm, " ")
    .replace(/[*_~`|]/g, " ");
  return (text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []).length;
}

const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;

/** Uma troca de recuo numa linha: tirar `remove` espaços do começo e pôr `add`. */
export interface IndentChange {
  line: number;
  remove: number;
  add: number;
}

/**
 * Tab (`dir` 1) e ⇧Tab (-1) num item de lista: o item (com os filhos e as linhas de continuação) desce um nível, para
 * a coluna do texto do item de cima, ou sobe para o recuo do pai. É o recuo que o CommonMark entende como filho: 2 para
 * `- `, 3 para `1. `. `lines` é a nota inteira e `first`/`last` as linhas da seleção (base 0). `null` quando a seleção
 * não é lista (o Tab segue como sempre); `[]` quando é lista mas não dá para mudar (o primeiro item não vira filho).
 */
export function listIndent(lines: string[], first: number, last: number, dir: 1 | -1): IndentChange[] | null {
  const head = LIST_ITEM.exec(lines[first] ?? "");
  if (!head || lines.slice(first, last + 1).some((l) => /^ *\t/.test(l))) return null;
  for (let i = first; i <= last; i++) if (lines[i]!.trim() && !LIST_ITEM.test(lines[i]!) && indentOf(lines[i]!) <= head[1]!.length) return null;
  const w = head[1]!.length;
  // Os filhos vão junto: as linhas logo abaixo, mais recuadas que o item.
  let end = last;
  while (end + 1 < lines.length && lines[end + 1]!.trim() && indentOf(lines[end + 1]!) > w) end++;

  // O item de cima no mesmo bloco de lista, com recuo menor ou igual.
  let above: RegExpExecArray | null = null;
  let parent: RegExpExecArray | null = null;
  for (let i = first - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    const m = LIST_ITEM.exec(l);
    if (!m) {
      if (indentOf(l) === 0) break; // um parágrafo fora da lista: o bloco acabou
      continue; // continuação de um item
    }
    const iw = m[1]!.length;
    if (!above && iw <= w) above = m;
    if (iw < w) {
      parent = m;
      break;
    }
  }

  let delta: number;
  if (dir === 1) {
    if (!above || above[1]!.length < w) return []; // já é o primeiro filho, ou o primeiro item da lista
    delta = above[0].length - w;
  } else {
    if (w === 0) return [];
    delta = -(w - (parent ? parent[1]!.length : 0));
  }
  const changes: IndentChange[] = [];
  for (let i = first; i <= end; i++) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    changes.push(delta > 0 ? { line: i, remove: 0, add: delta } : { line: i, remove: Math.min(-delta, indentOf(l)), add: 0 });
  }
  return changes;
}

const indentOf = (line: string) => /^ */.exec(line)![0].length;
