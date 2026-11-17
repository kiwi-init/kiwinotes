// A bateria da Bússola (ADR 0013, T13702) numa pasta pequena, no CI: os 30 pedidos rodam com a política de hoje e as
// ferramentas do Kiwi de verdade, e o simulador conta as idas. A pasta grande (20 mil notas) é do `bun test/tokens/bateria.ts`.

import { beforeAll, describe, expect, test } from "bun:test";

import { CAPSULE_MAX_TOKENS, WINDOW_MAX_TOKENS } from "../../src/agent/window.ts";
import { PARTES, somar } from "./idas.ts";
import { bagagens, fixoUnica, janelasDe, relidasDe, rodarBateria, type Resultado, resumo, resumoFind, resumoJanela, escritaNotaGrande, escritas, resumoDiferenca, resumoPacote, resumoRegistro, resumoUnica, tabela, tabelaJanela, usageDepoisDe } from "./bateria.ts";
import { ALVOS } from "./pasta-grande.ts";
import { PEDIDOS } from "./pedidos.ts";

let digitada: Resultado;
let falada: Resultado;
beforeAll(async () => {
  digitada = await rodarBateria({ notas: 600, falado: false });
  falada = await rodarBateria({ notas: 600, falado: true });
}, 60_000);

describe("os 30 pedidos", () => {
  test("cada um tem o alvo anotado, e o alvo existe na pasta falsa", () => {
    expect(PEDIDOS).toHaveLength(30);
    expect(new Set(PEDIDOS.map((p) => p.id)).size).toBe(30);
    for (const p of PEDIDOS) {
      if (["pasta", "projeto", "última reunião"].includes(p.tipo)) continue;
      expect(Object.keys(ALVOS)).toContain(p.alvo);
    }
    // Pedidos que escrevem: acrescentar, trocar um trecho e organizar.
    expect(PEDIDOS.filter((p) => ["acrescentar", "trocar trecho", "organizar"].includes(p.tipo)).length).toBeGreaterThanOrEqual(6);
    // A versão falada muda o nome em boa parte deles.
    expect(PEDIDOS.filter((p) => p.falado !== p.texto).length).toBeGreaterThanOrEqual(20);
  });
});

describe("a política de hoje", () => {
  test("digitado, acha todos os alvos menos \"essa nota\" (hoje o Kiwi não diz qual nota está aberta)", () => {
    const nao = digitada.linhas.filter((l) => !l.achou).map((l) => l.pedido.tipo);
    expect(nao).toEqual(["essa nota", "essa nota", "essa nota"]);
  });

  test("falado, o agente dá mais idas para achar", () => {
    const idas = (r: Resultado) => r.linhas.reduce((s, l) => s + l.sim.idas.length, 0);
    expect(idas(falada)).toBeGreaterThan(idas(digitada));
    expect(falada.linhas.reduce((s, l) => s + l.sim.partes.achar, 0)).toBeGreaterThan(digitada.linhas.reduce((s, l) => s + l.sim.partes.achar, 0));
  });

  test("toda escrita lê antes e escreve depois: ao menos 3 idas", () => {
    for (const l of digitada.linhas.filter((x) => ["acrescentar", "trocar trecho", "organizar"].includes(x.pedido.tipo))) {
      expect(l.achou).toBe(true);
      expect(l.sim.idas.length).toBeGreaterThanOrEqual(3);
      expect(l.sim.idas.some((i) => i.motivo === "escrever")).toBe(true);
    }
  });

  test("as cinco partes somam o total de cada pedido, e a bagagem cresce ao longo da sessão", () => {
    for (const l of digitada.linhas) expect(PARTES.reduce((s, k) => s + l.sim.partes[k], 0)).toBe(l.sim.total);
    const bagagem = digitada.linhas.map((l) => l.sim.idas[0]!.partes.bagagem);
    expect(bagagem.at(-1)!).toBeGreaterThan(bagagem[1]!);
  });

  test("o /usage de depois do pedido: no máximo um a cada 10 min de sessão, e o custo dele entra na conta", () => {
    expect(usageDepoisDe([5, 5, 5, 70, 5])).toEqual([true, false, true, true, false]);
    expect(digitada.usage.leituras).toBeGreaterThan(0);
    expect(digitada.usage.leituras).toBeLessThanOrEqual(digitada.linhas.length / 2 + 1);
    expect(digitada.usage.tokens).toBeGreaterThan(0);
  });

  test("a tabela e o resumo saem para o PR", () => {
    expect(tabela(digitada).split("\n")).toHaveLength(2 + 30 + 1);
    expect(resumo(falada)).toMatchObject({ versao: "falada", "achou o alvo": expect.any(String) });
  });
});

describe("a janela curta e a cápsula (ADR 0013 peça 5, T13835)", () => {
  for (const nome of ["digitada", "falada"] as const) {
    test(`${nome}: a bagagem no começo de um pedido fica até 6 mil, e até 800 depois de uma pausa longa`, () => {
      const r = nome === "digitada" ? digitada : falada;
      const depois = bagagens(r.depois.sim);
      expect(Math.max(...depois)).toBeLessThanOrEqual(WINDOW_MAX_TOKENS);
      r.linhas.forEach((l, i) => {
        if (i > 0 && l.sim.frio) {
          expect(r.depois.sim[i]!.janela).toBe("idle");
          expect(depois[i]!).toBeLessThanOrEqual(CAPSULE_MAX_TOKENS);
        }
      });
      for (const c of r.depois.capsulas) expect(c).toBeLessThanOrEqual(CAPSULE_MAX_TOKENS);
      // As mesmas idas, menos tokens: a peça 5 só mexe na bagagem.
      expect(somar(r.depois.sim).idas).toBe(somar(r.linhas.map((l) => l.sim)).idas);
      expect(somar(r.depois.sim).total).toBeLessThan(somar(r.linhas.map((l) => l.sim)).total * 0.6);
    });
  }

  test("as cinco partes ainda somam o total; a 1ª janela abre com o mapa da pasta", () => {
    for (const p of digitada.depois.sim) expect(PARTES.reduce((s, k) => s + p.partes[k], 0)).toBe(p.total);
    expect(digitada.depois.sim[0]!.janela).toBe("start");
    expect(digitada.depois.capsulas[0]!).toBeGreaterThan(0);
  });

  test("com o teto em zero, cada pedido é uma janela, e a bagagem é só a cápsula", async () => {
    const r = await rodarBateria({ notas: 200, falado: false, pedidos: PEDIDOS.slice(0, 6), maxTokens: 0 });
    expect(r.depois.sim.every((p) => p.janela)).toBe(true);
    expect(bagagens(r.depois.sim)).toEqual(r.depois.capsulas);
  });

  test("a tabela e o resumo da janela saem para o PR", () => {
    expect(tabelaJanela(digitada).split("\n")).toHaveLength(2 + 30);
    expect(resumoJanela(falada)).toMatchObject({ versao: "falada", "teto da janela": "6000 tokens" });
  });
});

describe("o find e o erro que ensina (ADR 0013 peça 3, T14133)", () => {
  let comFindFalada: Resultado;
  let comFindDigitada: Resultado;
  beforeAll(async () => {
    comFindDigitada = await rodarBateria({ notas: 600, falado: false, find: true });
    comFindFalada = await rodarBateria({ notas: 600, falado: true, find: true });
  }, 60_000);

  test("acha os mesmos alvos, com menos idas no falado e nunca mais no digitado", () => {
    expect(comFindFalada.linhas.filter((l) => l.achou).length).toBe(falada.linhas.filter((l) => l.achou).length);
    expect(comFindDigitada.linhas.filter((l) => l.achou).length).toBe(digitada.linhas.filter((l) => l.achou).length);
    const idas = (r: Resultado) => somar(r.depois.sim).idas;
    expect(idas(comFindFalada)).toBeLessThan(idas(falada) * 0.9);
    expect(idas(comFindDigitada)).toBeLessThanOrEqual(idas(digitada));
    expect(somar(comFindFalada.depois.sim).total).toBeLessThan(somar(falada.depois.sim).total);
  });

  test("o risco do ADR: as chamadas com erro ficam abaixo de 5 %", () => {
    for (const r of [comFindDigitada, comFindFalada]) expect(r.chamadas.erros / r.chamadas.total).toBeLessThan(0.05);
  });

  test("o resumo sai para o PR", () => {
    expect(resumoFind(falada, comFindFalada)).toMatchObject({ versao: "falada", "chamadas com erro": expect.any(String) });
  });
});

describe("o faro e o pacote (ADR 0013 peças 1 e 2, T14359)", () => {
  let pacoteDigitada: Resultado;
  let pacoteFalada: Resultado;
  let findDigitada: Resultado;
  beforeAll(async () => {
    pacoteDigitada = await rodarBateria({ notas: 600, falado: false, pacote: true });
    pacoteFalada = await rodarBateria({ notas: 600, falado: true, pacote: true });
    findDigitada = await rodarBateria({ notas: 600, falado: false, find: true });
  }, 90_000);

  test("nenhum certo com o alvo errado, e o alvo achado em todos os pedidos", () => {
    for (const r of [pacoteDigitada, pacoteFalada]) {
      expect(r.faro.certoErrado).toBe(0);
      expect(r.faro.certo).toBeGreaterThanOrEqual(24);
      expect(r.linhas.every((l) => l.achou)).toBe(true);
    }
  });

  test("a meta do ADR: a maior parte dos pedidos em 1 ida, e bem menos idas e tokens que com o find", () => {
    for (const r of [pacoteDigitada, pacoteFalada]) {
      expect(r.depois.sim.filter((p) => p.idas.length === 1).length).toBeGreaterThanOrEqual(18);
      expect(somar(r.depois.sim).idas / r.linhas.length).toBeLessThan(1.6);
    }
    expect(somar(pacoteDigitada.depois.sim).total).toBeLessThan(somar(findDigitada.depois.sim).total * 0.6);
  });

  test("o resumo sai para o PR", () => {
    expect(resumoPacote(findDigitada, pacoteDigitada)).toMatchObject({ versao: "digitada", "o faro": expect.stringContaining("certos") });
  });
});

describe("a ferramenta única e o cartão (ADR 0013 peça 6, T14563)", () => {
  let pacote: Resultado;
  let unica: Resultado;
  let unicaFalada: Resultado;
  let unicaFind: Resultado;
  beforeAll(async () => {
    pacote = await rodarBateria({ notas: 600, falado: false, pacote: true });
    unica = await rodarBateria({ notas: 600, falado: false, pacote: true, unica: true });
    unicaFalada = await rodarBateria({ notas: 600, falado: true, pacote: true, unica: true });
    // Sem o pacote, o agente chama bem mais (achar, listar, ler): é onde a forma da chamada mais pode errar.
    unicaFind = await rodarBateria({ notas: 600, falado: true, find: true, unica: true });
  }, 120_000);

  test("a meta do ADR: o fixo por ida até 4 mil", async () => {
    const f = await fixoUnica(pacote.cal);
    expect(f.antes).toBeGreaterThan(8000);
    expect(f.depois).toBeLessThanOrEqual(4000);
    expect(unica.cal.fixo).toBe(f.depois);
  });

  test("o risco do ADR: as chamadas com erro de forma ficam abaixo de 5 %, e nenhuma ida existe só por ele", () => {
    for (const r of [unica, unicaFalada, unicaFind]) {
      expect(r.chamadas.total).toBeGreaterThan(0);
      expect(r.chamadas.erroChamada / r.chamadas.total).toBeLessThan(0.05);
    }
    expect(unicaFind.chamadas.total).toBeGreaterThanOrEqual(30);
    expect(unicaFind.chamadas.idasPorErroChamada).toBe(0);
  });

  test("as mesmas idas e os mesmos alvos que antes, e menos tokens no total", () => {
    expect(unica.linhas.map((l) => l.achou)).toEqual(pacote.linhas.map((l) => l.achou));
    expect(somar(unica.depois.sim).idas).toBe(somar(pacote.depois.sim).idas);
    expect(somar(unica.depois.sim).total).toBeLessThan(somar(pacote.depois.sim).total);
  });

  test("o resumo sai para o PR", async () => {
    expect(await resumoUnica(pacote, unica)).toMatchObject({ versao: "digitada", "fixo por ida": expect.stringContaining("→"), "chamadas com erro de forma": expect.any(String) });
  });
});

describe("escrever só a diferença (ADR 0013 peça 7, T14650)", () => {
  let unica: Resultado;
  let dif: Resultado;
  let difFalada: Resultado;
  beforeAll(async () => {
    unica = await rodarBateria({ notas: 600, falado: false, pacote: true, unica: true });
    dif = await rodarBateria({ notas: 600, falado: false, pacote: true, unica: true, diferenca: true });
    difFalada = await rodarBateria({ notas: 600, falado: true, pacote: true, unica: true, diferenca: true });
  }, 120_000);

  test("as escritas: as mesmas idas, menos saída e menos tokens; nenhuma chamada a mais com erro", () => {
    const a = escritas(unica);
    const b = escritas(dif);
    expect(a.pedidos).toBe(7);
    // Com o pacote, a versão já vinha e a leitura já não acontecia: as idas são as mesmas.
    expect(b.idas).toBe(a.idas);
    expect(b.saida).toBeLessThan(a.saida);
    expect(b.total).toBeLessThan(a.total);
    for (const r of [dif, difFalada]) expect(r.chamadas.erros).toBeLessThanOrEqual(unica.chamadas.erros);
  });

  test("numa nota grande, o que o agente manda cai a menos de um quarto (uma seção) e de um décimo (a nota inteira)", () => {
    const casos = escritaNotaGrande();
    expect(casos).toHaveLength(3);
    expect(casos[0]!.depois).toBeLessThan(casos[0]!.antes / 4);
    for (const c of casos.slice(1)) expect(c.depois).toBeLessThan(c.antes / 10);
  });

  test("os pedidos que não escrevem não mudam", () => {
    const leitura = (r: Resultado) => r.depois.sim.filter((_, i) => !["acrescentar", "trocar trecho", "organizar"].includes(r.linhas[i]!.pedido.tipo)).map((p) => p.idas.length);
    expect(leitura(dif)).toEqual(leitura(unica));
    expect(dif.linhas.map((l) => l.achou)).toEqual(unica.linhas.map((l) => l.achou));
  });

  test("o resumo sai para o PR", () => {
    expect(resumoDiferenca(unica, dif)).toMatchObject({ versao: "digitada", "total nas escritas": expect.stringContaining("→") });
  });
});

describe("o registro de entrega (ADR 0013 peça 4, T14682)", () => {
  let dif: Resultado;
  let reg: Resultado;
  let regFalada: Resultado;
  let difFalada: Resultado;
  beforeAll(async () => {
    dif = await rodarBateria({ notas: 600, falado: false, pacote: true, unica: true, diferenca: true });
    reg = await rodarBateria({ notas: 600, falado: false, pacote: true, unica: true, diferenca: true, registro: { janelas: janelasDe(dif) } });
    difFalada = await rodarBateria({ notas: 600, falado: true, pacote: true, unica: true, diferenca: true });
    regFalada = await rodarBateria({ notas: 600, falado: true, pacote: true, unica: true, diferenca: true, registro: { janelas: janelasDe(difFalada) } });
  }, 120_000);

  test("a meta do spec: nenhuma nota sem mudança relida por inteiro, e achar e ler até 10 %", () => {
    for (const [antes, depois] of [[dif, reg], [difFalada, regFalada]] as const) {
      expect(antes.relidas.vezes).toBeGreaterThan(0);
      expect(depois.relidas.vezes).toBe(0);
      const t = somar(depois.depois.sim);
      expect((t.partes.achar + t.partes.ler) / t.total).toBeLessThanOrEqual(0.1);
      // Com as mesmas janelas, o total cai. Com a janela recalculada, ela fecha por tamanho mais tarde, e a conta muda de
      // lugar: o resumo mostra as duas.
      expect(t.total).toBeLessThan(somar(antes.depois.sim).total);
      expect(depois.livre).toHaveLength(depois.depois.sim.length);
    }
  });

  test("as mesmas idas e o mesmo alvo: o registro só encolhe o que volta", () => {
    expect(reg.depois.sim.map((p) => p.idas.length)).toEqual(dif.depois.sim.map((p) => p.idas.length));
    expect(reg.linhas.map((l) => l.achou)).toEqual(dif.linhas.map((l) => l.achou));
    expect(reg.chamadas.erros).toBeLessThanOrEqual(dif.chamadas.erros);
  });

  test("a conta das releituras esquece o que veio antes da janela", () => {
    const e = [[{ key: "a", texto: "x" }], [{ key: "a", texto: "x" }], [{ key: "a", texto: "x" }], [{ key: "a", texto: "y" }]];
    expect(relidasDe(e, (i) => i === 0)).toEqual({ vezes: 2, chars: 2 });
    expect(relidasDe(e, (i) => i === 0 || i === 2)).toEqual({ vezes: 1, chars: 1 });
  });

  test("o resumo sai para o PR", () => {
    expect(resumoRegistro(dif, reg)).toMatchObject({ "notas sem mudança relidas por inteiro": expect.stringContaining("atingida"), "total, com a janela recalculada": expect.stringContaining("→") });
  });
});
