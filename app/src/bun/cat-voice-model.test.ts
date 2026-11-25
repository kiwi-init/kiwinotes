// A voz do gato baixada no clique (T26729), contra um servidor HTTP falso: nada vai ao Hugging Face. O modelo e as vozes
// daqui são inventados (arquivos pequenos com bytes de mentira); o manifesto de verdade só é conferido por fora. O
// catálogo (T27778): duas vozes inventadas no lugar da en-a e da en-b, e a pt-a "em breve".

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Fetcher, ModelManifest } from "../notes/semantic/model.ts";
import { modelDir } from "../notes/semantic/model.ts";
import { tempDir } from "../../test/tmp.ts";
import type { CatVoiceStatus } from "../shared/ui-contract.ts";
import { CAT_VOICE_IDS, CAT_VOICES, type CatVoiceId } from "../shared/cat-voices.ts";
import { CAT_VOICE_REFS, CatVoiceModel, type CatVoiceRef, headlessCatVoiceSource, QWEN3_TTS } from "./cat-voice-model.ts";
import { spawnVoice, VoiceProcess } from "./voice-process.ts";

const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// O "modelo" e a "voz" inventados: o que o servidor falso serve, pelo caminho.
const FILES: Record<string, Buffer> = {
  "/exemplo/modelo-voz/resolve/rev-exemplo/config.json": bytes(300, 1),
  "/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors": bytes(200_000, 2),
  "/vozes/ana-exemplo.wav": bytes(50_000, 3),
  "/vozes/bia-exemplo.wav": bytes(40_000, 4),
};
/** O modelo (200_300), a Ana (50_000) e a Bia (40_000). */
const TOTAL = 290_300;
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
const wav = (nome: string, text: string, preview?: string[]): CatVoiceRef => ({
  manifest: {
    id: `voz-${nome}`,
    repo: "-",
    revision: "v1",
    files: [{ name: `${nome}.wav`, size: FILES[`/vozes/${nome}.wav`]!.length, sha256: sha(FILES[`/vozes/${nome}.wav`]!), url: `${base()}/vozes/${nome}.wav` }],
  },
  text,
  language: "english",
  ...(preview ? { preview } : {}),
});
const VOICE = () => wav("ana-exemplo", "Oi, eu sou a Ana, uma voz inventada para os testes.", ["Uma frase de exemplo."]);
const VOICE_B = () => wav("bia-exemplo", "Oi, eu sou a Bia, outra voz inventada.");
const VOICES = () => ({ "en-a": VOICE(), "en-b": VOICE_B(), "pt-a": null });
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
    voices: VOICES(),
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
    expect(await m.refresh()).toEqual({
      phase: "off",
      size: TOTAL,
      voice: false,
      model: false,
      voices: [
        { id: "en-a", state: "missing", size: 50_000 },
        { id: "en-b", state: "missing", size: 40_000 },
        { id: "pt-a", state: "soon" },
      ],
      selected: "en-a",
      preview: null,
    });
    expect(requests).toEqual([]);
  });

  test("o clique baixa o modelo e todas as vozes, confere, aquece e fica pronto", async () => {
    const { m, modelsDir, seen, warms } = make();
    await m.download();
    expect(m.status()).toMatchObject({ phase: "ready", size: TOTAL, voice: true, model: true });
    expect(m.status().voices.map((v) => v.state)).toEqual(["ready", "ready", "soon"]);
    expect(warms()).toBe(1);
    // O andamento sobe até o total, e o aquecimento vem depois do download.
    const phases = seen.map((s) => s.phase);
    expect(phases[0]).toBe("downloading");
    expect(phases.slice(-2)).toEqual(["warming", "ready"]);
    const done = seen.filter((s) => s.phase === "downloading").map((s) => s.done!);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(TOTAL);
    expect(seen.every((s) => s.phase !== "downloading" || s.total === TOTAL)).toBe(true);
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
    expect(requests.length).toBe(4);
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

  test("o servidor que falha no modelo vira erro de download, e o clique seguinte tenta de novo", async () => {
    const { m } = make();
    quirks["/exemplo/modelo-voz/resolve/rev-exemplo/config.json"] = "500";
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "download" });
    quirks = {};
    await m.download();
    expect(m.status().phase).toBe("ready");
  });

  test("uma voz que falha no download é erro só dela: a outra fica pronta e o gato fala (spec #27531)", async () => {
    const { m, warms } = make();
    quirks["/vozes/bia-exemplo.wav"] = "500";
    await m.download();
    const s = m.status();
    expect(s).toMatchObject({ phase: "noVoice", voice: true, model: true });
    expect(s.error).toBeUndefined();
    expect(s.voices.slice(0, 2)).toEqual([
      { id: "en-a", state: "ready", size: 50_000 },
      { id: "en-b", state: "error", error: "download", size: 40_000 },
    ]);
    expect(warms()).toBe(1);
    expect((await m.assets()).refText).toBe(VOICE().text);
  });

  test("uma voz com o SHA-256 diferente é erro de hash só dela, e nada dela fica no disco", async () => {
    const { m, modelsDir } = make();
    quirks["/vozes/ana-exemplo.wav"] = "trocado";
    await m.download();
    expect(m.status().voices[0]).toEqual({ id: "en-a", state: "error", error: "hash", size: 50_000 });
    expect(m.status().voices[1]!.state).toBe("ready");
    const dir = modelDir(modelsDir, VOICE().manifest);
    expect(existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".")) : []).toEqual([]);
    // A escolhida (en-a) quebrou: o gato fala na outra que está no disco.
    expect((await m.assets()).refText).toBe(VOICE_B().text);
  });

  test("com o modelo e sem uma voz, o Completar baixa só a voz, sem os pesos de novo", async () => {
    const { m, seen } = make();
    quirks["/vozes/bia-exemplo.wav"] = "500";
    await m.download();
    expect(m.status().phase).toBe("noVoice");
    quirks = {};
    requests = [];
    seen.length = 0;
    await m.download();
    expect(requests).toEqual(["/vozes/bia-exemplo.wav"]);
    expect(m.status()).toMatchObject({ phase: "ready" });
    expect(m.status().voices[1]).toEqual({ id: "en-b", state: "ready", size: 40_000 });
    // O andamento começa do que já está no disco e vai até o total.
    const done = seen.filter((s) => s.phase === "downloading").map((s) => s.done!);
    expect(done[0]).toBe(TOTAL - 40_000);
    expect(done.at(-1)).toBe(TOTAL);
  });

  test("uma referência apagada numa sessão anterior: o refresh diz noVoice, com o modelo", async () => {
    const first = make();
    await first.m.download();
    rmSync(path.dirname(modelDir(first.modelsDir, VOICE_B().manifest)), { recursive: true, force: true });
    const again = make({ modelsDir: first.modelsDir });
    expect(await again.m.refresh()).toMatchObject({ phase: "noVoice", model: true, voice: true });
    expect(again.m.status().voices[1]!.state).toBe("missing");
  });

  test("a escolhida vem dos Ajustes, e o assets segue a escolha a cada leitura", async () => {
    let escolha: CatVoiceId = "en-b";
    const { m } = make({ selected: () => escolha });
    await m.download();
    expect(m.status().selected).toBe("en-b");
    expect((await m.assets()).refText).toBe(VOICE_B().text);
    escolha = "en-a";
    expect((await m.assets()).refText).toBe(VOICE().text);
    // A "em breve" escolhida (ou um valor estranho) cai numa voz que está no disco.
    escolha = "pt-a";
    expect((await m.assets()).refText).toBe(VOICE().text);
    expect((await m.voiceAssets("en-b")).language).toBe("english");
    await expect(m.voiceAssets("pt-a")).rejects.toThrow(/ainda não tem referência/);
  });

  test("o setPreview sai no status, para a linha mostrar o que está tocando", async () => {
    const { m, seen } = make();
    m.setPreview("en-b");
    expect(m.status().preview).toBe("en-b");
    expect(seen.at(-1)!.preview).toBe("en-b");
    m.setPreview(null);
    expect(m.status().preview).toBeNull();
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
    expect(requests.sort()).toEqual(["/exemplo/modelo-voz/resolve/rev-exemplo/pesos/model.safetensors", "/vozes/ana-exemplo.wav", "/vozes/bia-exemplo.wav"]);
    expect(m.status().phase).toBe("ready");
  });

  test("sem nenhuma voz no catálogo, o modelo baixa e o estado fica noVoice, sem aquecer", async () => {
    const { m, warms } = make({ voices: {} });
    expect(m.status()).toMatchObject({ size: 200_300, voice: false });
    expect(m.status().voices.map((v) => v.state)).toEqual(["soon", "soon", "soon"]);
    await m.download();
    expect(m.status().phase).toBe("noVoice");
    expect(warms()).toBe(0);
    await expect(m.assets()).rejects.toThrow(/nenhuma voz do gato tem referência/);
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

  test("o aquecimento travado vira erro pelo prazo e derruba o processo (#27141)", async () => {
    const { m, stops } = make({ warmMs: 50, warm: () => new Promise(() => {}) });
    await m.download();
    expect(m.status()).toMatchObject({ phase: "error", error: "warmup" });
    expect(stops()).toBe(1);
    // A falha não prende o clique seguinte.
    expect(await Promise.race([m.download().then(() => "fim"), Bun.sleep(1000).then(() => "preso")])).toBe("fim");
  });

  test("cancelar e remover durante um aquecimento travado não ficam esperando (#27141)", async () => {
    const { m, modelsDir } = make({ warmMs: 60_000, warm: () => new Promise(() => {}) });
    void m.download();
    while (m.status().phase !== "warming") await Bun.sleep(5);
    const tempo = <T,>(p: Promise<T>) => Promise.race([p.then(() => "fim"), Bun.sleep(1000).then(() => "preso")]);
    expect(await tempo(m.cancel())).toBe("fim");
    void m.download();
    while (m.status().phase !== "warming") await Bun.sleep(5);
    expect(await tempo(m.remove())).toBe("fim");
    expect(m.status().phase).toBe("off");
    expect(existsSync(path.dirname(modelDir(modelsDir, MODEL)))).toBe(false);
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

  test("remover derruba o processo e apaga o modelo e todas as vozes", async () => {
    const { m, modelsDir, stops } = make();
    await m.download();
    await m.remove();
    expect(stops()).toBe(1);
    expect(m.status().phase).toBe("off");
    expect(m.status().voices.map((v) => v.state)).toEqual(["missing", "missing", "soon"]);
    expect(readdirSync(modelsDir)).toEqual([]);
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
      expect(cmds[0]).toMatchObject({ modelDir: (await m.assets()).modelDir, refText: VOICE().text, language: "english", cacheMB: 512 });
      // Remover derruba o processo.
      await m.remove();
      expect(voice.running).toBe(false);
    } finally {
      await voice.stop();
    }
  });
});

describe("a chave de teste do headless (T26736)", () => {
  const write = (o: unknown) => {
    const f = path.join(tempDir("cat-voice-key"), "voz.json");
    writeFileSync(f, JSON.stringify(o));
    return f;
  };

  test("sem a chave, nada muda: o headless não baixa", () => {
    expect(headlessCatVoiceSource({})).toBeNull();
  });

  test("com a chave, o modelo e a voz inventados vêm do servidor falso, e o download funciona", async () => {
    const src = headlessCatVoiceSource({ KIWI_CAT_VOICE_MANIFEST: write({ host: base(), model: MODEL, voices: VOICES() }) })!;
    expect(src.manifest).toEqual(MODEL);
    const { m } = make({ ...src, fetch: src.fetch! });
    await m.download();
    expect(m.status().phase).toBe("ready");
    expect(requests.sort()).toEqual(Object.keys(FILES).sort());
  });

  test("o `voice` de antes (T26736) vale como a en-a sozinha", () => {
    const src = headlessCatVoiceSource({ KIWI_CAT_VOICE_MANIFEST: write({ host: base(), model: MODEL, voice: VOICE() }) })!;
    expect(src.voices).toEqual({ "en-a": VOICE() });
  });

  test("só um host local, e nenhum pedido sai para outro", async () => {
    expect(() => headlessCatVoiceSource({ KIWI_CAT_VOICE_MANIFEST: write({ host: "https://exemplo.com", model: MODEL, voice: null }) })).toThrow(/local/);
    const src = headlessCatVoiceSource({ KIWI_CAT_VOICE_MANIFEST: write({ host: base(), model: MODEL, voice: null }) })!;
    await expect(src.fetch!("https://exemplo.com/x")).rejects.toThrow(/não é o host de teste/);
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

  test("o catálogo (spec #27531): en-a e en-b com o WAV do release fixo e o SHA-256; a pt-a ainda em breve", () => {
    expect(Object.keys(CAT_VOICE_REFS).sort()).toEqual([...CAT_VOICE_IDS].sort());
    expect(CAT_VOICE_REFS["pt-a"]).toBeNull();
    for (const id of ["en-a", "en-b"] as const) {
      const r = CAT_VOICE_REFS[id]!;
      expect(r.language).toBe(CAT_VOICES[id].language);
      expect(r.manifest.files.length).toBe(1);
      const f = r.manifest.files[0]!;
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(100_000);
      expect(f.url).toBe(`https://github.com/kiwi-init/kiwinotes/releases/download/cat-voices-1/${f.name}`);
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.preview!.length).toBeGreaterThan(0);
    }
    // Um diretório por voz: apagar ou baixar uma não mexe na outra.
    expect(new Set(Object.values(CAT_VOICE_REFS).flatMap((r) => (r ? [r.manifest.id] : []))).size).toBe(2);
  });
});
