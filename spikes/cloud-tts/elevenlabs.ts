// Laboratório da voz na nuvem (spec #30991, T31096): o provedor ElevenLabs, atrás da interface de `provider.ts`.
// Streaming pelo WebSocket `stream-input`, vozes prontas (sem clone) e, no fim de cada fala, a geração
// apagada do histórico da conta pela API. A chave só vem do ambiente (`ELEVENLABS_API_KEY`), vai só no
// cabeçalho `xi-api-key` e nunca entra em URL, mensagem, erro ou log.

import type { Lang, Synthesis, TtsProvider, Voice } from "./provider";

export const HISTORY_PERMISSION = "a chave do ElevenLabs precisa da permissão de histórico (escrita) para o lab apagar as falas";
export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
/** O de melhor qualidade em português; `eleven_flash_v2_5` troca qualidade por latência. */
export const DEFAULT_MODEL = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

/** Vozes prontas da biblioteca do ElevenLabs (premade). Os modelos multilíngues falam as duas línguas com a mesma voz. */
const VOICES: Record<Lang, Voice[]> = {
  "pt-BR": [
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", lang: "pt-BR" },
    { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", lang: "pt-BR" },
    { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", lang: "pt-BR" },
  ],
  "en-US": [
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", lang: "en-US" },
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian", lang: "en-US" },
    { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", lang: "en-US" },
  ],
};

/**
 * US$ por crédito no plano Creator (US$ 22 por 100 mil créditos), uma estimativa para a tabela:
 * o `multilingual_v2` gasta 1 crédito por caractere e o `flash_v2_5`, meio. Conferir em elevenlabs.io/pricing.
 */
const USD_PER_CREDIT = 22 / 100_000;
const CREDITS_PER_CHAR: Record<string, number> = { eleven_multilingual_v2: 1, eleven_flash_v2_5: 0.5, eleven_turbo_v2_5: 0.5 };

export interface ElevenLabsOptions {
  env?: Record<string, string | undefined>;
  /** Quantas vezes procurar a geração no histórico, que pode demorar a aparecer, e a espera entre elas. */
  historyTries?: number;
  historyWaitMs?: number;
  /** Para avisos do provedor (nunca com a chave nem com o texto da fala). */
  log?: (line: string) => void;
}

/** Erro sem o valor da chave: só o que aconteceu e o código HTTP. */
class ElevenLabsError extends Error {
  constructor(message: string) {
    super(`ElevenLabs: ${message}`);
  }
}

/** Para comparar o texto do item do histórico com a fala enviada: sem espaços nas pontas e sem espaço repetido. */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

export function elevenLabs(opts: ElevenLabsOptions = {}): TtsProvider {
  const env = opts.env ?? process.env;
  const key = env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError("falta a variável ELEVENLABS_API_KEY no ambiente");
  const base = (env.ELEVENLABS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.ELEVENLABS_MODEL || DEFAULT_MODEL;
  const tries = opts.historyTries ?? 6;
  const wait = opts.historyWaitMs ?? 500;
  const log = opts.log ?? (() => {});
  const headers = { "xi-api-key": key };

  async function api(method: "GET" | "DELETE", path: string): Promise<unknown> {
    const res = await fetch(`${base}${path}`, { method, headers });
    if (!res.ok) throw new ElevenLabsError(`${method} ${path.split("?")[0]} respondeu ${res.status}`);
    return res.json();
  }

  /**
   * Antes da primeira fala: a chave lê o histórico? Sem a permissão, cada geração ficaria na conta e o apagar
   * falharia depois do crédito gasto (a rodada do harry, #31397). Um GET de um item não gasta crédito.
   */
  async function check(): Promise<void> {
    const res = await fetch(`${base}/v1/history?page_size=1`, { method: "GET", headers });
    if (res.status === 401 || res.status === 403) throw new ElevenLabsError(HISTORY_PERMISSION);
    if (!res.ok) throw new ElevenLabsError(`a conferência do histórico respondeu ${res.status}`);
  }

  /** O apagar não derruba a fala: o áudio já foi gerado e pago. Falhou, a fala conta como não apagada (0). */
  async function tryDelete(text: string, voiceId: string, startedAtMs: number): Promise<number> {
    try {
      return await deleteGeneration(text, voiceId, startedAtMs);
    } catch (e) {
      log(`elevenlabs: a fala não foi apagada do histórico (${(e as Error).message})`);
      return 0;
    }
  }

  /**
   * Apaga do histórico a geração desta fala: a mesma voz, TTS, a partir do início da fala e com o mesmo
   * texto. O filtro pelo texto protege as outras gerações da conta feitas na mesma hora com a mesma voz.
   */
  async function deleteGeneration(text: string, voiceId: string, startedAtMs: number): Promise<number> {
    const after = Math.floor(startedAtMs / 1000) - 1;
    const q = new URLSearchParams({ voice_id: voiceId, source: "TTS", date_after_unix: String(after), page_size: "100" });
    for (let i = 0; i < tries; i++) {
      const page = (await api("GET", `/v1/history?${q}`)) as { history?: { history_item_id: string; text?: string }[] };
      const mine = (page.history ?? []).filter((h) => typeof h.text === "string" && sameText(h.text, text));
      if (mine.length) {
        for (const h of mine) await api("DELETE", `/v1/history/${encodeURIComponent(h.history_item_id)}`);
        return mine.length;
      }
      if (i < tries - 1) await Bun.sleep(wait);
    }
    log("elevenlabs: a geração não apareceu no histórico; nada apagado");
    return 0;
  }

  function synthesize(text: string, voice: Voice, o: { signal?: AbortSignal } = {}): Synthesis {
    const startedAt = Date.now();
    const wsBase = base.replace(/^http/, "ws");
    const q = new URLSearchParams({ model_id: model, output_format: OUTPUT_FORMAT });
    const url = `${wsBase}/v1/text-to-speech/${encodeURIComponent(voice.id)}/stream-input?${q}`;

    // Fila entre o WebSocket e quem lê o áudio.
    const chunks: Uint8Array[] = [];
    let ended = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const poke = () => {
      wake?.();
      wake = null;
    };
    let finish!: () => void;
    let fail!: (e: Error) => void;
    const streamDone = new Promise<void>((res, rej) => {
      finish = res;
      fail = rej;
    });
    streamDone.catch(() => {});

    // O WebSocket do Bun aceita cabeçalhos: a chave vai no `xi-api-key`, nunca na URL nem nas mensagens.
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    const close = (err?: Error) => {
      if (ended) return;
      ended = true;
      if (err) failure = err;
      try {
        ws.close();
      } catch {}
      poke();
      err ? fail(err) : finish();
    };
    o.signal?.addEventListener("abort", () => close(new ElevenLabsError("fala cancelada")), { once: true });

    ws.onopen = () => {
      ws.send(JSON.stringify({ text: " " }));
      ws.send(JSON.stringify({ text: `${text} `, flush: true }));
      ws.send(JSON.stringify({ text: "" }));
    };
    ws.onmessage = (ev) => {
      let msg: { audio?: string | null; isFinal?: boolean; error?: string; message?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return close(new ElevenLabsError("mensagem do WebSocket fora do formato"));
      }
      if (msg.error) return close(new ElevenLabsError(`o servidor recusou a fala (${msg.error})`));
      if (msg.audio) {
        chunks.push(Uint8Array.from(Buffer.from(msg.audio, "base64")));
        poke();
      }
      if (msg.isFinal) close();
    };
    ws.onerror = () => close(new ElevenLabsError("o WebSocket falhou"));
    ws.onclose = (ev) => close(ev.code === 1000 || ev.code === 1005 ? undefined : new ElevenLabsError(`o WebSocket fechou com ${ev.code}`));

    async function* audio(): AsyncIterable<Uint8Array> {
      for (;;) {
        if (chunks.length) {
          yield chunks.shift()!;
          continue;
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
      }
    }

    // O apagar roda mesmo se a fala falhar no meio: o servidor pode ter gerado e guardado parte dela.
    const done = streamDone.then(
      async () => ({ chars: text.length, deleted: await tryDelete(text, voice.id, startedAt) }),
      async (err) => {
        await tryDelete(text, voice.id, startedAt);
        throw err;
      },
    );
    return { audio: audio(), format: "mp3", done };
  }

  return {
    name: "elevenlabs",
    voices: (lang) => VOICES[lang],
    synthesize,
    check,
    costPerChar: USD_PER_CREDIT * (CREDITS_PER_CHAR[model] ?? 1),
  };
}
