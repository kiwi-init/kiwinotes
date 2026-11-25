import { describe, expect, test } from "bun:test";
import { FALA_TAXA, nivelRms } from "../agent/fala-player.ts";
import { saidaFalsa, sinteseFalsa, tomDaFrase } from "./fake-speech.ts";

// A voz de mentira das provas (T26829): pedaços de 80 ms com um nível que sobe e desce, como uma fala.
describe("a voz de mentira (T26829)", () => {
  test("o tom vem em pedaços de 80 ms, com sílabas: o nível sobe e desce", () => {
    const pedacos = tomDaFrase("Pronto: o pedido tinha cinco palavras.");
    expect(pedacos.length).toBeGreaterThan(10);
    for (const p of pedacos) expect(p.length).toBe(FALA_TAXA * 0.08);
    const niveis = pedacos.map(nivelRms);
    expect(Math.max(...niveis)).toBeGreaterThan(0.2);
    expect(Math.min(...niveis.slice(0, -1))).toBeLessThan(Math.max(...niveis) * 0.6);
  });

  test("a síntese para com o abort, e a saída solta o pedaço no limpar", async () => {
    const abort = new AbortController();
    const recebidos: number[] = [];
    for await (const p of sinteseFalsa().sintetizar("Uma frase comprida para ter vários pedaços.", abort.signal)) {
      recebidos.push(p.length);
      if (recebidos.length === 2) abort.abort();
    }
    expect(recebidos.length).toBe(2);
    const saida = saidaFalsa();
    let volume = -1;
    const t0 = performance.now();
    const tocou = saida.tocar(new Int16Array(FALA_TAXA), (v) => (volume = v));
    saida.limpar();
    await tocou;
    expect(volume).toBe(1);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
