// T27825: a saída de verdade da voz do gato, contra um helper falso. Nada sai no alto-falante.
import { describe, expect, test } from "bun:test";
import { FalaPlayer, type FalaEvento } from "../agent/fala-player.ts";
import { pcmBase64, saidaHelper, type SpeechHelper } from "./speech-output.ts";
import { CatVoicePreview } from "./cat-voice-preview.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** O helper falso: guarda cada `speech.play`, e o teste diz quando um pedaço acabou (`tocou`). */
function fakeHelper(o: { volume?: number; falha?: boolean } = {}) {
  const plays: { seq: number; pcm: string }[] = [];
  /** Os comandos na ordem em que chegam ao helper: `play:<seq>` e `stop`. */
  const ordem: string[] = [];
  let stops = 0;
  const played = new Set<(e: { seq: number }) => void>();
  const closes = new Set<() => void>();
  const helper: SpeechHelper = {
    async request(c) {
      if (o.falha) throw new Error("speech_output");
      plays.push({ seq: c.seq, pcm: c.pcm });
      ordem.push(`play:${c.seq}`);
      return { data: { volume: o.volume ?? 0.5 } };
    },
    async send() {
      stops++;
      ordem.push("stop");
    },
    on(_t, fn) {
      played.add(fn);
      return () => played.delete(fn);
    },
    onClose(fn) {
      closes.add(fn);
      return () => closes.delete(fn);
    },
  };
  return {
    helper,
    plays,
    ordem,
    get stops() {
      return stops;
    },
    tocou(seq: number) {
      for (const fn of played) fn({ seq });
    },
    caiu() {
      for (const fn of closes) fn();
    },
  };
}

const pcm = (n: number, v = 1000) => new Int16Array(n).fill(v);

describe("saidaHelper (T27825)", () => {
  test("o PCM vai em base64, Int16 little-endian", () => {
    expect(pcmBase64(new Int16Array([1, -2]))).toBe(Buffer.from([1, 0, 0xfe, 0xff]).toString("base64"));
    // Uma fatia de um buffer maior leva só ela.
    const big = new Int16Array([9, 1, -2, 9]);
    expect(pcmBase64(big.subarray(1, 3))).toBe(Buffer.from([1, 0, 0xfe, 0xff]).toString("base64"));
  });

  test("o tocar resolve quando o pedaço começa: o próximo chega ao helper com este ainda tocando", async () => {
    const f = fakeHelper();
    const saida = saidaHelper(f.helper);
    const comecou: number[] = [];
    let um = false;
    let dois = false;
    void saida.tocar(pcm(1920), (v) => comecou.push(v)).then(() => (um = true));
    await tick();
    expect(um).toBe(true); // nada antes dele: começa na hora
    void saida.tocar(pcm(1920), (v) => comecou.push(v)).then(() => (dois = true));
    await tick();
    expect(f.plays.map((p) => p.seq)).toEqual([1, 2]); // o 2º já está no helper
    expect(dois).toBe(false); // e só começa quando o 1º acaba
    f.tocou(1);
    await tick();
    expect(dois).toBe(true);
    expect(comecou).toEqual([0.5, 0.5]); // o volume do helper vai ao nível
    saida.dispose();
  });

  test("limpar manda o stop, solta o tocar pendente e ignora o played atrasado", async () => {
    const f = fakeHelper();
    const saida = saidaHelper(f.helper);
    void saida.tocar(pcm(1920), () => {});
    let solto = false;
    const chamadas: number[] = [];
    void saida.tocar(pcm(1920), () => chamadas.push(1)).then(() => (solto = true));
    await tick();
    saida.limpar();
    await tick();
    expect(f.stops).toBe(1);
    expect(solto).toBe(true);
    f.tocou(1);
    f.tocou(2);
    expect(chamadas).toEqual([]); // o limpo não "começa" depois
    saida.dispose();
  });

  test("o helper caiu: o tocar que não começou rejeita; o erro do play também", async () => {
    const f = fakeHelper();
    const saida = saidaHelper(f.helper);
    void saida.tocar(pcm(1920), () => {});
    const segundo = saida.tocar(pcm(1920), () => {});
    await tick();
    f.caiu();
    await expect(segundo).rejects.toThrow("o helper caiu");
    saida.dispose();
    const g = fakeHelper({ falha: true });
    await expect(saidaHelper(g.helper).tocar(pcm(10), () => {})).rejects.toThrow("speech_output");
  });

  test("um played que não chega não prende a fala: o pedaço acaba depois do tempo dele", async () => {
    const f = fakeHelper();
    const logs: string[] = [];
    // 240 amostras a 24 kHz = 10 ms, mais 5 ms de folga.
    const saida = saidaHelper(f.helper, { folgaMs: 5, log: (m) => logs.push(m) });
    void saida.tocar(pcm(240), () => {});
    const segundo = saida.tocar(pcm(240), () => {});
    await segundo;
    expect(logs[0]).toContain("o pedaço 1 não voltou");
    saida.dispose();
  });

  test("o fim da fala espera o último pedaço acabar de tocar (drenar)", async () => {
    const f = fakeHelper();
    const saida = saidaHelper(f.helper);
    const eventos: FalaEvento[] = [];
    const player = new FalaPlayer({
      sintese: {
        async *sintetizar() {
          yield pcm(1920);
          yield pcm(1920);
        },
      },
      saida,
      evento: (e) => eventos.push(e),
    });
    let acabou = false;
    void player.falar({ turnId: "t1", frases: ["a"] }).then(() => (acabou = true));
    for (let i = 0; i < 20 && f.plays.length < 2; i++) await tick();
    f.tocou(1);
    for (let i = 0; i < 10; i++) await tick();
    expect(acabou).toBe(false); // o 2º ainda toca
    expect(eventos.some((e) => e.tipo === "terminou")).toBe(false);
    f.tocou(2);
    for (let i = 0; i < 10 && !acabou; i++) await tick();
    expect(acabou).toBe(true);
    expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "fim" });
    saida.dispose();
  });

  test("com o FalaPlayer: os pedaços na ordem, o nível com o volume do helper e o corte no cancelar", async () => {
    const f = fakeHelper({ volume: 0.5 });
    const saida = saidaHelper(f.helper);
    const eventos: FalaEvento[] = [];
    const player = new FalaPlayer({
      sintese: {
        async *sintetizar(frase) {
          for (let i = 0; i < 3; i++) yield pcm(1920, frase === "a" ? 16384 : 8192);
        },
      },
      saida,
      evento: (e) => eventos.push(e),
    });
    const fim = player.falar({ turnId: "t1", frases: ["a", "b"] });
    for (let i = 0; i < 20 && f.plays.length < 2; i++) await tick();
    expect(f.plays.length).toBe(2); // o 1º tocando e o 2º na fila do helper, nunca mais
    const niveis = eventos.filter((e) => e.tipo === "nivel").map((e) => (e as { nivel: number }).nivel);
    expect(niveis[0]).toBeCloseTo(0.25, 5); // RMS 0,5 × volume 0,5
    f.tocou(1);
    for (let i = 0; i < 20 && f.plays.length < 3; i++) await tick();
    expect(f.plays.map((p) => p.seq)).toEqual([1, 2, 3]);
    player.cancelar();
    await fim;
    expect(f.stops).toBe(1);
    // Cancelado com a fila cheia: o drenar não prende nada.
    await saida.drenar();
    expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "cancelado" });
    saida.dispose();
  });

  describe("a fala do gato e o Ouvir dividem a saída (#28376)", () => {
    const GATO = pcmBase64(pcm(1920, 2222));
    const PREVIA = pcmBase64(pcm(1920, 1111));
    /** Ligados como no app (`startCatVoiceOutput`, src/bun/windows.ts). */
    function montar() {
      const f = fakeHelper();
      const saida = saidaHelper(f.helper);
      const eventos: FalaEvento[] = [];
      let previa: CatVoicePreview | undefined;
      const player = new FalaPlayer({
        sintese: {
          async *sintetizar() {
            for (let i = 0; i < 3; i++) yield pcm(1920, 2222);
          },
        },
        saida,
        antesDeFalar: () => previa?.parar(),
        evento: (e) => eventos.push(e),
      });
      previa = new CatVoicePreview({
        sintese: () => ({
          async *sintetizar(_frase, signal) {
            for (let i = 0; i < 6 && !signal.aborted; i++) yield pcm(1920, 1111);
          },
        }),
        frases: () => ["Olá."],
        saida,
        falaDoGato: () => player.falaAtual,
      });
      const quem = (seq: number) => (f.plays.find((p) => p.seq === seq)?.pcm === GATO ? "gato" : "previa");
      return { f, saida, player, previa, eventos, quem };
    }
    const esperar = async (ok: () => boolean) => {
      for (let i = 0; i < 50 && !ok(); i++) await tick();
    };

    test("o gato fala durante uma prévia: a prévia para antes, e a fila fica só com a voz dele", async () => {
      const { f, saida, player, previa, eventos, quem } = montar();
      void previa.ouvir("pt-a");
      await esperar(() => f.plays.length >= 2);
      expect(f.plays.map((p) => p.pcm)).toEqual([PREVIA, PREVIA]);
      let acabou = false;
      void player.falar({ turnId: "t1", frases: ["a"] }).then(() => (acabou = true));
      await esperar(() => f.plays.some((p) => p.pcm === GATO));
      // O stop da prévia vai antes do 1º pedaço do gato, e depois dele só vem a voz do gato.
      const primeiroGato = f.ordem.findIndex((o) => o.startsWith("play:") && quem(Number(o.slice(5))) === "gato");
      expect(f.ordem.slice(0, primeiroGato)).toContain("stop");
      expect(f.ordem.slice(primeiroGato).filter((o) => o !== "stop").map((o) => quem(Number(o.slice(5))))).toEqual(
        f.ordem.slice(primeiroGato).filter((o) => o !== "stop").map(() => "gato"),
      );
      expect(previa.tocando).toBeNull();
      // O terminou do gato espera só os pedaços dele.
      for (let i = 0; i < 5 && !acabou; i++) {
        for (const p of [...f.plays].filter((p) => p.pcm === GATO)) f.tocou(p.seq);
        await esperar(() => acabou);
      }
      expect(acabou).toBe(true);
      expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "fim" });
      expect(f.plays.filter((p) => p.pcm === GATO).length).toBe(3);
      expect(f.plays.filter((p) => p.pcm === PREVIA).length).toBe(2); // nenhum pedaço da prévia depois do gato
      saida.dispose();
    });

    test("a prévia que espera a fala do gato, parada, não corta o gato", async () => {
      const { f, saida, player, previa, quem } = montar();
      void player.falar({ turnId: "t1", frases: ["a"] });
      await esperar(() => f.plays.length >= 2);
      void previa.ouvir("pt-a");
      await tick();
      expect(previa.tocando).toBe("pt-a");
      previa.parar();
      await tick();
      expect(f.stops).toBe(0);
      expect(f.plays.map((p) => quem(p.seq))).toEqual(["gato", "gato"]);
      expect(player.falando).toBe("t1");
      player.cancelar();
      saida.dispose();
    });
  });
});
