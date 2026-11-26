// A voz do Kiwi com o provedor das settings (spec #31616, T31626), contra um servidor falso e um Keychain falso:
// nenhuma chave nem chamada de verdade. A chave é inventada.
import { afterEach, expect, test } from "bun:test";

import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { vozDoKiwi } from "./cat-voice-provider.ts";
import { ElevenLabsError } from "./elevenlabs-voice.ts";
import { elevenLabsKey, memoryKeychain } from "./keychain.ts";
import type { SinteseFala } from "./voice-process.ts";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

function montar(o: { status?: number; body?: unknown } = {}) {
  const pedidos: { method: string; path: string; body?: unknown }[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      pedidos.push({ method: req.method, path, ...(req.method === "POST" ? { body: await req.json() } : {}) });
      if (o.status) return Response.json(o.body ?? {}, { status: o.status });
      if (req.method === "GET") return Response.json({ voice_id: "x" });
      return new Response(new Uint8Array([1, 0, 2, 0]));
    },
  });
  const settings = { ...DEFAULT_SETTINGS };
  const kc = memoryKeychain();
  const local: SinteseFala = {
    async *sintetizar() {
      yield Int16Array.from([9]);
    },
  };
  const tocados: number[][] = [];
  const avisos: unknown[] = [];
  let saida = true;
  const voz = vozDoKiwi({
    vozLocal: local,
    settings: { load: async () => settings },
    key: elevenLabsKey({ run: kc.run }),
    baseUrl: `http://127.0.0.1:${server.port}`,
    aviso: (r) => avisos.push(r),
    falarUmaVez: () =>
      saida
        ? async (s, texto) => {
            for await (const p of s.sintetizar(texto, new AbortController().signal)) tocados.push([...p]);
          }
        : undefined,
  });
  const falar = async (frase: string) => {
    const out: number[][] = [];
    for await (const p of voz.sintese.sintetizar(frase, new AbortController().signal)) out.push([...p]);
    return out;
  };
  return { voz, settings, kc, pedidos, tocados, avisos, falar, semSaida: () => (saida = false) };
}

test("o provedor, a voz e o modelo vêm das settings; a chave, do Keychain", async () => {
  const m = montar();
  expect(await m.falar("Oi.")).toEqual([[9]]);
  expect(m.pedidos).toEqual([]);
  m.settings.catVoiceProvider = "elevenlabs";
  // Sem chave no Keychain: a voz local, e o motivo.
  expect(await m.falar("Oi.")).toEqual([[9]]);
  expect(m.avisos).toEqual(["no_key"]);
  expect(m.voz.lastFallback()?.reason).toBe("no_key");
  await elevenLabsKey({ run: m.kc.run }).setKey("chave-exemplo-123");
  m.settings.elevenLabsVoiceId = "VozExemplo02";
  m.settings.elevenLabsModel = "eleven_v3";
  expect(await m.falar("Oi.")).toEqual([[1, 2]]);
  expect(m.pedidos).toEqual([{ method: "POST", path: "/v1/text-to-speech/VozExemplo02/stream", body: { text: "Oi.", model_id: "eleven_v3" } }]);
  expect(m.avisos).toEqual(["no_key", null]);
  expect(m.voz.lastFallback()).toBeNull();
});

test("speakOnce: confere a voz e fala pelo ElevenLabs, mesmo com o provedor local", async () => {
  const m = montar();
  await elevenLabsKey({ run: m.kc.run }).setKey("chave-exemplo-123");
  await m.voz.speakOnce("Teste.");
  expect(m.pedidos.map((p) => `${p.method} ${p.path}`)).toEqual(["GET /v1/voices/XrExE9yKIg1WjnnlVkGX", "POST /v1/text-to-speech/XrExE9yKIg1WjnnlVkGX/stream"]);
  expect(m.tocados).toEqual([[1, 2]]);
});

test("speakOnce: rejeita com o motivo, sem cair para a local, e sem a saída", async () => {
  const sem = montar();
  await expect(sem.voz.speakOnce("Teste.")).rejects.toMatchObject({ reason: "no_key" });
  expect(sem.pedidos).toEqual([]);
  server!.stop(true);
  const m = montar({ status: 404, body: { detail: { status: "voice_not_found" } } });
  await elevenLabsKey({ run: m.kc.run }).setKey("chave-exemplo-123");
  const e = await m.voz.speakOnce("Teste.").catch((x) => x);
  expect(e).toBeInstanceOf(ElevenLabsError);
  expect((e as ElevenLabsError).reason).toBe("voice_not_found");
  expect(m.tocados).toEqual([]);
  m.semSaida();
  await expect(m.voz.speakOnce("Teste.")).rejects.toThrow("helper_unavailable");
});
