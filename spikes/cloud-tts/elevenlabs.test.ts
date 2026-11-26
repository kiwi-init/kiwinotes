// T31096, T31446: o provedor ElevenLabs (HTTP `/stream` e WebSocket `stream-input`) contra um servidor falso local. Nenhuma conta de verdade: a rodada real é do harry.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { elevenLabs, FREE_TIER_LIBRARY, HISTORY_PERMISSION, INVALID_KEY, parseVoices, sameText, VOICE_NOT_FOUND } from "./elevenlabs";
import { main } from "./run.ts";

const KEY = "sk_exemplo_0000000000000000000000000000000000000000";
const VOICE = { id: "voz-exemplo", name: "Exemplo", lang: "pt-BR" as const };

type HistoryItem = { history_item_id: string; text: string; voice_id: string; request_id?: string; source?: string };

const seen = {
  wsHeaders: [] as (string | null)[],
  wsUrls: [] as string[],
  wsMessages: [] as string[],
  httpHeaders: [] as (string | null)[],
  httpUrls: [] as string[],
  deleted: [] as string[],
  /** Cada fala que chegou ao servidor, pelos dois caminhos: a chave do cabeçalho e o texto. */
  synth: [] as { key: string | null; text: string; via: "http" | "ws" }[],
  historyQueries: [] as URLSearchParams[],
};
let history: HistoryItem[] = [];
/** Quantos GETs do histórico voltam vazios antes de a geração aparecer (o atraso da conta de verdade). */
let lagGets = 0;
/** O que o WebSocket falso faz: tocar o áudio, recusar ou cair no meio. */
let wsMode: "ok" | "error" | "drop" = "ok";
/** A chave sem a permissão de histórico: os GETs do histórico a partir deste (0 = desde a conferência) dão 401. */
let historyDenyFrom = Infinity;
let historyGets = 0;
let gen = 0;
/** O HTTP falso: tocar, recusar com 401 ou cair no meio do corpo. */
let httpMode: "ok" | "error" | "drop" = "ok";
/** O HTTP devolve o `request-id`? E o item do histórico o traz? (A doc diz que sim; o filtro pelo texto fica de reserva.) */
let sendRequestId = true;
/** O nome do cabeçalho do id: a doc do SDK JS mostra os dois. */
let requestIdHeader = "request-id";
/** A espera entre o primeiro e o segundo pedaço do áudio, para medir o primeiro som antes do total. */
let gapMs = 0;
/** Com que `source` o histórico guarda a fala do WebSocket (a doc não diz; a rodada do #31443 não achou com `TTS`). */
let wsSource = "TTS";
/** As vozes que a conta acha (`GET /v1/voices/{id}`) e o plano dela (`GET /v1/user/subscription`). */
let accountVoices: Record<string, { category: string; available_for_tiers?: string[] }> = {};
let tier = "creator";
let subscriptionStatus = 200;

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/stream-input")) {
        seen.wsHeaders.push(req.headers.get("xi-api-key"));
        seen.wsUrls.push(req.url);
        return srv.upgrade(req, { data: { text: "", voice: url.pathname.split("/")[3] } }) ? undefined : new Response("no", { status: 400 });
      }
      seen.httpHeaders.push(req.headers.get("xi-api-key"));
      seen.httpUrls.push(req.url);
      const stream = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)\/stream$/);
      if (req.method === "POST" && stream) return fakeStream(req, decodeURIComponent(stream[1]));
      // Como a API de verdade: o 401 diz o porquê no `detail.status`.
      if (req.headers.get("xi-api-key") !== KEY) return Response.json({ detail: { status: "invalid_api_key" } }, { status: 401 });
      if (url.pathname.startsWith("/v1/history") && historyGets++ >= historyDenyFrom) return Response.json({ detail: { status: "missing_permissions" } }, { status: 401 });
      if (req.method === "GET" && url.pathname === "/v1/history") {
        seen.historyQueries.push(url.searchParams);
        if (lagGets > 0) {
          lagGets--;
          return Response.json({ history: [] });
        }
        const v = url.searchParams.get("voice_id");
        const src = url.searchParams.get("source");
        return Response.json({ history: history.filter((h) => h.voice_id === v && (!src || h.source === src)) });
      }
      const voice = url.pathname.match(/^\/v1\/voices\/([^/]+)$/);
      if (req.method === "GET" && voice) {
        const v = accountVoices[decodeURIComponent(voice[1]!)];
        return v ? Response.json({ voice_id: voice[1], ...v }) : Response.json({ detail: { status: "voice_not_found" } }, { status: 404 });
      }
      if (req.method === "GET" && url.pathname === "/v1/user/subscription") {
        return subscriptionStatus === 200 ? Response.json({ tier }) : Response.json({ detail: { status: "missing_permissions" } }, { status: subscriptionStatus });
      }
      const del = url.pathname.match(/^\/v1\/history\/(.+)$/);
      if (req.method === "DELETE" && del) {
        seen.deleted.push(decodeURIComponent(del[1]));
        history = history.filter((h) => h.history_item_id !== decodeURIComponent(del[1]));
        return Response.json({ status: "ok" });
      }
      return new Response("{}", { status: 404 });
    },
    websocket: {
      message(ws, raw) {
        const data = ws.data as { text: string; voice: string };
        seen.wsMessages.push(String(raw));
        const msg = JSON.parse(String(raw)) as { text: string };
        if (msg.text.trim()) data.text += msg.text;
        if (msg.text !== "") return;
        // O fim do texto: a conta guarda a geração no histórico e o áudio sai em pedaços.
        if (wsMode === "error") {
          ws.send(JSON.stringify({ error: "quota_exceeded", message: "sem créditos" }));
          return;
        }
        seen.synth.push({ key: seen.wsHeaders.at(-1) ?? null, text: data.text.trim(), via: "ws" });
        history.push({ history_item_id: `item-${++gen}`, text: data.text.trim(), voice_id: data.voice, source: wsSource });
        ws.send(JSON.stringify({ audio: Buffer.from("ID3-parte-1").toString("base64"), isFinal: false }));
        if (wsMode === "drop") {
          ws.close(1011, "caiu");
          return;
        }
        ws.send(JSON.stringify({ audio: Buffer.from("-parte-2").toString("base64"), isFinal: false }));
        ws.send(JSON.stringify({ audio: null, isFinal: true }));
      },
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

/** `POST /v1/text-to-speech/{voz}/stream`: o `request-id` no cabeçalho, o item no histórico e o mp3 em pedaços no corpo. */
async function fakeStream(req: Request, voice: string): Promise<Response> {
  const body = (await req.json()) as { text: string; model_id?: string };
  seen.synth.push({ key: req.headers.get("xi-api-key"), text: body.text, via: "http" });
  const requestId = `req-exemplo-${++gen}`;
  const headers: Record<string, string> = { "content-type": "audio/mpeg" };
  if (sendRequestId) headers[requestIdHeader] = requestId;
  if (httpMode === "error") return Response.json({ detail: { status: "quota_exceeded" } }, { status: 401, headers });
  history.push({ history_item_id: `item-${gen}`, text: body.text, voice_id: voice, source: "TTS", ...(sendRequestId ? { request_id: requestId } : {}) });
  const mode = httpMode;
  const gap = gapMs;
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode("ID3-parte-1"));
        if (gap) await Bun.sleep(gap);
        if (mode === "drop") return c.error(new Error("caiu"));
        c.enqueue(enc.encode("-parte-2"));
        c.close();
      },
    }),
    { headers },
  );
}

function reset() {
  for (const k of Object.keys(seen) as (keyof typeof seen)[]) seen[k].length = 0;
  history = [];
  lagGets = 0;
  wsMode = "ok";
  httpMode = "ok";
  sendRequestId = true;
  requestIdHeader = "request-id";
  gapMs = 0;
  wsSource = "TTS";
  accountVoices = {};
  tier = "creator";
  subscriptionStatus = 200;
  historyDenyFrom = Infinity;
  historyGets = 0;
}

const provider = () => elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base, ELEVENLABS_TRANSPORT: "ws" }, historyWaitMs: 5 });
const httpProvider = (o: { log?: (l: string) => void } = {}) =>
  elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base }, historyWaitMs: 5, ...o });

async function readAll(it: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  for await (const p of it) parts.push(p);
  return Buffer.concat(parts).toString();
}

describe("ElevenLabs pelo WebSocket (servidor falso)", () => {
  test("o áudio chega em pedaços, na ordem, em mp3", async () => {
    reset();
    const s = provider().synthesize("Oi, Ana! A reunião do Projeto X é às 15h.", VOICE);
    expect(s.format).toBe("mp3");
    expect(await readAll(s.audio)).toBe("ID3-parte-1-parte-2");
    expect((await s.done).chars).toBe("Oi, Ana! A reunião do Projeto X é às 15h.".length);
  });

  test("a chave só vai no cabeçalho xi-api-key: nunca na URL nem nas mensagens", async () => {
    reset();
    const s = provider().synthesize("Tudo pronto.", VOICE);
    await readAll(s.audio);
    await s.done;
    expect(seen.wsHeaders).toEqual([KEY]);
    expect(seen.httpHeaders.every((h) => h === KEY)).toBe(true);
    for (const u of [...seen.wsUrls, ...seen.httpUrls]) expect(u).not.toContain(KEY);
    for (const m of seen.wsMessages) expect(m).not.toContain(KEY);
  });

  test("o provedor manda só o texto que recebeu (o núcleo já tirou os segredos)", async () => {
    reset();
    const s = provider().synthesize("Sua nota foi salva.", VOICE);
    await readAll(s.audio);
    await s.done;
    const sent = seen.wsMessages.map((m) => (JSON.parse(m) as { text: string }).text).join("");
    expect(sent.trim()).toBe("Sua nota foi salva.");
  });

  test("no fim da fala, a geração é apagada do histórico", async () => {
    reset();
    const s = provider().synthesize("Lembrete: revisar o exemplo amanhã.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.deleted).toEqual(["item-" + gen]);
    expect(history).toEqual([]);
  });

  test("outra geração da conta, da mesma voz e na mesma hora, fica (o texto não bate)", async () => {
    reset();
    history.push({ history_item_id: "da-pessoa", text: "Um texto que a pessoa gerou no site.", voice_id: VOICE.id });
    history.push({ history_item_id: "outra-voz", text: "Bom dia.", voice_id: "voz-vizinha" });
    const s = provider().synthesize("Bom dia.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.deleted).toEqual(["item-" + gen]);
    expect(history.map((h) => h.history_item_id).sort()).toEqual(["da-pessoa", "outra-voz"]);
  });

  test("o histórico atrasado: procura de novo até a geração aparecer", async () => {
    reset();
    lagGets = 3;
    const s = provider().synthesize("São 3 itens na lista.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.httpUrls.filter((u) => u.includes("/v1/history?")).length).toBe(4);
  });

  test("a fala que cai no meio ainda apaga o que a conta guardou", async () => {
    reset();
    wsMode = "drop";
    const s = provider().synthesize("Uma fala que cai.", VOICE);
    await expect(readAll(s.audio)).rejects.toThrow(/fechou com 1011/);
    await expect(s.done).rejects.toThrow();
    expect(seen.deleted.length).toBe(1);
    expect(history).toEqual([]);
  });

  test("o erro do servidor sai sem a chave", async () => {
    reset();
    wsMode = "error";
    const s = provider().synthesize("Sem créditos.", VOICE);
    const err = await readAll(s.audio).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("quota_exceeded");
    expect(err?.message).not.toContain(KEY);
    await s.done.catch(() => {});
  });

  test("sem a chave no ambiente, para antes de qualquer chamada", () => {
    expect(() => elevenLabs({ env: { ELEVENLABS_BASE_URL: base } })).toThrow(/ELEVENLABS_API_KEY/);
  });

  test("a chave errada: a conferência para antes de gerar, sem a chave no erro", async () => {
    reset();
    const p = elevenLabs({ env: { ELEVENLABS_API_KEY: "sk_exemplo_errada", ELEVENLABS_BASE_URL: base }, historyWaitMs: 5 });
    const err = await p.check!().then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain(INVALID_KEY);
    expect(err?.message).not.toContain(HISTORY_PERMISSION);
    expect(err?.message).not.toContain("sk_exemplo_errada");
    expect(seen.wsHeaders).toEqual([]);
  });

  test("o apagar que falha não derruba a fala: o áudio chega e a fala conta como não apagada", async () => {
    reset();
    historyDenyFrom = 0;
    const warned: string[] = [];
    const p = elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base }, historyWaitMs: 5, log: (l) => warned.push(l) });
    const s = p.synthesize("Oi, Ana.", VOICE);
    expect(await readAll(s.audio)).toBe("ID3-parte-1-parte-2");
    expect(await s.done).toEqual({ chars: "Oi, Ana.".length, deleted: 0 });
    expect(warned.join("\n")).toContain("não foi apagada");
    expect(warned.join("\n")).not.toContain(KEY);
  });

  test("vozes prontas: 3 por língua, nenhuma clonada", () => {
    const p = provider();
    expect(p.voices("pt-BR").length).toBe(3);
    expect(p.voices("en-US").length).toBe(3);
    expect(p.costPerChar).toBeGreaterThan(0);
  });

  test("sameText ignora espaços nas pontas e repetidos", () => {
    expect(sameText("  Oi,  Ana. ", "Oi, Ana.")).toBe(true);
    expect(sameText("Oi, Ana.", "Oi, Bruno.")).toBe(false);
  });
});

test("a rodada com o ElevenLabs falso: os tokens de exemplo não saem, cada geração é apagada e a chave não aparece", async () => {
  reset();
  const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-el-"));
  const printed: string[] = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => printed.push(a.join(" "));
  console.error = (...a) => printed.push(a.join(" "));
  let code: number;
  try {
    code = await main(["--providers", "elevenlabs", "--rounds", "1", "--only", "pt01,pt10,en09,mix01", "--out", out], {
      ELEVENLABS_API_KEY: KEY,
      ELEVENLABS_BASE_URL: base,
    });
  } finally {
    Object.assign(console, orig);
  }
  const all = printed.join("\n");
  expect(code).toBe(0);
  expect(all).toContain("credenciais: nenhuma");
  expect(all).not.toContain(KEY);
  // 4 falas × 3 vozes: o que chegou ao servidor não tem os tokens de exemplo, e cada geração saiu do histórico.
  const sent = seen.synth.map((x) => x.text).join("\n");
  expect(seen.synth.length).toBe(12);
  expect(seen.synth.every((x) => x.via === "http" && x.key === KEY)).toBe(true);
  expect(sent).not.toMatch(/ghp|AKIA|segredo/i);
  expect(seen.deleted.length).toBe(12);
  expect(history).toEqual([]);
  expect(existsSync(path.join(out, "tabela.md"))).toBe(true);
  for (const f of readdirSync(out, { recursive: true }) as string[]) {
    if (!f.includes(".")) continue;
    expect(readFileSync(path.join(out, f)).toString("latin1")).not.toContain(KEY);
  }
});

/** A rodada inteira pelo main, com a saída capturada. */
async function runMain(env: Record<string, string>) {
  const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-el-"));
  const printed: string[] = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => printed.push(a.join(" "));
  console.error = (...a) => printed.push(a.join(" "));
  try {
    const code = await main(["--providers", "elevenlabs", "--rounds", "1", "--only", "pt01,en09", "--out", out], env);
    return { code, out, all: printed.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}

test("a chave sem a permissão de histórico: a rodada para antes de qualquer fala, sem gastar crédito (#31397)", async () => {
  reset();
  historyDenyFrom = 0;
  const r = await runMain({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base });
  expect(r.code).toBe(2);
  expect(r.all).toContain(HISTORY_PERMISSION);
  expect(r.all).not.toContain(INVALID_KEY);
  expect(r.all).not.toContain(KEY);
  expect(seen.synth).toEqual([]);
  expect(existsSync(path.join(r.out, "tabela.md"))).toBe(false);
});

test("a permissão some no meio da rodada: o áudio fica salvo e a tabela avisa as falas não apagadas", async () => {
  reset();
  historyDenyFrom = 1; // a conferência passa; os GETs do apagar dão 401
  const r = await runMain({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base });
  expect(r.code).toBe(0);
  expect(r.all).not.toContain(KEY);
  // 2 falas × 3 vozes: os 6 áudios salvos, nenhuma falha na tabela e o aviso das 6 gerações que ficaram na conta.
  expect(seen.synth.length).toBe(6);
  const files = (readdirSync(path.join(r.out, "elevenlabs"), { recursive: true }) as string[]).filter((f) => f.endsWith(".mp3"));
  expect(files.length).toBe(6);
  const tabela = readFileSync(path.join(r.out, "tabela.md"), "utf8");
  expect(tabela).toContain("| 0 de 3 |");
  expect(tabela).toContain("Aviso: 6 falas não apagadas do histórico do elevenlabs.");
  expect(seen.deleted).toEqual([]);
});

test("a mensagem da permissão pede leitura do histórico, que é o que a conferência prova (#31411)", () => {
  expect(HISTORY_PERMISSION).toContain("leitura");
  expect(HISTORY_PERMISSION).not.toContain("escrita");
});

test("a fala que cai e não consegue apagar conta como não apagada", async () => {
  reset();
  wsMode = "drop";
  historyDenyFrom = 0;
  const s = provider().synthesize("Uma fala que cai.", VOICE);
  await readAll(s.audio).catch(() => {});
  const err = (await s.done.then(
    () => null,
    (e: Error & { notDeleted?: number }) => e,
  ))!;
  expect(err.message).toContain("1011");
  expect(err.notDeleted).toBe(1);
});

test("a fala que cai mas apaga não entra no aviso", async () => {
  reset();
  wsMode = "drop";
  const s = provider().synthesize("Outra fala que cai.", VOICE);
  await readAll(s.audio).catch(() => {});
  const err = (await s.done.then(
    () => null,
    (e: Error & { notDeleted?: number }) => e,
  ))!;
  expect(seen.deleted.length).toBe(1);
  expect(err.notDeleted).toBeUndefined();
});

test("na rodada, as falas que caem sem apagar aparecem no aviso da tabela", async () => {
  reset();
  httpMode = "drop";
  historyDenyFrom = 1; // a conferência passa; o apagar dá 401
  const r = await runMain({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base });
  expect(r.code).toBe(0);
  const tabela = readFileSync(path.join(r.out, "tabela.md"), "utf8");
  expect(tabela).toContain("| 3 de 3 |");
  expect(tabela).toContain("Aviso: 6 falas não apagadas do histórico do elevenlabs.");
});

describe("ElevenLabs pelo HTTP /stream (o padrão, T31446)", () => {
  test("o áudio sai pelo POST /stream, com a chave só no cabeçalho e o texto no corpo", async () => {
    reset();
    const s = httpProvider().synthesize("Oi, Ana! A reunião do Projeto X é às 15h.", VOICE);
    expect(await readAll(s.audio)).toBe("ID3-parte-1-parte-2");
    await s.done;
    expect(seen.wsHeaders).toEqual([]);
    expect(seen.synth).toEqual([{ key: KEY, text: "Oi, Ana! A reunião do Projeto X é às 15h.", via: "http" }]);
    for (const u of seen.httpUrls) expect(u).not.toContain(KEY);
  });

  test("o primeiro pedaço chega antes do fim: o primeiro som não espera o áudio inteiro", async () => {
    reset();
    gapMs = 150;
    const t0 = performance.now();
    const s = httpProvider().synthesize("Uma frase curta.", VOICE);
    let first = 0;
    for await (const _ of s.audio) if (!first) first = performance.now() - t0;
    const total = performance.now() - t0;
    await s.done;
    expect(total - first).toBeGreaterThanOrEqual(100);
  });

  test("apaga pelo request-id: o item com o mesmo texto e sem esse id fica", async () => {
    reset();
    history.push({ history_item_id: "da-pessoa", text: "Bom dia.", voice_id: VOICE.id, source: "TTS", request_id: "req-da-pessoa" });
    const s = httpProvider().synthesize("Bom dia.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.deleted).toEqual(["item-" + gen]);
    expect(history.map((h) => h.history_item_id)).toEqual(["da-pessoa"]);
  });

  test("o id também vale no cabeçalho x-request-id", async () => {
    reset();
    requestIdHeader = "x-request-id";
    history.push({ history_item_id: "da-pessoa", text: "Bom dia.", voice_id: VOICE.id, source: "TTS", request_id: "req-da-pessoa" });
    const s = httpProvider().synthesize("Bom dia.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(history.map((h) => h.history_item_id)).toEqual(["da-pessoa"]);
  });

  test("a espera entre as procuras cresce: 3 vazias somam 1+2+3 esperas", async () => {
    reset();
    lagGets = 3;
    const p = elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base }, historyWaitMs: 40 });
    const s = p.synthesize("Uma frase de exemplo.", VOICE);
    await readAll(s.audio);
    const t0 = performance.now();
    expect((await s.done).deleted).toBe(1);
    // Fixa, seriam 3 × 40 = 120 ms; crescendo, 40 + 80 + 120 = 240 ms.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(220);
  });

  test("sem o request-id, cai no filtro pelo texto", async () => {
    reset();
    sendRequestId = false;
    const s = httpProvider().synthesize("Lembrete: revisar o exemplo.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(history).toEqual([]);
  });

  test("o histórico atrasado: procura de novo, com a espera crescendo", async () => {
    reset();
    lagGets = 4;
    const s = httpProvider().synthesize("São 3 itens na lista.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.historyQueries.length).toBe(5);
  });

  test("a fala recusada sai sem a chave, e o apagar roda mesmo assim", async () => {
    reset();
    httpMode = "error";
    const s = httpProvider().synthesize("Sem créditos.", VOICE);
    const err = await readAll(s.audio).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("401 quota_exceeded");
    expect(err?.message).not.toContain(KEY);
    await expect(s.done).rejects.toThrow();
  });

  test("a fala que cai no meio do corpo ainda apaga o que a conta guardou", async () => {
    reset();
    httpMode = "drop";
    const s = httpProvider().synthesize("Uma fala que cai.", VOICE);
    await expect(readAll(s.audio)).rejects.toThrow(/conexão HTTP falhou/);
    await expect(s.done).rejects.toThrow();
    expect(seen.deleted.length).toBe(1);
    expect(history).toEqual([]);
  });

  test("cancelar a fala para o download", async () => {
    reset();
    gapMs = 200;
    const ac = new AbortController();
    const s = httpProvider().synthesize("Uma fala cancelada.", VOICE, { signal: ac.signal });
    const it = s.audio[Symbol.asyncIterator]();
    await it.next();
    ac.abort();
    await expect(it.next()).rejects.toThrow(/cancelada/);
    await s.done.catch(() => {});
  });
});

describe("o WebSocket e o histórico (T31446)", () => {
  test("o stream-input pede auto_mode, para o servidor não esperar o chunk_length_schedule", async () => {
    reset();
    const s = provider().synthesize("Tudo pronto.", VOICE);
    await readAll(s.audio);
    await s.done;
    expect(new URL(seen.wsUrls[0]!).searchParams.get("auto_mode")).toBe("true");
    expect(provider().name).toBe("elevenlabs-ws");
    expect(httpProvider().name).toBe("elevenlabs");
  });

  test("a busca no histórico não filtra por source: a fala do WebSocket é achada com outro source", async () => {
    reset();
    wsSource = "stream_input";
    const s = provider().synthesize("Tudo pronto.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.historyQueries.every((q) => !q.has("source"))).toBe(true);
  });
});

describe("a voz escolhida na hora (T31480)", () => {
  const LIB = "vozExemploBiblioteca01";
  const withVoices = (voices: string, log?: (l: string) => void) =>
    elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base }, historyWaitMs: 5, voices, log });
  const checkErr = (p: ReturnType<typeof elevenLabs>) =>
    p.check!().then(
      () => null,
      (e: Error) => e,
    );

  test("--voices troca as vozes fixas pelas escolhidas, nas duas línguas, com o nome se vier", () => {
    const p = withVoices(`${LIB}:Narradora, outraVozExemplo`);
    expect(p.voices("pt-BR")).toEqual([
      { id: LIB, name: "Narradora", lang: "pt-BR" },
      { id: "outraVozExemplo", name: "outraVozExemplo", lang: "pt-BR" },
    ]);
    expect(p.voices("en-US").map((v) => v.id)).toEqual([LIB, "outraVozExemplo"]);
  });

  test("sem --voices, o ELEVENLABS_VOICES vale; sem os dois, as 3 vozes fixas", () => {
    const viaEnv = elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base, ELEVENLABS_VOICES: LIB } });
    expect(viaEnv.voices("pt-BR").map((v) => v.id)).toEqual([LIB]);
    expect(provider().voices("pt-BR").length).toBe(3);
  });

  test("um ID fora do formato para na hora, antes de qualquer chamada", () => {
    expect(() => parseVoices("../v1/history")).toThrow(/fora do formato/);
    expect(() => parseVoices(" , ")).toThrow(/sem nenhuma voz/);
  });

  test("a fala usa a voz escolhida", async () => {
    reset();
    accountVoices[LIB] = { category: "professional" };
    const p = withVoices(LIB);
    const s = p.synthesize("Oi, Ana.", p.voices("pt-BR")[0]!);
    await readAll(s.audio);
    await s.done;
    expect(seen.httpUrls.some((u) => u.includes(`/v1/text-to-speech/${LIB}/stream`))).toBe(true);
  });

  test("plano pago e voz da biblioteca em My Voices: a conferência passa", async () => {
    reset();
    accountVoices[LIB] = { category: "professional" };
    expect(await checkErr(withVoices(LIB))).toBeNull();
  });

  test("plano grátis e voz da biblioteca: para antes da 1ª fala, com a mensagem clara", async () => {
    reset();
    tier = "free";
    accountVoices[LIB] = { category: "professional" };
    const err = await checkErr(withVoices(LIB));
    expect(err?.message).toContain(FREE_TIER_LIBRARY);
    expect(err?.message).not.toContain(KEY);
    expect(seen.synth).toEqual([]);
  });

  test("plano grátis e voz pronta (premade): passa", async () => {
    reset();
    tier = "free";
    accountVoices[LIB] = { category: "premade" };
    expect(await checkErr(withVoices(LIB))).toBeNull();
  });

  test("a voz que a conta não acha: pede para adicionar em My Voices", async () => {
    reset();
    const err = await checkErr(withVoices(LIB));
    expect(err?.message).toContain(VOICE_NOT_FOUND);
  });

  test("a voz que não está no plano da conta (available_for_tiers) para antes", async () => {
    reset();
    tier = "starter";
    accountVoices[LIB] = { category: "professional", available_for_tiers: ["creator", "pro"] };
    const err = await checkErr(withVoices(LIB));
    expect(err?.message).toContain("não está no plano starter");
  });

  test("sem permissão de ler o plano: segue com um aviso", async () => {
    reset();
    subscriptionStatus = 401;
    accountVoices[LIB] = { category: "professional" };
    const warned: string[] = [];
    expect(await checkErr(withVoices(LIB, (l) => warned.push(l)))).toBeNull();
    expect(warned.join("\n")).toContain("não deu para ler o plano");
  });

  test("sem --voices, a conferência não olha voz nem plano", async () => {
    reset();
    tier = "free";
    expect(await checkErr(provider())).toBeNull();
    expect(seen.httpUrls.some((u) => u.includes("/v1/voices/") || u.includes("/v1/user/subscription"))).toBe(false);
  });

  test("na rodada: --voices no plano grátis para com código 2, sem gastar crédito", async () => {
    reset();
    tier = "free";
    accountVoices[LIB] = { category: "professional" };
    const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-el-"));
    const printed: string[] = [];
    const orig = { log: console.log, error: console.error };
    console.log = (...a) => printed.push(a.join(" "));
    console.error = (...a) => printed.push(a.join(" "));
    let code: number;
    try {
      code = await main(["--providers", "elevenlabs", "--rounds", "1", "--only", "pt01", "--voices", `${LIB}:Narradora`, "--out", out], {
        ELEVENLABS_API_KEY: KEY,
        ELEVENLABS_BASE_URL: base,
      });
    } finally {
      Object.assign(console, orig);
    }
    expect(code).toBe(2);
    expect(printed.join("\n")).toContain(FREE_TIER_LIBRARY);
    expect(seen.synth).toEqual([]);
  });

  test("na rodada: --voices num plano pago usa só a voz escolhida", async () => {
    reset();
    accountVoices[LIB] = { category: "professional" };
    const r = await (async () => {
      const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-el-"));
      const orig = { log: console.log, error: console.error };
      console.log = () => {};
      console.error = () => {};
      try {
        return await main(["--providers", "elevenlabs", "--rounds", "1", "--only", "pt01,en09", "--voices", `${LIB}:Narradora`, "--out", out], {
          ELEVENLABS_API_KEY: KEY,
          ELEVENLABS_BASE_URL: base,
        });
      } finally {
        Object.assign(console, orig);
      }
    })();
    expect(r).toBe(0);
    expect(seen.synth.length).toBe(2);
    expect(seen.httpUrls.filter((u) => u.includes("/stream")).every((u) => u.includes(`/v1/text-to-speech/${LIB}/stream`))).toBe(true);
  });
});
