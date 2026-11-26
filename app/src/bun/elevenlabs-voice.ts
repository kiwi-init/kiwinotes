// A voz do Kiwi pelo ElevenLabs (spec #31616, T31626): o cliente de streaming e a queda para a voz local.
//
// - **Streaming pelo HTTP** `POST /v1/text-to-speech/{voz}/stream`, o caminho do lab para todos os modelos (o
//   WebSocket não aceita o v3 nem o v4). O áudio vem em `pcm_24000` (16 bits, little-endian, mono, a 24 kHz), a taxa do
//   player (`FALA_TAXA`), que o toca em fatias de 80 ms enquanto chega, sem decodificar nada. O `pcm_24000` vale em
//   todo plano; só o de 44,1 kHz pede o Pro (https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).
// - **O texto passa pelo filtro do guardrail** (`SecretGuard.request`, o mesmo do pedido da pessoa) antes de sair, e
//   os marcadores `‹segredo…›` não são falados.
// - **A chave** vem do Keychain (`getKey`, injetado) a cada frase, vai só no cabeçalho `xi-api-key` e nunca entra em
//   URL, erro ou log. Nada fica guardado: sem cache de áudio, sem o texto no log.
// - **Os erros** viram um motivo curto (`ElevenLabsReason`), pelo `detail.status` da API
//   (https://elevenlabs.io/docs/help-center/technical/api-error-code-400-or-401) ou pelo código HTTP.
// - **A queda** (`sinteseComQueda`): sem chave ou com o ElevenLabs falhando, a frase sai na voz local, e o resto da fala
//   também. O motivo vai à UI uma vez, e só de novo quando ele muda ou depois de uma fala que deu certo.

import { MARKER, SecretGuard } from "../guardrail/filter.ts";
import type { CatVoiceProvider, ElevenLabsModel } from "../shared/elevenlabs.ts";
import type { SinteseFala } from "./voice-process.ts";

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
/** A taxa do player (24 kHz), em PCM de 16 bits. */
export const ELEVENLABS_OUTPUT_FORMAT = "pcm_24000";
/** 80 ms a 24 kHz: o tamanho das fatias da voz local, para o player e a boca do gato verem o mesmo ritmo. */
const SLICE = 1920;

export const ELEVENLABS_REASONS = ["no_key", "invalid_api_key", "missing_permissions", "quota_exceeded", "voice_not_found", "network", "unknown"] as const;
export type ElevenLabsReason = (typeof ELEVENLABS_REASONS)[number];

/** Uma falha do ElevenLabs, só com o motivo e o código HTTP: nunca a chave nem o texto. */
export class ElevenLabsError extends Error {
  constructor(
    readonly reason: ElevenLabsReason,
    readonly status?: number,
  ) {
    super(`elevenlabs: ${reason}${status ? ` (HTTP ${status})` : ""}`);
  }
}

export interface ElevenLabsVoiceOpts {
  /** A chave do Keychain (`src/bun/keychain.ts`), lida a cada frase: trocar ou apagar vale na próxima. */
  getKey(): Promise<string | null>;
  /** A voz e o modelo de agora, das settings. */
  config(): Promise<{ voiceId: string; model: ElevenLabsModel }>;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export interface ElevenLabsVoice extends SinteseFala {
  /** Confere a voz (`GET /v1/voices/{id}`) com a chave de agora: o "Testar" dos Ajustes. Rejeita com o motivo. */
  checkVoice(signal?: AbortSignal): Promise<void>;
}

const KNOWN = new Set<string>(ELEVENLABS_REASONS);

/** O motivo de uma resposta de erro: o `detail.status` da API, se for um conhecido, ou o código HTTP. */
export async function reasonOf(res: Response): Promise<ElevenLabsReason> {
  let status: unknown;
  try {
    const body = (await res.json()) as { detail?: { status?: unknown } };
    status = body?.detail?.status;
  } catch {}
  if (typeof status === "string" && KNOWN.has(status)) return status as ElevenLabsReason;
  if (res.status === 401) return "invalid_api_key";
  if (res.status === 402) return "quota_exceeded";
  if (res.status === 404) return "voice_not_found";
  return "unknown";
}

/** O texto que pode sair: sem os segredos que o guardrail acha e sem os marcadores deles. */
export function textoSeguro(frase: string): string {
  return new SecretGuard()
    .request(frase)
    .text.replace(MARKER, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const aborted = (signal: AbortSignal | undefined, e: unknown) =>
  signal?.aborted === true || (e instanceof Error && e.name === "AbortError");

export function elevenLabsVoice(o: ElevenLabsVoiceOpts): ElevenLabsVoice {
  const doFetch = o.fetch ?? fetch;
  const base = (o.baseUrl ?? ELEVENLABS_BASE_URL).replace(/\/+$/, "");

  const key = async (): Promise<string> => {
    const k = await o.getKey();
    if (!k) throw new ElevenLabsError("no_key");
    return k;
  };

  /** O `fetch` com a queda de rede virando motivo; um abort devolve `null`. */
  const request = async (url: string, init: RequestInit, signal?: AbortSignal): Promise<Response | null> => {
    try {
      return await doFetch(url, { ...init, ...(signal ? { signal } : {}) });
    } catch (e) {
      if (aborted(signal, e)) return null;
      throw new ElevenLabsError("network");
    }
  };

  async function* sintetizar(frase: string, signal: AbortSignal): AsyncGenerator<Int16Array> {
    if (signal.aborted) return;
    const text = textoSeguro(frase);
    if (!text) return;
    const [k, { voiceId, model }] = await Promise.all([key(), o.config()]);
    if (signal.aborted) return;
    const url = `${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
    const res = await request(
      url,
      { method: "POST", headers: { "xi-api-key": k, "content-type": "application/json", accept: "audio/pcm" }, body: JSON.stringify({ text, model_id: model }) },
      signal,
    );
    if (!res) return;
    if (!res.ok) throw new ElevenLabsError(await reasonOf(res), res.status);
    if (!res.body) throw new ElevenLabsError("unknown", res.status);
    const reader = res.body.getReader();
    // As amostras de 16 bits podem vir partidas entre dois pedaços da rede: o byte que sobra espera o próximo.
    let pending = new Uint8Array(0);
    let slice = new Int16Array(SLICE);
    let filled = 0;
    try {
      for (;;) {
        let r: Awaited<ReturnType<typeof reader.read>>;
        try {
          r = await reader.read();
        } catch (e) {
          if (aborted(signal, e)) return;
          throw new ElevenLabsError("network");
        }
        if (signal.aborted) return;
        if (r.done) break;
        let bytes = r.value;
        if (pending.length) {
          const joined = new Uint8Array(pending.length + bytes.length);
          joined.set(pending);
          joined.set(bytes, pending.length);
          bytes = joined;
        }
        const even = bytes.length & ~1;
        pending = bytes.slice(even);
        const view = new DataView(bytes.buffer, bytes.byteOffset, even);
        for (let i = 0; i < even; i += 2) {
          slice[filled++] = view.getInt16(i, true);
          if (filled === SLICE) {
            yield slice;
            if (signal.aborted) return;
            slice = new Int16Array(SLICE);
            filled = 0;
          }
        }
      }
      if (filled > 0 && !signal.aborted) yield slice.slice(0, filled);
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  return {
    sintetizar,
    async checkVoice(signal) {
      const [k, { voiceId }] = await Promise.all([key(), o.config()]);
      const res = await request(`${base}/v1/voices/${encodeURIComponent(voiceId)}`, { headers: { "xi-api-key": k } }, signal);
      if (!res) throw new ElevenLabsError("network");
      if (res.ok) return;
      const reason = await reasonOf(res);
      // A API responde 400 ou 422 a um ID que não é de voz nenhuma: para a pessoa, é a voz que não existe.
      throw new ElevenLabsError(reason === "unknown" && (res.status === 400 || res.status === 422) ? "voice_not_found" : reason, res.status);
    },
  };
}

/** A última queda para a voz local, para a linha dos Ajustes: o motivo e quando (ISO). */
export interface ElevenLabsFallback {
  reason: ElevenLabsReason;
  at: string;
}

export interface SinteseComQuedaOpts {
  local: SinteseFala;
  nuvem: SinteseFala;
  /** O provedor de agora, das settings: lido no começo de cada fala. */
  provedor(): Promise<CatVoiceProvider>;
  /** O motivo de a voz ter caído para a local, para a UI (uma linha discreta); `null` quando o ElevenLabs voltou. */
  aviso(reason: ElevenLabsReason | null): void;
  log?(m: string): void;
  now?(): Date;
}

export function reasonOfError(e: unknown): ElevenLabsReason {
  return e instanceof ElevenLabsError ? e.reason : "unknown";
}

/**
 * A voz do Kiwi com a escolha da pessoa: a local, ou o ElevenLabs com a queda para a local. A escolha vale por fala (o
 * `signal` do turno, o mesmo em todas as frases dele), e uma falha passa o resto da fala para a local.
 */
export function sinteseComQueda(o: SinteseComQuedaOpts): SinteseFala & { lastFallback(): ElevenLabsFallback | null } {
  const falas = new WeakMap<AbortSignal, Promise<{ nuvem: boolean }>>();
  let ultima: ElevenLabsFallback | null = null;
  const avisar = (r: ElevenLabsReason | null) => {
    if (r === (ultima?.reason ?? null)) return;
    ultima = r ? { reason: r, at: (o.now?.() ?? new Date()).toISOString() } : null;
    try {
      o.aviso(r);
    } catch {}
  };

  const fala = (signal: AbortSignal) => {
    let f = falas.get(signal);
    if (!f) {
      f = o.provedor().then(
        (p) => ({ nuvem: p === "elevenlabs" }),
        () => ({ nuvem: false }),
      );
      falas.set(signal, f);
    }
    return f;
  };

  async function* sintetizar(frase: string, signal: AbortSignal): AsyncGenerator<Int16Array> {
    const estado = await fala(signal);
    if (signal.aborted) return;
    if (!estado.nuvem) {
      yield* o.local.sintetizar(frase, signal);
      return;
    }
    let tocou = false;
    try {
      for await (const pcm of o.nuvem.sintetizar(frase, signal)) {
        tocou = true;
        yield pcm;
      }
      if (!signal.aborted) avisar(null);
      return;
    } catch (e) {
      if (signal.aborted) return;
      const reason = reasonOfError(e);
      o.log?.(`elevenlabs: ${reason}; a voz local segue esta fala`);
      estado.nuvem = false;
      avisar(reason);
      // Uma frase que já tocou em parte não recomeça na outra voz: a local segue da próxima.
      if (tocou) return;
    }
    yield* o.local.sintetizar(frase, signal);
  }

  return {
    sintetizar,
    lastFallback: () => ultima,
  };
}
