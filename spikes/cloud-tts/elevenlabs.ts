// Laboratório da voz na nuvem (spec #30991, T31096): o provedor ElevenLabs, atrás da interface de `provider.ts`.
// Streaming pelo HTTP `/stream` (padrão) ou pelo WebSocket `stream-input` (`ELEVENLABS_TRANSPORT=ws`), vozes
// prontas (sem clone) e, no fim de cada fala, a geração apagada do histórico da conta pela API (T31446).
//
// Por que o HTTP é o padrão (a rodada do harry, #31443, achou 0 gerações do WebSocket no histórico):
// - a doc do `stream-input` não diz se nem como as gerações do WebSocket entram no histórico;
// - o HTTP devolve o cabeçalho `request-id`, e cada item do histórico tem o `request_id`: o apagar acha a geração
//   pelo id, sem depender do texto (https://elevenlabs.io/docs/api-reference/history/list);
// - o HTTP não espera o `chunk_length_schedule` do WebSocket (padrão [120, 160, 250, 290] caracteres), que com uma
//   fala curta manda o áudio todo de uma vez. No WebSocket, o `auto_mode=true` cuida disso
//   (https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization). A chave só vem do ambiente (`ELEVENLABS_API_KEY`), vai só no
// cabeçalho `xi-api-key` e nunca entra em URL, mensagem, erro ou log.

import type { Lang, Synthesis, TtsProvider, Voice } from "./provider";

export const HISTORY_PERMISSION = "a chave do ElevenLabs não lê o histórico: dê a ela a permissão de leitura do histórico, que o lab usa para achar e apagar as falas";
export const INVALID_KEY = "a chave do ElevenLabs está errada: confira o valor de ELEVENLABS_API_KEY";
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
  /** A fala falhou e a geração dela pode ter ficado no histórico (o apagar também falhou): o núcleo conta no aviso. */
  notDeleted?: number;
  constructor(message: string) {
    super(`ElevenLabs: ${message}`);
  }
}

/** Uma fala enviada: o texto, e o `request-id` quando o HTTP o devolve. */
interface Generation {
  text: string;
  requestId?: string;
}
interface HistoryItem {
  history_item_id: string;
  request_id?: string | null;
  text?: string | null;
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
  const transport = env.ELEVENLABS_TRANSPORT === "ws" ? "ws" : "http";
  // O histórico demora a mostrar a geração: até 10 procuras, com a espera crescendo até 2 s (uns 15 s no pior caso).
  const tries = opts.historyTries ?? 10;
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
    if (res.status === 401 || res.status === 403) {
      // O ElevenLabs diz o porquê no `detail.status`: a chave errada e a chave sem permissão pedem coisas diferentes.
      const body = (await res.json().catch(() => null)) as { detail?: { status?: string } } | null;
      throw new ElevenLabsError(body?.detail?.status === "invalid_api_key" ? INVALID_KEY : HISTORY_PERMISSION);
    }
    if (!res.ok) throw new ElevenLabsError(`a conferência do histórico respondeu ${res.status}`);
  }

  /** O apagar não derruba a fala: o áudio já foi gerado e pago. Devolve quantas apagou, ou `null` se o apagar falhou. */
  async function tryDelete(gen: Generation, voiceId: string, startedAtMs: number): Promise<number | null> {
    try {
      return await deleteGeneration(gen, voiceId, startedAtMs);
    } catch (e) {
      log(`elevenlabs: a fala não foi apagada do histórico (${(e as Error).message})`);
      return null;
    }
  }

  /**
   * Apaga do histórico a geração desta fala: a mesma voz e a partir do início da fala. Com o `request-id` do HTTP,
   * o item desse pedido; sem ele, ou se nenhum item o tem, o item com o mesmo texto. Os dois filtros protegem as
   * outras gerações da conta feitas na mesma hora com a mesma voz. Sem o filtro `source=TTS`: a doc não diz com que
   * `source` o WebSocket entra, e com ele a rodada do #31443 não achou nada.
   */
  async function deleteGeneration(gen: Generation, voiceId: string, startedAtMs: number): Promise<number> {
    const after = Math.floor(startedAtMs / 1000) - 1;
    const q = new URLSearchParams({ voice_id: voiceId, date_after_unix: String(after), page_size: "100" });
    for (let i = 0; i < tries; i++) {
      const page = (await api("GET", `/v1/history?${q}`)) as { history?: HistoryItem[] };
      const items = page.history ?? [];
      const byId = gen.requestId ? items.filter((h) => h.request_id === gen.requestId) : [];
      const mine = byId.length ? byId : items.filter((h) => typeof h.text === "string" && sameText(h.text, gen.text));
      if (mine.length) {
        for (const h of mine) await api("DELETE", `/v1/history/${encodeURIComponent(h.history_item_id)}`);
        return mine.length;
      }
      if (i < tries - 1) await Bun.sleep(Math.min(wait * (i + 1), 4 * wait));
    }
    log("elevenlabs: a geração não apareceu no histórico; nada apagado");
    return 0;
  }

  function synthesize(text: string, voice: Voice, o: { signal?: AbortSignal } = {}): Synthesis {
    return transport === "ws" ? synthesizeWs(text, voice, o) : synthesizeHttp(text, voice, o);
  }

  /** O `done` comum: o apagar roda mesmo se a fala falhar no meio, porque o servidor pode ter guardado parte dela. */
  function finishWith(stream: Promise<void>, gen: Generation, voice: Voice, startedAt: number): Synthesis["done"] {
    return stream.then(
      async () => ({ chars: gen.text.length, deleted: (await tryDelete(gen, voice.id, startedAt)) ?? 0 }),
      async (err: ElevenLabsError) => {
        // A fala caiu e o apagar falhou: a geração pode estar na conta, e o aviso da tabela tem de contar.
        if ((await tryDelete(gen, voice.id, startedAt)) === null) err.notDeleted = 1;
        throw err;
      },
    );
  }

  /** `POST /v1/text-to-speech/{voz}/stream`: o áudio chega em pedaços no corpo, e o `request-id` no cabeçalho. */
  function synthesizeHttp(text: string, voice: Voice, o: { signal?: AbortSignal }): Synthesis {
    const startedAt = Date.now();
    const gen: Generation = { text };
    const chunks: Uint8Array[] = [];
    let ended = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const poke = () => {
      wake?.();
      wake = null;
    };
    const q = new URLSearchParams({ output_format: OUTPUT_FORMAT });
    const stream = (async () => {
      try {
        const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice.id)}/stream?${q}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ text, model_id: model }),
          signal: o.signal,
        });
        gen.requestId = res.headers.get("request-id") ?? undefined;
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { detail?: { status?: string } } | null;
          throw new ElevenLabsError(`o servidor recusou a fala (${res.status}${body?.detail?.status ? ` ${body.detail.status}` : ""})`);
        }
        for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
          chunks.push(c);
          poke();
        }
      } catch (e) {
        failure = e instanceof ElevenLabsError ? e : new ElevenLabsError(o.signal?.aborted ? "fala cancelada" : "a conexão HTTP falhou");
        throw failure;
      } finally {
        ended = true;
        poke();
      }
    })();
    stream.catch(() => {});

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
    return { audio: audio(), format: "mp3", done: finishWith(stream, gen, voice, startedAt) };
  }

  function synthesizeWs(text: string, voice: Voice, o: { signal?: AbortSignal }): Synthesis {
    const startedAt = Date.now();
    const wsBase = base.replace(/^http/, "ws");
    // `auto_mode`: o servidor decide quando gerar, sem esperar o `chunk_length_schedule` encher.
    const q = new URLSearchParams({ model_id: model, output_format: OUTPUT_FORMAT, auto_mode: "true" });
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

    return { audio: audio(), format: "mp3", done: finishWith(streamDone, { text }, voice, startedAt) };
  }

  return {
    // O nome diz o caminho na tabela, para a rodada pelo WebSocket não se misturar com a do HTTP.
    name: transport === "ws" ? "elevenlabs-ws" : "elevenlabs",
    voices: (lang) => VOICES[lang],
    synthesize,
    check,
    costPerChar: USD_PER_CREDIT * (CREDITS_PER_CHAR[model] ?? 1),
  };
}
