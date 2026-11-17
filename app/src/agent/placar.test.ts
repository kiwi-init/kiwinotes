// O placar (ADR 0013, T14671): as idas pelos eventos do agente, as cinco partes pela regra do simulador, e o total
// sempre o que o agente informou.

import { describe, expect, test } from "bun:test";

import { faroDoPlacar, parteDaFerramenta, PlacarTurno } from "./placar.ts";

const usage = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
const soma = (p: Record<string, number>) => Object.values(p).reduce((a, b) => a + b, 0);

describe("o placar de um pedido", () => {
  test("sem ferramenta, 1 ida: o pedido, a bagagem e a saída; o resto é o fixo", () => {
    const t = new PlacarTurno(100, 400, null);
    t.pensando();
    const p = t.fim(usage(200, 50, 5000));
    expect(p.idas).toBe(1);
    expect(p.partes).toEqual({ pedido: 150, achar: 0, ler: 0, bagagem: 400, fixo: 4700 });
    expect(p.faro).toBeUndefined();
  });

  test("cada leva de ferramentas é mais uma ida, e o resultado entra nas idas depois dela", () => {
    const t = new PlacarTurno(100, 0, { kind: "nada" });
    // Leva 1: buscar e listar juntas (paralelas), com um resultado de achar.
    t.ferramentaComecou();
    t.ferramentaComecou();
    t.resultado("notes_search", true, 300);
    t.resultado("notes_list", true, 100);
    t.pensando();
    // Leva 2: ler.
    t.ferramentaComecou();
    t.resultado("notes_read", true, 1000);
    t.pensando();
    const p = t.fim(usage(1000, 80, 20_000));
    expect(p.idas).toBe(3);
    // Os 400 de achar entram nas idas 2 e 3; os 1000 de ler, só na 3.
    expect(p.partes.achar).toBe(800);
    expect(p.partes.ler).toBe(1000);
    expect(p.partes.pedido).toBe(100 * 3 + 80);
    expect(soma(p.partes)).toBe(21_080);
    expect(p.faro).toEqual({ kind: "nada", searched: true });
  });

  test("um erro é parte de achar, mesmo numa leitura; escrever e propor são do pedido", () => {
    expect(parteDaFerramenta("notes_read", false)).toBe("achar");
    expect(parteDaFerramenta("notes_read", true)).toBe("ler");
    expect(parteDaFerramenta("find", true)).toBe("achar");
    expect(parteDaFerramenta("notes_edit", true)).toBe("pedido");
  });

  test("a conta local maior que o total: as partes encolhem juntas, o fixo fica em zero, e a soma é o total", () => {
    const t = new PlacarTurno(3000, 9000, { kind: "certo", how: "nome" });
    const p = t.fim(usage(5000, 1000));
    expect(p.partes.fixo).toBe(0);
    expect(soma(p.partes)).toBe(6000);
    expect(p.partes.bagagem).toBeGreaterThan(p.partes.pedido);
    expect(p.faro).toEqual({ kind: "certo", how: "nome", searched: false });
  });

  test("o faro: como achou, e o que a pessoa disse quando apontou", () => {
    const target = { kind: "nota" as const, path: "Ideias.md", title: "Ideias" };
    expect(faroDoPlacar(null)).toBeNull();
    expect(faroDoPlacar({ kind: "nada" })).toEqual({ kind: "nada" });
    expect(faroDoPlacar({ kind: "provavel", hits: [] })).toEqual({ kind: "provavel" });
    expect(faroDoPlacar({ kind: "certo", hit: { target, said: "ideias", score: 1, how: "som" } as never })).toEqual({ kind: "certo", how: "som" });
    expect(faroDoPlacar({ kind: "certo", hit: { target, said: "essa nota", score: 2, how: "apontado" } as never })).toEqual({ kind: "certo", how: "apontado", said: "essa nota" });
  });
});
