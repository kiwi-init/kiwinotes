// A voz do gato de mentira (T26829), para as provas no headless (`KIWI_FAKE_SPEECH=1`): uma síntese que gera um tom
// com o envelope de sílabas de uma fala, em pedaços de 80 ms entregues em rajadas como o processo da voz (T26732), e
// uma saída que só espera o tempo do pedaço. Nada toca no alto-falante e nada vem do mic.
import { FALA_TAXA, type Pcm, type SaidaFala, type SinteseFala } from "../agent/fala-player.ts";

/** 80 ms a 24 kHz. */
const PEDACO = 1920;
/** Uma sílaba por 0,2 s, mais ou menos: o tanto de pedaços por caractere da frase. */
const SEGUNDOS_POR_LETRA = 0.06;

/** O tom de uma frase: 220 Hz com o volume subindo e descendo nas sílabas, e uma pausa curta no fim. */
export function tomDaFrase(frase: string): Pcm[] {
  const segundos = Math.max(0.6, Math.min(8, frase.length * SEGUNDOS_POR_LETRA));
  const total = Math.ceil((segundos * FALA_TAXA) / PEDACO) * PEDACO;
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / FALA_TAXA;
    // As sílabas: um envelope a 5 Hz, com a força variando devagar, como o volume de uma frase.
    const silaba = Math.max(0, Math.sin(Math.PI * 5 * t)) ** 1.5;
    const forca = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.7 * t + 1);
    const fim = Math.min(1, (segundos - t) / 0.25);
    pcm[i] = Math.round(Math.sin(2 * Math.PI * 220 * t) * silaba * forca * Math.max(0, fim) * 0.8 * 32767);
  }
  const pedacos: Pcm[] = [];
  for (let i = 0; i < total; i += PEDACO) pedacos.push(pcm.subarray(i, i + PEDACO));
  return pedacos;
}

const espera = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });

/** A síntese falsa: os pedaços do tom em rajadas de 3, a cada 0,2 s (mais rápido que o tempo real, como a de verdade). */
export function sinteseFalsa(): SinteseFala {
  return {
    async *sintetizar(frase, signal) {
      const pedacos = tomDaFrase(frase);
      for (let i = 0; i < pedacos.length; i++) {
        if (signal.aborted) return;
        if (i % 3 === 0) await espera(200, signal);
        if (signal.aborted) return;
        yield pedacos[i]!;
      }
    },
  };
}

/** A saída falsa: cada pedaço "toca" pelo tempo dele, no volume 1; o `limpar` solta o que estiver tocando. */
export function saidaFalsa(): SaidaFala {
  let limpo = new AbortController();
  return {
    async tocar(pcm, aoTocar) {
      const signal = limpo.signal;
      if (signal.aborted) return;
      aoTocar(1);
      await espera((pcm.length / FALA_TAXA) * 1000, signal);
    },
    limpar() {
      limpo.abort();
      limpo = new AbortController();
    },
  };
}
