// O frontmatter YAML do topo da nota. O editor mostra só o corpo; o frontmatter volta intacto ao gravar, para a nota
// abrir no Obsidian sem perder nada (spec #1107). Só o que a UI mostra é lido: as tags.

export interface Split {
  /** O bloco `---\n…\n---\n` como estava, ou "". */
  frontmatter: string;
  body: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(content: string): Split {
  const m = BLOCK.exec(content);
  return m ? { frontmatter: m[0], body: content.slice(m[0].length) } : { frontmatter: "", body: content };
}

export const joinFrontmatter = ({ frontmatter, body }: Split) => frontmatter + body;

/** As tags do frontmatter (`tags: [a, b]` ou a lista com `- a`) e as `#tag` do corpo, sem repetir. */
export function tagsOf(content: string): string[] {
  const { frontmatter, body } = splitFrontmatter(content);
  const tags: string[] = [];
  const inline = /^tags:\s*\[(.*)\]\s*$/m.exec(frontmatter);
  if (inline) tags.push(...inline[1]!.split(","));
  // Só linhas "  - item": o `---` que fecha o bloco não é item.
  const list = /^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]+.+\r?\n?)+)/m.exec(frontmatter);
  if (list) tags.push(...list[1]!.split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, "")));
  const single = /^tags:[ \t]*([^\[\s].*)$/m.exec(frontmatter);
  if (single) tags.push(...single[1]!.split(/[,\s]+/));
  // `#tag` no corpo, fora de código e de títulos ("# Título" tem espaço depois do #).
  const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.push(m[1]!);
  const seen = new Set<string>();
  return tags
    .map((t) => t.trim().replace(/^["']|["']$/g, "").replace(/^#/, ""))
    .filter((t) => t && !seen.has(t) && seen.add(t));
}
