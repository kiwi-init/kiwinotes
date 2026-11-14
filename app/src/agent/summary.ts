// O resumo executivo de um projeto (spec #11546, T11559): o agente manda os campos pela ferramenta
// `project_summary_propose`, e o Kiwi monta a seção "Resumo executivo" num formato fixo, no topo da nota principal do
// projeto. Nada é escrito antes do [Aplicar] da pessoa; a proposta é a mesma do #8360 (`kind: "summary"`).
//
// - **O formato fixo,** nesta ordem: a situação (um sinal e a data), o que andou, as decisões (com a data e a fonte),
//   os riscos e bloqueios, os próximos passos (quem e quando, com a fonte) e as reuniões recentes. Só os blocos ligados
//   em Ajustes entram.
// - **O agente não inventa:** cada decisão e cada próximo passo leva o link da nota ou da reunião de onde veio. Sem
//   fonte, o item não entra (a ferramenta já o tira).
// - **Um resumo novo substitui o anterior,** que continua nas Versões da nota (o snapshot do [Aplicar]).

import { markdownStructure, type NoteHeading } from "../shared/markdown-structure.ts";
import { linkSafeName } from "../shared/wikilinks.ts";

export const SUMMARY_BLOCKS = ["situacao", "andou", "decisoes", "riscos", "proximos", "reunioes"] as const;
export type SummaryBlock = (typeof SUMMARY_BLOCKS)[number];

export interface SummarySettings {
  /** Cada bloco liga e desliga (Ajustes › Agente, na parte das reuniões). */
  blocks: Record<SummaryBlock, boolean>;
  /** O período do primeiro resumo, sem um anterior: 7, 14 ou 30 dias. */
  firstDays: 7 | 14 | 30;
}

export const DEFAULT_SUMMARY_SETTINGS: SummarySettings = {
  blocks: { situacao: true, andou: true, decisoes: true, riscos: true, proximos: true, reunioes: true },
  firstDays: 14,
};

export function sanitizeSummarySettings(input: unknown): SummarySettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const b = (o.blocks && typeof o.blocks === "object" ? o.blocks : {}) as Record<string, unknown>;
  const blocks = Object.fromEntries(SUMMARY_BLOCKS.map((k) => [k, b[k] !== false])) as Record<SummaryBlock, boolean>;
  const firstDays = o.firstDays === 7 || o.firstDays === 30 ? o.firstDays : 14;
  return { blocks, firstDays };
}

export type SummarySignal = "verde" | "amarelo" | "vermelho";

/** Um item com a fonte: o caminho da nota ou da reunião de onde ele veio. */
export interface Sourced {
  text: string;
  source: string;
}

/** O que o agente mandou: só campos, sem texto pronto. */
export interface SummaryFields {
  signal: SummarySignal;
  /** Uma linha sobre a situação, depois do sinal (opcional). */
  status?: string;
  progress: Sourced[];
  decisions: (Sourced & { date?: string })[];
  risks: { text: string; source?: string }[];
  nextSteps: (Sourced & { who?: string; when?: string })[];
  /** As reuniões recentes do projeto: o caminho, o título e o dia. */
  meetings: { path: string; title: string; date: string }[];
  /** Desde quando "o que andou" conta (`AAAA-MM-DD`). */
  since: string;
}

export const SUMMARY_TITLE = "Resumo executivo";
const SIGNAL: Record<SummarySignal, string> = { verde: "🟢 No rumo", amarelo: "🟡 Atenção", vermelho: "🔴 Travado" };

const noMd = (p: string) => p.replace(/\.md$/i, "");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** `13/11/2026` a partir de `2026-11-13`. */
export const dayOf = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
};
const link = (path: string) => `[[${noMd(path)}|${linkSafeName(noMd(path).split("/").at(-1) ?? path) || "fonte"}]]`;

/** A seção "Resumo executivo", com os blocos ligados na ordem fixa. `today` é o dia local, `AAAA-MM-DD`. */
export function summarySection(f: SummaryFields, s: SummarySettings, today: string): string {
  const b = s.blocks;
  const parts: string[] = [`## ${SUMMARY_TITLE}`];
  if (b.situacao) parts.push(`**Situação:** ${SIGNAL[f.signal]} · ${dayOf(today)}${f.status ? ` · ${oneLine(f.status)}` : ""}`);
  const list = (title: string, lines: string[]) => {
    if (lines.length) parts.push(`### ${title}\n\n${lines.join("\n")}`);
  };
  if (b.andou) list(`O que andou desde ${dayOf(f.since)}`, f.progress.map((p) => `- ${oneLine(p.text)} (${link(p.source)})`));
  if (b.decisoes) list("Decisões", f.decisions.map((d) => `- ${oneLine(d.text)}${d.date ? ` (${dayOf(d.date)}, ${link(d.source)})` : ` (${link(d.source)})`}`));
  if (b.riscos) list("Riscos e bloqueios", f.risks.map((r) => `- ${oneLine(r.text)}${r.source ? ` (${link(r.source)})` : ""}`));
  if (b.proximos)
    list(
      "Próximos passos",
      f.nextSteps.map((n) => {
        const who = [n.who && oneLine(n.who), n.when && oneLine(n.when)].filter(Boolean).join(", ");
        return `- [ ] ${oneLine(n.text)}${who ? ` (${who})` : ""} · ${link(n.source)}`;
      }),
    );
  if (b.reunioes) list("Reuniões recentes", f.meetings.map((m) => `- ${dayOf(m.date)} · [[${noMd(m.path)}|${linkSafeName(oneLine(m.title)) || "Reunião"}]]`));
  return `${parts.join("\n\n")}\n`;
}

/** A seção "Resumo executivo" que a nota já tem: onde começa e onde acaba (até o próximo título de nível ≤ 2). */
function existingSection(content: string, headings: NoteHeading[]): { from: number; to: number } | null {
  const h = headings.find((x) => x.level === 2 && x.title.trim().toLowerCase() === SUMMARY_TITLE.toLowerCase());
  if (!h) return null;
  const next = headings.find((x) => x.from > h.from && x.level <= 2);
  return { from: h.from, to: next ? next.from : content.length };
}

/** Onde o topo da nota começa: depois do frontmatter e do título (`# …`) do começo, se houver. */
function topOf(content: string, headings: NoteHeading[]): number {
  let at = 0;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(content);
  if (fm) at = fm[0].length;
  const h1 = headings.find((x) => x.level === 1 && x.from >= at);
  if (h1 && content.slice(at, h1.from).trim() === "") {
    const end = content.indexOf("\n", h1.from);
    at = end < 0 ? content.length : end + 1;
  }
  return at;
}

/**
 * A nota principal com o resumo: a seção que já existe é trocada (o anterior fica nas Versões); sem ela, a seção entra
 * no topo, depois do frontmatter e do título. O resto da nota não muda.
 */
export function mainNoteWithSummary(content: string, section: string): string {
  const headings = markdownStructure(content).headings;
  const old = existingSection(content, headings);
  if (old) {
    const before = content.slice(0, old.from);
    const after = content.slice(old.to);
    return `${before}${section}${after ? `\n${after.replace(/^\n+/, "")}` : ""}`;
  }
  const at = topOf(content, headings);
  const before = content.slice(0, at);
  const after = content.slice(at).replace(/^\n+/, "");
  return `${before}${before && !before.endsWith("\n\n") ? "\n" : ""}${section}${after ? `\n${after}` : ""}`;
}

/** O dia do último resumo, pela linha "Situação" da seção; null sem resumo. */
export function lastSummaryDate(content: string): string | null {
  const headings = markdownStructure(content).headings;
  const old = existingSection(content, headings);
  if (!old) return null;
  const m = /\*\*Situação:\*\*[^\n]*?(\d{2})\/(\d{2})\/(\d{4})/.exec(content.slice(old.from, old.to));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Desde quando "o que andou" conta: o último resumo, ou hoje menos o período do primeiro. */
export function summarySince(content: string | null, s: SummarySettings, today: Date): string {
  const last = content ? lastSummaryDate(content) : null;
  if (last) return last;
  const d = new Date(today.getTime() - s.firstDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
