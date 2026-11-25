// O player da fala do gato (spec #26687, parte 5; T26734). Recebe as frases de um turno (`AgentService.onSpeech`,
// T26709), pede à síntese os pedaços de PCM frase a frase e os toca na ordem, sem esperar o fim da síntese.
// TypeScript puro: a síntese, a saída de áudio e a mídia vêm de fora, e os testes usam as falsas (nada sai no
// alto-falante).
//
// - **Um turno por vez:** as frases de um turno novo cancelam o anterior.
// - **Interromper** (o atalho da pessoa, o × do gato): `cancelar()` aborta a síntese, limpa os buffers da saída e
//   devolve a mídia. Um pedaço que chega depois, de um turno que já não vale, é jogado fora.
// - **Reunião gravando:** o gato fica mudo. `reuniao(true)` cancela o que estiver tocando e recusa as falas até
//   `reuniao(false)`.
// - **A mídia** abaixa no 1º pedaço tocado e volta no fim, no cancelamento ou no erro. A própria fala não é abaixada:
//   quem abaixa só os outros sons é a `MidiaFala` de fora.
// - **O nível** para a animação sai do que a saída diz que tocou (`aoTocar`, com o volume dela), não do que a síntese
//   gerou; no fim e no cancelamento, volta a 0.

/** PCM mono, 16 bits, na taxa `FALA_TAXA`. */
export type Pcm = Int16Array;

/** A taxa da voz do gato (o Qwen3-TTS, T26732): 24 kHz, mono. A síntese entrega pedaços de 80 ms (1920 amostras). */
export const FALA_TAXA = 24_000;

export interface SinteseFala {
  /** Os pedaços de uma frase, na ordem. Para com o `signal` abortado. */
  sintetizar(frase: string, signal: AbortSignal): AsyncIterable<Pcm>;
}

export interface SaidaFala {
  /**
   * Toca um pedaço; resolve quando ele terminou ou foi limpo, ou, numa saída com fila (`drenar`), quando ele começou a
   * sair, para o próximo entrar na fila sem buraco. `aoTocar` é chamado quando ele começa a sair, com o volume
   * aplicado pela saída (0 a 1).
   */
  tocar(pcm: Pcm, aoTocar: (volume: number) => void): Promise<void>;
  /** Esvazia o que está na fila da saída, na hora. */
  limpar(): void;
  /** Numa saída com fila (T27825): resolve quando tudo o que entrou acabou de tocar ou foi limpo. */
  drenar?(): Promise<void>;
}

/** Abaixa os outros sons durante a fala (spec #17697), sem abaixar a voz do gato. */
export interface MidiaFala {
  abaixar(): void;
  devolver(): void;
}

export type FalaEvento =
  | { tipo: "comecou"; turnId: string }
  | { tipo: "nivel"; turnId: string; nivel: number }
  | { tipo: "terminou"; turnId: string; motivo: "fim" | "cancelado" | "erro"; erro?: string };

export interface FalaPlayerOpts {
  sintese: SinteseFala;
  saida: SaidaFala;
  midia?: MidiaFala;
  evento?(e: FalaEvento): void;
  log?(m: string): void;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** O RMS de um pedaço, de 0 a 1. */
export function nivelRms(pcm: Pcm): number {
  if (pcm.length === 0) return 0;
  let soma = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]! / 32768;
    soma += v * v;
  }
  return Math.min(1, Math.sqrt(soma / pcm.length));
}

interface Turno {
  id: string;
  abort: AbortController;
  midiaBaixa: boolean;
  fim: Promise<void>;
}

export class FalaPlayer {
  private atual: Turno | undefined;
  private emReuniao = false;

  constructor(private readonly o: FalaPlayerOpts) {}

  /** A fala em andamento, se alguma: resolve quando ela acaba (o Ouvir dos Ajustes espera, T27778). */
  get falaAtual(): Promise<void> | undefined {
    return this.atual?.fim;
  }

  /** O turno que está falando, se algum. */
  get falando(): string | undefined {
    return this.atual?.id;
  }

  /** Fala as frases de um turno. Resolve quando ele terminou, foi cancelado ou deu erro. */
  falar(fala: { turnId: string; frases: readonly string[] }): Promise<void> {
    if (this.emReuniao) {
      this.o.log?.("fala: reunião gravando, o gato fica mudo");
      return Promise.resolve();
    }
    const frases = fala.frases.filter((f) => f.trim());
    if (frases.length === 0) return Promise.resolve();
    this.cancelar();
    const turno: Turno = { id: fala.turnId, abort: new AbortController(), midiaBaixa: false, fim: Promise.resolve() };
    this.atual = turno;
    turno.fim = this.rodar(turno, frases);
    return turno.fim;
  }

  /** Interrompe a fala: o atalho da pessoa ou o × do gato. */
  cancelar(): void {
    const t = this.atual;
    if (!t) return;
    this.atual = undefined;
    t.abort.abort();
    this.o.saida.limpar();
    this.encerrar(t, "cancelado");
  }

  /** Uma reunião começou (`true`) ou parou de gravar (`false`). */
  reuniao(ativa: boolean): void {
    this.emReuniao = ativa;
    if (ativa) this.cancelar();
  }

  private vale(t: Turno): boolean {
    return this.atual === t && !t.abort.signal.aborted;
  }

  /** Um ouvinte que lança não derruba a fala nem o encerramento: o erro vai ao log. */
  private emitir(e: FalaEvento): void {
    try {
      this.o.evento?.(e);
    } catch (err) {
      this.o.log?.(`fala: o evento ${e.tipo} falhou: ${mensagem(err)}`);
    }
  }

  private encerrar(t: Turno, motivo: "fim" | "cancelado" | "erro", erro?: string): void {
    if (t.midiaBaixa) {
      t.midiaBaixa = false;
      try {
        this.o.midia?.devolver();
      } catch (err) {
        this.o.log?.(`fala: devolver a mídia falhou: ${mensagem(err)}`);
      }
    }
    this.emitir({ tipo: "nivel", turnId: t.id, nivel: 0 });
    this.emitir({ tipo: "terminou", turnId: t.id, motivo, ...(erro ? { erro } : {}) });
  }

  private async rodar(t: Turno, frases: string[]): Promise<void> {
    this.emitir({ tipo: "comecou", turnId: t.id });
    // A síntese corre à frente da saída: os pedaços entram na fila e a saída os toca na ordem.
    const fila: Pcm[] = [];
    let sinteseAcabou = false;
    let erroSintese: unknown;
    let erroSaida: unknown;
    let acordar: (() => void) | undefined;
    const avisar = () => {
      const a = acordar;
      acordar = undefined;
      a?.();
    };
    const produtor = (async () => {
      try {
        for (const frase of frases) {
          for await (const pcm of this.o.sintese.sintetizar(frase, t.abort.signal)) {
            if (!this.vale(t)) return; // pedaço atrasado de um turno que já não vale
            fila.push(pcm);
            avisar();
          }
          if (!this.vale(t)) return;
        }
      } catch (e) {
        if (this.vale(t)) erroSintese = e;
      } finally {
        sinteseAcabou = true;
        avisar();
      }
    })();

    try {
      while (this.vale(t)) {
        const pcm = fila.shift();
        if (!pcm) {
          if (sinteseAcabou) break;
          await new Promise<void>((r) => {
            acordar = r;
            t.abort.signal.addEventListener("abort", () => r(), { once: true });
          });
          continue;
        }
        if (!t.midiaBaixa) {
          t.midiaBaixa = true;
          this.o.midia?.abaixar();
        }
        await this.o.saida.tocar(pcm, (volume) => {
          if (this.vale(t)) this.emitir({ tipo: "nivel", turnId: t.id, nivel: nivelRms(pcm) * Math.max(0, Math.min(1, volume)) });
        });
      }
      // O fim da fala é o fim do som, não o começo do último pedaço.
      if (this.vale(t) && erroSintese === undefined) await this.o.saida.drenar?.();
    } catch (e) {
      // A saída caiu (o fone desconectou, o dispositivo sumiu): para a síntese e limpa o que ficou.
      if (this.atual === t) {
        erroSaida = e;
        t.abort.abort();
        try {
          this.o.saida.limpar();
        } catch {}
      }
    }
    await produtor;
    if (this.atual !== t) return; // cancelado: quem cancelou já encerrou
    this.atual = undefined;
    if (erroSaida !== undefined || erroSintese !== undefined) {
      const [onde, err] = erroSaida !== undefined ? ["a saída", erroSaida] : ["a síntese", erroSintese];
      this.o.log?.(`fala: ${onde} falhou: ${mensagem(err)}`);
      this.encerrar(t, "erro", mensagem(err));
    } else this.encerrar(t, "fim");
  }
}

/** O que liga o player ao app: a fala do agente, o atalho, o × do gato e as reuniões. */
export interface FalaPlayerWiring {
  agent: { onSpeech(fn: (e: { turnId: string; frases: string[] }) => void): () => void };
  /** Os eventos do helper; sem ele, só a fala do agente liga o player. */
  helper?: { on(type: "agent.record.started" | "catOverlay.close" | "meeting.started" | "meeting.stopped", fn: () => void): () => void };
  log?(m: string): void;
}

/** Liga o player; devolve o desligar, que também cala o que estiver tocando. */
export function ligarFalaPlayer(player: FalaPlayer, w: FalaPlayerWiring): () => void {
  const offs = [
    // A guarda: nenhuma falha do player chega ao main como rejeição solta.
    w.agent.onSpeech((e) => {
      player.falar(e).catch((err) => w.log?.(`fala: o player falhou: ${mensagem(err)}`));
    }),
    // O atalho da pessoa: ela vai falar de novo, o gato se cala.
    w.helper?.on("agent.record.started", () => player.cancelar()),
    w.helper?.on("catOverlay.close", () => player.cancelar()),
    w.helper?.on("meeting.started", () => player.reuniao(true)),
    w.helper?.on("meeting.stopped", () => player.reuniao(false)),
  ];
  return () => {
    for (const off of offs) off?.();
    player.cancelar();
  };
}
