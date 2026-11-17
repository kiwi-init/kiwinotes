// Os vetores da busca pelo sentido (T6013): o e5 pelo ONNX Runtime, neste Mac. O texto nunca sai do processo.
// O e5 pede o prefixo `query: ` na busca e `passage: ` no texto das notas; o vetor é a média dos tokens, normalizada.

import path from "node:path";
import { readFile } from "node:fs/promises";
import { Tokenizer } from "@huggingface/tokenizers";
import type * as Ort from "onnxruntime-node";

export type EmbedKind = "query" | "passage";

export interface Embedder {
  readonly dim: number;
  embed(texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]>;
  close(): Promise<void>;
}

/** O e5 lê até 512 tokens; um trecho mais longo é cortado (o `chunks.ts` já corta antes disso). */
const MAX_TOKENS = 512;
/** O `<pad>` do XLM-R. A máscara de atenção já ignora, mas o id certo evita surpresa. */
const PAD_ID = 1n;

export function meanPool(data: Float32Array, mask: BigInt64Array, rows: number, len: number, dim: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const v = new Float32Array(dim);
    let n = 0;
    for (let c = 0; c < len; c++) {
      if (!mask[r * len + c]) continue;
      n++;
      const at = (r * len + c) * dim;
      for (let d = 0; d < dim; d++) v[d]! += data[at + d]!;
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      v[d]! /= Math.max(n, 1);
      norm += v[d]! * v[d]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) v[d]! /= norm;
    out.push(v);
  }
  return out;
}

/**
 * Carrega o tokenizer e o modelo de `dir` (o `ensureModel` já conferiu os arquivos). Poucas threads: a indexação roda
 * em segundo plano e não pode tomar o Mac de quem está digitando.
 */
export async function onnxEmbedder(dir: string, o: { threads?: number } = {}): Promise<Embedder> {
  const ort: typeof Ort = await import("onnxruntime-node");
  const [tokenizerJson, configJson] = await Promise.all([
    readFile(path.join(dir, "tokenizer.json"), "utf8"),
    readFile(path.join(dir, "tokenizer_config.json"), "utf8"),
  ]);
  const tokenizer = new Tokenizer(JSON.parse(tokenizerJson) as object, JSON.parse(configJson) as object);
  const session = await ort.InferenceSession.create(path.join(dir, "onnx", "model_quantized.onnx"), {
    intraOpNumThreads: o.threads ?? 2,
    interOpNumThreads: 1,
    executionMode: "sequential",
    enableCpuMemArena: false,
  });
  const output = session.outputNames[0]!;
  const needsTypes = session.inputNames.includes("token_type_ids");
  let queue: Promise<unknown> = Promise.resolve();
  const run = async (texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]> => {
    if (!texts.length) return [];
    const encoded = texts.map((t) => tokenizer.encode(`${kind}: ${t}`).ids.slice(0, MAX_TOKENS));
    const len = Math.max(...encoded.map((ids) => ids.length));
    const ids = new BigInt64Array(texts.length * len).fill(PAD_ID);
    const mask = new BigInt64Array(texts.length * len);
    encoded.forEach((row, r) =>
      row.forEach((id, c) => {
        ids[r * len + c] = BigInt(id);
        mask[r * len + c] = 1n;
      }),
    );
    const dims = [texts.length, len];
    const feeds: Record<string, Ort.Tensor> = {
      input_ids: new ort.Tensor("int64", ids, dims),
      attention_mask: new ort.Tensor("int64", mask, dims),
    };
    if (needsTypes) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(texts.length * len), dims);
    const result = (await session.run(feeds))[output]!;
    const dim = result.dims[2]!;
    return meanPool(result.data as Float32Array, mask, texts.length, len, dim);
  };
  return {
    dim: 384,
    // Uma inferência por vez: a busca da pessoa e a indexação em segundo plano não disputam a mesma sessão.
    embed: (texts, kind) => {
      const next = queue.then(() => run(texts, kind));
      queue = next.catch(() => {});
      return next;
    },
    // Solta só depois da inferência em curso: o Bun cai ao sair com o ONNX Runtime ainda rodando (T6013).
    close: async () => {
      await queue;
      await session.release();
    },
  };
}
