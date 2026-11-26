// Google Cloud Text-to-Speech, vozes Chirp 3 HD, em streaming (spec #30991, T31095). O streaming do Chirp 3 HD é só
// gRPC bidirecional (`StreamingSynthesize`); o REST não tem. Os .proto vêm do pacote @google-cloud/text-to-speech.
//
// A credencial vem só do ambiente, e nunca é gravada, impressa nem posta no log:
// - `GOOGLE_TTS_ENDPOINT` (`host:port`): sem TLS e sem credencial, só para o servidor falso local dos testes;
// - `GOOGLE_TTS_API_KEY`: uma chave de API, no cabeçalho `x-goog-api-key`;
// - sem as duas: as Application Default Credentials (`gcloud auth application-default login`).

import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { GoogleAuth } from "google-auth-library";

import type { Lang, Synthesis, TtsProvider, Voice } from "./provider.ts";

const PROTOS = path.join(import.meta.dir, "node_modules/@google-cloud/text-to-speech/build/protos");
const HOST = "texttospeech.googleapis.com:443";
export const SAMPLE_RATE = 24_000;

/** O serviço `TextToSpeech` do v1, carregado dos .proto (o cliente e o servidor falso usam o mesmo). */
export function ttsService(): grpc.ServiceClientConstructor {
  const def = loader.loadSync("google/cloud/texttospeech/v1/cloud_tts.proto", {
    includeDirs: [PROTOS, path.join(import.meta.dir, "node_modules/google-gax/build/protos")],
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: false,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as { google: { cloud: { texttospeech: { v1: { TextToSpeech: grpc.ServiceClientConstructor } } } } };
  return pkg.google.cloud.texttospeech.v1.TextToSpeech;
}

/** 3 vozes por língua, para o harry ouvir. O nome segue `<língua>-Chirp3-HD-<voz>`. */
const VOICES: Record<Lang, string[]> = {
  "pt-BR": ["Aoede", "Kore", "Charon"],
  "en-US": ["Leda", "Puck", "Charon"],
};

function credentials(env: Record<string, string | undefined>): { endpoint: string; creds: grpc.ChannelCredentials } {
  if (env.GOOGLE_TTS_ENDPOINT) return { endpoint: env.GOOGLE_TTS_ENDPOINT, creds: grpc.credentials.createInsecure() };
  const ssl = grpc.credentials.createSsl();
  const key = env.GOOGLE_TTS_API_KEY;
  if (key) {
    const call = grpc.credentials.createFromMetadataGenerator((_, cb) => {
      const md = new grpc.Metadata();
      md.set("x-goog-api-key", key);
      cb(null, md);
    });
    return { endpoint: HOST, creds: grpc.credentials.combineChannelCredentials(ssl, call) };
  }
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return { endpoint: HOST, creds: grpc.credentials.combineChannelCredentials(ssl, grpc.credentials.createFromGoogleCredential(auth)) };
}

/** Um erro do gRPC sem nada da credencial: só o código e a primeira linha da mensagem. */
function cleanError(e: unknown): Error {
  const err = e as { code?: number; details?: string; message?: string };
  const status = typeof err.code === "number" ? (grpc.status[err.code] ?? String(err.code)) : "?";
  const detail = (err.details ?? err.message ?? "").split("\n")[0]!.slice(0, 200);
  return new Error(`google: ${status}: ${detail}`);
}

export function googleProvider(env: Record<string, string | undefined> = process.env): TtsProvider {
  const { endpoint, creds } = credentials(env);
  const Service = ttsService();
  const client = new Service(endpoint, creds);
  return {
    name: "google",
    // US$ 30 por milhão de caracteres depois do 1 milhão grátis do mês (spec #30991).
    costPerChar: 30 / 1_000_000,
    voices: (lang) => VOICES[lang].map((v) => ({ id: `${lang}-Chirp3-HD-${v}`, name: v, lang })),
    synthesize(text: string, voice: Voice, opts?: { signal?: AbortSignal }): Synthesis {
      const call = (client as unknown as { StreamingSynthesize(): grpc.ClientDuplexStream<unknown, { audio_content?: Buffer }> }).StreamingSynthesize();
      opts?.signal?.addEventListener("abort", () => call.cancel(), { once: true });
      let finish!: (v: { chars: number }) => void;
      let fail!: (e: Error) => void;
      const done = new Promise<{ chars: number }>((res, rej) => ((finish = res), (fail = rej)));
      // Quem lê o `audio` vê o erro; o `done` não pode virar uma rejeição solta.
      done.catch(() => {});
      async function* audio(): AsyncGenerator<Uint8Array> {
        call.write({
          streaming_config: {
            voice: { language_code: voice.lang, name: voice.id },
            streaming_audio_config: { audio_encoding: "PCM", sample_rate_hertz: SAMPLE_RATE },
          },
        });
        call.write({ input: { text } });
        call.end();
        try {
          for await (const r of call as AsyncIterable<{ audio_content?: Buffer }>) {
            if (r.audio_content?.length) yield new Uint8Array(r.audio_content);
          }
        } catch (e) {
          const err = cleanError(e);
          fail(err);
          throw err;
        }
        // O Google cobra os caracteres do texto enviado.
        finish({ chars: [...text].length });
      }
      return { audio: audio(), format: "pcm16", sampleRate: SAMPLE_RATE, done };
    },
  };
}
