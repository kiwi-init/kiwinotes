// A resposta que está chegando (spec #15454): a proposta espera por ela, e não só pela que já está na tela.
//
// O `talking` do KiwiCat vem do `onShown` do CatBubble, um efeito que roda depois da pintura. Quando o texto chega só no
// `done` (o agente responde de uma vez), o `busy` cai no mesmo render em que o balão da resposta entra, e o `talking` só
// vira `true` um quadro depois: nesse quadro a proposta entrava junto com a resposta e saía em seguida (o trace do
// #15424: os dois aos 39 ms, a proposta fora aos 164 ms). O portão nasce do próprio evento do pedido, no mesmo render
// do balão, e solta quando o balão já apareceu e saiu.

import type { AgentTurnEvent } from "../../src/shared/ui-contract";

/** Sem o balão aparecer nesse tempo (escondido, ou fechado antes de entrar), o portão solta: a proposta nunca fica presa. */
export const ANSWER_GATE_MS = 5000;

/**
 * Quanto a pergunta mandada espera a resposta no canto (T15377). Cobre a ida e volta do pedido, mesmo com a máquina
 * carregada, e não a espera do agente: um agente que pensa mais que isso tem o gato pensando, sem a pergunta.
 */
export const ASK_HOLD_MS = 1500;

export class AnswerGate {
  /** Uma resposta chegou e o balão dela ainda não saiu. */
  pending = false;
  /** O balão da resposta está na tela agora. */
  private showing = false;
  /** O balão dessa resposta já esteve na tela (um pedido novo com o balão de antes ainda aberto também conta). */
  private seen = false;
  /**
   * O pedido saiu pelo campo e o balão da resposta ainda não apareceu (T15377): a pergunta fica no canto. Ela sai só
   * quando a resposta entra, para que as duas troquem no mesmo instante, como as outras trocas do canto (spec #11652).
   * Antes, ela saía no Enter e a resposta só montava depois da ida e volta do pedido até o Bun. Com a máquina carregada,
   * o canto ficava vazio.
   */
  asked = false;

  /** O Enter do campo, antes de o pedido chegar ao Bun. */
  sent(): void {
    this.asked = true;
  }

  /** O pedido nem saiu (o `ask` falhou), o campo abriu de novo ou o `ASK_HOLD_MS` passou: a pergunta não espera mais. */
  unsent(): void {
    this.asked = false;
  }

  /** Um evento do pedido; devolve se o portão está fechado. */
  event(e: AgentTurnEvent): boolean {
    if (e.type === "started") {
      // Um pedido novo: o `busy` cobre até a resposta; o portão volta a contar do zero.
      this.pending = false;
      this.seen = false;
    } else if (e.type === "text" || e.type === "error" || e.type === "limit") {
      this.hold();
    } else if (e.type === "done") {
      // Cancelado, o balão fecha sem mostrar nada (bubble-state); sem texto, não há o que esperar.
      if (e.stopReason !== "cancelled" && (e.text.trim() || this.pending)) this.hold();
      else {
        if (!this.seen) this.pending = false;
        // Sem resposta para entrar, a pergunta sai sozinha.
        this.asked = false;
      }
    }
    return this.pending;
  }

  private hold() {
    this.pending = true;
    // O balão já aberto (a resposta de antes, ou o pedido falado) recebe o texto novo sem entrar de novo.
    if (this.showing) this.seen = true;
  }

  /** O `onShown` do CatBubble. O portão solta quando o balão que apareceu sai da tela. */
  shown(showing: boolean): boolean {
    this.showing = showing;
    if (showing) {
      if (this.pending) this.seen = true;
      this.asked = false;
    } else if (this.seen) {
      this.pending = false;
      this.seen = false;
    }
    return this.pending;
  }

  /** O prazo passou sem o balão aparecer. */
  expire(): boolean {
    if (!this.seen) this.pending = false;
    return this.pending;
  }
}

/** Quem esconde a proposta no canto do gato (spec #8360, #11469, #12150, #11652 e #15454). */
export function proposalHidden(s: {
  asking: boolean;
  away: boolean;
  talking: boolean;
  answering: boolean;
  noting: boolean;
  routining: boolean;
  busy: boolean;
  sending: boolean;
}): boolean {
  return s.asking || s.away || s.talking || s.answering || s.noting || s.routining || s.busy || s.sending;
}
