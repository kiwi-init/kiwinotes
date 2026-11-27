// T28675: a ligação da voz do gato que o app usa (`ligarVozDoGato`). A fala do agente liga o player, e a boca do gato
// recebe o nível enquanto a voz toca e o `null` no fim. Síntese e saída falsas: nada toca.
import { expect, test } from "bun:test";
import type { FalaNaTela, Pcm, SaidaFala, SinteseFala } from "../agent/fala-player.ts";
import { ligarVozDoGato, ligarVozDoGatoNoApp } from "./cat-voice-output.ts";
import { ElevenLabsError } from "./elevenlabs-voice.ts";

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

// T29234: a ligação inteira do app (`ligarVozDoGatoNoApp`, que o `startCatVoiceOutput` chama), com um helper falso
// que responde como o de verdade: o `speech.play` devolve o volume, e o `speech.played` vem logo depois.
function montarNoApp() {
  const ordem: string[] = [];
  const played = new Set<(e: { seq: number }) => void>();
  const closes = new Set<() => void>();
  const eventos = new Map<string, Set<() => void>>();
  const fala = new Set<(e: { turnId: string; frases: string[] }) => void>();
  const janelas = [[], []] as FalaNaTela[][];
  const gato: FalaNaTela[] = [];
  let overlay: { speech(e: FalaNaTela): void } | undefined;
  let saidaDaPrevia: SaidaFala | undefined;
  const voz = ligarVozDoGatoNoApp({
    sintese: {
      async *sintetizar() {
        for (let i = 0; i < 3; i++) yield tom(480, 8000);
      },
    },
    agent: {
      onSpeech: (fn) => {
        fala.add(fn);
        return () => fala.delete(fn);
      },
    },
    helper: {
      saida: {
        async request(c) {
          ordem.push(`play:${c.seq}`);
          setTimeout(() => {
            for (const fn of played) fn({ seq: c.seq });
          }, 0);
          return { data: { volume: 0.5 } };
        },
        async send() {
          ordem.push("stop");
        },
        on: (_t, fn) => {
          played.add(fn);
          return () => played.delete(fn);
        },
        onClose: (fn) => {
          closes.add(fn);
          return () => closes.delete(fn);
        },
      },
      midia: {
        async request(c) {
          ordem.push(c.type);
          return {};
        },
      },
      eventos: {
        on: (t, fn) => {
          const s = eventos.get(t) ?? new Set();
          eventos.set(t, s);
          s.add(fn);
          return () => s.delete(fn);
        },
      },
    },
    janelas: () => janelas.map((caixa) => ({ send: { event: (e: { name: "agent.speech"; payload: FalaNaTela }) => void caixa.push(e.payload) } })),
    overlay: () => overlay,
    previa: (saida) => {
      saidaDaPrevia = saida;
      return { parar() {} };
    },
  });
  return {
    voz,
    ordem,
    janelas,
    gato,
    saidaDaPrevia: () => saidaDaPrevia,
    subirOverlay: () => (overlay = { speech: (e) => void gato.push(e) }),
    falar: async (turnId: string) => {
      for (const fn of fala) fn({ turnId, frases: ["Oi."] });
      await esperar(() => janelas[0]!.some((e) => e.turnId === turnId && e.nivel === null));
    },
    ouvintes: () => played.size + closes.size + fala.size + [...eventos.values()].reduce((n, s) => n + s.size, 0),
  };
}

test("no app, a fala abaixa a mídia antes do 1º pedaço e devolve depois do último", async () => {
  const m = montarNoApp();
  await m.falar("t1");
  await esperar(() => m.ordem.includes("speech.unduck"));
  expect(m.ordem).toEqual(["speech.duck", "play:1", "play:2", "play:3", "speech.unduck"]);
  m.voz.stop();
});

test("no app, a boca vai a todas as janelas abertas, e ao gato do overlay quando ele sobe", async () => {
  const m = montarNoApp();
  await m.falar("t1");
  const boca = (es: FalaNaTela[]) => es.map((e) => (e.nivel === null ? null : e.nivel > 0 ? "abre" : 0));
  for (const j of m.janelas) expect(boca(j)).toEqual(["abre", "abre", "abre", 0, null]);
  expect(m.gato).toEqual([]); // o overlay ainda não tinha subido
  m.subirOverlay();
  await m.falar("t2");
  expect(boca(m.gato)).toEqual(["abre", "abre", "abre", 0, null]);
  expect(m.gato.every((e) => e.turnId === "t2")).toBe(true);
  m.voz.stop();
});

test("no app, a prévia recebe a mesma saída, e desligar solta o helper e o agente", async () => {
  const m = montarNoApp();
  expect(m.saidaDaPrevia()).toBeDefined();
  expect(m.ouvintes()).toBeGreaterThan(0);
  m.voz.stop();
  expect(m.ouvintes()).toBe(0); // o `saida.dispose()` também tira o speech.played e o fechar do helper
});

test("falarUmaVez (o Testar do ElevenLabs, spec #31616): cala o gato, toca na mesma saída e rejeita com o motivo", async () => {
  const m = montar({ pedacos: 50 });
  m.falar("t1");
  await esperar(() => m.naTela.length >= 2);
  const tocados: number[] = [];
  const teste: SinteseFala = {
    async *sintetizar(frase) {
      expect(frase).toBe("Oi, este é um teste.");
      yield Int16Array.from([7]);
      yield Int16Array.from([8]);
    },
  };
  // A saída do montar não guarda o que tocou: troca por uma que guarda, a mesma para o player e o teste.
  const saida: SaidaFala = { async tocar(pcm, aoTocar) { tocados.push(pcm[0]!); aoTocar(1); await tick(); }, limpar() {} };
  const fala = new Set<(e: { turnId: string; frases: string[] }) => void>();
  const voz = ligarVozDoGato({ sintese: { async *sintetizar() {} }, saida, agent: { onSpeech: (fn) => (fala.add(fn), () => fala.delete(fn)) }, naTela: () => {} });
  await voz.falarUmaVez(teste, "Oi, este é um teste.");
  expect(tocados).toEqual([7, 8]);
  // O gato que falava foi calado.
  await m.voz.falarUmaVez(teste, "Oi, este é um teste.");
  await esperar(() => m.naTela.at(-1)?.nivel === null);
  expect(m.naTela.at(-1)).toEqual({ turnId: "t1", nivel: null });
  const falha: SinteseFala = {
    // biome-ignore lint/correctness/useYield: falha antes do 1º pedaço
    async *sintetizar() {
      throw new ElevenLabsError("voice_not_found", 404);
    },
  };
  await expect(voz.falarUmaVez(falha, "Oi, este é um teste.")).rejects.toMatchObject({ reason: "voice_not_found" });
  voz.stop();
  m.voz.stop();
});

test("falarUmaVez: o gato voltando a falar corta o teste", async () => {
  const fala = new Set<(e: { turnId: string; frases: string[] }) => void>();
  let limpou = 0;
  const saida: SaidaFala = { async tocar(_p, aoTocar) { aoTocar(1); await tick(); }, limpar() { limpou++; } };
  const voz = ligarVozDoGato({ sintese: { async *sintetizar() { yield tom(10, 100); } }, saida, agent: { onSpeech: (fn) => (fala.add(fn), () => fala.delete(fn)) }, naTela: () => {} });
  let vistos = 0;
  const longo: SinteseFala = {
    async *sintetizar(_f, signal) {
      for (let i = 0; i < 1000 && !signal.aborted; i++) {
        vistos++;
        yield tom(10, 100);
      }
    },
  };
  const p = voz.falarUmaVez(longo, "Teste.");
  await esperar(() => vistos >= 3);
  for (const fn of fala) fn({ turnId: "t2", frases: ["Oi."] });
  await p;
  expect(vistos).toBeLessThan(1000);
  expect(limpou).toBeGreaterThan(0);
  voz.stop();
});

for (const evento of ["agent.record.started", "meeting.started", "record.started"] as const) {
  test(`falarUmaVez: o ${evento} corta a fala (o aviso do Calendário não cai na transcrição, T32156)`, async () => {
    const helper = new Map<string, Set<() => void>>();
    let limpou = 0;
    const saida: SaidaFala = { async tocar(_p, aoTocar) { aoTocar(1); await tick(); }, limpar() { limpou++; } };
    const voz = ligarVozDoGato({
      sintese: { async *sintetizar() {} },
      saida,
      agent: { onSpeech: () => () => {} },
      helper: { on: (t, fn) => { const s = helper.get(t) ?? new Set(); s.add(fn); helper.set(t, s); return () => s.delete(fn); } },
      naTela: () => {},
    });
    let vistos = 0;
    const longo: SinteseFala = {
      async *sintetizar(_f, signal) {
        for (let i = 0; i < 1000 && !signal.aborted; i++) {
          vistos++;
          yield tom(10, 100);
        }
      },
    };
    const p = voz.falarUmaVez(longo, "Aviso.");
    await esperar(() => vistos >= 3);
    for (const fn of helper.get(evento) ?? []) fn();
    await p;
    expect(vistos).toBeLessThan(1000);
    expect(limpou).toBeGreaterThan(0);
    voz.stop();
    expect([...helper.values()].reduce((n, s) => n + s.size, 0)).toBe(0);
  });
}

test("falarUmaVez que falha não deixa o teste guardado: a próxima fala do gato não limpa a saída à toa", async () => {
  const fala = new Set<(e: { turnId: string; frases: string[] }) => void>();
  let limpou = 0;
  const naTela: FalaNaTela[] = [];
  const saida: SaidaFala = {
    async tocar(_p, aoTocar) {
      aoTocar(1);
      await tick();
    },
    limpar() {
      limpou++;
    },
  };
  const voz = ligarVozDoGato({
    sintese: {
      async *sintetizar() {
        yield tom(10, 100);
      },
    },
    saida,
    agent: { onSpeech: (fn) => (fala.add(fn), () => fala.delete(fn)) },
    naTela: (e) => naTela.push(e),
  });
  const falha: SinteseFala = {
    // biome-ignore lint/correctness/useYield: falha antes do 1º pedaço
    async *sintetizar() {
      throw new ElevenLabsError("network");
    },
  };
  await expect(voz.falarUmaVez(falha, "Teste.")).rejects.toMatchObject({ reason: "network" });
  const antes = limpou;
  for (const fn of fala) fn({ turnId: "t1", frases: ["Oi."] });
  await esperar(() => naTela.at(-1)?.nivel === null);
  expect(limpou).toBe(antes);
  voz.stop();
});
