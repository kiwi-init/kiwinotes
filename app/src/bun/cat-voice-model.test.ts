// A voz do gato baixada no clique (T26729), contra um servidor HTTP falso: nada vai ao Hugging Face. O modelo e a voz
// daqui são inventados (arquivos pequenos com bytes de mentira); o manifesto de verdade só é conferido por fora.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Fetcher, ModelManifest } from "../notes/semantic/model.ts";
import { modelDir } from "../notes/semantic/model.ts";
import { tempDir } from "../../test/tmp.ts";
import type { CatVoiceStatus } from "../shared/ui-contract.ts";
import { CAT_VOICE_REF, CatVoiceModel, type CatVoiceRef, QWEN3_TTS } from "./cat-voice-model.ts";
import { spawnVoice, VoiceProcess } from "./voice-process.ts";

const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// O "modelo" e a "voz" inventados: o que o servidor falso serve, pelo caminho.
const FILES: Record<string, Buffer> = {
  "/exemplo/modelo-voz/resolve/rev-exemplo/config.json": bytes(300, 1),
  "/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors": bytes(200_000, 2),
  "/vozes/ana-exemplo.wav": bytes(50_000, 3),
};
const MODEL: ModelManifest = {
  id: "modelo-voz-exemplo",
  repo: "exemplo/modelo-voz",
  revision: "rev-exemplo",
  files: [
    { name: "config.json", size: 300, sha256: sha(FILES["/exemplo/modelo-voz/resolve/rev-exemplo/config.json"]!) },
    { name: "pesos/model.safetensors", size: 200_000, sha256: sha(FILES["/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors"]!) },
  ],
};

let server: ReturnType<typeof Bun.serve>;
let requests: string[] = [];
/** Por caminho: o que o servidor faz de diferente (500, bytes trocados, devagar). */
let quirks: Record<string, "500" | "trocado" | "devagar"> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      requests.push(p);
      const body = FILES[p];
      if (!body) return new Response("não há", { status: 404 });
      const q = quirks[p];
      if (q === "500") return new Response("falha inventada", { status: 500 });
      if (q === "trocado") return new Response(Buffer.from(body).fill(7));
      if (q === "devagar") {
        // Um pedaço e depois nada por muito tempo: o cancelamento tem de cortar no meio.
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(body.subarray(0, 1000));
              await Bun.sleep(5_000);
              c.close();
            },
          }),
        );
      }
      return new Response(new Uint8Array(body));
    },
  });
});
afterAll(() => server.stop(true));
afterEach(() => {
  requests = [];
  quirks = {};
});

const base = () => `http://127.0.0.1:${server.port}`;
const VOICE = (): CatVoiceRef => ({
  manifest: {
    id: "voz-exemplo",
    repo: "-",
    revision: "v1",
    files: [{ name: "ana-exemplo.wav", size: 50_000, sha256: sha(FILES["/vozes/ana-exemplo.wav"]!), url: `${base()}/vozes/ana-exemplo.wav` }],
  },
  text: "Oi, eu sou a Ana, uma voz inventada para os testes.",
});
/** O fetch do app, mas o huggingface.co vira o servidor falso. */
const fakeFetch: Fetcher = (url, init) => fetch(url.replace("https://huggingface.co", base()), init?.signal ? { signal: init.signal } : {});

function make(over: Partial<ConstructorParameters<typeof CatVoiceModel>[0]> = {}) {
  const modelsDir = tempDir("cat-voice");
  const seen: CatVoiceStatus[] = [];
  let warms = 0;
  let stops = 0;
  const m = new CatVoiceModel({
    modelsDir,
    manifest: MODEL,
    voice: VOICE(),
    fetch: fakeFetch,
    warm: async () => {
      warms++;
      return 20;
    },
    stopVoice: async () => {
      stops++;
    },
    log: () => {},
    ...over,
  });
  m.onStatus((s) => seen.push(s));
  return { m, modelsDir, seen, warms: () => warms, stops: () => stops };
}

describe("CatVoiceModel", () => {
  test("começa desligado, mostra o tamanho e ler o estado não baixa nada", async () => {
    const { m } = make();
    expect(await m.refresh()).toEqual({ phase: "off", size: 250_300, voice: true });
    expect(requests).toEqual([]);
  });

  test("o clique baixa o modelo e a voz, confere, aquece e fica pronto", async () => {
    const { m, modelsDir, seen, warms } = make();
    await m.download();
    expect(m.status()).toEqual({ phase: "ready", size: 250_300, voice: true });
    expect(warms()).toBe(1);
    // O andamento sobe até o total, e o aquecimento vem depois do download.
    const phases = seen.map((s) => s.phase);
    expect(phases[0]).toBe("downloading");
    expect(phases.slice(-2)).toEqual(["warming", "ready"]);
    const done = seen.filter((s) => s.phase === "downloading").map((s) => s.done!);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(250_300);
    expect(seen.every((s) => s.phase !== "downloading" || s.total === 250_300)).toBe(true);
    // A voz veio da URL fixa dela, e o modelo da revisão fixa.
    expect(requests.sort()).toEqual(Object.keys(FILES).sort());
    const a = await m.assets();
    expect(a.modelDir).toBe(modelDir(modelsDir, MODEL));
    expect(sha(readFileSync(a.refAudio))).toBe(sha(FILES["/vozes/ana-exemplo.wav"]!));
    expect(a.refText).toBe(VOICE().text);
  });

  test("clicar de novo durante o download não baixa duas vezes", async () => {
    const { m, warms } = make();
    await Promise.all([m.download(), m.download(), m.download()]);
    expect(requests.length).toBe(3);
    expect(warms()).toBe(1);
  });

  test("um arquivo com o SHA-256 diferente vira erro, e nada dele fica no disco", async () => {
    const { m, modelsDir, warms } = make();
    quirks["/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors"] = "trocado";
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "hash" });
    expect(warms()).toBe(0);
    const dir = path.join(modelDir(modelsDir, MODEL), "pesos");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    await expect(m.assets()).rejects.toThrow(/não foi baixado/);
  });

  test("o servidor que falha vira erro de download, e o clique seguinte tenta de novo", async () => {
    const { m } = make();
    quirks["/vozes/ana-exemplo.wav"] = "500";
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "download" });
    quirks = {};
    await m.download();
    expect(m.status().phase).toBe("ready");
  });

  test("cancelar no meio para o download, apaga o .part e não aquece", async () => {
    const { m, modelsDir, warms } = make();
    quirks["/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors"] = "devagar";
    const running = m.download();
    for (let i = 0; i < 100 && !(m.status().phase === "downloading" && m.status().done! > 300); i++) await Bun.sleep(10);
    expect(m.status().phase).toBe("downloading");
    const t0 = performance.now();
    await m.cancel();
    await running;
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(m.status().phase).toBe("off");
    expect(warms()).toBe(0);
    expect(readdirSync(path.join(modelDir(modelsDir, MODEL), "pesos"))).toEqual([]);
    // O que já conferiu fica: o clique seguinte só baixa o que falta.
    quirks = {};
    requests = [];
    await m.download();
    expect(requests.sort()).toEqual(["/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors", "/vozes/ana-exemplo.wav"]);
    expect(m.status().phase).toBe("ready");
  });

  test("sem a voz escolhida, o modelo baixa e o estado fica noVoice, sem aquecer", async () => {
    const { m, warms } = make({ voice: null });
    expect(m.status()).toMatchObject({ size: 200_300, voice: false });
    await m.download();
    expect(m.status().phase).toBe("noVoice");
    expect(warms()).toBe(0);
    await expect(m.assets()).rejects.toThrow(/ainda não foi escolhida/);
    expect(await m.refresh()).toMatchObject({ phase: "noVoice" });
  });

  test("o aquecimento que falha vira erro, com os arquivos baixados", async () => {
    const { m } = make({
      warm: async () => {
        throw new Error("o Metal não compilou");
      },
    });
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "warmup" });
    expect((await m.assets()).refText).toBe(VOICE().text);
  });

  test("o que uma sessão anterior baixou conta como pronto, sem baixar nem aquecer", async () => {
    const first = make();
    await first.m.download();
    requests = [];
    const again = make({ modelsDir: first.modelsDir });
    expect(await again.m.refresh()).toMatchObject({ phase: "ready" });
    expect(requests).toEqual([]);
    expect(again.warms()).toBe(0);
  });

  test("remover derruba o processo e apaga o modelo e a voz", async () => {
    const { m, modelsDir, stops } = make();
    await m.download();
    await m.remove();
    expect(stops()).toBe(1);
    expect(m.status().phase).toBe("off");
    expect(existsSync(path.dirname(modelDir(modelsDir, MODEL)))).toBe(false);
    expect(await m.refresh()).toMatchObject({ phase: "off" });
  });

  test("sem download (o headless), nada vai à rede", async () => {
    const { m } = make({ download: false });
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "download" });
    expect(requests).toEqual([]);
  });

  test("o fim do download aquece o processo da voz de verdade (o kiwi-voice falso)", async () => {
    const FAKE = path.join(import.meta.dir, "..", "..", "test", "helpers", "fake-kiwi-voice.ts");
    const log = path.join(tempDir("cat-voice-proc"), "cmds.jsonl");
    let m!: CatVoiceModel;
    const voice = new VoiceProcess({ bin: "kiwi-voice", assets: () => m.assets(), idleMs: 60_000, spawn: () => spawnVoice(process.execPath, [FAKE, log]) });
    ({ m } = make({ warm: () => voice.warmup(), stopVoice: () => voice.stop() }));
    try {
      await m.download();
      expect(m.status().phase).toBe("ready");
      const cmds = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(cmds.map((c) => c.type)).toEqual(["load", "warmup"]);
      expect(cmds[0]).toMatchObject({ modelDir: (await m.assets()).modelDir, refText: VOICE().text, cacheMB: 512 });
      // Remover derruba o processo.
      await m.remove();
      expect(voice.running).toBe(false);
    } finally {
      await voice.stop();
    }
  });
});

describe("o manifesto de verdade", () => {
  test("o Qwen3-TTS do ADR 0014: a revisão fixa, 12 arquivos, todos com SHA-256", () => {
    expect(QWEN3_TTS.repo).toBe("mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit");
    expect(QWEN3_TTS.revision).toBe("50f45ef0047cde7e84c2ef04326acb8ada2436a7");
    const adr = readFileSync(path.join(import.meta.dir, "..", "..", "..", "docs", "adr", "0014-runtime-da-voz.md"), "utf8");
    expect(adr).toContain(QWEN3_TTS.repo);
    expect(adr).toContain(QWEN3_TTS.revision.slice(0, 8));
    expect(QWEN3_TTS.files.length).toBe(12);
    expect(QWEN3_TTS.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.size > 0 && !f.url)).toBe(true);
    // O tokenizer.json não está no repo: o kiwi-voice o gera na 1ª carga.
    expect(QWEN3_TTS.files.map((f) => f.name)).not.toContain("tokenizer.json");
    const total = QWEN3_TTS.files.reduce((n, f) => n + f.size, 0);
    expect(total).toBeGreaterThan(1.9e9);
    expect(total).toBeLessThan(2.1e9);
  });

  test("a voz desenhada ainda não foi escolhida (#26939)", () => {
    expect(CAT_VOICE_REF).toBeNull();
  });
});
