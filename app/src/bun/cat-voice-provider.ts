// A voz do Kiwi com o provedor que a pessoa escolheu (spec #31616, T31626): a voz local, ou o ElevenLabs com a queda
// para a local. Lê o provedor, a voz e o modelo das settings a cada fala e a chave do Keychain a cada frase, então
// trocar nos Ajustes vale da próxima fala em diante. O app (`startCatVoiceOutput`) passa a síntese ao player, e os
// Ajustes (T31628) usam o `speakOnce` (o "Testar") e o `lastFallback` (a linha do motivo).
import type { AppSettings } from "../store/settings.ts";
import { type ElevenLabsFallback, type ElevenLabsReason, elevenLabsVoice, sinteseComQueda } from "./elevenlabs-voice.ts";
import type { SinteseFala } from "./voice-process.ts";

export interface VozDoKiwiOpts {
  vozLocal: SinteseFala;
  settings: { load(): Promise<Pick<AppSettings, "catVoiceProvider" | "elevenLabsVoiceId" | "elevenLabsModel">> };
  /** A chave do ElevenLabs (`elevenLabsKey()` no app; o `memoryKeychain` nos testes). */
  key: { getKey(): Promise<string | null> };
  /** A saída do gato para o "Testar": o `falarUmaVez` da voz ligada, ou nada antes de o helper subir. */
  falarUmaVez(): ((sintese: SinteseFala, texto: string) => Promise<void>) | undefined;
  aviso?(reason: ElevenLabsReason | null): void;
  log?(m: string): void;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export interface VozDoKiwi {
  /** A síntese do player do gato. */
  sintese: SinteseFala;
  /**
   * Fala `texto` uma vez com a voz e o modelo de agora, pelo ElevenLabs e sem cair para a local: confere a voz antes
   * (`GET /v1/voices/{id}`). Rejeita com o `ElevenLabsError` (o `.reason`), ou `helper_unavailable` sem a saída.
   */
  speakOnce(texto: string): Promise<void>;
  /** A última queda para a voz local; `null` desde que o ElevenLabs voltou (ou se nunca caiu). */
  lastFallback(): ElevenLabsFallback | null;
}

export function vozDoKiwi(o: VozDoKiwiOpts): VozDoKiwi {
  const nuvem = elevenLabsVoice({
    getKey: () => o.key.getKey(),
    config: async () => {
      const s = await o.settings.load();
      return { voiceId: s.elevenLabsVoiceId, model: s.elevenLabsModel };
    },
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}),
  });
  const sintese = sinteseComQueda({
    local: o.vozLocal,
    nuvem,
    provedor: async () => (await o.settings.load()).catVoiceProvider,
    aviso: (r) => o.aviso?.(r),
    ...(o.log ? { log: o.log } : {}),
  });
  return {
    sintese,
    lastFallback: () => sintese.lastFallback(),
    async speakOnce(texto) {
      const falar = o.falarUmaVez();
      if (!falar) throw new Error("helper_unavailable");
      await nuvem.checkVoice();
      await falar(nuvem, texto);
    },
  };
}
