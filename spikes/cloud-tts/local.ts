// A voz local do gato, para comparar (spec #30991): o mesmo `kiwi-voice` (Qwen3-TTS 0.6B, ADR 0014) e as mesmas
// referências do app. Em pt, a `pt-a` (Kiwi PT-1); em en, a `en-a` e a `en-b` (Kiwi EN-1 e EN-2). Frase por frase, como o player do app.
//
// - `KIWI_VOICE`: o executável `kiwi-voice` (o do app instalado fica em `Kiwi Notes.app/Contents/Resources/app/voice/`).
// - `KIWI_MODELS_DIR`: a pasta dos modelos já baixados (por padrão, a do app). Nada baixa daqui.

import path from "node:path";

import { cortarFrases } from "../../app/src/agent/fala.ts";
import { CatVoiceModel } from "../../app/src/bun/cat-voice-model.ts";
import { type SinteseFala, VOICE_SAMPLE_RATE, VoiceProcess } from "../../app/src/bun/voice-process.ts";
import type { CatVoiceId } from "../../app/src/shared/cat-voices.ts";
import { dataDir } from "../../app/src/store/files.ts";
import type { Lang, Synthesis, TtsProvider, Voice } from "./provider.ts";

const VOICES: Record<Lang, { id: CatVoiceId; name: string }[]> = {
  "pt-BR": [{ id: "pt-a", name: "Kiwi-PT-1" }],
  "en-US": [
    { id: "en-a", name: "Kiwi-EN-1" },
    { id: "en-b", name: "Kiwi-EN-2" },
  ],
};

/** O `kiwi-voice` de verdade, com o modelo e a voz do disco. Um processo por voz, que fica de pé entre as falas. */
export function realVoices(env: Record<string, string | undefined> = process.env): { synth: (id: string) => SinteseFala; stop: () => Promise<void> } {
  if (!env.KIWI_VOICE) throw new Error("local: falta KIWI_VOICE (o caminho do kiwi-voice)");
  const model = new CatVoiceModel({ modelsDir: env.KIWI_MODELS_DIR || path.join(dataDir(), "models"), download: false });
  const procs = new Map<string, VoiceProcess>();
  return {
    synth(id) {
      let p = procs.get(id);
      if (!p) procs.set(id, (p = new VoiceProcess({ bin: env.KIWI_VOICE!, assets: () => model.voiceAssets(id as CatVoiceId) })));
      return p;
    },
    stop: async () => void (await Promise.all([...procs.values()].map((p) => p.stop()))),
  };
}

export function localProvider(synth: (id: string) => SinteseFala): TtsProvider {
  return {
    name: "local",
    costPerChar: 0,
    voices: (lang) => VOICES[lang].map((v) => ({ ...v, lang })),
    synthesize(text: string, voice: Voice, opts?: { signal?: AbortSignal }): Synthesis {
      const ctl = new AbortController();
      opts?.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
      let finish!: (v: { chars: number }) => void;
      let fail!: (e: Error) => void;
      const done = new Promise<{ chars: number }>((res, rej) => ((finish = res), (fail = rej)));
      done.catch(() => {});
      async function* audio(): AsyncGenerator<Uint8Array> {
        try {
          for (const frase of cortarFrases(text)) {
            for await (const pcm of synth(voice.id).sintetizar(frase, ctl.signal)) {
              yield new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
            }
          }
        } catch (e) {
          const err = new Error(`local: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`);
          fail(err);
          throw err;
        }
        finish({ chars: [...text].length });
      }
      return { audio: audio(), format: "pcm16", sampleRate: VOICE_SAMPLE_RATE, done };
    },
  };
}
