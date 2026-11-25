// A saída de verdade da voz do gato (T27825): um `SaidaFala` que toca o PCM no helper Swift (`speech.play`), onde um
// `AVAudioEngine` põe os pedaços em fila na saída padrão do Mac. No headless, o helper toca numa saída muda; nos
// testes, um helper falso. Nada aqui abre dispositivo de áudio.
//
// - **Sem buraco entre os pedaços:** o `FalaPlayer` espera cada `tocar` antes de mandar o próximo. Por isso o `tocar`
//   resolve quando o pedaço *começa* a tocar (o anterior acabou), e não quando ele acaba: o próximo chega ao helper
//   enquanto este ainda toca. O fim da fala espera o `drenar()`: o último pedaço acabou de tocar.
// - **O nível:** o `aoTocar` vai com o volume que o helper diz (o do dispositivo de saída), quando o pedaço começa.
// - **Interromper:** `limpar()` manda `speech.stop`, que corta na hora, e solta todo `tocar` pendente.
// - **O helper caiu:** os `tocar` pendentes rejeitam, e o `FalaPlayer` encerra a fala com erro.
// - **Um `speech.played` que não chega** não prende a fala: cada pedaço acaba sozinho depois do tempo dele + `folgaMs`.

import { FALA_TAXA, type MidiaFala, type Pcm, type SaidaFala } from "../agent/fala-player.ts";

/** O que a saída usa do `Sidecar` (src/bun/sidecar.ts). */
export interface SpeechHelper {
  request(command: { type: "speech.play"; seq: number; pcm: string }): Promise<{ data: { volume: number } }>;
  send(command: { type: "speech.stop" }): Promise<unknown>;
  on(type: "speech.played", fn: (e: { seq: number }) => void): () => void;
  onClose(fn: () => void): () => void;
}

export interface SaidaHelperOpts {
  taxa?: number;
  /** Quanto além do tempo do pedaço esperar o `speech.played` antes de dar o pedaço por tocado. */
  folgaMs?: number;
  log?(m: string): void;
}

export const SPEECH_SLACK_MS = 1000;

interface Pedaco {
  seq: number;
  amostras: number;
  /** O helper já o recebeu (o `speech.play` voltou). */
  enviado: boolean;
  /** Já começou a tocar (o anterior acabou). */
  comecou: boolean;
  volume: number;
  aoTocar(volume: number): void;
  resolver(): void;
  rejeitar(e: Error): void;
  vigia?: ReturnType<typeof setTimeout>;
}

/** O PCM Int16 do pedaço em base64, como o helper lê (little-endian, como a memória do Mac). */
export function pcmBase64(pcm: Pcm): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64");
}

export function saidaHelper(
  helper: SpeechHelper,
  o: SaidaHelperOpts = {},
): SaidaFala & { drenar(): Promise<void>; dispose(): void } {
  const taxa = o.taxa ?? FALA_TAXA;
  const folga = o.folgaMs ?? SPEECH_SLACK_MS;
  /** Os pedaços no helper, na ordem: o 1º é o que toca. */
  const fila: Pedaco[] = [];
  let seq = 0;
  /** Quem espera a fila esvaziar (`drenar`). */
  let vazia: (() => void)[] = [];
  const conferirVazia = () => {
    if (fila.length) return;
    const fns = vazia;
    vazia = [];
    for (const fn of fns) fn();
  };

  const comecar = (p: Pedaco) => {
    if (p.comecou) return;
    p.comecou = true;
    p.vigia = setTimeout(() => {
      o.log?.(`fala: o pedaço ${p.seq} não voltou do helper; segue`);
      acabou(p.seq);
    }, (p.amostras / taxa) * 1000 + folga);
    try {
      p.aoTocar(p.volume);
    } catch {}
    p.resolver();
  };

  const acabou = (n: number) => {
    const i = fila.findIndex((p) => p.seq === n);
    if (i < 0) return; // de um pedaço já limpo
    // O helper toca na ordem: o que acabou leva junto os de antes dele, se o `played` deles se perdeu.
    for (const p of fila.splice(0, i + 1)) {
      clearTimeout(p.vigia);
      comecar(p);
    }
    if (fila[0]?.enviado) comecar(fila[0]);
    conferirVazia();
  };

  const soltar = (erro?: Error) => {
    for (const p of fila.splice(0)) {
      clearTimeout(p.vigia);
      if (erro && !p.comecou) p.rejeitar(erro);
      else p.resolver();
    }
    conferirVazia();
  };

  const offPlayed = helper.on("speech.played", (e) => acabou(e.seq));
  const offClose = helper.onClose(() => soltar(new Error("o helper caiu")));

  return {
    tocar(pcm, aoTocar) {
      const n = ++seq;
      return new Promise<void>((resolver, rejeitar) => {
        const p: Pedaco = { seq: n, amostras: pcm.length, enviado: false, comecou: false, volume: 1, aoTocar, resolver, rejeitar };
        fila.push(p);
        helper.request({ type: "speech.play", seq: n, pcm: pcmBase64(pcm) }).then(
          (r) => {
            if (!fila.includes(p)) return; // limpo enquanto ia ao helper
            p.enviado = true;
            p.volume = Math.max(0, Math.min(1, Number(r.data?.volume ?? 1)));
            if (fila[0] === p) comecar(p);
          },
          (e) => {
            const i = fila.indexOf(p);
            if (i < 0) return;
            fila.splice(i, 1);
            rejeitar(e instanceof Error ? e : new Error(String(e)));
            conferirVazia();
          },
        );
      });
    },
    drenar() {
      if (!fila.length) return Promise.resolve();
      return new Promise<void>((r) => vazia.push(r));
    },
    limpar() {
      soltar();
      helper.send({ type: "speech.stop" }).catch(() => {});
    },
    dispose() {
      offPlayed();
      offClose();
      soltar();
    },
  };
}

/**
 * T26830: a mídia dos outros apps durante a fala do gato, pelo helper. `abaixar` antes do 1º pedaço e `devolver` no fim,
 * no corte ou no erro (o `FalaPlayer` chama). Um erro do helper só vai ao log: a voz toca do mesmo jeito.
 */
/** O que a mídia usa do helper. */
export interface MidiaHelper {
  request(command: { type: "speech.duck" | "speech.unduck" }): Promise<unknown>;
}

export function midiaHelper(
  helper: MidiaHelper,
  log?: (msg: string) => void,
): MidiaFala {
  const pedir = (type: "speech.duck" | "speech.unduck") =>
    void helper.request({ type }).catch((e) => log?.(`speech: ${type} falhou: ${e instanceof Error ? e.message : String(e)}`));
  return { abaixar: () => pedir("speech.duck"), devolver: () => pedir("speech.unduck") };
}
