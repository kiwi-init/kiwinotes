// Os textos da proposta da reunião (spec #8360, T11293), no balão do gato e na Atividade do agente. Puros: o que a
// tela mostra para cada estado da proposta.

import type { AgentProposalSummary } from "../../src/shared/ui-contract.ts";
import { collapse, type DiffLine } from "../notes/diff.ts";

export const PROPOSAL_VIEW = "Ver a proposta";
export const PROPOSAL_HIDE = "Fechar a proposta";
export const PROPOSAL_APPLY = "Aplicar";
export const PROPOSAL_DISCARD = "Descartar";
export const PROPOSAL_PREPARE = "Preparar";
export const PROPOSAL_NOT_NOW = "Agora não";
export const PROPOSAL_NONE = "Nenhum: só a nota da reunião";
export const PROPOSAL_UNDO = "Desfazer";
export const PROPOSAL_LATER = "Depois";
export const PROPOSALS_TITLE = "Propostas das reuniões";
export const PROPOSALS_HINT = "Nada é escrito antes do [Aplicar]. Uma proposta fica aqui até você aplicar ou descartar, por 30 dias.";

/** As propostas que esperam a pessoa (a pergunta do modo econômico ou a proposta pronta), da mais nova para a mais velha. */
export function openProposals(list: readonly AgentProposalSummary[]): AgentProposalSummary[] {
  return list.filter((p) => p.status === "offer" || p.status === "pending").sort((a, b) => b.at.localeCompare(a.at));
}

/** Onde a nota vai: "em Migração", "em Atas", ou "na pasta principal". */
export function whereLine(p: AgentProposalSummary): string {
  if (p.project && p.note.folder === p.project.folder) return `em ${p.project.name}`;
  return p.note.folder ? `em ${p.note.folder}` : "na pasta principal";
}

/** A junção dos nomes da pergunta ("É do A, do B ou do C?"): ", do " entre os do meio e " ou do " antes do último. */
export const choiceJoin = (i: number, total: number) => (i === 0 ? "" : i === total - 1 ? " ou do " : ", do ");

/** A frase principal da proposta, pelo estado. A pergunta com os projetos, a tela monta com o `choiceJoin`. */
export function proposalLine(p: AgentProposalSummary): string {
  const meeting = `"${p.meeting.title}"`;
  switch (p.status) {
    case "offer":
      return `A reunião ${meeting} terminou. Quer a proposta da nota do projeto? Ela gasta um pedido do seu plano.`;
    case "pending":
      if (!p.project && p.candidates.length) return `A proposta da reunião ${meeting} está pronta.`;
      return `A proposta da reunião ${meeting} está pronta: a nota "${p.note.title}" ${whereLine(p)}${p.project ? ", e a reunião na nota principal" : ""}.`;
    case "applied":
      return `Pronto: a nota "${p.note.title}" está ${whereLine(p)}.`;
    case "discarded":
      return `A proposta da reunião ${meeting} foi descartada.`;
  }
}

/** A diferença na nota principal, com 2 linhas em volta de cada mudança e o resto recolhido. */
export function mainDiff(lines: readonly { text: string; added: boolean }[]): (DiffLine | { kind: "gap"; count: number })[] {
  // A última quebra de linha da nota não vira uma linha vazia no fim.
  const shown = lines.length && lines.at(-1)!.text === "" ? lines.slice(0, -1) : lines;
  return collapse(shown.map((l) => ({ kind: l.added ? ("add" as const) : ("same" as const), text: l.text })));
}
