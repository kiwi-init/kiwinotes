// Os callouts do Obsidian (T6383, E8, issue 184): os 13 tipos com os títulos em PT, o `+`/`-` que recolhe e trocar o
// tipo pelo menu. Sem DOM: o desenho fica em `renderedWidget.tsx`, e o ícone de cada tipo em `calloutIcons.tsx`. Referência de comportamento: Obsidian e SilverBullet
// `codemirror/syntax/admonition.ts` (MIT), só como ideia.

export type CalloutTone = "accent" | "danger" | "neutral";

export interface CalloutKind {
  id: string;
  /** O título quando a nota não escreve um. */
  title: string;
  tone: CalloutTone;
}

export const CALLOUT_KINDS: readonly CalloutKind[] = [
  { id: "note", title: "Nota", tone: "accent" },
  { id: "abstract", title: "Resumo", tone: "accent" },
  { id: "info", title: "Info", tone: "accent" },
  { id: "todo", title: "A fazer", tone: "accent" },
  { id: "tip", title: "Dica", tone: "accent" },
  { id: "success", title: "Sucesso", tone: "accent" },
  { id: "question", title: "Pergunta", tone: "neutral" },
  { id: "warning", title: "Atenção", tone: "danger" },
  { id: "failure", title: "Falha", tone: "danger" },
  { id: "danger", title: "Perigo", tone: "danger" },
  { id: "bug", title: "Bug", tone: "danger" },
  { id: "example", title: "Exemplo", tone: "neutral" },
  { id: "quote", title: "Citação", tone: "neutral" },
];

/** Os outros nomes que o Obsidian aceita, no tipo deles. */
const ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const BY_ID = new Map(CALLOUT_KINDS.map((k) => [k.id, k]));

/** O tipo de um nome escrito na nota. Como no Obsidian, um nome desconhecido desenha como nota. */
export function calloutKind(name: string): CalloutKind {
  const id = name.toLowerCase();
  return BY_ID.get(ALIASES[id] ?? id) ?? BY_ID.get("note")!;
}

export interface Callout {
  kind: CalloutKind;
  /** O nome como está escrito (`TIP`, `faq`, `meu-tipo`). */
  name: string;
  /** O título escrito depois do `]`, ou o título em PT do tipo. */
  title: string;
  custom: boolean;
  /** `+` aberto, `-` recolhido; sem marca, não recolhe. */
  fold: "+" | "-" | null;
  /** Onde o nome está no texto do bloco (para trocar o tipo). */
  nameFrom: number;
  nameTo: number;
  /** As linhas de baixo, sem o `>` do começo. */
  body: string;
}

const HEAD = /^(\s*>\s?)\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;

/** O callout que o bloco (uma citação) é, ou `null`. */
export function parseCallout(source: string): Callout | null {
  const lines = source.split("\n");
  const m = HEAD.exec(lines[0] ?? "");
  if (!m) return null;
  const kind = calloutKind(m[2]!);
  const title = m[4]!.trim();
  const nameFrom = m[1]!.length + 2;
  const body = lines
    .slice(1)
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n");
  return {
    kind,
    name: m[2]!,
    title: title || (BY_ID.has(m[2]!.toLowerCase()) || ALIASES[m[2]!.toLowerCase()] ? kind.title : capitalize(m[2]!)),
    custom: !!title,
    fold: m[3] === "+" || m[3] === "-" ? m[3] : null,
    nameFrom,
    nameTo: nameFrom + m[2]!.length,
    body,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * O callout em volta da posição `pos` do documento: sobe pelas linhas de citação até a primeira e confere se ela abre
 * um callout. Devolve onde está o nome do tipo no documento.
 */
export function calloutAt(doc: string, pos: number): { kind: CalloutKind; from: number; to: number } | null {
  const lineAt = (start: number) => {
    const end = doc.indexOf("\n", start);
    return doc.slice(start, end === -1 ? doc.length : end);
  };
  let start = doc.lastIndexOf("\n", pos - 1) + 1;
  if (!/^\s*>/.test(lineAt(start))) return null;
  while (!HEAD.test(lineAt(start)) && start > 0) {
    const prev = start >= 2 ? doc.lastIndexOf("\n", start - 2) + 1 : 0;
    if (prev >= start || !/^\s*>/.test(lineAt(prev))) break;
    start = prev;
  }
  const head = parseCallout(lineAt(start));
  if (!head) return null;
  return { kind: head.kind, from: start + head.nameFrom, to: start + head.nameTo };
}
