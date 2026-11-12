// O modelo da busca pelo sentido (T6013, L17, decisão #4766): o multilingual-e5-small (MIT), no ONNX quantizado do
// Xenova, baixado uma vez do huggingface.co para a pasta do app, fora do cofre. A revisão é fixa e cada arquivo tem o
// SHA-256 conferido antes de entrar: um arquivo errado nunca é usado.

import { createHash } from "node:crypto";
import { type FileHandle, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
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

/** O `fetch`: o `signal` aborta a conexão (desligar, sair do app, ou o prazo sem bytes). */
export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * Sem nenhum byte por este tempo, o download desiste (T7941): o Wi-Fi de hotel ou a VPN que cai sem fechar a conexão
 * deixavam o `fetch` do Bun, que não tem prazo, esperando para sempre. O arquivo inteiro pode demorar o quanto for.
 */
export const STALL_MS = 30_000;

/** `p`, ou um erro quando o `signal` aborta antes. */
function unlessAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

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
  o: { fetch?: Fetcher; onProgress?: (done: number, total: number) => void; signal?: AbortSignal; stallMs?: number } = {},
): Promise<string> {
  const dir = modelDir(root, m);
  const get: Fetcher = o.fetch ?? ((url, init) => fetch(url, { redirect: "follow", signal: init?.signal }));
  const stallMs = o.stallMs ?? STALL_MS;
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
    // Um controle por arquivo: aborta pelo `signal` de fora ou pelo prazo sem bytes, que recomeça a cada pedaço.
    const abort = new AbortController();
    const onOuter = () => abort.abort(new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} aborted`));
    if (o.signal?.aborted) onOuter();
    o.signal?.addEventListener("abort", onOuter, { once: true });
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} stalled: no bytes for ${Math.round(stallMs / 1000)} s`)), stallMs);
    };
    const hash = createHash("sha256");
    // O `.part` por um FileHandle, cada escrita esperada (T8159): o `createWriteStream` abria e escrevia por conta
    // própria, o `destroy` não esperava, e o `rm` do erro corria antes. O `.part` sobrava, ou o stream abria depois de a
    // pasta sumir e o erro dele ficava sem dono (o `ENOENT` que derrubou o CI e o build da rc15).
    let out: FileHandle | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let size = 0;
    try {
      arm();
      const res = await unlessAborted(get(fileUrl(m, f), { signal: abort.signal }), abort.signal);
      if (!res.ok || !res.body) throw new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} failed: HTTP ${res.status}`);
      const file = (out = await open(part, "w"));
      reader = res.body.getReader();
      for (;;) {
        arm();
        const { done: end, value: chunk } = await unlessAborted(reader.read(), abort.signal);
        if (end) break;
        size += chunk.byteLength;
        if (size > f.size) throw new ModelError("E_MODEL_HASH", `${f.name} is larger than expected`);
        hash.update(chunk);
        for (let at = 0; at < chunk.byteLength; ) at += (await file.write(chunk, at, chunk.byteLength - at)).bytesWritten;
        o.onProgress?.(done + size, total);
      }
      clearTimeout(stall);
      out = undefined;
      await file.close();
    } catch (e) {
      // A leitura pendente e a conexão saem junto: o `cancel` solta o corpo, e o `abort` o `fetch`.
      abort.abort(e);
      void reader?.cancel().catch(() => {});
      // Fecha antes de apagar, e só devolve depois: nada do `.part` fica correndo depois do retorno.
      await out?.close().catch(() => {});
      await rm(part, { force: true });
      throw e instanceof ModelError ? e : new ModelError("E_MODEL_DOWNLOAD", `download of ${f.name} failed: ${String(e)}`);
    } finally {
      clearTimeout(stall);
      o.signal?.removeEventListener("abort", onOuter);
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
