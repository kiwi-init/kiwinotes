// O Google contra um servidor gRPC falso local (spec #30991, T31095): nenhum teste fala com a nuvem.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as grpc from "@grpc/grpc-js";

import { measure, prepare, table, wav } from "./core.ts";
import { chirpNames, googleProvider, ttsService } from "./google.ts";
import { main } from "./run.ts";

// Um token falso de exemplo, montado por partes para nenhum scanner o tomar por real.
const FAKE_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const FAKE_KEY = "exemplo-" + "chave-falsa-0000";

interface Seen {
  config?: { voice?: { name?: string; language_code?: string }; streaming_audio_config?: { audio_encoding?: string; sample_rate_hertz?: number } };
  texts: string[];
  metadata: Record<string, unknown>;
}

let server: grpc.Server;
let port = 0;
const seen: Seen[] = [];
let failNext = false;
/** O `ListVoices` falso: vozes Chirp 3 HD de exemplo e uma de outra família, que o filtro tira. */
const CATALOG = [
  { name: "pt-BR-Chirp3-HD-Zephyr", language_codes: ["pt-BR"] },
  { name: "pt-BR-Chirp3-HD-Achird", language_codes: ["pt-BR"] },
  { name: "pt-BR-Neural2-A", language_codes: ["pt-BR"] },
  { name: "en-US-Chirp3-HD-Puck", language_codes: ["en-US"] },
];
const listed: string[] = [];
let catalogEmpty = false;

beforeAll(async () => {
  server = new grpc.Server();
  server.addService(ttsService().service, {
    ListVoices(call: grpc.ServerUnaryCall<{ language_code?: string }, unknown>, cb: grpc.sendUnaryData<unknown>) {
      const lang = call.request.language_code ?? "";
      listed.push(lang);
      cb(null, { voices: catalogEmpty ? [] : CATALOG.filter((v) => !lang || v.language_codes.includes(lang)) });
    },
    StreamingSynthesize(call: grpc.ServerDuplexStream<Record<string, unknown>, unknown>) {
      const s: Seen = { texts: [], metadata: call.metadata.getMap() };
      seen.push(s);
      call.on("data", (req: { streaming_config?: Seen["config"]; input?: { text?: string } }) => {
        if (req.streaming_config) s.config = req.streaming_config;
        if (req.input?.text) s.texts.push(req.input.text);
      });
      call.on("end", () => {
        if (failNext) {
          failNext = false;
          call.emit("error", { code: grpc.status.PERMISSION_DENIED, details: "sem permissão" });
          return;
        }
        // 3 pedaços de PCM, como o streaming de verdade.
        for (let i = 0; i < 3; i++) call.write({ audio_content: Buffer.alloc(480, i + 1) });
        call.end();
      });
    },
  });
  port = await new Promise<number>((res, rej) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))));
});

afterAll(() => server.forceShutdown());

const provider = () => googleProvider({ GOOGLE_TTS_ENDPOINT: `127.0.0.1:${port}` });

describe("google (servidor falso)", () => {
  test("streaming: a voz, o PCM a 24 kHz e o texto", async () => {
    seen.length = 0;
    const p = provider();
    const voice = p.voices("pt-BR")[0]!;
    expect(voice.id).toBe("pt-BR-Chirp3-HD-Aoede");
    const syn = p.synthesize("Oi, Ana.", voice);
    const chunks: Uint8Array[] = [];
    for await (const c of syn.audio) chunks.push(c);
    expect(chunks.length).toBe(3);
    expect(await syn.done).toEqual({ chars: 8 });
    expect(seen[0]!.config).toMatchObject({ voice: { name: "pt-BR-Chirp3-HD-Aoede", language_code: "pt-BR" }, streaming_audio_config: { audio_encoding: "PCM", sample_rate_hertz: 24000 } });
    expect(seen[0]!.texts).toEqual(["Oi, Ana."]);
  });

  test("o token de exemplo não chega ao servidor: o núcleo o tira antes", async () => {
    seen.length = 0;
    const p = provider();
    const raw = `Achei a chave do Projeto X: ${FAKE_TOKEN}. Guarde bem.`;
    const { text, held } = prepare(raw, "pt-BR");
    expect(held).toBe(1);
    await measure(p, p.voices("pt-BR")[0]!, { id: "token", text }, { rounds: 1 });
    const sent = seen.flatMap((s) => s.texts).join("\n");
    expect(sent).not.toContain(FAKE_TOKEN);
    expect(sent).not.toMatch(/ghp|B dois|a1B2/i);
    // O fala.ts soletra o que sobra (`ghp a um B dois…`): o texto enviado é exatamente a frase sem o token.
    expect(sent).toBe("Achei a chave do Projeto X:. Guarde bem.");
    expect(sent).not.toContain("segredo");
    expect(sent).toContain("Projeto X");
  });

  test("em inglês também", () => {
    const { text, held } = prepare(`**Done.** Your key ${"AKIA" + "Q7XZ3K9P2M4N8R6T"} is in the note`, "en-US");
    expect(held).toBe(1);
    expect(text).not.toContain("AKIA");
    expect(text).not.toContain("*");
    expect(text).toContain("Done.");
  });

  test("o erro do servidor diz o código, sem a credencial", async () => {
    failNext = true;
    const p = provider();
    const m = await measure(p, p.voices("en-US")[0]!, { id: "erro", text: "Hello." }, { rounds: 1 });
    expect(m.error).toContain("PERMISSION_DENIED");
  });

  test("a medida: mediana de 3, caracteres, custo e o .wav", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-"));
    const p = provider();
    const m = await measure(p, p.voices("en-US")[1]!, { id: "f01", text: "Hello, Ana." }, { rounds: 3, out });
    expect(m.error).toBeUndefined();
    expect(m.rounds.length).toBe(3);
    expect(m.firstMs).toBeLessThanOrEqual(m.totalMs);
    expect(m.chars).toBe(11);
    expect(m.costUsd).toBeCloseTo(11 * 30e-6, 10);
    const file = path.join(out, m.file!);
    expect(m.file).toBe(path.join("google", "Puck", "f01.wav"));
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.length).toBe(44 + 3 * 480);
    expect(table([m])).toContain("| google | en-US |");
  });

  test("a chave da API vai no cabeçalho, e nunca na saída nem nos arquivos", async () => {
    // O provedor com chave usa TLS no host de verdade: aqui só se confere que nada a escreve.
    const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-"));
    const logs: string[] = [];
    const orig = { log: console.log, error: console.error };
    console.log = (...a) => logs.push(a.join(" "));
    console.error = (...a) => logs.push(a.join(" "));
    try {
      const p = googleProvider({ GOOGLE_TTS_ENDPOINT: `127.0.0.1:${port}`, GOOGLE_TTS_API_KEY: FAKE_KEY });
      const m = await measure(p, p.voices("pt-BR")[2]!, { id: "f02", text: "Pronto." }, { rounds: 1, out });
      logs.push(JSON.stringify(m), table([m]));
    } finally {
      Object.assign(console, orig);
    }
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
    for (const f of readdirSync(out, { recursive: true }) as string[]) {
      const full = path.join(out, f);
      if (f.endsWith(".wav")) expect(readFileSync(full).toString("latin1")).not.toContain(FAKE_KEY);
    }
  });
});

test("wav: o cabeçalho de 44 bytes", () => {
  const w = wav(new Uint8Array(10), 24000);
  const v = new DataView(w.buffer);
  expect(v.getUint32(24, true)).toBe(24000);
  expect(v.getUint32(40, true)).toBe(10);
});

test("as ADC viram o cabeçalho authorization (o google-auth-library devolve um Headers)", async () => {
  const { authMetadata } = await import("./google.ts");
  const gen = authMetadata({ getRequestHeaders: async () => new Headers({ authorization: "Bearer exemplo" }) });
  const md = await new Promise<grpc.Metadata>((res, rej) => gen({ service_url: "https://exemplo.local", method_name: "x" }, (e: Error | null, m?: grpc.Metadata) => (e ? rej(e) : res(m!))));
  expect(md.get("authorization")).toEqual(["Bearer exemplo"]);
});

describe("as vozes escolhidas na hora (T31480)", () => {
  const withVoices = (voices: string) => googleProvider({ GOOGLE_TTS_ENDPOINT: `127.0.0.1:${port}` }, { voices });

  test("--voices all: as Chirp 3 HD da língua, pelo ListVoices, antes da 1ª fala", async () => {
    listed.length = 0;
    const p = withVoices("all");
    await p.check!();
    expect(p.voices("pt-BR").map((v) => v.id)).toEqual(["pt-BR-Chirp3-HD-Achird", "pt-BR-Chirp3-HD-Zephyr"]);
    expect(p.voices("en-US").map((v) => v.name)).toEqual(["Puck"]);
    expect(listed).toEqual(["pt-BR", "en-US"]);
  });

  test("--voices com uma lista: os nomes curtos ou inteiros, sem o ListVoices", async () => {
    listed.length = 0;
    const p = withVoices("Kore, pt-BR-Chirp3-HD-Fenrir");
    await p.check!();
    expect(p.voices("pt-BR").map((v) => v.id)).toEqual(["pt-BR-Chirp3-HD-Kore", "pt-BR-Chirp3-HD-Fenrir"]);
    expect(listed).toEqual([]);
  });

  test("sem --voices, as 3 fixas", () => {
    expect(provider().voices("pt-BR").map((v) => v.name)).toEqual(["Aoede", "Kore", "Charon"]);
  });

  test("um nome fora do formato para na hora", () => {
    expect(() => chirpNames("Kore/../x")).toThrow(/fora do formato/);
  });

  test("o ListVoices sem nenhuma Chirp 3 HD para a rodada antes da 1ª fala", async () => {
    catalogEmpty = true;
    try {
      await expect(withVoices("all").check!()).rejects.toThrow(/nenhuma voz Chirp 3 HD/);
    } finally {
      catalogEmpty = false;
    }
  });

  test("na rodada: --voices all, uma pasta por voz com a fala", async () => {
    seen.length = 0;
    const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-g-"));
    const orig = { log: console.log, error: console.error };
    console.log = () => {};
    console.error = () => {};
    let code: number;
    try {
      code = await main(["--providers", "google", "--rounds", "1", "--only", "pt02", "--voices", "all", "--out", out], { GOOGLE_TTS_ENDPOINT: `127.0.0.1:${port}` });
    } finally {
      Object.assign(console, orig);
    }
    expect(code).toBe(0);
    expect(seen.map((s) => s.config?.voice?.name)).toEqual(["pt-BR-Chirp3-HD-Achird", "pt-BR-Chirp3-HD-Zephyr"]);
    expect(readdirSync(path.join(out, "google")).sort()).toEqual(["Achird", "Zephyr"]);
    expect(readdirSync(path.join(out, "google", "Zephyr"))).toEqual(["pt02.wav"]);
  });

  test("--voices com mais de um provedor para antes de tudo", async () => {
    const orig = console.log;
    const printed: string[] = [];
    console.log = (...a) => printed.push(a.join(" "));
    try {
      const code = await main(["--providers", "google,local", "--voices", "all", "--out", mkdtempSync(path.join(tmpdir(), "cloud-tts-g-"))], {});
      expect(code).toBe(2);
    } finally {
      console.log = orig;
    }
    expect(printed.join("\n")).toContain("um provedor por vez");
  });
});
