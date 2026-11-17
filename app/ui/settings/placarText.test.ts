// Os textos do placar (T14671): os cartões, a %, os selos.

import { describe, expect, test } from "bun:test";

import type { AgentPlacarView } from "../../src/shared/ui-contract.ts";
import { acharLerLine, cartoes, curto, porcentos, seloFaro } from "./placarText.ts";

const partes = { pedido: 1200, achar: 300, ler: 600, bagagem: 900, fixo: 7000 };
const view: AgentPlacarView = { pedidos: 9, idas: 10, tokens: 75_000, partes, comFaro: 9, dePrimeira: 8, limite5h: 3, ultimos: [] };

describe("o placar em texto", () => {
  test("os cartões de hoje, por pedido, e o limite quando o /usage deu", () => {
    const c = cartoes(view);
    expect(c.map((x) => x.valor)).toEqual(["9", "10", "75 mil", "8 de 9"]);
    expect(c[1]!.sub).toBe("1,1 por pedido");
    expect(c[2]!.sub).toBe("8,3 mil por pedido");
    expect(c[3]!.sub).toBe("3 % do limite de 5 horas");
    const sem = cartoes({ ...view, comFaro: 0, dePrimeira: 0, limite5h: undefined });
    expect(sem[3]!.valor).toBe("—");
    expect(sem[3]!.sub).toBeUndefined();
  });

  test("as % somam 100, e achar e ler juntos", () => {
    const pc = porcentos(partes);
    expect(Object.values(pc).reduce((a, b) => a + b, 0)).toBe(100);
    expect(acharLerLine(partes)).toBe("Achar e ler: 9 % do gasto de hoje.");
    expect(porcentos({ pedido: 0, achar: 0, ler: 0, bagagem: 0, fixo: 0 }).fixo).toBe(0);
    expect(curto(820)).toBe("820");
    expect(curto(1_250_000)).toBe("1,3 mi");
  });

  test("os selos da Bússola", () => {
    expect(seloFaro({ kind: "certo", how: "som", searched: false }).texto).toBe("achou · pelo som");
    expect(seloFaro({ kind: "certo", how: "nome", searched: false }).texto).toBe("achou · pelo nome");
    expect(seloFaro({ kind: "certo", how: "apontado", said: "a nota aberta", searched: false }).texto).toBe("achou · a nota aberta");
    expect(seloFaro({ kind: "provavel", searched: false })).toEqual({ texto: "quase · o agente escolheu", tom: "quase" });
    expect(seloFaro({ kind: "nada", searched: true }).texto).toBe("não achou · o agente buscou");
    expect(seloFaro({ kind: "nada", searched: false }).texto).toBe("sem alvo");
    expect(seloFaro(undefined).tom).toBe("sem");
  });
});
