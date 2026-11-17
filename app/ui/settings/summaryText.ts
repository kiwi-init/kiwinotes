// Os textos do resumo executivo em Ajustes › Agente (spec #11546), na parte das reuniões: os 6 blocos e o período do
// primeiro resumo. Só texto, para testar sem a tela.

import type { SummaryBlock, SummarySettings } from "../../src/shared/summary-settings.ts";

export const SUMMARY_SETTINGS_TITLE = "Resumo executivo do projeto";
export const SUMMARY_SETTINGS_HINT =
  'Quando você pede "resumo executivo do <projeto>", o agente prepara o resumo no topo da nota principal do projeto, no lugar do anterior (que fica nas Versões). Nada é escrito antes do [Aplicar].';

export const SUMMARY_BLOCK_LABELS: { key: SummaryBlock; label: string }[] = [
  { key: "situacao", label: "Situação" },
  { key: "andou", label: "O que andou" },
  { key: "decisoes", label: "Decisões" },
  { key: "riscos", label: "Riscos e bloqueios" },
  { key: "proximos", label: "Próximos passos" },
  { key: "reunioes", label: "Reuniões recentes" },
];

export const FIRST_DAYS_OPTIONS: { value: "7" | "14" | "30"; label: string }[] = [
  { value: "7", label: "7 dias" },
  { value: "14", label: "14 dias" },
  { value: "30", label: "30 dias" },
];

export function firstDaysHint(days: SummarySettings["firstDays"]): string {
  return `Sem um resumo anterior, "O que andou" conta os últimos ${days} dias. Depois, conta desde o último resumo.`;
}

export function summaryBlocksHint(blocks: SummarySettings["blocks"]): string {
  const on = SUMMARY_BLOCK_LABELS.filter((b) => blocks[b.key]).map((b) => b.label);
  if (!on.length) return "Nenhum bloco ligado: o resumo sai vazio. Ligue ao menos um.";
  if (on.length === SUMMARY_BLOCK_LABELS.length) return "Os 6 blocos, nesta ordem.";
  const list = on.length === 1 ? on[0]! : `${on.slice(0, -1).join(", ")} e ${on.at(-1)}`;
  return `O resumo leva ${list}, nesta ordem.`;
}
