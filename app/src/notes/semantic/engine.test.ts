// T6013: o modelo baixa uma vez, carrega, avisa o estado, espera depois de uma falha e some quando é desligado.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RETRY_MS, SemanticEngine, type SemanticModelState } from "./engine.ts";
import { fakeEmbedder } from "./fake.ts";
import { type ModelManifest, modelDir } from "./model.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const body = new TextEncoder().encode("model".repeat(100));
const manifest: ModelManifest = {
  id: "fake",
  repo: "x/fake",
  revision: "r1",
  files: [{ name: "onnx/model_quantized.onnx", size: body.length, sha256: createHash("sha256").update(body).digest("hex") }],
};

function setup(o: { enabled?: boolean; fail?: boolean; download?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "kn-engine-"));
  dirs.push(root);
  let enabled = o.enabled ?? true;
  let fail = o.fail ?? false;
  let clock = 0;
  const fetched: string[] = [];
  const loaded: string[] = [];
  const states: SemanticModelState[] = [];
  const engine = new SemanticEngine({
    modelsDir: root,
    manifest,
    download: o.download,
    enabled: async () => enabled,
    fetch: async (url) => {
      fetched.push(url);
      return fail ? new Response("down", { status: 503 }) : new Response(new Uint8Array(body));
    },
    load: async (dir) => {
      loaded.push(dir);
      return fakeEmbedder();
    },
    now: () => clock,
  });
  engine.onState((s) => states.push(s));
  return {
    root, engine, fetched, loaded, states,
    set: (v: { enabled?: boolean; fail?: boolean; clock?: number }) => {
      enabled = v.enabled ?? enabled;
      fail = v.fail ?? fail;
      clock = v.clock ?? clock;
    },
  };
}

test("baixa, carrega e fica pronto; a 2ª chamada usa o mesmo modelo", async () => {
  const s = setup();
  expect(s.engine.loaded()).toBeNull();
  const model = await s.engine.start();
  expect(model).not.toBeNull();
  expect(s.engine.loaded()).toBe(model);
  expect(await s.engine.start()).toBe(model);
  expect(s.fetched.length).toBe(1);
  expect(s.loaded).toEqual([modelDir(s.root, manifest)]);
  expect(s.states.map((x) => x.phase)).toEqual(["downloading", "downloading", "loading", "ready"]);
  expect(s.engine.state()).toEqual({ phase: "ready" });
});

test("desligado: não baixa nada", async () => {
  const s = setup({ enabled: false });
  expect(await s.engine.start()).toBeNull();
  expect(s.fetched).toEqual([]);
  expect(s.engine.state().phase).toBe("off");
});

test("sem rede (headless): só usa o modelo que já está no disco", async () => {
  const s = setup({ download: false });
  expect(await s.engine.start()).toBeNull();
  expect(s.fetched).toEqual([]);
  expect(s.engine.state().phase).toBe("idle");
});

test("depois de uma falha, espera RETRY_MS para tentar de novo", async () => {
  const s = setup({ fail: true });
  expect(await s.engine.start()).toBeNull();
  expect(s.engine.state().phase).toBe("error");
  s.set({ fail: false, clock: RETRY_MS - 1 });
  expect(await s.engine.start()).toBeNull();
  expect(s.fetched.length).toBe(1);
  s.set({ clock: RETRY_MS });
  expect(await s.engine.start()).not.toBeNull();
  expect(s.engine.state().phase).toBe("ready");
});

test("desligar solta o modelo e apaga os arquivos dele", async () => {
  const s = setup();
  await s.engine.start();
  expect(existsSync(modelDir(s.root, manifest))).toBe(true);
  s.set({ enabled: false });
  await s.engine.disable();
  expect(s.engine.loaded()).toBeNull();
  expect(existsSync(path.join(s.root, manifest.id))).toBe(false);
  expect(s.engine.state().phase).toBe("off");
});

test("sem uso por idleMs, o modelo sai da memória; a próxima busca o traz de volta em segundo plano", async () => {
  const s = setup();
  const first = await s.engine.start();
  s.set({ clock: RETRY_MS - 1 });
  await s.engine.sweep();
  expect(s.engine.loaded()).toBe(first);
  s.set({ clock: 2 * RETRY_MS });
  await s.engine.sweep();
  expect(s.engine.loaded()).toBeNull();
  expect(s.engine.state().phase).toBe("ready");
  const again = await s.engine.start();
  expect(again).not.toBeNull();
  expect(s.loaded.length).toBe(2);
  expect(s.fetched.length).toBe(1);
  await s.engine.close();
});

// T7444 (varredura de robustez): a rede pendura no meio do download (Wi-Fi de hotel, VPN que cai sem fechar a conexão).
// O servidor mandou os cabeçalhos e 8 bytes, e depois nada, sem erro. O `fetch` do Bun não tem prazo: sem um, o estado
// fica em "downloading 8/…" para sempre, não tenta de novo, e desligar a busca pelo sentido nunca termina.
function stalled() {
  const root = mkdtempSync(path.join(tmpdir(), "kn-engine-stall-"));
  dirs.push(root);
  let enabled = true;
  let calls = 0;
  let clock = 0;
  const states: SemanticModelState[] = [];
  const engine = new SemanticEngine({
    modelsDir: root,
    manifest,
    enabled: async () => enabled,
    // A 1ª resposta pendura; a 2ª (a nova tentativa) vem inteira.
    fetch: async () =>
      ++calls === 1
        ? new Response(new ReadableStream({ start: (c) => c.enqueue(body.slice(0, 8)) }))
        : new Response(new Uint8Array(body)),
    load: async () => fakeEmbedder(),
    now: () => clock,
    // Sugestão de nome: sem nenhum byte por este tempo, o download desiste (o padrão do app seria de dezenas de s).
    stallMs: 200,
  } as ConstructorParameters<typeof SemanticEngine>[0]);
  engine.onState((s) => states.push(s));
  return { root, engine, states, off: () => (enabled = false), calls: () => calls, later: (ms: number) => (clock += ms) };
}

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.then(() => "terminou"), Bun.sleep(ms).then(() => `ainda esperando depois de ${ms} ms`)]);

test("download pendurado: desligar a busca pelo sentido termina logo, e o .part sai (T7444)", async () => {
  const s = stalled();
  void s.engine.start();
  await Bun.sleep(50);
  expect(s.engine.state()).toMatchObject({ phase: "downloading", done: 8 });
  s.off();
  expect(await within(s.engine.disable(), 1000)).toBe("terminou");
  expect(s.engine.state().phase).toBe("off");
  expect(existsSync(path.join(modelDir(s.root, manifest), "onnx/model_quantized.onnx.part"))).toBe(false);
});

test("download pendurado: sem bytes por um tempo, vira erro, e a nova tentativa baixa (T7444)", async () => {
  const s = stalled();
  const first = await within(s.engine.start(), 2000);
  expect(first).toBe("terminou");
  expect(s.engine.state()).toMatchObject({ phase: "error" });
  s.later(RETRY_MS + 1);
  expect(await s.engine.start()).not.toBeNull();
  expect(s.engine.state().phase).toBe("ready");
  expect(s.calls()).toBe(2);
});
