// As referências de uma nota (spec #11908, T11987): o agente pesquisa a documentação na web e manda os itens (o título,
// o link, uma linha e a data) pela ferramenta `notes_add_references`; o Kiwi monta a seção "Referências" no fim da nota,
// uma linha por item, sem repetir um link que a nota já tem. Nada é escrito antes do [Aplicar] da pessoa: a proposta é a
// mesma do #8360 (`kind: "references"`).

import { markdownStructure } from "../shared/markdown-structure.ts";

export const REFERENCES_TITLE = "Referências";
/** Quantos itens uma proposta leva, no máximo. */
export const REFERENCES_MAX = 30;

export interface ReferenceItem {
  title: string;
  /** Só http(s): a ferramenta recusa outro. */
  url: string;
  summary: string;
  /** `AAAA-MM-DD`, o dia em que o agente abriu a página. */
  date?: string;
}

/** Os parênteses de um endereço, codificados: no Markdown, um `(` ou `)` cru no link o quebra (revisão do T11986). */
const encodeParens = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29");

/** O link, para comparar: sem o `#…`, sem a barra do fim, o host sem maiúsculas e os parênteses codificados. */
export function linkKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return encodeParens(`${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`);
  } catch {
    return encodeParens(url.trim());
  }
}

/** Um link achado no texto, sem o que é pontuação ou o `)` do Markdown em volta: os parênteses só em par. */
function trimLink(raw: string): string {
  let s = raw.replace(/[.,;:!?]+$/, "");
  const count = (c: string) => s.split(c).length - 1;
  while (s.endsWith(")") && count(")") > count("(")) s = s.slice(0, -1).replace(/[.,;:!?]+$/, "");
  return s;
}

/** Os links http(s) que a nota já tem (em `[texto](link)`, `<link>` ou soltos), pelo `linkKey`. */
export function linksIn(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(/https?:\/\/[^\s<>\]"']+/gi)) out.add(linkKey(trimLink(m[0])));
  return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** O título num link do Markdown: sem os colchetes que o quebrariam. */
const linkText = (s: string) => oneLine(s).replace(/[[\]]/g, "") || "link";
const dayOf = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

/** A linha de um item: `- [Título](link): a linha (dd/mm/aaaa)`. */
export function referenceLine(i: ReferenceItem): string {
  const url = encodeParens(i.url).replace(/ /g, "%20");
  const summary = oneLine(i.summary);
  return `- [${linkText(i.title)}](${url})${summary ? `: ${summary}` : ""}${i.date ? ` (${dayOf(i.date)})` : ""}`;
}

/**
 * A nota com as referências novas: as que a nota ainda não tem entram no fim da seção "Referências" (que o Kiwi cria no
 * fim da nota, se ela não existe). `added` são as que entraram; sem nenhuma nova, a nota volta igual.
 */
export function noteWithReferences(
  content: string,
  items: readonly ReferenceItem[],
): { content: string; added: ReferenceItem[]; lines: string[]; /** A seção foi criada agora (a nota não tinha). */ created: boolean } {
  const known = linksIn(content);
  const added: ReferenceItem[] = [];
  for (const i of items) {
    const k = linkKey(i.url);
    if (known.has(k)) continue;
    known.add(k);
    added.push(i);
  }
  if (!added.length) return { content, added, lines: [], created: false };
  const lines = added.map(referenceLine);
  const headings = markdownStructure(content).headings;
  const h = headings.find((x) => x.level === 2 && x.title.trim().toLowerCase() === REFERENCES_TITLE.toLowerCase());
  if (h) {
    const next = headings.find((x) => x.from > h.from && x.level <= 2);
    const end = next ? next.from : content.length;
    const body = content.slice(0, end).replace(/\s+$/, "");
    const after = content.slice(end);
    // A linha em branco depois do título, numa seção vazia; senão, logo abaixo do último item.
    const sep = body.endsWith(`## ${h.title}`) || /\n##\s[^\n]*$/.test(body) ? "\n\n" : "\n";
    return { content: `${body}${sep}${lines.join("\n")}\n${after ? `\n${after.replace(/^\n+/, "")}` : ""}`, added, lines, created: false };
  }
  const base = content.replace(/\s+$/, "");
  return { content: `${base ? `${base}\n\n` : ""}## ${REFERENCES_TITLE}\n\n${lines.join("\n")}\n`, added, lines, created: true };
}
