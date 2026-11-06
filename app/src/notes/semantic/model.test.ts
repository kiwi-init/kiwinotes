// T6013: o download do modelo confere o SHA-256 e nunca deixa um arquivo errado no lugar.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { E5_SMALL, ensureModel, fileUrl, ModelError, type ModelManifest, modelBytes, modelDir, modelPresent, verifyModel } from "./model.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "kn-model-"));
  dirs.push(d);
  return d;
};

const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const files = { "tokenizer.json": bytes('{"model":"x"}'), "onnx/model_quantized.onnx": bytes("ONNX".repeat(1000)) };
const manifest: ModelManifest = {
  id: "fake-e5",
  repo: "Xenova/fake",
  revision: "abc123",
  files: Object.entries(files).map(([name, b]) => ({ name, size: b.length, sha256: sha(b) })),
};

function server(body: (name: string) => Uint8Array | null) {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    const name = url.split("/resolve/abc123/")[1]!;
    const b = body(name);
    return b ? new Response(b) : new Response("nope", { status: 404 });
  };
  return { urls, fetch };
}

test("o manifesto do e5 é fixo: a revisão, os arquivos e um SHA-256 para cada um", () => {
  expect(E5_SMALL.revision).toMatch(/^[0-9a-f]{40}$/);
  for (const f of E5_SMALL.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(E5_SMALL.files.map((f) => f.name)).toEqual(["tokenizer_config.json", "tokenizer.json", "onnx/model_quantized.onnx"]);
  expect(fileUrl(E5_SMALL, E5_SMALL.files[2]!)).toBe(
    "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx/model_quantized.onnx",
  );
  expect(Math.round(modelBytes(E5_SMALL) / 1e6)).toBe(135);
});

test("baixa da revisão fixa, confere o hash e avisa o progresso; na 2ª vez não baixa nada", async () => {
  const root = tmp();
  const s = server((name) => files[name as keyof typeof files] ?? null);
  const progress: number[] = [];
  const dir = await ensureModel(root, manifest, { fetch: s.fetch, onProgress: (done) => progress.push(done) });
  expect(dir).toBe(modelDir(root, manifest));
  expect(s.urls).toEqual(manifest.files.map((f) => fileUrl(manifest, f)));
  expect(readFileSync(path.join(dir, "onnx/model_quantized.onnx"))).toEqual(Buffer.from(files["onnx/model_quantized.onnx"]));
  expect(progress.at(-1)).toBe(modelBytes(manifest));
  expect(await modelPresent(root, manifest)).toBe(true);
  expect(await verifyModel(root, manifest)).toBe(true);
  await ensureModel(root, manifest, { fetch: s.fetch });
  expect(s.urls.length).toBe(2);
});

test("um arquivo com o hash errado é recusado e não fica no disco", async () => {
  const root = tmp();
  const evil = bytes("EVIL".repeat(1000));
  const s = server((name) => (name.endsWith(".onnx") ? evil : files[name as keyof typeof files] ?? null));
  const err = await ensureModel(root, manifest, { fetch: s.fetch }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ModelError);
  expect((err as ModelError).code).toBe("E_MODEL_HASH");
  const onnxDir = path.join(modelDir(root, manifest), "onnx");
  expect(readdirSync(onnxDir)).toEqual([]);
  expect(await modelPresent(root, manifest)).toBe(false);
});

test("maior que o esperado para no meio; HTTP de erro não deixa nada", async () => {
  const root = tmp();
  const big = server((name) => (name.endsWith(".onnx") ? bytes("ONNX".repeat(2000)) : files[name as keyof typeof files] ?? null));
  const err = await ensureModel(root, manifest, { fetch: big.fetch }).catch((e: unknown) => e);
  expect((err as ModelError).code).toBe("E_MODEL_HASH");
  const gone = server(() => null);
  const root2 = tmp();
  const err2 = await ensureModel(root2, manifest, { fetch: gone.fetch }).catch((e: unknown) => e);
  expect((err2 as ModelError).code).toBe("E_MODEL_DOWNLOAD");
  expect(existsSync(path.join(modelDir(root2, manifest), "tokenizer.json"))).toBe(false);
});
