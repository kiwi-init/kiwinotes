// O simulador de idas (ADR 0013, T13702) contra o registro do harry: os 18 pedidos, as 34 idas e os 934 mil tokens. O
// registro é só números e nomes de ferramenta (`registro-forma.json`, do #13534). Roda no `bun test` (o CI).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { calibrar, PARTES, type Registro, roteiroDoRegistro, simular, somaDoRegistro, somar } from "./idas.ts";

const REGISTRO = JSON.parse(readFileSync(path.join(import.meta.dir, "registro-forma.json"), "utf8")) as Registro & { de: string };
const erro = (sim: number, real: number) => Math.abs(sim - real) / real;

describe("o registro do harry", () => {
  test("só números e nomes de ferramenta: nenhum texto, no arquivo inteiro", () => {
    const textos = new Set<string>();
    const walk = (x: unknown): void => {
      if (typeof x === "string") textos.add(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(REGISTRO);
    // Fora os nomes de ferramenta, só a descrição do arquivo, o modelo e o tempo do cache.
    const cabecalho = new Set([REGISTRO.de, "claude-sonnet-5-5", "1h"]);
    expect(REGISTRO.de).toMatch(/^registro do agente do Kiwi, 18 pedidos/);
    for (const t of textos) if (!cabecalho.has(t)) expect(t).toMatch(/^[a-z_]+$/);
    // Os campos são só estes: nada de texto, caminho ou argumento.
    const campos = new Set<string>();
    const keys = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(keys);
      else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) (campos.add(k), keys(v));
    };
    keys(REGISTRO);
    expect([...campos].sort()).toEqual(["argumentosChars", "cache", "cacheEscrito", "cacheLido", "de", "entrada", "erro", "ferramentas", "idas", "modelo", "nome", "pedidoChars", "pedidos", "resultadoChars", "saida"]);
  });

  test("os números do ADR 0013: 18 pedidos, 34 idas, 934 mil tokens", () => {
    const real = somaDoRegistro(REGISTRO);
    expect(REGISTRO.pedidos).toHaveLength(18);
    expect(real.idas).toBe(34);
    expect(real.cacheLido).toBe(827_666);
    expect(real.saida).toBe(6_279);
    expect(real.total).toBe(934_158);
  });
});

describe("o simulador reproduz o registro", () => {
  const cal = calibrar(REGISTRO);
  const sim = simular(roteiroDoRegistro(REGISTRO), cal);
  const s = somar(sim);
  const real = somaDoRegistro(REGISTRO);

  test("a calibração tem números de verdade", () => {
    // O fixo do ADR: 8,6 mil tokens por ida. O contador local fica perto do tokenizador (fator perto de 1).
    expect(cal.fixo).toBeGreaterThan(8_000);
    expect(cal.fixo).toBeLessThan(9_200);
    expect(cal.fator).toBeGreaterThan(0.8);
    expect(cal.fator).toBeLessThan(1.6);
    expect(cal.aFrio).toBeGreaterThanOrEqual(0);
  });

  test("até 15 % de erro no total, na leitura de cache, na escrita e na saída", () => {
    expect(s.idas).toBe(real.idas);
    expect(erro(s.total, real.total)).toBeLessThan(0.15);
    expect(erro(s.cacheLido, real.cacheLido)).toBeLessThan(0.15);
    expect(erro(s.cacheEscrito, real.cacheEscrito)).toBeLessThan(0.15);
    expect(erro(s.saida, real.saida)).toBeLessThan(0.15);
  });

  test("as 4 retomadas a frio caem nos mesmos pedidos", () => {
    expect(sim.map((p, i) => (p.frio ? i + 1 : 0)).filter(Boolean)).toEqual([1, 4, 7, 10]);
  });

  test("as cinco partes somam o total, e a bagagem e o fixo são a maior parte, como no ADR", () => {
    expect(PARTES.reduce((a, k) => a + s.partes[k], 0)).toBe(s.total);
    // ADR 0013: a conversa antiga reenviada é 64,6 %; o fixo, 31,4 %.
    expect(s.partes.bagagem / s.total).toBeGreaterThan(0.55);
    expect(s.partes.fixo / s.total).toBeGreaterThan(0.25);
    expect(s.partes.fixo / s.total).toBeLessThan(0.38);
  });
});

describe("a conta de uma ida", () => {
  const cal = { fixo: 1000, fator: 1, porItem: 0, aFrio: 500 };
  const ida = (saida: number, ferramentas: { nome: string; resultadoChars: number; erro?: boolean }[] = []) => ({
    saida,
    ferramentas: ferramentas.map((f) => ({ argumentosChars: 10, erro: false, ...f })),
  });

  test("quente: cada ida lê o que a anterior tinha e escreve só o novo; cada resultado abre mais uma ida", () => {
    const [p] = simular([{ pedidoChars: 40, pausaMin: 0, idas: [ida(10, [{ nome: "notes_search", resultadoChars: 400 }]), ida(20)] }], cal);
    expect(p!.idas).toHaveLength(2);
    const [a, b] = p!.idas;
    expect(a!.cacheLido).toBe(0);
    expect(b!.cacheLido).toBe(a!.cacheEscrito);
    // A 2ª escreve a saída da 1ª e o resultado da busca.
    expect(b!.cacheEscrito).toBeGreaterThan(10);
    expect(b!.motivo).toBe("achar");
    expect(b!.partes.achar).toBeGreaterThan(0);
  });

  test("depois de mais de 1 hora, a sessão inteira é escrita de novo, com os avisos da retomada", () => {
    const pedidos = [
      { pedidoChars: 40, pausaMin: 0, idas: [ida(10)] },
      { pedidoChars: 40, pausaMin: 5, idas: [ida(10)] },
      { pedidoChars: 40, pausaMin: 90, idas: [ida(10)] },
    ];
    const [p1, p2, p3] = simular(pedidos, cal);
    expect(p2!.idas[0]!.cacheLido).toBe(p1!.idas[0]!.cacheEscrito);
    expect(p3!.frio).toBe(true);
    expect(p3!.idas[0]!.cacheLido).toBe(0);
    expect(p3!.idas[0]!.cacheEscrito).toBeGreaterThan(p2!.idas[0]!.cacheLido + p2!.idas[0]!.cacheEscrito + cal.aFrio);
    // O pedido de antes já é bagagem.
    expect(p3!.partes.bagagem).toBeGreaterThan(0);
  });

  test("o /usage de depois do pedido fica na conversa: é bagagem nos pedidos seguintes", () => {
    const pedidos = (usage: boolean) => [
      { pedidoChars: 40, pausaMin: 0, idas: [ida(10)], usageDepois: usage },
      { pedidoChars: 40, pausaMin: 5, idas: [ida(10)] },
    ];
    const [, com] = simular(pedidos(true), cal);
    const [, sem] = simular(pedidos(false), cal);
    expect(com!.partes.bagagem).toBeGreaterThan(sem!.partes.bagagem + 50);
    expect(com!.idas[0]!.cacheEscrito).toBeGreaterThan(sem!.idas[0]!.cacheEscrito);
  });

  test("uma leitura que dá erro é parte de achar, e a ida seguinte existe só pelo erro", () => {
    const [p] = simular([{ pedidoChars: 40, pausaMin: 0, idas: [ida(10, [{ nome: "files_read", resultadoChars: 80, erro: true }]), ida(5)] }], cal);
    expect(p!.idas[1]!.motivo).toBe("erro");
    expect(p!.partes.ler).toBe(0);
  });
});

describe("a janela curta no simulador (T13835)", () => {
  const cal = { fixo: 8000, fator: 1, porItem: 0, aFrio: 2000 };
  const pedido = (pausaMin: number) => ({ pedidoChars: 40, pedido: "um pedido de teste com umas palavras", pausaMin, idas: [{ ferramentas: [], saida: 100 }] });
  const janela = { maxTokens: 6000, idleMin: 55, capsula: () => 500 };

  test("a janela nova lê do cache só o fixo, com o cache quente; a frio, escreve tudo, sem os avisos da retomada", () => {
    const [a, b, c] = simular([pedido(0), pedido(58), pedido(70)], cal, { janela });
    expect(a!.janela).toBe("start");
    expect(b!.janela).toBe("idle");
    expect(b!.idas[0]!.cacheLido).toBe(8000);
    expect(b!.idas[0]!.partes.bagagem).toBe(500);
    expect(c!.janela).toBe("idle");
    expect(c!.idas[0]!.cacheLido).toBe(0);
    // A parte do pedido leva a saída da ida (100).
    expect(c!.idas[0]!.cacheEscrito).toBe(8000 + 500 + c!.idas[0]!.partes.pedido - 100);
  });

  test("dentro da janela, a sessão segue como antes; passou do teto, a próxima abre com a cápsula", () => {
    // Depois do 1º pedido, a conversa tem uns 610 tokens (a cápsula, o pedido e a saída); depois do 2º, uns 720.
    const sim = simular([pedido(0), pedido(5), pedido(5)], cal, { janela: { ...janela, maxTokens: 650 } });
    expect(sim[1]!.janela).toBeUndefined();
    expect(sim[1]!.idas[0]!.partes.bagagem).toBeGreaterThan(500);
    expect(sim[2]!.janela).toBe("size");
    expect(sim[2]!.idas[0]!.partes.bagagem).toBe(500);
  });
});
