// A proposta não pisca antes da resposta (spec #15454): o portão da resposta que está chegando, puro.
import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../../src/shared/ui-contract";
import { AnswerGate, proposalHidden } from "./answer-gate";

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
const ev = (e: NoId<AgentTurnEvent>) => ({ id: "p1", ...e }) as AgentTurnEvent;
const idle = { asking: false, away: false, talking: false, noting: false, routining: false, busy: false, sending: false };

/**
 * O canto como o KiwiCat o monta: o `busy` cai com o `done`, e o `talking` só chega depois, no efeito do `onShown`.
 * Devolve se a proposta está escondida em cada passo.
 */
function corner(events: AgentTurnEvent[]) {
  const gate = new AnswerGate();
  let busy = false, answering = false;
  const seen: boolean[] = [];
  for (const e of events) {
    answering = gate.event(e);
    if (e.type === "started") busy = true;
    if (e.type === "done" || e.type === "error") busy = false;
    // O render logo depois do evento: o balão já entrou, mas o `onShown` ainda não rodou.
    seen.push(proposalHidden({ ...idle, busy, answering }));
  }
  return { gate, hidden: seen, answering };
}

describe("a proposta espera a resposta que está chegando", () => {
  test("a resposta inteira no done: a proposta fica escondida no render do done, antes do onShown", () => {
    // O caso do trace (#15424): o agente usa a ferramenta, a proposta nasce, e o texto chega só no `done`.
    const { hidden } = corner([
      ev({ type: "started" }),
      ev({ type: "status", status: "running", tool: "routine_propose" }),
      ev({ type: "status", status: "thinking" }),
      ev({ type: "done", stopReason: "end_turn", text: "Preparei a rotina." }),
    ]);
    expect(hidden).toEqual([true, true, true, true]);
  });

  test("o texto aos pedaços: escondida do primeiro pedaço até o balão sair", () => {
    const { gate, hidden } = corner([ev({ type: "started" }), ev({ type: "text", text: "Prepa" }), ev({ type: "done", stopReason: "end_turn", text: "Preparei." })]);
    expect(hidden).toEqual([true, true, true]);
    expect(gate.shown(true)).toBe(true);
    expect(gate.shown(false)).toBe(false);
  });

  test("depois que a resposta sai, a proposta volta", () => {
    const { gate } = corner([ev({ type: "started" }), ev({ type: "done", stopReason: "end_turn", text: "Pronto." })]);
    gate.shown(true);
    expect(proposalHidden({ ...idle, talking: true, answering: gate.pending })).toBe(true);
    const answering = gate.shown(false);
    expect(proposalHidden({ ...idle, answering })).toBe(false);
  });

  test("o balão que nunca aparece não prende a proposta: o prazo solta", () => {
    const { gate } = corner([ev({ type: "started" }), ev({ type: "done", stopReason: "end_turn", text: "Pronto." })]);
    expect(gate.pending).toBe(true);
    expect(gate.expire()).toBe(false);
  });

  test("o prazo não solta com o balão na tela", () => {
    const { gate } = corner([ev({ type: "started" }), ev({ type: "done", stopReason: "end_turn", text: "Pronto." })]);
    gate.shown(true);
    expect(gate.expire()).toBe(true);
  });

  test("cancelado, ou sem texto, não há o que esperar", () => {
    expect(corner([ev({ type: "started" }), ev({ type: "done", stopReason: "cancelled", text: "" })]).answering).toBe(false);
    expect(corner([ev({ type: "started" }), ev({ type: "done", stopReason: "end_turn", text: " " })]).answering).toBe(false);
    expect(corner([ev({ type: "started" }), ev({ type: "text", text: "meio" }), ev({ type: "done", stopReason: "cancelled", text: "" })]).answering).toBe(false);
  });

  test("o erro também é um balão: a proposta espera por ele", () => {
    expect(corner([ev({ type: "started" }), ev({ type: "error", code: "E_X", message: "O agente parou." })]).hidden).toEqual([true, true]);
  });

  test("um pedido novo começa do zero", () => {
    const { gate } = corner([ev({ type: "started" }), ev({ type: "done", stopReason: "end_turn", text: "Um." })]);
    gate.shown(true);
    gate.event(ev({ type: "started" }));
    expect(gate.pending).toBe(false);
    expect(gate.shown(false)).toBe(false);
  });

  test("um pedido novo com o balão de antes ainda na tela: o portão solta quando ele sai", () => {
    const gate = new AnswerGate();
    gate.event(ev({ type: "started" }));
    gate.event(ev({ type: "done", stopReason: "end_turn", text: "Um." }));
    gate.shown(true);
    // O pedido seguinte começa com a resposta de antes ainda aberta, e o texto novo cai no mesmo balão.
    gate.event(ev({ type: "started" }));
    expect(gate.event(ev({ type: "text", text: "Dois." }))).toBe(true);
    expect(gate.expire()).toBe(true);
    expect(gate.shown(false)).toBe(false);
  });
});

// A pergunta mandada fica no canto até a resposta entrar no lugar dela (T15377): sem isso, ela saía no Enter e a resposta
// só montava depois da ida e volta do pedido, e com a máquina carregada o canto ficava vazio.
describe("a pergunta mandada espera a resposta entrar", () => {
  test("fica do Enter até o balão da resposta aparecer, passando pelo started e pelo texto", () => {
    const gate = new AnswerGate();
    gate.sent();
    expect(gate.asked).toBe(true);
    gate.event(ev({ type: "started" }));
    expect(gate.asked).toBe(true);
    gate.event(ev({ type: "text", text: "Pron" }));
    expect(gate.asked).toBe(true);
    gate.shown(true);
    expect(gate.asked).toBe(false);
    // A proposta continua esperando a resposta sair, como antes.
    expect(gate.pending).toBe(true);
  });

  test("o erro é um balão: a pergunta sai quando ele aparece", () => {
    const gate = new AnswerGate();
    gate.sent();
    gate.event(ev({ type: "started" }));
    gate.event(ev({ type: "error", code: "E_X", message: "O agente parou." }));
    expect(gate.asked).toBe(true);
    gate.shown(true);
    expect(gate.asked).toBe(false);
  });

  test("sem resposta para entrar (cancelado, ou sem texto), a pergunta sai no done", () => {
    for (const done of [ev({ type: "done", stopReason: "cancelled", text: "" }), ev({ type: "done", stopReason: "end_turn", text: " " })]) {
      const gate = new AnswerGate();
      gate.sent();
      gate.event(ev({ type: "started" }));
      gate.event(done);
      expect(gate.asked).toBe(false);
    }
  });

  test("a resposta inteira no done: a pergunta espera o balão dela", () => {
    const gate = new AnswerGate();
    gate.sent();
    gate.event(ev({ type: "started" }));
    gate.event(ev({ type: "done", stopReason: "end_turn", text: "Pronto." }));
    expect(gate.asked).toBe(true);
    gate.shown(true);
    expect(gate.asked).toBe(false);
  });

  test("o pedido que falhou, o campo aberto de novo ou o prazo: unsent solta sem mexer no que a proposta espera", () => {
    const gate = new AnswerGate();
    gate.sent();
    gate.event(ev({ type: "started" }));
    gate.event(ev({ type: "text", text: "meio" }));
    gate.unsent();
    expect(gate.asked).toBe(false);
    expect(gate.pending).toBe(true);
  });

  test("sem o Enter (a fala pelo Control, um pedido de outro lugar), nada segura a pergunta", () => {
    const gate = new AnswerGate();
    gate.event(ev({ type: "started" }));
    gate.event(ev({ type: "text", text: "Oi" }));
    expect(gate.asked).toBe(false);
  });
});
