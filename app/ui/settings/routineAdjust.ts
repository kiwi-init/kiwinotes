// O [Ajustar] de uma rotina que o agente propôs (spec #12944): o balão do gato (ou a Atividade) pede, e a parte Rotinas
// de Ajustes abre o cartão com os campos da proposta. O pedido fica guardado até alguém pegar: Ajustes › Agente pode
// ainda não estar montado quando o balão pede.

import type { CustomRoutineInput } from "../../src/shared/ui-contract.ts";

export interface AdjustRequest {
  /** A proposta: salvar o cartão é o [Criar] dela, com os campos do cartão. */
  proposal: string;
  routine: CustomRoutineInput;
}

let pending: AdjustRequest | null = null;
const listeners = new Set<(r: AdjustRequest) => void>();

/** Pede o cartão de uma proposta. Quem estiver ouvindo pega na hora; senão, o próximo que ouvir. */
export function requestAdjust(r: AdjustRequest): void {
  pending = r;
  for (const fn of listeners) fn(r);
}

/** Ouve os pedidos; pega o que já estava esperando. Devolve o desligar. */
export function onAdjust(fn: (r: AdjustRequest) => void): () => void {
  listeners.add(fn);
  if (pending) fn(pending);
  return () => listeners.delete(fn);
}

/** O pedido foi atendido (o cartão abriu): não abre de novo na próxima montagem. */
export function adjustTaken(proposal: string): void {
  if (pending?.proposal === proposal) pending = null;
}
