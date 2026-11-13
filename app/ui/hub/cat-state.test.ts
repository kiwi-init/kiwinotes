// O estado do gato a partir dos eventos do agente (spec #9510): a sequência de um pedido, as interrupções, os eventos
// atrasados e o gato que nasce com o agente ocupado.

import { describe, expect, test } from "bun:test";

import type { AgentTurnEvent } from "../../src/shared/ui-contract";
import { CAT_FINISHED_MAX, CatActivity } from "./cat-state";

const started = (id: string): AgentTurnEvent => ({ id, type: "started" });
const running = (id: string): AgentTurnEvent => ({ id, type: "status", status: "running", tool: "mcp__kiwi__notes_read" });
const thinking = (id: string): AgentTurnEvent => ({ id, type: "status", status: "thinking" });
const done = (id: string, stopReason = "end_turn"): AgentTurnEvent => ({ id, type: "done", text: "", stopReason });
const error = (id: string): AgentTurnEvent => ({ id, type: "error", code: "E_AGENT_FAILED", message: "caiu" });

describe("o gato segue o pedido atual (spec #9510)", () => {
  test("a sequência: acordou, thinking, agindo e de volta a thinking, pronto", () => {
    const a = new CatActivity(false);
    expect(a.state).toBe("repouso");
    expect(a.event(started("1"))).toBe("acordou");
    expect(a.event({ id: "1", type: "status", status: "opening" })).toBe("thinking");
    expect(a.event(running("1"))).toBe("agindo");
    // O host manda `thinking` quando a ferramenta acaba.
    expect(a.event(thinking("1"))).toBe("thinking");
    expect(a.event({ id: "1", type: "text", text: "olá" })).toBe("thinking");
    expect(a.event({ id: "1", type: "permission", tool: "Bash", decision: "denied" })).toBe("thinking");
    expect(a.event(done("1"))).toBe("pronto");
  });

  test("o cancelamento e o fim cortado voltam ao repouso, sem pronto; o erro fica até o próximo pedido", () => {
    const a = new CatActivity(false);
    a.event(started("1"));
    expect(a.event(done("1", "cancelled"))).toBe("repouso");
    a.event(started("2"));
    expect(a.event(done("2", "max_tokens"))).toBe("repouso");
    a.event(started("3"));
    expect(a.event(error("3"))).toBe("erro");
    // Depois do erro, um evento atrasado do mesmo pedido não muda nada; o próximo pedido muda.
    expect(a.event(thinking("3"))).toBe("erro");
    expect(a.event(started("4"))).toBe("acordou");
  });

  test("o erro e o cancelamento no meio da entrada valem na hora", () => {
    const a = new CatActivity(false);
    a.event(started("1"));
    expect(a.event(error("1"))).toBe("erro");
    const b = new CatActivity(false);
    b.event(started("1"));
    expect(b.event(done("1", "cancelled"))).toBe("repouso");
  });

  test("um evento de pedido antigo é ignorado, também o de um pedido que o gato não viu começar", () => {
    const a = new CatActivity(false);
    a.event(started("1"));
    a.event(done("1"));
    a.event(started("2"));
    expect(a.event(error("1"))).toBe("acordou");
    expect(a.event(running("1"))).toBe("acordou");
    // O gato nasceu parado e chega um `done` de um pedido que acabou antes dele: nada muda.
    const b = new CatActivity(false);
    expect(b.event(done("velho"))).toBe("repouso");
    expect(b.event(running("velho"))).toBe("repouso");
  });

  test("o gato que nasce com o agente ocupado começa em thinking e adota o pedido que já rodava, só ele", () => {
    const a = new CatActivity(true);
    expect(a.state).toBe("thinking");
    expect(a.event(running("rodando"))).toBe("agindo");
    // Um segundo pedido desconhecido não é adotado.
    expect(a.event(error("outro"))).toBe("agindo");
    expect(a.event(done("rodando"))).toBe("pronto");
    // Um `started` também tira a adoção: o pedido novo é o atual.
    const b = new CatActivity(true);
    b.event(started("novo"));
    expect(b.event(done("antigo"))).toBe("acordou");
  });

  test("os pedidos terminados ficam guardados até um limite, e o mais velho sai primeiro", () => {
    const a = new CatActivity(false);
    for (let i = 0; i < CAT_FINISHED_MAX + 10; i++) {
      a.event(started(`p${i}`));
      a.event(done(`p${i}`));
    }
    const finished = (a as unknown as { finished: Set<string> }).finished;
    expect(finished.size).toBe(CAT_FINISHED_MAX);
    expect(finished.has("p0")).toBe(false);
    expect(finished.has(`p${CAT_FINISHED_MAX + 9}`)).toBe(true);
  });

  test("o campo de texto (spec #9878): abrir deixa atento, fechar volta ao repouso, e mandar não repete a entrada", () => {
    const a = new CatActivity(false);
    expect(a.attend(true)).toBe("ouvindo");
    expect(a.attend(false)).toBe("repouso");
    // Mandar: o campo fecha, o gato fica atento até o pedido começar, e o pedido entra direto no thinking.
    a.attend(true);
    expect(a.sent()).toBe("ouvindo");
    expect(a.event(started("1"))).toBe("thinking");
    expect(a.event(running("1"))).toBe("agindo");
    expect(a.event(done("1"))).toBe("pronto");
    // O envio que falha (sem started): fechar volta ao repouso, e o próximo pedido de fora entra normal.
    const b = new CatActivity(false);
    b.attend(true); b.sent();
    expect(b.attend(false)).toBe("repouso");
    expect(b.event(started("2"))).toBe("acordou");
  });

  test("com o agente ocupado, o campo abre e fecha sem mudar o gato; o fim do pedido com o campo aberto volta à atenção", () => {
    const a = new CatActivity(false);
    a.event(started("1")); a.event(running("1"));
    expect(a.busy).toBe(true);
    expect(a.attend(true)).toBe("agindo");
    expect(a.attend(false)).toBe("agindo");
    a.attend(true);
    expect(a.event(done("1"))).toBe("ouvindo");
    expect(a.busy).toBe(false);
    // O erro continua aparecendo, mesmo com o campo aberto.
    a.event(started("2"));
    expect(a.event(error("2"))).toBe("erro");
    // O gato que nasce com o agente ocupado também conta como ocupado.
    const b = new CatActivity(true);
    expect(b.busy).toBe(true);
    expect(b.attend(true)).toBe("thinking");
  });
});
