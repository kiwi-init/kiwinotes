// O comando "/" (T2660, spec #2457 ponto 3): no começo da linha ou depois de um espaço, "/" abre um menu de blocos,
// como no Notion. Tudo vira Markdown puro. Teclado primeiro: ↑↓ escolhem, Enter insere, Esc fecha (o autocomplete do
// CodeMirror). A lógica do texto fica aqui, sem o editor, para os testes.

import { formatDate } from "../../../src/shared/templates.ts";

export interface SlashItem {
  id: string;
  label: string;
  /** Palavras que também acham o item ("h1", "todo"…). */
  words: string;
  detail: string;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Título", words: "titulo h1 cabecalho heading", detail: "#" },
  { id: "h2", label: "Subtítulo", words: "subtitulo h2 secao", detail: "##" },
  { id: "list", label: "Lista", words: "lista bullet topicos", detail: "-" },
  { id: "numbered", label: "Lista numerada", words: "numerada ordenada 1.", detail: "1." },
  { id: "todo", label: "Checklist", words: "checklist tarefa todo caixa", detail: "- [ ]" },
  { id: "table", label: "Tabela", words: "tabela table", detail: "| |" },
  { id: "code", label: "Código", words: "codigo code bloco", detail: "```" },
  { id: "quote", label: "Citação", words: "citacao quote", detail: ">" },
  { id: "callout", label: "Callout", words: "callout aviso nota destaque", detail: "> [!note]" },
  { id: "divider", label: "Divisor", words: "divisor linha separador hr", detail: "---" },
  { id: "link", label: "Link para nota", words: "link nota wikilink", detail: "[[ ]]" },
  { id: "template", label: "Modelo", words: "modelo template", detail: "…" },
  { id: "tomorrow", label: "Amanhã", words: "amanha tomorrow", detail: "AAAA-MM-DD" },
  { id: "yesterday", label: "Ontem", words: "ontem yesterday", detail: "AAAA-MM-DD" },
  { id: "today", label: "Data de hoje", words: "data hoje dia date", detail: "AAAA-MM-DD" },
];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");

/** Os itens que casam com o que veio depois da "/". */
export type SlashUsage = Record<string, number>;
/** Exact labels/aliases, then prefixes, then substrings; usage only breaks ties. */
export function slashMatches(typed: string, usage: SlashUsage = {}): SlashItem[] {
  const q = fold(typed.trim());
  const score = (it: SlashItem) => {
    const label = fold(it.label), words = [label, ...fold(it.words).split(/\s+/)];
    return !q || words.includes(q) ? 0 : words.some(w => w.startsWith(q)) ? 1 : words.some(w => w.includes(q)) ? 2 : 3;
  };
  return SLASH_ITEMS.map((it, index) => ({ it, index, rank: score(it) })).filter(x => x.rank < 3)
    .sort((a, b) => a.rank - b.rank || (usage[b.it.id] ?? 0) - (usage[a.it.id] ?? 0) || a.index - b.index).map(x => x.it);
}
const USAGE_KEY = "kn.slash.usage.v1";
export function readSlashUsage(): SlashUsage {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}"), usage: SlashUsage = {};
    for (const it of SLASH_ITEMS) if (Number.isSafeInteger(raw?.[it.id]) && raw[it.id] > 0) usage[it.id] = Math.min(raw[it.id], 1_000_000);
    return usage;
  } catch { return {}; }
}
export function recordSlashUse(id: string): void {
  if (!SLASH_ITEMS.some(it => it.id === id)) return;
  try { const usage = readSlashUsage(); usage[id] = Math.min((usage[id] ?? 0) + 1, 1_000_000); localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch { /* private/blocked storage */ }
}

/**
 * O que entra no lugar de "/palavra": o texto e onde o cursor fica (relativo ao começo do que entrou). No meio de uma
 * linha, um bloco começa numa linha nova; a data e o link entram ali mesmo. `null` para o "Modelo", que a janela abre.
 */
export function slashInsert(id: string, atLineStart: boolean, now: Date): { insert: string; cursor: number } | null {
  const block = (text: string, cursor = text.length) => {
    const nl = atLineStart ? "" : "\n";
    return { insert: nl + text, cursor: nl.length + cursor };
  };
  switch (id) {
    case "h1":
      return block("# ");
    case "h2":
      return block("## ");
    case "list":
      return block("- ");
    case "numbered":
      return block("1. ");
    case "todo":
      return block("- [ ] ");
    case "quote":
      return block("> ");
    case "callout":
      return block("> [!note]\n> ");
    case "divider":
      return block("---\n");
    case "code":
      return block("```\n\n```", 4);
    case "table": {
      const t = "| Coluna | Coluna |\n| --- | --- |\n|  |  |";
      return block(t, t.lastIndexOf("|  |") + 2);
    }
    case "link":
      return { insert: "[[]]", cursor: 2 };
    case "today":
    case "tomorrow":
    case "yesterday": {
      const date = new Date(now);
      date.setDate(date.getDate() + (id === "tomorrow" ? 1 : id === "yesterday" ? -1 : 0));
      const d = formatDate(date, "AAAA-MM-DD");
      return { insert: d, cursor: d.length };
    }
    default:
      return null;
  }
}

/** "/" logo antes do cursor, no começo da linha ou depois de um espaço: devolve o que foi digitado depois dela. */
export function slashTrigger(lineBefore: string): { typed: string; from: number; atLineStart: boolean } | null {
  const m = /(^|\s)\/([\p{L}\p{N}]*)$/u.exec(lineBefore);
  if (!m) return null;
  const from = m.index + m[1]!.length;
  return { typed: m[2]!, from, atLineStart: lineBefore.slice(0, from).trim() === "" };
}
