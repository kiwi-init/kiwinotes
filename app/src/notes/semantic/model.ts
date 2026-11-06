// O modelo da busca pelo sentido (T6013, L17, decisão #4766): o multilingual-e5-small (MIT), no ONNX quantizado do
// Xenova, baixado uma vez do huggingface.co para a pasta do app, fora do cofre. A revisão é fixa e cada arquivo tem o
// SHA-256 conferido antes de entrar: um arquivo errado nunca é usado.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface ModelFile {
  name: string;
  size: number;
  sha256: string;
}

export interface ModelManifest {
  id: string;
  repo: string;
  revision: string;
  files: readonly ModelFile[];
}

export const E5_SMALL: ModelManifest = {
  id: "multilingual-e5-small",
  repo: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  files: [
    { name: "tokenizer_config.json", size: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
    { name: "tokenizer.json", size: 17_082_730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    { name: "onnx/model_quantized.onnx", size: 118_308_185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
  ],
};

export const modelBytes = (m: ModelManifest) => m.files.reduce((sum, f) => sum + f.size, 0);

/** Onde o modelo fica: `<modelos>/<id>/<revisão>/`. */
export const modelDir = (root: string, m: ModelManifest) => path.join(root, m.id, m.revision);

export const fileUrl = (m: ModelManifest, f: ModelFile) =>
  `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.name}`;

export class ModelError extends Error {
  constructor(
    readonly code: "E_MODEL_HASH" | "E_MODEL_DOWNLOAD",
    message: string,
  ) {
    super(message);
  }
}

export type Fetcher = (url: string) => Promise<Response>;

async function sha256Of(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** O modelo inteiro já está no disco e confere com o manifesto (o hash é conferido no download, aqui só o tamanho). */
export async function modelPresent(root: string, m: ModelManifest): Promise<boolean> {
  const dir = modelDir(root, m);
  for (const f of m.files) {
    const s = await stat(path.join(dir, f.name)).catch(() => null);
    if (!s || s.size !== f.size) return false;
  }
  return true;
}

/**
 * Baixa o que falta do modelo. Cada arquivo vai para um `.part`, tem o SHA-256 conferido e só então troca de nome:
 * um download pela metade ou um arquivo diferente do esperado nunca fica no lugar do modelo.
 */
export async function ensureModel(
  root: string,
  m: ModelManifest,
  o: { fetch?: Fetcher; onProgress?: (done: number, total: number) => void } = {},
): Promise<string> {
  const dir = modelDir(root, m);
  const get = o.fetch ?? ((url: string) => fetch(url, { redirect: "follow" }));
  const total = modelBytes(m);
  let done = 0;
  for (const f of m.files) {
    const target = path.join(dir, f.name);
    const have = await stat(target).catch(() => null);
    if (have?.size === f.size) {
      done += f.size;
      o.onProgress?.(done, total);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    const res = await get(fileUrl(m, f));
    if (!res.ok || !res.body) throw new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} failed: HTTP ${res.status}`);
    const hash = createHash("sha256");
    const out = createWriteStream(part);
    let size = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > f.size) throw new ModelError("E_MODEL_HASH", `${f.name} is larger than expected`);
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
        o.onProgress?.(done + size, total);
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      await rm(part, { force: true });
      throw e instanceof ModelError ? e : new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} failed: ${String(e)}`);
    }
    const got = hash.digest("hex");
    if (got !== f.sha256 || size !== f.size) {
      await rm(part, { force: true });
      throw new ModelError("E_MODEL_HASH", `${f.name} doesn't match its SHA-256 (got ${got})`);
    }
    await rename(part, target);
    done += f.size;
  }
  return dir;
}

/** Confere o SHA-256 dos arquivos que já estão no disco (o teste e o diagnóstico; o download já confere). */
export async function verifyModel(root: string, m: ModelManifest): Promise<boolean> {
  const dir = modelDir(root, m);
  for (const f of m.files) {
    const got = await sha256Of(path.join(dir, f.name)).catch(() => "");
    if (got !== f.sha256) return false;
  }
  return true;
}
