// O provedor ElevenLabs (spec #31616, T31626) contra um servidor falso, local: nenhuma chave de verdade, nenhuma
// chamada à API real. A chave dos testes é inventada.
import { afterEach, describe, expect, test } from "bun:test";

import type { SinteseFala } from "./voice-process.ts";
import { ElevenLabsError, type ElevenLabsReason, elevenLabsVoice, sinteseComQueda, textoSeguro } from "./elevenlabs-voice.ts";

const KEY = "chave-exemplo-123";
// Um token no formato do GitHub, montado em partes, como no filter.test.ts: o guardrail o reconhece.
const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

interface Seen {
  method: string;
  path: string;
  search: string;
  key: string | null;
  body: unknown;
}

type Handler = (req: Request, seen: Seen) => Response | Promise<Response>;

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

function falso(handler: Handler) {
  const seen: Seen[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const s: Seen = { method: req.method, path: u.pathname, search: u.search, key: req.headers.get("xi-api-key"), body: req.method === "POST" ? await req.json() : undefined };
      seen.push(s);
      return handler(req, s);
    },
  });
  return { seen, baseUrl: `http://127.0.0.1:${server.port}` };
}

/** PCM little-endian de `n` amostras: a amostra i vale i - 1000 (negativas também). */
function pcm(n: number): Uint8Array {
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, i - 1000, true);
  return b;
}

/** Uma resposta que manda os bytes em pedaços dos tamanhos dados (ímpares, para partir as amostras). */
function emPedacos(bytes: Uint8Array, sizes: number[]): Response {
  const parts: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; at < bytes.length; i++) {
    const n = sizes[i % sizes.length]!;
    parts.push(bytes.slice(at, at + n));
    at += n;
  }
  return new Response(
    new ReadableStream({
      async pull(c) {
        const p = parts.shift();
        if (!p) return c.close();
        await Bun.sleep(1);
        c.enqueue(p);
      },
    }),
    { headers: { "content-type": "audio/pcm" } },
  );
}

const voz = (baseUrl: string, key: string | null = KEY, extra: { voiceId?: string } = {}) =>
  elevenLabsVoice({ baseUrl, getKey: async () => key, config: async () => ({ voiceId: extra.voiceId ?? "VozExemplo01", model: "eleven_v4_turbo" }) });

async function tudo(s: SinteseFala, frase: string, signal = new AbortController().signal) {
  const out: Int16Array[] = [];
  for await (const c of s.sintetizar(frase, signal)) out.push(c);
  return out;
}

async function motivo(p: Promise<unknown>): Promise<ElevenLabsReason | string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ElevenLabsError ? e.reason : `outro: ${String(e)}`;
  }
}

describe("elevenLabsVoice", () => {
  test("o PCM chega em fatias de 80 ms, com as amostras partidas entre pedaços remontadas, e a chave só no cabeçalho", async () => {
    const n = 1920 * 2 + 777;
    const { seen, baseUrl } = falso(() => emPedacos(pcm(n), [1001, 3, 4096, 7]));
    const out = await tudo(voz(baseUrl), "Oi, Ana.");
    expect(out.map((c) => c.length)).toEqual([1920, 1920, 777]);
    const all = out.flatMap((c) => [...c]);
    expect(all.length).toBe(n);
    for (const i of [0, 1, 999, 1000, 1919, 1920, 3840, n - 1]) expect(all[i]).toBe(i - 1000);
    expect(seen).toEqual([
      { method: "POST", path: "/v1/text-to-speech/VozExemplo01/stream", search: "?output_format=pcm_24000", key: KEY, body: { text: "Oi, Ana.", model_id: "eleven_v4_turbo" } },
    ]);
    expect(seen[0]!.search).not.toContain(KEY);
  });

  test("o texto passa pelo guardrail: o segredo e o marcador não saem", async () => {
    const { seen, baseUrl } = falso(() => emPedacos(pcm(10), [20]));
    await tudo(voz(baseUrl), `Guardei o token ${GH} na nota.`);
    const text = (seen[0]!.body as { text: string }).text;
    expect(text).not.toContain(GH);
    expect(text).not.toContain("segredo");
    expect(text).toBe("Guardei o token na nota.");
    expect(textoSeguro(`  ${GH}  `)).toBe("");
  });

  test("uma frase que só tinha segredo não chama a API", async () => {
    const { seen, baseUrl } = falso(() => emPedacos(pcm(10), [20]));
    expect(await tudo(voz(baseUrl), GH)).toEqual([]);
    expect(seen).toEqual([]);
  });

  test("os motivos: o detail.status da API, ou o código HTTP", async () => {
    const casos: [number, unknown, ElevenLabsReason][] = [
      [401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }, "invalid_api_key"],
      [401, { detail: { status: "missing_permissions", message: "x" } }, "missing_permissions"],
      [401, { detail: { status: "quota_exceeded", message: "x" } }, "quota_exceeded"],
      [400, { detail: { status: "voice_not_found", message: "x" } }, "voice_not_found"],
      [401, "não é json", "invalid_api_key"],
      [404, {}, "voice_not_found"],
      [402, {}, "quota_exceeded"],
      [500, { detail: { status: "algo_novo" } }, "unknown"],
    ];
    for (const [status, body, esperado] of casos) {
      const { baseUrl } = falso(() => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
      expect(await motivo(tudo(voz(baseUrl), "Oi."))).toBe(esperado);
      server!.stop(true);
    }
  });

  test("sem chave: no_key, sem chamar a API; sem rede: network; e o erro não traz a chave", async () => {
    const { seen, baseUrl } = falso(() => emPedacos(pcm(10), [20]));
    expect(await motivo(tudo(voz(baseUrl, null), "Oi."))).toBe("no_key");
    expect(await motivo(tudo(voz(baseUrl, ""), "Oi."))).toBe("no_key");
    expect(seen).toEqual([]);
    server!.stop(true);
    let erro: unknown;
    try {
      await tudo(voz(baseUrl), "Oi.");
    } catch (e) {
      erro = e;
    }
    expect((erro as ElevenLabsError).reason).toBe("network");
    expect(String(erro)).not.toContain(KEY);
    expect(String(erro)).not.toContain("Oi");
  });

  test("a rede cai no meio do áudio: network", async () => {
    const { baseUrl } = falso(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(pcm(2000));
              setTimeout(() => c.error(new Error("caiu")), 5);
            },
          }),
        ),
    );
    const out: Int16Array[] = [];
    const r = await motivo(
      (async () => {
        for await (const c of voz(baseUrl).sintetizar("Oi.", new AbortController().signal)) out.push(c);
      })(),
    );
    expect(r).toBe("network");
    expect(out.length).toBe(1);
  });

  test("o abort no meio para a fala sem erro, e o servidor vê a conexão fechar", async () => {
    let fechou = false;
    const { baseUrl } = falso(
      () =>
        new Response(
          new ReadableStream({
            async pull(c) {
              await Bun.sleep(5);
              c.enqueue(pcm(1920));
            },
            cancel() {
              fechou = true;
            },
          }),
        ),
    );
    const ac = new AbortController();
    const out: Int16Array[] = [];
    for await (const c of voz(baseUrl).sintetizar("Uma frase longa.", ac.signal)) {
      out.push(c);
      if (out.length === 2) ac.abort();
    }
    expect(out.length).toBe(2);
    for (let i = 0; i < 50 && !fechou; i++) await Bun.sleep(5);
    expect(fechou).toBe(true);
  });

  test("abortado antes: nada sai", async () => {
    const { seen, baseUrl } = falso(() => emPedacos(pcm(10), [20]));
    const ac = new AbortController();
    ac.abort();
    expect(await tudo(voz(baseUrl), "Oi.", ac.signal)).toEqual([]);
    expect(seen).toEqual([]);
  });

  test("checkVoice: o GET da voz com a chave, e os motivos", async () => {
    const respostas: Record<string, Response | (() => Response)> = {};
    const { seen, baseUrl } = falso((req) => {
      const id = new URL(req.url).pathname.split("/").pop()!;
      return (respostas[id] as () => Response)();
    });
    respostas.VozExemplo01 = () => Response.json({ voice_id: "VozExemplo01", name: "Exemplo" });
    respostas.Sumida = () => Response.json({ detail: { status: "voice_not_found" } }, { status: 404 });
    respostas.Torta = () => Response.json({ detail: { status: "invalid_uid" } }, { status: 400 });
    respostas.Chave = () => Response.json({ detail: { status: "invalid_api_key" } }, { status: 401 });
    expect(await motivo(voz(baseUrl).checkVoice())).toBe("ok");
    expect(seen[0]).toEqual({ method: "GET", path: "/v1/voices/VozExemplo01", search: "", key: KEY, body: undefined });
    expect(await motivo(voz(baseUrl, KEY, { voiceId: "Sumida" }).checkVoice())).toBe("voice_not_found");
    expect(await motivo(voz(baseUrl, KEY, { voiceId: "Torta" }).checkVoice())).toBe("voice_not_found");
    expect(await motivo(voz(baseUrl, KEY, { voiceId: "Chave" }).checkVoice())).toBe("invalid_api_key");
    expect(await motivo(voz(baseUrl, null).checkVoice())).toBe("no_key");
  });
});

/** Uma síntese falsa que devolve um pedaço por frase com o valor `v`, ou lança na frase que `falha` disser. */
function sintese(v: number, falha?: (frase: string) => ElevenLabsReason | "depois" | undefined): SinteseFala & { frases: string[] } {
  const frases: string[] = [];
  return {
    frases,
    async *sintetizar(frase) {
      frases.push(frase);
      const f = falha?.(frase);
      if (f === "depois") {
        yield new Int16Array([v]);
        throw new ElevenLabsError("network");
      }
      if (f) throw new ElevenLabsError(f);
      yield new Int16Array([v]);
    },
  };
}

async function fala(s: SinteseFala, frases: string[]) {
  const signal = new AbortController().signal;
  const out: number[] = [];
  for (const f of frases) for await (const c of s.sintetizar(f, signal)) out.push(c[0]!);
  return out;
}

describe("sinteseComQueda", () => {
  test("local escolhida: só a local, sem tocar no ElevenLabs", async () => {
    const local = sintese(1);
    const nuvem = sintese(2);
    const s = sinteseComQueda({ local, nuvem, provedor: async () => "local", aviso: () => {} });
    expect(await fala(s, ["A.", "B."])).toEqual([1, 1]);
    expect(nuvem.frases).toEqual([]);
  });

  test("ElevenLabs escolhido e funcionando: só ele", async () => {
    const local = sintese(1);
    const s = sinteseComQueda({ local, nuvem: sintese(2), provedor: async () => "elevenlabs", aviso: () => {} });
    expect(await fala(s, ["A.", "B."])).toEqual([2, 2]);
    expect(local.frases).toEqual([]);
    expect(s.lastFallback()).toBeNull();
  });

  test("falha na 1ª frase: ela e o resto da fala saem na local, e o motivo vai uma vez só", async () => {
    const avisos: (ElevenLabsReason | null)[] = [];
    const logs: string[] = [];
    let erro: ElevenLabsReason | undefined = "quota_exceeded";
    const nuvem = sintese(2, () => erro);
    const local = sintese(1);
    const s = sinteseComQueda({ local, nuvem, provedor: async () => "elevenlabs", aviso: (r) => avisos.push(r), log: (m) => logs.push(m), now: () => new Date("2026-01-02T03:04:05Z") });
    expect(await fala(s, ["Frase um.", "Frase dois."])).toEqual([1, 1]);
    expect(nuvem.frases).toEqual(["Frase um."]);
    expect(local.frases).toEqual(["Frase um.", "Frase dois."]);
    expect(s.lastFallback()).toEqual({ reason: "quota_exceeded", at: "2026-01-02T03:04:05.000Z" });
    // A próxima fala tenta o ElevenLabs de novo; o mesmo motivo não repete o aviso.
    expect(await fala(s, ["Frase três."])).toEqual([1]);
    expect(avisos).toEqual(["quota_exceeded"]);
    // Ele volta: o aviso some.
    erro = undefined;
    expect(await fala(s, ["Frase quatro."])).toEqual([2]);
    expect(avisos).toEqual(["quota_exceeded", null]);
    expect(s.lastFallback()).toBeNull();
    // O log não leva o texto falado.
    expect(logs.join("\n")).not.toContain("Frase");
  });

  test("um motivo novo avisa de novo", async () => {
    const avisos: (ElevenLabsReason | null)[] = [];
    let erro: ElevenLabsReason = "network";
    const s = sinteseComQueda({ local: sintese(1), nuvem: sintese(2, () => erro), provedor: async () => "elevenlabs", aviso: (r) => avisos.push(r) });
    await fala(s, ["A."]);
    erro = "invalid_api_key";
    await fala(s, ["B."]);
    expect(avisos).toEqual(["network", "invalid_api_key"]);
  });

  test("falha depois de tocar parte da frase: ela não recomeça na local, e a próxima frase vai na local", async () => {
    const nuvem = sintese(2, (f) => (f === "A." ? "depois" : undefined));
    const local = sintese(1);
    const s = sinteseComQueda({ local, nuvem, provedor: async () => "elevenlabs", aviso: () => {} });
    expect(await fala(s, ["A.", "B."])).toEqual([2, 1]);
    expect(local.frases).toEqual(["B."]);
  });

  test("o provedor é lido uma vez por fala: trocar no meio vale da próxima", async () => {
    let p: "local" | "elevenlabs" = "elevenlabs";
    let lidas = 0;
    const s = sinteseComQueda({
      local: sintese(1),
      nuvem: sintese(2),
      provedor: async () => {
        lidas++;
        return p;
      },
      aviso: () => {},
    });
    const signal = new AbortController().signal;
    const out: number[] = [];
    for await (const c of s.sintetizar("A.", signal)) out.push(c[0]!);
    p = "local";
    for await (const c of s.sintetizar("B.", signal)) out.push(c[0]!);
    expect(out).toEqual([2, 2]);
    expect(lidas).toBe(1);
    expect(await fala(s, ["C."])).toEqual([1]);
  });

  test("abortado durante a falha: não cai para a local nem avisa", async () => {
    const ac = new AbortController();
    const avisos: unknown[] = [];
    const local = sintese(1);
    const nuvem: SinteseFala = {
      // biome-ignore lint/correctness/useYield: falha antes do 1º pedaço
      async *sintetizar() {
        ac.abort();
        throw new ElevenLabsError("network");
      },
    };
    const s = sinteseComQueda({ local, nuvem, provedor: async () => "elevenlabs", aviso: (r) => avisos.push(r) });
    const out: Int16Array[] = [];
    for await (const c of s.sintetizar("A.", ac.signal)) out.push(c);
    expect(out).toEqual([]);
    expect(avisos).toEqual([]);
  });
});
