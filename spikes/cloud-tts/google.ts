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
  return { endpoint: HOST, creds: grpc.credentials.combineChannelCredentials(ssl, grpc.credentials.createFromMetadataGenerator(authMetadata(auth))) };
}

/**
 * Os cabeçalhos das ADC como metadata do gRPC. O `createFromGoogleCredential` do grpc-js lê os cabeçalhos com
 * `Object.keys`, e o google-auth-library 10+ devolve um `Headers`: sairia sem o `authorization`, e a chamada iria sem
 * credencial nenhuma.
 */
export function authMetadata(auth: { getRequestHeaders(url?: string): Promise<Headers | Record<string, string>> }): Parameters<typeof grpc.credentials.createFromMetadataGenerator>[0] {
  return (params, cb) => {
    auth.getRequestHeaders(params.service_url).then(
      (h) => {
        const md = new grpc.Metadata();
        const entries = h instanceof Headers ? [...h.entries()] : Object.entries(h);
        for (const [k, v] of entries) md.add(k, v);
        cb(null, md);
      },
      (e: Error) => cb(new Error(`google: sem as credenciais padrão (${e.message.split("\n")[0]!.slice(0, 120)})`)),
    );
  };
}

/** Um erro do gRPC sem nada da credencial: só o código e a primeira linha da mensagem. */
function cleanError(e: unknown): Error {
  const err = e as { code?: number; details?: string; message?: string };
  const status = typeof err.code === "number" ? (grpc.status[err.code] ?? String(err.code)) : "?";
  const detail = (err.details ?? err.message ?? "").split("\n")[0]!.slice(0, 200);
  return new Error(`google: ${status}: ${detail}`);
}

/**
 * As vozes Chirp 3 HD escolhidas na hora (T31480): `all` (todas as da língua, pelo `ListVoices`) ou uma lista de nomes
 * (`Aoede,Kore`, ou o nome inteiro `pt-BR-Chirp3-HD-Aoede`). Sem a opção, as 3 fixas.
 */
export interface GoogleOptions {
  voices?: string;
}

const CHIRP = "Chirp3-HD-";
const LANGS: Lang[] = ["pt-BR", "en-US"];

/** `Aoede, pt-BR-Chirp3-HD-Kore` → `["Aoede", "Kore"]`. */
export function chirpNames(spec: string): string[] {
  const names = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(CHIRP) ? s.slice(s.indexOf(CHIRP) + CHIRP.length) : s));
  for (const n of names) if (!/^[A-Za-z0-9_-]{1,40}$/.test(n)) throw new Error(`google: nome de voz fora do formato: ${JSON.stringify(n.slice(0, 40))}`);
  if (!names.length) throw new Error("google: --voices sem nenhuma voz");
  return names;
}

export function googleProvider(env: Record<string, string | undefined> = process.env, opts: GoogleOptions = {}): TtsProvider {
  const { endpoint, creds } = credentials(env);
  const Service = ttsService();
  const client = new Service(endpoint, creds);
  const all = opts.voices?.trim() === "all";
  const chosen: Record<Lang, string[]> = all || !opts.voices ? { ...VOICES } : { "pt-BR": chirpNames(opts.voices), "en-US": chirpNames(opts.voices) };

  /** `ListVoices` de uma língua: os nomes das vozes Chirp 3 HD dela, em ordem. Não gasta caractere. */
  function listChirp(lang: Lang): Promise<string[]> {
    return new Promise((res, rej) =>
      (client as unknown as { ListVoices(req: unknown, cb: (e: unknown, r?: { voices?: { name?: string }[] }) => void): void }).ListVoices({ language_code: lang }, (e, r) => {
        if (e) return rej(cleanError(e));
        const names = (r?.voices ?? [])
          .map((v) => v.name ?? "")
          .filter((n) => n.startsWith(`${lang}-${CHIRP}`))
          .map((n) => n.slice(`${lang}-${CHIRP}`.length))
          .sort();
        res(names);
      }),
    );
  }

  return {
    name: "google",
    /** Com `--voices all`, a lista vem do Google antes da 1ª fala. */
    async check() {
      if (!all) return;
      for (const lang of LANGS) {
        const names = await listChirp(lang);
        if (!names.length) throw new Error(`google: nenhuma voz Chirp 3 HD em ${lang} no ListVoices`);
        chosen[lang] = names;
      }
    },
    // US$ 30 por milhão de caracteres depois do 1 milhão grátis do mês (spec #30991).
    costPerChar: 30 / 1_000_000,
    voices: (lang) => chosen[lang].map((v) => ({ id: `${lang}-Chirp3-HD-${v}`, name: v, lang })),
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
