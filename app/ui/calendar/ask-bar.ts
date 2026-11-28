// A barra "Peça ao Kiwi" do Calendário (ponto 7 do spec #34706, T34755): o lado puro. A pessoa escreve na própria barra
// e manda com Enter; a barra anda pelas fases (ouvindo, pensando, respondendo) com os eventos do pedido, e a resposta
// fica ali, debaixo dela. A tela (KiwiAsk.tsx) só desenha a fase; os testes ficam em ask-bar.test.ts.

import type { AgentTurnEvent } from "../../src/shared/ui-contract.ts";

/**
 * - `idle`: a barra parada, com o convite;
 * - `listening`: o foco na barra, a pessoa escrevendo;
 * - `thinking`: o pedido saiu, e o agente ainda não escreveu;
 * - `answering`: o texto chegando;
 * - `done`: a resposta inteira, debaixo da barra;
 * - `error`: o pedido falhou, com o motivo no lugar da resposta.
 */
export type AskPhase = "idle" | "listening" | "thinking" | "answering" | "done" | "error";

export interface AskBar {
  phase: AskPhase;
  /** O pedido desta barra: os eventos de outro pedido (o do gato do canto, por exemplo) não mexem nela. */
  id: string | null;
  /** O que a pessoa pediu, para mostrar em cima da resposta. */
  asked: string;
  /** O texto que já chegou (os pedaços do `text`), e depois a resposta inteira do `done`. */
  answer: string;
  /** A fala curta do `cat_speak`, quando o agente mandou: é ela que a barra mostra no fim. */
  speech: string | null;
}

export const ASK_IDLE: AskBar = { phase: "idle", id: null, asked: "", answer: "", speech: null };

export type AskBarEvent =
  | { type: "focus" }
  /** O foco saiu; com o campo vazio, a barra volta a mostrar o que tinha. */
  | { type: "blur"; draft: string }
  | { type: "sent"; text: string }
  /** O `agent.ask` respondeu com o id do pedido. */
  | { type: "id"; id: string }
  | { type: "turn"; event: AgentTurnEvent }
  /** O `agent.ask` falhou antes de o pedido começar. */
  | { type: "failed"; message: string }
  /** O × da resposta, ou o Esc com o campo vazio. */
  | { type: "close" };

/** A barra está esperando o agente (pensando ou respondendo): o Enter não manda outro pedido. */
export const askBusy = (s: AskBar) => s.phase === "thinking" || s.phase === "answering";

/** O que fica debaixo da barra: a fala curta, se houver; senão o texto. */
export const askShown = (s: AskBar) => (s.phase === "done" && s.speech ? s.speech : s.answer);

const rest = (s: AskBar): AskPhase => (s.phase === "error" ? "error" : s.answer || s.speech ? "done" : "idle");

export function askBarStep(s: AskBar, ev: AskBarEvent): AskBar {
  switch (ev.type) {
    case "focus":
      return askBusy(s) || s.phase === "listening" ? s : { ...s, phase: "listening" };
    case "blur":
      return s.phase === "listening" && !ev.draft.trim() ? { ...s, phase: rest(s) } : s;
    case "sent":
      return { phase: "thinking", id: null, asked: ev.text, answer: "", speech: null };
    case "id":
      return askBusy(s) && !s.id ? { ...s, id: ev.id } : s;
    case "failed":
      return askBusy(s) ? { ...s, phase: "error", answer: ev.message } : s;
    case "close":
      return ASK_IDLE;
    case "turn": {
      const e = ev.event;
      if (!askBusy(s)) return s;
      // O 1º evento que chega antes do id (o `agent.ask` ainda não voltou) é deste pedido: a barra acabou de mandar.
      if (s.id && e.id !== s.id) return s;
      const own = s.id ? s : { ...s, id: e.id };
      switch (e.type) {
        case "text":
          return { ...own, phase: "answering", answer: own.answer + e.text };
        case "speech":
          return { ...own, speech: e.text.trim() || null };
        case "done":
          if (e.stopReason === "cancelled" && !e.text && !own.answer) return { ...ASK_IDLE };
          return { ...own, phase: "done", answer: e.text || own.answer };
        case "error":
          return { ...own, phase: "error", answer: e.message };
        case "limit":
          return e.status === "out" ? { ...own, phase: "error", answer: "" } : own;
        default:
          return own;
      }
    }
  }
}
