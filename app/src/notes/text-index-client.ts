// O índice do conteúdo fora da thread do main (P0 #23988, 2ª metade). O paliativo do #243 cortou a transação em 1 MB,
// mas três casos ainda prendiam o laço do Bun: a partida (346 ms), um arquivo de 5 MB sozinho (110 ms) e a extração de
// um xlsx de 33 MB (745 ms). Agora o `TextIndex` inteiro roda num Worker (`text-index-worker.ts`), e o main fica com
// este cliente, de mesma API: manda a lista e os avisos, e recebe os achados.
//
// - A lista vai como um JSON só com o caminho, o tamanho e o mtime, e o worker escolhe o que entra: com 250 mil arquivos,
//   o filtro e o clone estruturado no main custavam uns 180 ms de uma vez; o `JSON.stringify` custa uns 20.
// - O worker confere a busca pelo que o banco tem (`TextIndex.stored`); o achado volta e o main confere com o `stat` de
//   agora, tira o que já saiu e põe o tamanho e o mtime de agora. Se o worker cai, o próximo pedido abre outro sobre o
//   mesmo banco, que já tem tudo, e a próxima lista ou aviso põe em dia o que mudou nesse meio-tempo.
// - Sem o arquivo do worker (um build sem o preBuild) ou com `KIWI_TEXT_INDEX_WORKER=0`, o índice roda no main, como antes.

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { isIndexedFile, type TextHit, TextIndex, type TextIndexOptions } from "./text-index.ts";
import type { VaultFile } from "./vault.ts";

/** O que o resto do app usa do índice, no main ou no worker. */
export type TextIndexApi = Pick<TextIndex, "sync" | "update" | "search" | "idle" | "close" | "destroy">;

/** As opções que vão ao worker: as do `TextIndex`, sem a função da pausa (`pauseMs: 0` é sem pausa, nos testes). */
export type WorkerOptions = Omit<TextIndexOptions, "pause">;

export type WorkerRequest = { id: number } & (
  | { op: "init"; options: WorkerOptions; pauseMs?: number }
  /** `json`: `VaultFile[]`, só com `path`, `size` e `mtime`. */
  | { op: "sync"; json: string }
  | { op: "update"; now: VaultFile[]; gone: string[] }
  | { op: "search"; query: string; limit: number }
  | { op: "idle" }
  | { op: "stats" }
  | { op: "close" }
);
export type WorkerReply = { id: number; value?: unknown; error?: string };

/** `mainThread`: onde o índice rodou (o teste confere que não foi no main). */
export type WorkerStats = TextIndex["stats"] & { lastSearchBytes: number; heapBytes: number; mainThread: boolean };

type Body = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/** O worker do índice: o .js que o preBuild põe ao lado do bundle, ou o .ts do código-fonte. */
export function textIndexWorkerScript(dir = import.meta.dir): string | null {
  for (const p of [path.join(dir, "..", "workers", "text-index-worker.js"), path.join(dir, "text-index-worker.ts")]) if (existsSync(p)) return p;
  return null;
}

/** O índice no worker, ou no main se não houver worker (`KIWI_TEXT_INDEX_WORKER=0`, ou um build sem ele). */
export function createTextIndex(o: WorkerOptions, dir = import.meta.dir): TextIndexApi {
  if (process.env.KIWI_TEXT_INDEX_WORKER === "0") {
    console.warn("[text-index] KIWI_TEXT_INDEX_WORKER=0: o índice roda na thread do main");
    return new TextIndex(o);
  }
  const script = textIndexWorkerScript(dir);
  if (script) return new TextIndexWorker(o, script);
  // Um build sem o `workers/` volta ao problema do P0 #23988: que fique no log, não calado.
  console.warn("[text-index] o worker do índice não está no app (falta workers/text-index-worker.js): o índice roda na thread do main");
  return new TextIndex(o);
}

export class TextIndexWorker implements TextIndexApi {
  private w: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private closed = false;
  /** Quantos workers abriram (o teste da queda). */
  starts = 0;

  constructor(
    private readonly o: WorkerOptions,
    private readonly script: string,
    private readonly pauseMs?: number,
  ) {}

  private worker(): Worker {
    if (this.w) return this.w;
    const w = new Worker(this.script);
    // O worker não segura o processo aberto: quem fecha é o `close()`.
    (w as Worker & { unref(): void }).unref();
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.value);
    };
    w.onerror = (e) => {
      console.error("[text-index] o worker caiu:", e.message);
      this.lost(w);
    };
    w.addEventListener("close", () => this.lost(w));
    this.w = w;
    this.starts++;
    this.send(w, { op: "init", options: this.o, ...(this.pauseMs !== undefined ? { pauseMs: this.pauseMs } : {}) }).catch(() => {});
    return w;
  }

  /** O worker caiu ou fechou: o que esperava por ele falha, e o próximo pedido abre outro. */
  private lost(w: Worker) {
    if (this.w !== w) return;
    this.w = null;
    const err = new Error("o worker do índice parou");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send(w: Worker, body: Body): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...body, id });
    });
  }

  private call(body: Body): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("o índice fechou"));
    return this.send(this.worker(), body);
  }

  sync(files: Iterable<VaultFile>): Promise<void> {
    if (this.closed) return Promise.resolve();
    const json = JSON.stringify(Array.isArray(files) ? files : [...files], ["path", "size", "mtime"]);
    return this.call({ op: "sync", json }).then(() => {}, log);
  }

  update(paths: readonly string[], stat: (p: string) => VaultFile | undefined): Promise<void> {
    if (this.closed) return Promise.resolve();
    const now: VaultFile[] = [];
    const gone: string[] = [];
    for (const p of paths) {
      if (!isIndexedFile(p)) continue;
      const f = stat(p);
      if (f) now.push({ path: f.path, size: f.size, mtime: f.mtime });
      else gone.push(p);
    }
    if (!now.length && !gone.length) return Promise.resolve();
    return this.call({ op: "update", now, gone }).then(() => {}, log);
  }

  async search(query: string, limit: number, stat: (p: string) => VaultFile | undefined): Promise<TextHit[]> {
    if (limit <= 0 || this.closed) return [];
    const hits = (await this.call({ op: "search", query, limit }).catch((e) => (log(e), []))) as TextHit[];
    const out: TextHit[] = [];
    for (const h of hits) {
      const f = stat(h.path);
      if (f) out.push({ ...h, file: { ...h.file, size: f.size, mtime: f.mtime } }); // saiu enquanto a busca andava
    }
    return out;
  }

  async idle(): Promise<void> {
    if (!this.w || this.closed) return;
    await this.call({ op: "idle" }).catch(log);
  }

  /** O que o worker fez e o heap dele (a medição e os testes). */
  stats(): Promise<WorkerStats> {
    return this.call({ op: "stats" }) as Promise<WorkerStats>;
  }

  /** Derruba o worker, como uma queda (o teste da volta). */
  kill(): void {
    const w = this.w;
    if (!w) return;
    w.terminate();
    this.lost(w);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const w = this.w;
    if (w) await this.send(w, { op: "close" }).catch(() => {});
    this.closed = true;
    if (w) {
      w.terminate();
      this.lost(w);
    }
  }

  async destroy(): Promise<void> {
    await this.close();
    await rm(this.o.dir, { recursive: true, force: true });
  }
}

const log = (e: unknown) => console.error("[text-index]", e instanceof Error ? e.message : e);
