// T28675: a ligação da voz do gato que o app usa (`ligarVozDoGato`). A fala do agente liga o player, e a boca do gato
// recebe o nível enquanto a voz toca e o `null` no fim. Síntese e saída falsas: nada toca.
import { expect, test } from "bun:test";
import type { FalaNaTela, Pcm, SaidaFala, SinteseFala } from "../agent/fala-player.ts";
import { ligarVozDoGato } from "./cat-voice-output.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
const esperar = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await tick();
};
const tom = (n: number, amp: number): Pcm => Int16Array.from({ length: n }, (_, i) => (i % 2 ? amp : -amp));

function montar(o: { volume?: number; pedacos?: number } = {}) {
  const fala = new Set<(e: { turnId: string; frases: string[] }) => void>();
  const helper = new Map<string, Set<() => void>>();
  const naTela: FalaNaTela[] = [];
  const sintese: SinteseFala = {
    async *sintetizar(_frase, signal) {
      for (let i = 0; i < (o.pedacos ?? 3) && !signal.aborted; i++) yield tom(480, 8000);
    },
  };
  const saida: SaidaFala = {
    async tocar(_pcm, aoTocar) {
      aoTocar(o.volume ?? 1);
      await tick();
    },
    limpar() {},
  };
  const voz = ligarVozDoGato({
    sintese,
    saida,
    agent: {
      onSpeech: (fn) => {
        fala.add(fn);
        return () => fala.delete(fn);
      },
    },
    helper: {
      on: (t, fn) => {
        const s = helper.get(t) ?? new Set();
        helper.set(t, s);
        s.add(fn);
        return () => s.delete(fn);
      },
    },
    naTela: (e) => naTela.push(e),
  });
  return {
    voz,
    naTela,
    falar: (turnId: string) => {
      for (const fn of fala) fn({ turnId, frases: ["Oi."] });
    },
    helper: (t: string) => {
      for (const fn of helper.get(t) ?? []) fn();
    },
    ouvintes: () => fala.size + [...helper.values()].reduce((n, s) => n + s.size, 0),
  };
}

test("a fala do agente abre a boca do gato pelo nível e fecha com null no fim", async () => {
  const m = montar({ volume: 0.5 });
  m.falar("t1");
  await esperar(() => m.naTela.at(-1)?.nivel === null);
  // 3 pedaços, o 0 do encerrar (a boca fecha) e o null do fim.
  expect(m.naTela.map((e) => (e.nivel === null ? null : e.nivel > 0 ? "abre" : 0))).toEqual(["abre", "abre", "abre", 0, null]);
  const niveis = m.naTela.slice(0, 3).map((e) => e.nivel);
  // O nível é o do pedaço com o volume da saída (o tom tem RMS 8000/32768 ≈ 0,244; × 0,5).
  for (const n of niveis) expect(n!).toBeCloseTo((8000 / 32768) * 0.5, 3);
  expect(m.naTela.every((e) => e.turnId === "t1")).toBe(true);
  expect(m.naTela.at(-1)).toEqual({ turnId: "t1", nivel: null });
  m.voz.stop();
});

test("o atalho da pessoa corta a fala, e a boca fecha", async () => {
  const m = montar({ pedacos: 50 });
  m.falar("t1");
  await esperar(() => m.naTela.length >= 2);
  m.helper("agent.record.started");
  await esperar(() => m.naTela.at(-1)?.nivel === null);
  expect(m.naTela.at(-1)).toEqual({ turnId: "t1", nivel: null });
  expect(m.voz.player.falando).toBeUndefined();
  m.voz.stop();
});

test("desligar cala a voz, fecha a boca e solta o agente e o helper", async () => {
  const m = montar({ pedacos: 50 });
  expect(m.ouvintes()).toBeGreaterThan(0);
  m.falar("t1");
  await esperar(() => m.naTela.length >= 2);
  m.voz.stop();
  await esperar(() => m.naTela.at(-1)?.nivel === null);
  expect(m.naTela.at(-1)).toEqual({ turnId: "t1", nivel: null });
  expect(m.ouvintes()).toBe(0);
});

test("sem a prévia (o headless), a ligação não cria nenhuma", () => {
  const m = montar();
  expect(m.voz.previa).toBeUndefined();
  m.voz.stop();
});
