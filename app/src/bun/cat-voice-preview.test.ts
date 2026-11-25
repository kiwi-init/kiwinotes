// O Ouvir dos Ajustes (T27778): a prévia com uma síntese e uma saída falsas, sem processo e sem alto-falante.

import { expect, test } from "bun:test";

import type { CatVoiceId } from "../shared/cat-voices.ts";
import { CatVoicePreview, saidaMuda, type SaidaPrevia } from "./cat-voice-preview.ts";
import type { SinteseFala } from "./voice-process.ts";

const FRASES: Partial<Record<CatVoiceId, string[]>> = { "en-a": ["Primeira frase.", "Segunda frase."], "en-b": ["Outra voz."] };

function make(o: { falaDoGato?: () => Promise<unknown> | null } = {}) {
  const tocados: string[] = [];
  const mudancas: (CatVoiceId | null)[] = [];
  let limpezas = 0;
  /** Cada frase vira 3 pedaços, um a cada 20 ms, marcados com a voz e a frase. */
  const sintese = (id: CatVoiceId): SinteseFala => ({
    async *sintetizar(frase, signal) {
      for (let i = 0; i < 3; i++) {
        await Bun.sleep(20);
        if (signal.aborted) return;
        const pcm = new Int16Array(4) as Int16Array & { tag?: string };
        pcm.tag = `${id}:${frase}:${i}`;
        yield pcm;
      }
    },
  });
  const saida: SaidaPrevia = {
    async tocar(pcm) {
      tocados.push((pcm as Int16Array & { tag: string }).tag);
    },
    limpar() {
      limpezas++;
    },
  };
  const p = new CatVoicePreview({
    sintese,
    frases: (id) => FRASES[id] ?? null,
    saida,
    ...(o.falaDoGato ? { falaDoGato: o.falaDoGato } : {}),
    onChange: (id) => mudancas.push(id),
  });
  return { p, tocados, mudancas, limpezas: () => limpezas };
}

test("toca o texto fixo inteiro na voz da linha, e avisa o começo e o fim", async () => {
  const { p, tocados, mudancas } = make();
  await p.ouvir("en-b");
  expect(tocados).toEqual(["en-b:Outra voz.:0", "en-b:Outra voz.:1", "en-b:Outra voz.:2"]);
  expect(mudancas).toEqual(["en-b", null]);
  expect(p.tocando).toBeNull();
});

test("uma prévia nova corta a anterior: a saída é limpa e só a nova chega ao fim", async () => {
  const { p, tocados, mudancas, limpezas } = make();
  const primeira = p.ouvir("en-a");
  await Bun.sleep(30);
  expect(p.tocando).toBe("en-a");
  const segunda = p.ouvir("en-b");
  await Promise.all([primeira, segunda]);
  expect(limpezas()).toBe(1);
  // Da en-a, só o que tocou antes do corte; nada da segunda frase dela.
  expect(tocados.filter((t) => t.startsWith("en-a")).every((t) => t.startsWith("en-a:Primeira"))).toBe(true);
  expect(tocados.filter((t) => t.startsWith("en-b"))).toEqual(["en-b:Outra voz.:0", "en-b:Outra voz.:1", "en-b:Outra voz.:2"]);
  expect(mudancas).toEqual(["en-a", null, "en-b", null]);
});

test("durante a fala do gato, a prévia espera ela acabar", async () => {
  let acabar!: () => void;
  let fala: Promise<void> | null = new Promise<void>((r) => (acabar = r));
  const { p, tocados } = make({ falaDoGato: () => fala });
  const prev = p.ouvir("en-b");
  await Bun.sleep(80);
  expect(tocados).toEqual([]);
  expect(p.tocando).toBe("en-b");
  fala = null;
  acabar();
  await prev;
  expect(tocados.length).toBe(3);
});

test("parar durante a espera da fala do gato não toca nada", async () => {
  const { p, tocados } = make({ falaDoGato: () => new Promise(() => {}) });
  const prev = p.ouvir("en-a");
  await Bun.sleep(20);
  p.parar();
  await prev;
  expect(tocados).toEqual([]);
  expect(p.tocando).toBeNull();
});

test("a voz sem prévia (em breve) é recusada, e a que toca segue", async () => {
  const { p } = make();
  await expect(p.ouvir("pt-a")).rejects.toThrow(/ainda não tem prévia/);
});

test("um erro na síntese vai ao log e não ao chamador", async () => {
  const logs: string[] = [];
  const p = new CatVoicePreview({
    sintese: () => ({
      // eslint-disable-next-line require-yield
      async *sintetizar() {
        throw new Error("a voz en-a não foi baixada");
      },
    }),
    frases: () => ["x"],
    saida: saidaMuda(),
    log: (m) => logs.push(m),
  });
  await p.ouvir("en-a");
  expect(logs).toEqual(["prévia en-a: a voz en-a não foi baixada"]);
  expect(p.tocando).toBeNull();
});

test("a saída muda espera o tempo do pedaço, e o limpar solta na hora", async () => {
  const s = saidaMuda(24_000);
  const t0 = performance.now();
  await s.tocar(new Int16Array(2400), () => {});
  expect(performance.now() - t0).toBeGreaterThanOrEqual(90);
  const longo = s.tocar(new Int16Array(240_000), () => {});
  const t1 = performance.now();
  s.limpar();
  await longo;
  expect(performance.now() - t1).toBeLessThan(100);
});
