// O começo fixo do pedido ao agente (specs #11102, #11084, #11469 e #12137): o Modelo de nota, a memória, as instruções
// da pessoa, o glossário do ditado e as instruções do modo econômico, sempre nesta ordem e com os mesmos bytes para os
// mesmos ajustes (o cache do agente). Uma função pura: o service monta o pedido com ela, e a bateria de tokens
// (app/test/tokens/) mede exatamente o que vai.

import { glossaryText, instructionsText, memoryText } from "./memory.ts";
import { type NoteModel, noteModelText } from "./note-model.ts";

/**
 * As instruções do modo econômico (spec #11084), no começo do pedido: sempre os mesmos bytes, na mesma ordem, para o
 * cache do agente reaproveitar. Nada da pessoa vai aqui.
 */
export const ECONOMY_INSTRUCTIONS =
  "[Modo econômico do Kiwi: responda curto e direto, em poucas linhas. Leia as notas por seção (notes_outline e section), não inteiras.]\n\n";

export interface FixedPrefixInput {
  /** O Modelo de nota, ou null sem ele (um erro ao ler o modelo não derruba o pedido). */
  model: NoteModel | null;
  /** Os fatos da memória do agente. */
  facts: readonly string[];
  /** As instruções da pessoa (Ajustes › Agente). */
  instructions: string;
  /** Os termos do dicionário do ditado. */
  terms: readonly string[];
  economy: boolean;
  /** O texto do pedido: no modo econômico, o glossário vai só com os termos que aparecem nele. */
  request: string;
}

/**
 * O começo fixo. No modo econômico o glossário muda a cada pedido (só os termos dele): ele vai por último, depois das
 * instruções do econômico, para o cache pegar tudo antes dele (revisão do T11667).
 */
export function fixedPrefix(o: FixedPrefixInput): string {
  const p = prefixParts(o);
  return p.stable + p.perRequest;
}

/**
 * O começo fixo em duas partes (spec #13379): `stable`, o que é igual entre os pedidos com os mesmos ajustes, e
 * `perRequest`, o glossário só com os termos do pedido (no modo econômico; fora dele, vazio). A sessão do agente é
 * retomada entre um pedido e outro, então o `stable` só precisa ir quando muda: cada cópia dele ficava no histórico.
 */
export function prefixParts(o: FixedPrefixInput): { stable: string; perRequest: string } {
  const stable =
    (o.model ? noteModelText(o.model) : "") +
    memoryText(o.facts) +
    instructionsText(o.instructions) +
    (o.economy ? ECONOMY_INSTRUCTIONS : glossaryText(o.terms));
  return { stable, perRequest: o.economy ? glossaryText(o.terms, o.request) : "" };
}

/**
 * De quantos em quantos pedidos na mesma sessão o começo fixo vai de novo, mesmo sem mudar (spec #13379): o agente
 * resume a conversa quando ela fica longa, e o começo fixo pode sair do resumo.
 */
export const PREFIX_RESEND_EVERY = 8;
