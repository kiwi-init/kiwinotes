// O Ouvir dos Ajustes (spec #27531, T27778): fala o texto fixo de uma voz do catálogo, na voz daquela linha, sem mudar a
// escolhida (`kiwicat.voz`) e sem chamar o agente.
//
// - Uma prévia nova corta a anterior: o `signal` dela aborta (o `kiwi-voice` recebe o `cancel`) e a saída é limpa.
// - Durante uma fala do gato, a prévia espera a fala acabar, e só então começa (ninguém fala por cima do gato).
// - A saída é a mesma interface da do player (`SaidaFala`, src/agent/fala-player.ts): a de verdade toca no alto-falante
//   (T27825); a dos testes e do headless só espera o tempo do pedaço.

import type { CatVoiceId } from "../shared/cat-voices.ts";
import { FALA_TAXA, type SaidaFala } from "../agent/fala-player.ts";
import type { SinteseFala } from "./voice-process.ts";

/** A saída de som: a mesma do player da fala, para a de verdade (T27825) servir aos dois. */
export type SaidaPrevia = SaidaFala;

export interface CatVoicePreviewOptions {
  /** A síntese numa voz fixa (`VoiceProcess.com`). */
  sintese: (id: CatVoiceId) => SinteseFala;
  /** O texto fixo da voz, em frases. `null`: a voz não tem prévia (ainda sem referência). */
  frases: (id: CatVoiceId) => readonly string[] | null;
  saida: SaidaPrevia;
  /** A fala do gato em andamento, se alguma: a prévia espera ela acabar. */
  falaDoGato?: () => Promise<unknown> | null | undefined;
  /** A voz tocando mudou (`null`: parou). */
  onChange?: (id: CatVoiceId | null) => void;
  log?: (m: string) => void;
}

const abortado = (signal: AbortSignal) =>
  new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: true })));

export class CatVoicePreview {
  /** `saiu`: já mandou pedaço à saída. A prévia que só espera a fala do gato não limpa a saída ao parar (é dele). */
  private atual: { id: CatVoiceId; abort: AbortController; saiu: boolean } | null = null;

  constructor(private readonly o: CatVoicePreviewOptions) {}

  /** A voz tocando agora (ou esperando a fala do gato acabar). */
  get tocando(): CatVoiceId | null {
    return this.atual?.id ?? null;
  }

  /** Fala o texto fixo da voz. Resolve quando acaba, é cortada ou dá erro (o erro vai ao log, nunca ao chamador). */
  async ouvir(id: CatVoiceId): Promise<void> {
    const frases = this.o.frases(id);
    if (!frases || frases.length === 0) throw new Error(`a voz ${id} ainda não tem prévia`);
    this.parar();
    const me = { id, abort: new AbortController(), saiu: false };
    const { signal } = me.abort;
    this.atual = me;
    this.o.onChange?.(id);
    try {
      // A fala do gato primeiro: uma fala nova que começou enquanto esperava também é esperada.
      for (let fala = this.o.falaDoGato?.(); fala; fala = this.o.falaDoGato?.()) {
        await Promise.race([Promise.resolve(fala).catch(() => {}), abortado(signal)]);
        if (signal.aborted) return;
      }
      const sintese = this.o.sintese(id);
      for (const frase of frases) {
        for await (const pcm of sintese.sintetizar(frase, signal)) {
          if (signal.aborted) return;
          me.saiu = true;
          await this.o.saida.tocar(pcm, () => {});
          if (signal.aborted) return;
        }
        if (signal.aborted) return;
      }
    } catch (e) {
      if (!signal.aborted) this.o.log?.(`prévia ${id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (this.atual === me) {
        this.atual = null;
        this.o.onChange?.(null);
      }
    }
  }

  /** Corta a prévia que estiver tocando (ou esperando). */
  parar(): void {
    const a = this.atual;
    if (!a) return;
    this.atual = null;
    a.abort.abort();
    if (a.saiu) {
      try {
        this.o.saida.limpar();
      } catch {}
    }
    this.o.onChange?.(null);
  }
}

/** A saída muda do headless e dos roteiros de tela: cada pedaço "toca" pelo tempo dele, e nada sai no alto-falante. */
export function saidaMuda(taxa = FALA_TAXA): SaidaPrevia {
  let limpo = new AbortController();
  return {
    tocar(pcm) {
      const signal = limpo.signal;
      return new Promise<void>((r) => {
        if (signal.aborted) return r();
        const t = setTimeout(r, (pcm.length / taxa) * 1000);
        signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
      });
    },
    limpar() {
      limpo.abort();
      limpo = new AbortController();
    },
  };
}

/** O Ouvir ligado ao modelo e ao processo da voz: a voz da linha, o texto fixo dela e o `preview` no status. */
export function createCatVoicePreview(
  pair: { model: { ref(id: CatVoiceId): { preview?: readonly string[] } | null; voiceAssets(id: CatVoiceId): Promise<import("./voice-process.ts").VoiceAssets>; setPreview(id: CatVoiceId | null): void }; voice: { com: import("./voice-process.ts").VoiceProcess["com"] } },
  o: Pick<CatVoicePreviewOptions, "saida" | "falaDoGato" | "log">,
): CatVoicePreview {
  return new CatVoicePreview({
    ...o,
    sintese: (id) => pair.voice.com(() => pair.model.voiceAssets(id)),
    frases: (id) => pair.model.ref(id)?.preview ?? null,
    onChange: (id) => pair.model.setPreview(id),
  });
}
