// Os Ajustes do resumo executivo (spec #11546): os 6 blocos, cada um liga e desliga, e o período do primeiro resumo.
// Ficam no `shared`: o `store/settings.ts` guarda, o agente monta, e a tela mostra.

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

