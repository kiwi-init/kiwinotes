// Os textos da proposta da reunião (spec #8360, T11293), no balão do gato e na Atividade do agente. Puros: o que a
// tela mostra para cada estado da proposta, pelo catálogo (`proposal.*`, T29272). Os botões, a tela lê direto do
// catálogo pelo `useT()`.

import type { TextKey } from "../../src/shared/i18n/index.ts";
import type { AgentProposalSummary } from "../../src/shared/ui-contract.ts";
import { collapse, type DiffLine } from "../notes/diff.ts";
import { t } from "../src/i18n.ts";
import { customScheduleMid } from "./routinesText.ts";

export const proposalsTitle = () => t("proposal.title");
export const proposalsHint = () => t("proposal.hint");

/** As propostas que esperam a pessoa (a pergunta do modo econômico ou a proposta pronta), da mais nova para a mais velha. */
export function openProposals(list: readonly AgentProposalSummary[]): AgentProposalSummary[] {
  return list.filter((p) => p.status === "offer" || p.status === "pending").sort((a, b) => b.at.localeCompare(a.at));
}

/** Onde a nota vai: "em Mudança", "em Atas", ou "na pasta principal". */
export function whereLine(p: AgentProposalSummary): string {
  const at = (name: string) => t("proposal.in", { name });
  if (!p.note) return p.project ? at(p.project.name) : t("proposal.mainFolder");
  if (p.project && p.note.folder === p.project.folder) return at(p.project.name);
  return p.note.folder ? at(p.note.folder) : t("proposal.mainFolder");
}

/** O sinal do resumo executivo (spec #11546), como a seção mostra. */
export const summarySignal = (s: "verde" | "amarelo" | "vermelho") => t(`proposal.signal.${s}` as TextKey);

/** A frase do resumo executivo, pelo estado. */
function summaryLine(p: AgentProposalSummary): string {
  const of = p.project ? t("proposal.of", { name: p.project.name }) : "";
  switch (p.status) {
    case "offer":
    case "pending":
      if (!p.project && p.candidates.length) return t("proposal.summary.readyChoose");
      return t("proposal.summary.ready", { of, signal: p.summary ? ` (${summarySignal(p.summary.signal)})` : "" });
    case "applied":
      return t("proposal.summary.applied", { of });
    case "discarded":
      return t("proposal.summary.discarded", { of });
  }
}

/** A frase das referências de uma nota (spec #11908), pelo estado. */
export function referencesLine(p: AgentProposalSummary): string {
  const note = p.references ? `“${p.references.note.replace(/\.md$/i, "").split("/").at(-1)}”` : t("proposal.refs.theNote");
  const links = t("proposal.refs.links", { n: p.references?.count ?? 0 });
  switch (p.status) {
    case "offer":
    case "pending":
      return t("proposal.refs.ready", { note, links });
    case "applied":
      return t("proposal.refs.applied", { note });
    case "discarded":
      return t("proposal.refs.discarded", { note });
  }
}

/** A frase da rotina que o agente propõe (spec #12944), pelo estado. */
export function routineProposalLine(p: AgentProposalSummary): string {
  const name = `“${p.routine?.name ?? p.theme}”`;
  switch (p.status) {
    case "offer":
    case "pending":
      return t("proposal.routine.ready", { name, when: p.routine ? customScheduleMid(p.routine) : "" });
    case "applied":
      return t("proposal.routine.applied", { name });
    case "discarded":
      return t("proposal.routine.discarded", { name });
  }
}

/** A junção dos nomes da pergunta ("É do A, do B ou do C?"): ", do " entre os do meio e " ou do " antes do último. */
export const choiceJoin = (i: number, total: number) => (i === 0 ? "" : i === total - 1 ? t("proposal.choose.or") : t("proposal.choose.comma"));

/** A frase principal da proposta, pelo estado. A pergunta com os projetos, a tela monta com o `choiceJoin`. */
export function proposalLine(p: AgentProposalSummary): string {
  if (p.kind === "references") return referencesLine(p);
  if (p.kind === "routine") return routineProposalLine(p);
  if (p.kind === "summary" || !p.meeting || !p.note) return summaryLine(p);
  // As aspas curvas (spec #12626): o texto do agente é uma frase, não código.
  const meeting = `“${p.meeting.title}”`;
  switch (p.status) {
    case "offer":
      return t("proposal.meeting.offer", { meeting });
    case "pending":
      if (!p.project && p.candidates.length) return t("proposal.meeting.readyChoose", { meeting });
      return t("proposal.meeting.ready", { meeting, note: p.note.title, where: whereLine(p), main: p.project ? t("proposal.meeting.main") : "" });
    case "applied":
      return t("proposal.meeting.applied", { note: p.note.title, where: whereLine(p) });
    case "discarded":
      return t("proposal.meeting.discarded", { meeting });
  }
}

/** A diferença na nota principal, com 2 linhas em volta de cada mudança e o resto recolhido. */
export function mainDiff(lines: readonly { text: string; added: boolean }[]): (DiffLine | { kind: "gap"; count: number })[] {
  // A última quebra de linha da nota não vira uma linha vazia no fim.
  const shown = lines.length && lines.at(-1)!.text === "" ? lines.slice(0, -1) : lines;
  return collapse(shown.map((l) => ({ kind: l.added ? ("add" as const) : ("same" as const), text: l.text })));
}
