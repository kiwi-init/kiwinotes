// As fases da barra "Peça ao Kiwi" (ponto 7 do spec #34706, T34755).

import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../../src/shared/ui-contract.ts";
import { ASK_IDLE, type AskBar, type AskBarEvent, askBarStep, askBusy, askShown } from "./ask-bar.ts";

const turn = (event: AgentTurnEvent): AskBarEvent => ({ type: "turn", event });
const run = (events: AskBarEvent[], from: AskBar = ASK_IDLE) => events.reduce(askBarStep, from);

describe("a barra do Kiwi", () => {
  test("ouvindo no foco; o foco sai com o campo vazio e ela volta ao convite", () => {
    const s = run([{ type: "focus" }]);
    expect(s.phase).toBe("listening");
    expect(run([{ type: "blur", draft: "  " }], s).phase).toBe("idle");
    // Com texto no campo, ela segue ouvindo.
    expect(run([{ type: "blur", draft: "me lembra" }], s).phase).toBe("listening");
  });

  test("o pedido inteiro: pensando, respondendo com o texto chegando, e a resposta no fim", () => {
    let s = run([{ type: "focus" }, { type: "sent", text: "o que tenho amanhã?" }]);
    expect(s).toMatchObject({ phase: "thinking", asked: "o que tenho amanhã?", answer: "" });
    expect(askBusy(s)).toBe(true);
    s = run([{ type: "id", id: "r1" }, turn({ id: "r1", type: "started" }), turn({ id: "r1", type: "status", status: "thinking" })], s);
    expect(s.phase).toBe("thinking");
    s = run([turn({ id: "r1", type: "text", text: "Amanhã você " }), turn({ id: "r1", type: "text", text: "tem a feira." })], s);
    expect(s).toMatchObject({ phase: "answering", answer: "Amanhã você tem a feira." });
    s = run([turn({ id: "r1", type: "done", stopReason: "end_turn", text: "Amanhã você tem a feira, às 9h." })], s);
    expect(s).toMatchObject({ phase: "done", answer: "Amanhã você tem a feira, às 9h." });
    expect(askBusy(s)).toBe(false);
    expect(askShown(s)).toBe("Amanhã você tem a feira, às 9h.");
  });

  test("os eventos de outro pedido não mexem na barra; o 1º, antes do id, é dela", () => {
    let s = run([{ type: "sent", text: "oi" }, turn({ id: "r2", type: "started" })]);
    expect(s.id).toBe("r2");
    // O id que o `agent.ask` devolve depois não troca o que ela adotou.
    s = run([{ type: "id", id: "r2" }, turn({ id: "outro", type: "text", text: "do gato" })], s);
    expect(s).toMatchObject({ id: "r2", phase: "thinking", answer: "" });
    // Parada, ela ignora qualquer pedido.
    expect(run([turn({ id: "x", type: "text", text: "a" })])).toEqual(ASK_IDLE);
  });

  test("a fala curta do cat_speak é o que fica no fim", () => {
    const s = run([{ type: "sent", text: "e amanhã?" }, { type: "id", id: "r3" }, turn({ id: "r3", type: "speech", text: "Feira às 9h." }), turn({ id: "r3", type: "done", stopReason: "end_turn", text: "Amanhã há a feira, às 9h, e mais nada." })]);
    expect(askShown(s)).toBe("Feira às 9h.");
  });

  test("o erro, a falha do ask e o limite viram erro; o cancelar sem texto volta ao convite", () => {
    const sent = run([{ type: "sent", text: "oi" }, { type: "id", id: "r4" }]);
    expect(run([turn({ id: "r4", type: "error", code: "E_X", message: "O agente caiu." })], sent)).toMatchObject({ phase: "error", answer: "O agente caiu." });
    expect(run([{ type: "failed", message: "Não deu." }], sent)).toMatchObject({ phase: "error", answer: "Não deu." });
    expect(run([turn({ id: "r4", type: "limit", status: "out" })], sent).phase).toBe("error");
    expect(run([turn({ id: "r4", type: "limit", status: "warning" })], sent).phase).toBe("thinking");
    expect(run([turn({ id: "r4", type: "done", stopReason: "cancelled", text: "" })], sent)).toEqual(ASK_IDLE);
    // O cancelar no meio guarda o que já chegou.
    const half = run([turn({ id: "r4", type: "text", text: "Amanhã" }), turn({ id: "r4", type: "done", stopReason: "cancelled", text: "" })], sent);
    expect(half).toMatchObject({ phase: "done", answer: "Amanhã" });
  });

  test("o foco depois da resposta guarda a resposta; o × e o Esc limpam", () => {
    const done = run([{ type: "sent", text: "oi" }, { type: "id", id: "r5" }, turn({ id: "r5", type: "done", stopReason: "end_turn", text: "Olá." })]);
    const again = run([{ type: "focus" }], done);
    expect(again).toMatchObject({ phase: "listening", answer: "Olá." });
    expect(run([{ type: "blur", draft: "" }], again).phase).toBe("done");
    expect(run([{ type: "close" }], again)).toEqual(ASK_IDLE);
    // Pensando, o foco não muda a fase.
    const busy = run([{ type: "sent", text: "oi" }]);
    expect(run([{ type: "focus" }], busy).phase).toBe("thinking");
  });
});
