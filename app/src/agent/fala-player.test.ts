import { describe, expect, test } from "bun:test";
import { type FalaEvento, FalaPlayer, falaNaTela, ligarFalaPlayer, nivelRms, type Pcm, type SaidaFala, type SinteseFala } from "./fala-player.ts";

// Tudo falso (T26734): a síntese devolve PCM sintético, a saída só anota. Nada sai no alto-falante.

/** Um pedaço com amplitude fixa, para o nível ser previsível; o 1º valor marca a frase e o pedaço. */
const pedaco = (amp: number, marca: number, n = 160): Pcm => {
  const a = new Int16Array(n).fill(amp);
  a[0] = marca;
  return a;
};

/** Uma síntese que solta os pedaços quando o teste manda (`soltar`), para controlar a ordem. */
class SinteseFalsa implements SinteseFala {
  pedidas: string[] = [];
  abortadas = 0;
  private esperas: (() => void)[] = [];
  constructor(
    private readonly porFrase = 2,
    private readonly manual = false,
    private readonly falhaEm?: string,
  ) {}
  soltar(): void {
    this.esperas.shift()?.();
  }
  async *sintetizar(frase: string, signal: AbortSignal): AsyncIterable<Pcm> {
    const idx = this.pedidas.push(frase) - 1;
    signal.addEventListener("abort", () => this.abortadas++, { once: true });
    for (let i = 0; i < this.porFrase; i++) {
      if (this.manual) await new Promise<void>((r) => this.esperas.push(r));
      else await Promise.resolve();
      if (frase === this.falhaEm) throw new Error("modelo caiu");
      // Uma síntese de verdade pode soltar um pedaço já abortado: o player tem que jogá-lo fora.
      yield pedaco(8000, idx * 10 + i);
    }
  }
}

class SaidaFalsa implements SaidaFala {
  tocados: number[] = [];
  limpezas = 0;
  volume = 0.5;
  async tocar(pcm: Pcm, aoTocar: (volume: number) => void): Promise<void> {
    this.tocados.push(pcm[0]!);
    aoTocar(this.volume);
    await Promise.resolve();
  }
  limpar(): void {
    this.limpezas++;
  }
}

const tique = () => new Promise<void>((r) => setTimeout(r, 0));

function montar(sintese = new SinteseFalsa()) {
  const saida = new SaidaFalsa();
  const midia = { log: [] as string[], abaixar() { this.log.push("abaixar"); }, devolver() { this.log.push("devolver"); } };
  const eventos: FalaEvento[] = [];
  const player = new FalaPlayer({ sintese, saida, midia, evento: (e) => eventos.push(e) });
  return { player, sintese, saida, midia, eventos };
}

describe("FalaPlayer (T26734)", () => {
  test("toca os pedaços de cada frase na ordem, abaixa a mídia e devolve no fim", async () => {
    const { player, sintese, saida, midia, eventos } = montar();
    await player.falar({ turnId: "t1", frases: ["Pronto.", "Anotei na nota Ideias."] });
    expect(sintese.pedidas).toEqual(["Pronto.", "Anotei na nota Ideias."]);
    expect(saida.tocados).toEqual([0, 1, 10, 11]);
    expect(midia.log).toEqual(["abaixar", "devolver"]);
    expect(eventos.at(0)).toEqual({ tipo: "comecou", turnId: "t1" });
    expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "fim" });
    expect(player.falando).toBeUndefined();
  });

  test("o nível é o do que tocou, com o volume da saída, e volta a 0 no fim", async () => {
    const { player, eventos } = montar(new SinteseFalsa(1));
    await player.falar({ turnId: "t1", frases: ["Oi."] });
    const niveis = eventos.filter((e) => e.tipo === "nivel").map((e) => (e as { nivel: number }).nivel);
    // 159 amostras em 8000 e uma marca em 0: o RMS fica perto de 8000/32768, vezes o volume 0,5.
    expect(niveis[0]).toBeCloseTo(nivelRms(pedaco(8000, 0)) * 0.5, 6);
    expect(niveis[0]).toBeGreaterThan(0.1);
    expect(niveis.at(-1)).toBe(0);
  });

  test("a voz começa antes do fim da síntese", async () => {
    const sintese = new SinteseFalsa(2, true);
    const { player, saida } = montar(sintese);
    const fim = player.falar({ turnId: "t1", frases: ["Uma.", "Duas."] });
    sintese.soltar();
    await tique();
    expect(saida.tocados).toEqual([0]); // a 1ª frase ainda está sendo gerada
    for (let i = 0; i < 3; i++) {
      sintese.soltar();
      await tique();
    }
    await fim;
    expect(saida.tocados).toEqual([0, 1, 10, 11]);
  });

  test("cancelar aborta a síntese, limpa a saída, devolve a mídia e ignora o pedaço atrasado", async () => {
    const sintese = new SinteseFalsa(3, true);
    const { player, saida, midia, eventos } = montar(sintese);
    const fim = player.falar({ turnId: "t1", frases: ["Uma frase longa."] });
    sintese.soltar();
    await tique();
    expect(saida.tocados).toEqual([0]);
    player.cancelar();
    expect(sintese.abortadas).toBe(1);
    expect(saida.limpezas).toBe(1);
    expect(midia.log).toEqual(["abaixar", "devolver"]);
    // O pedaço que a síntese solta depois do cancelamento não toca.
    sintese.soltar();
    sintese.soltar();
    await fim;
    await tique();
    expect(saida.tocados).toEqual([0]);
    const terminos = eventos.filter((e) => e.tipo === "terminou");
    expect(terminos).toEqual([{ tipo: "terminou", turnId: "t1", motivo: "cancelado" }]);
    expect(eventos.filter((e) => e.tipo === "nivel").at(-1)).toEqual({ tipo: "nivel", turnId: "t1", nivel: 0 });
  });

  test("um turno novo cancela o anterior, e só o novo toca dali em diante", async () => {
    const sintese = new SinteseFalsa(2, true);
    const { player, saida, midia, eventos } = montar(sintese);
    const fim1 = player.falar({ turnId: "t1", frases: ["Velha."] });
    sintese.soltar();
    await tique();
    const fim2 = player.falar({ turnId: "t2", frases: ["Nova."] });
    // A espera da 1ª frase (já abortada) e as duas da nova.
    for (let i = 0; i < 3; i++) {
      sintese.soltar();
      await tique();
    }
    await Promise.all([fim1, fim2]);
    expect(saida.tocados).toEqual([0, 10, 11]);
    expect(eventos.filter((e) => e.tipo === "terminou").map((e) => [e.turnId, (e as { motivo: string }).motivo])).toEqual([
      ["t1", "cancelado"],
      ["t2", "fim"],
    ]);
    expect(midia.log).toEqual(["abaixar", "devolver", "abaixar", "devolver"]);
  });

  test("numa reunião gravando, o gato fica mudo; depois dela, volta a falar", async () => {
    const sintese = new SinteseFalsa(2, true);
    const { player, saida, midia } = montar(sintese);
    const fim = player.falar({ turnId: "t1", frases: ["Antes."] });
    sintese.soltar();
    await tique();
    player.reuniao(true);
    sintese.soltar();
    await fim;
    expect(saida.tocados).toEqual([0]);
    await player.falar({ turnId: "t2", frases: ["Durante."] });
    expect(sintese.pedidas).toEqual(["Antes."]);
    expect(midia.log).toEqual(["abaixar", "devolver"]);
    player.reuniao(false);
    const depois = player.falar({ turnId: "t3", frases: ["Depois."] });
    for (let i = 0; i < 2; i++) {
      sintese.soltar();
      await tique();
    }
    await depois;
    expect(saida.tocados).toEqual([0, 10, 11]);
  });

  test("a síntese que falha encerra com erro e devolve a mídia", async () => {
    const { player, saida, midia, eventos } = montar(new SinteseFalsa(2, false, "Quebra."));
    await player.falar({ turnId: "t1", frases: ["Boa.", "Quebra."] });
    expect(saida.tocados).toEqual([0, 1]);
    expect(midia.log).toEqual(["abaixar", "devolver"]);
    expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "erro", erro: "modelo caiu" });
  });

  test("a saída que falha encerra com erro, para a síntese e devolve a mídia", async () => {
    const sintese = new SinteseFalsa(3);
    const saida = new SaidaFalsa();
    saida.tocar = async () => {
      throw new Error("saída caiu");
    };
    const midia = { log: [] as string[], abaixar() { this.log.push("abaixar"); }, devolver() { this.log.push("devolver"); } };
    const eventos: FalaEvento[] = [];
    const logs: string[] = [];
    const player = new FalaPlayer({ sintese, saida, midia, evento: (e) => eventos.push(e), log: (m) => logs.push(m) });
    await player.falar({ turnId: "t1", frases: ["Uma.", "Duas."] });
    expect(midia.log).toEqual(["abaixar", "devolver"]);
    expect(player.falando).toBeUndefined();
    expect(sintese.abortadas).toBe(1);
    expect(sintese.pedidas).toEqual(["Uma."]);
    expect(eventos.at(-1)).toEqual({ tipo: "terminou", turnId: "t1", motivo: "erro", erro: "saída caiu" });
    expect(logs).toEqual(["fala: a saída falhou: saída caiu"]);
  });

  test("um ouvinte que lança não derruba a fala", async () => {
    const sintese = new SinteseFalsa(1);
    const saida = new SaidaFalsa();
    const logs: string[] = [];
    const player = new FalaPlayer({ sintese, saida, evento: () => { throw new Error("ouvinte"); }, log: (m) => logs.push(m) });
    await player.falar({ turnId: "t1", frases: ["Uma.", "Duas."] });
    expect(saida.tocados).toEqual([0, 10]);
    expect(player.falando).toBeUndefined();
    expect(logs.length).toBeGreaterThan(0);
  });

  test("sem frases, nada acontece", async () => {
    const { player, sintese, midia, eventos } = montar();
    await player.falar({ turnId: "t1", frases: ["  "] });
    expect(sintese.pedidas).toEqual([]);
    expect(midia.log).toEqual([]);
    expect(eventos).toEqual([]);
  });
});

describe("ligarFalaPlayer (T26734)", () => {
  function ligar() {
    const sintese = new SinteseFalsa(2, true);
    const m = montar(sintese);
    let fala: ((e: { turnId: string; frases: string[] }) => void) | undefined;
    const ouvintes = new Map<string, () => void>();
    const desligar = ligarFalaPlayer(m.player, {
      agent: { onSpeech: (fn) => ((fala = fn), () => (fala = undefined)) },
      helper: { on: (type, fn) => (ouvintes.set(type, fn), () => ouvintes.delete(type)) },
    });
    return { ...m, sintese, fala: (e: { turnId: string; frases: string[] }) => fala?.(e), ouvintes, desligar };
  }

  for (const evento of ["agent.record.started", "catOverlay.close"]) {
    test(`${evento} cala o gato`, async () => {
      const { player, sintese, saida, fala, ouvintes } = ligar();
      fala({ turnId: "t1", frases: ["Oi."] });
      sintese.soltar();
      await tique();
      expect(player.falando).toBe("t1");
      ouvintes.get(evento)!();
      expect(player.falando).toBeUndefined();
      expect(saida.limpezas).toBe(1);
    });
  }

  test("meeting.started silencia e meeting.stopped libera", async () => {
    const { player, sintese, fala, ouvintes } = ligar();
    ouvintes.get("meeting.started")!();
    fala({ turnId: "t1", frases: ["Oi."] });
    expect(player.falando).toBeUndefined();
    expect(sintese.pedidas).toEqual([]);
    ouvintes.get("meeting.stopped")!();
    fala({ turnId: "t2", frases: ["Oi."] });
    expect(player.falando).toBe("t2");
  });

  test("uma falha do player vai ao log, sem rejeição solta", async () => {
    const logs: string[] = [];
    const player = new FalaPlayer({ sintese: new SinteseFalsa(1), saida: new SaidaFalsa() });
    player.falar = () => Promise.reject(new Error("quebrou"));
    let fala: ((e: { turnId: string; frases: string[] }) => void) | undefined;
    ligarFalaPlayer(player, { agent: { onSpeech: (fn) => ((fala = fn), () => {}) }, log: (m) => logs.push(m) });
    fala!({ turnId: "t1", frases: ["Oi."] });
    await tique();
    expect(logs).toEqual(["fala: o player falhou: quebrou"]);
  });

  test("desligar solta os ouvintes e cala", async () => {
    const { player, fala, ouvintes, desligar } = ligar();
    fala({ turnId: "t1", frases: ["Oi."] });
    desligar();
    expect(player.falando).toBeUndefined();
    expect(ouvintes.size).toBe(0);
  });
});

// T26829: o que vai ao gato. O nível do que tocou, e `null` no fim, no corte e no erro.
describe("falaNaTela (T26829)", () => {
  function rig() {
    const enviados: { turnId: string; nivel: number | null }[] = [];
    return { enviados, naTela: falaNaTela((e) => enviados.push(e)) };
  }

  test("o nível passa, e o terminou vira null, pelo fim, pelo corte e pelo erro", () => {
    for (const motivo of ["fim", "cancelado", "erro"] as const) {
      const { enviados, naTela } = rig();
      naTela({ tipo: "comecou", turnId: "t" });
      naTela({ tipo: "nivel", turnId: "t", nivel: 0.3 });
      naTela({ tipo: "nivel", turnId: "t", nivel: 0.6 });
      naTela({ tipo: "nivel", turnId: "t", nivel: 0 });
      naTela({ tipo: "terminou", turnId: "t", motivo });
      expect(enviados).toEqual([
        { turnId: "t", nivel: 0.3 },
        { turnId: "t", nivel: 0.6 },
        { turnId: "t", nivel: 0 },
        { turnId: "t", nivel: null },
      ]);
    }
  });

  test("um turno cortado antes do 1º pedaço não abre a boca do gato", () => {
    const { enviados, naTela } = rig();
    naTela({ tipo: "comecou", turnId: "t" });
    naTela({ tipo: "nivel", turnId: "t", nivel: 0 });
    naTela({ tipo: "terminou", turnId: "t", motivo: "cancelado" });
    expect(enviados).toEqual([]);
  });

  test("com o player de verdade: o corte no meio manda o null, e o turno novo fala de novo", async () => {
    const { enviados, naTela } = rig();
    const tocando: (() => void)[] = [];
    const saida: SaidaFala = {
      tocar: (_pcm, aoTocar) => new Promise<void>((r) => { aoTocar(1); tocando.push(r); }),
      limpar: () => { for (const r of tocando.splice(0)) r(); },
    };
    const sintese: SinteseFala = {
      async *sintetizar() { yield pedaco(16384, 1); yield pedaco(16384, 2); },
    };
    const player = new FalaPlayer({ sintese, saida, evento: naTela });
    const a = player.falar({ turnId: "a", frases: ["Uma frase."] });
    await Bun.sleep(1);
    player.cancelar();
    await a;
    expect(enviados.at(-1)).toEqual({ turnId: "a", nivel: null });
    expect(enviados.some((e) => e.turnId === "a" && typeof e.nivel === "number" && e.nivel > 0.4)).toBe(true);
    const b = player.falar({ turnId: "b", frases: ["Outra."] });
    await Bun.sleep(1);
    for (const r of tocando.splice(0)) r();
    await Bun.sleep(1);
    for (const r of tocando.splice(0)) r();
    await b;
    expect(enviados.filter((e) => e.turnId === "b").at(-1)).toEqual({ turnId: "b", nivel: null });
  });
});
