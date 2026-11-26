// Laboratório da voz na nuvem (spec #30991, T31095): a interface que os provedores seguem. Fora do app e do CI.
// O núcleo (`core.ts`) prepara o texto (guardrail + fala.ts, sem marcadores) e mede; o provedor só sintetiza.

export type Lang = "pt-BR" | "en-US";

export interface Voice {
  id: string;
  name: string;
  lang: Lang;
}

export interface Synthesis {
  /** O áudio em pedaços, na ordem: o núcleo mede o primeiro pedaço e o total. */
  audio: AsyncIterable<Uint8Array>;
  /** O formato dos pedaços; `pcm16` é PCM 16 bits mono sem cabeçalho, e o núcleo grava como .wav. */
  format: "mp3" | "pcm16" | "ogg";
  /** Só no `pcm16`: a taxa de amostragem, para o cabeçalho do .wav. */
  sampleRate?: number;
  /** Resolve depois da limpeza do provedor (o apagar do ElevenLabs): os caracteres cobrados e quantas gerações saíram. */
  done: Promise<{ chars: number; deleted?: number }>;
}

export interface TtsProvider {
  name: "google" | "elevenlabs" | "elevenlabs-ws" | "local";
  /** 2 ou 3 por língua, fixas no código. */
  voices(lang: Lang): Voice[];
  /** O texto já vem preparado pelo núcleo: o provedor não filtra de novo. */
  synthesize(text: string, voice: Voice, opts?: { signal?: AbortSignal }): Synthesis;
  /**
   * Opcional: confere a conta antes da primeira fala, sem gastar crédito. Rejeita com uma mensagem clara (sem a
   * credencial), e a rodada para antes de sintetizar qualquer coisa.
   */
  check?(): Promise<void>;
  /** US$ por caractere, depois da cota grátis, para a tabela. */
  costPerChar: number;
}
