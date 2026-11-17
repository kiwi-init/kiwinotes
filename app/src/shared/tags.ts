// As tags das notas (T2619, spec #2457 ponto 3), na regra do Obsidian: `#tag` e `#tag/sub` no texto, e `tags:` no
// frontmatter. Uma tag tem pelo menos um caractere que não é número (`#2026` não é tag), não vive em código nem num
// link, e é a mesma tag sem diferença de maiúscula (`#Projeto` e `#projeto`). O engine e a janela usam as mesmas regras.

import { markdownStructure } from "./markdown-structure.ts";

/** Uma `#tag` no texto: depois do começo da linha, de um espaço ou de um "(". */
const BODY_TAG = /(?<=^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/** As `#tag` de uma linha, com onde começam e acabam (o `#` incluso), para o editor destacar (sem olhar código). */
export function tagsInLine(line: string): { from: number; to: number; tag: string }[] {
  const out: { from: number; to: number; tag: string }[] = [];
  for (const m of line.matchAll(BODY_TAG)) {
    const raw = m[1]!.replace(/\/+$/, "");
    const tag = cleanTag(raw);
    if (tag) out.push({ from: m.index!, to: m.index! + 1 + raw.length, tag });
  }
  return out;
}

/** A forma de uma tag que vale: sem barras nas pontas, com algo além de números. */
export function cleanTag(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  if (!t || !/[^\p{N}/]/u.test(t) || /\/\//.test(t) || t.length > 200) return null;
  return t;
}

/** A chave de comparação: sem diferença de maiúscula. */
export const tagKey = (t: string) => t.toLocaleLowerCase("pt-BR");

/** As `#tag` do corpo (sem o frontmatter), fora de blocos de código, de código na linha e de comentários `%%`. */
export function bodyTags(body: string): string[] {
  const context = markdownStructure(body);
  const out: string[] = [];
  for (const m of body.matchAll(BODY_TAG)) {
    if (!context.prose(m.index!)) continue;
    let node = context.tree.resolveInner(m.index!, 1), linked = false;
    for (; node; node = node.parent!) if (["URL", "Link", "Image"].includes(node.name)) { linked = true; break; }
    const t = cleanTag(m[1]!);
    if (t && !linked) out.push(t);
  }
  return out;
}

/** Junta as tags sem repetir (pela chave), na ordem em que apareceram. */
export function uniqueTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = cleanTag(raw);
    if (t && !seen.has(tagKey(t))) {
      seen.add(tagKey(t));
      out.push(t);
    }
  }
  return out;
}

/** A nota tem a tag (ou uma filha dela: `#projeto/kiwi` está em `projeto`). */
export function hasTag(noteTags: readonly string[], tag: string): boolean {
  const k = tagKey(tag);
  return noteTags.some((t) => {
    const nk = tagKey(t);
    return nk === k || nk.startsWith(`${k}/`);
  });
}

/** Um nó da árvore de tags (`notes.tags`): `count` é de notas, contando as das filhas uma vez só. */
export interface TagNode {
  /** A tag inteira, como apareceu primeiro (`projeto/kiwi`). */
  tag: string;
  /** O último pedaço (`kiwi`). */
  name: string;
  count: number;
  children: TagNode[];
}

/** A árvore das tags a partir das tags de cada nota, em ordem de nome. */
export function tagTree(notes: Iterable<readonly string[]>): TagNode[] {
  const nodes = new Map<string, TagNode & { notes: number }>();
  const roots: TagNode[] = [];
  let noteId = 0;
  const lastNote = new Map<string, number>();
  for (const tags of notes) {
    noteId++;
    for (const t of tags) {
      const parts = t.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const full = parts.slice(0, i).join("/");
        const key = tagKey(full);
        let node = nodes.get(key);
        if (!node) {
          node = { tag: full, name: parts[i - 1]!, count: 0, children: [], notes: 0 };
          nodes.set(key, node);
          if (i === 1) roots.push(node);
          else nodes.get(tagKey(parts.slice(0, i - 1).join("/")))!.children.push(node);
        }
        // Uma nota conta uma vez em cada nó, mesmo com `#a/b` e `#a/c`.
        if (lastNote.get(key) !== noteId) {
          lastNote.set(key, noteId);
          node.count++;
        }
      }
    }
  }
  const sort = (list: TagNode[]): TagNode[] =>
    list
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
      .map(({ tag, name, count, children }) => ({ tag, name, count, children: sort(children) }));
  return sort(roots);
}

/**
 * Tira os `tag:x` (ou `#x`) de uma busca: devolve as tags e o resto do texto. `tag:` sem nada é ignorado.
 */
export function splitTagQuery(query: string): { tags: string[]; text: string } {
  const tags: string[] = [];
  const rest: string[] = [];
  for (const word of query.split(/\s+/).filter(Boolean)) {
    const m = /^(?:tag:|#)(.+)$/i.exec(word);
    const t = m ? cleanTag(m[1]!) : null;
    if (t) tags.push(t);
    else if (!/^tag:$/i.test(word)) rest.push(word);
  }
  return { tags, text: rest.join(" ") };
}
