// O modelo da busca pelo sentido (T6013), um só para o app: baixa uma vez, carrega quando a primeira pasta de notas
// pede e fica carregado. Desligar na Configuração solta o modelo e apaga os arquivos.

import { rm } from "node:fs/promises";
import path from "node:path";

import type { Embedder } from "./embedder.ts";
import { E5_SMALL, ensureModel, type Fetcher, type ModelManifest, modelPresent, modelDir } from "./model.ts";

export type SemanticPhase = "off" | "idle" | "downloading" | "loading" | "ready" | "error";

export interface SemanticModelState {
  phase: SemanticPhase;
  /** Bytes baixados e o total, enquanto baixa. */
  done?: number;
  total?: number;
  error?: string;
}

export interface SemanticEngineOptions {
  /** `<dados do app>/models`: fora de qualquer pasta de notas. */
  modelsDir: string;
  enabled(): Promise<boolean>;
  /** Sem rede (o headless): só usa um modelo que já está no disco. */
  download?: boolean;
  manifest?: ModelManifest;
  fetch?: Fetcher;
  load?(dir: string): Promise<Embedder>;
  now?(): number;
  /** Sem uso por este tempo, o modelo sai da memória (~0,5 GB) e volta na próxima busca, em ~0,5 s. */
  idleMs?: number;
  /** Sem nenhum byte por este tempo, o download desiste e vira erro (T7941). O padrão é o `STALL_MS` (30 s). */
  stallMs?: number;
}

/** Depois de uma falha (sem rede, hash errado), espera isto antes de tentar de novo. */
export const RETRY_MS = 10 * 60_000;
export const IDLE_MS = 10 * 60_000;

export class SemanticEngine {
  private model: Embedder | null = null;
  private starting: Promise<Embedder | null> | null = null;
  /** O download em curso: desligar e sair o abortam, em vez de esperar uma conexão que pode nunca andar (T7941). */
  private download: AbortController | null = null;
  private current: SemanticModelState = { phase: "idle" };
  private failedAt = -Infinity;
  private lastUse = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(s: SemanticModelState) => void>();
  private readonly manifest: ModelManifest;
  private readonly now: () => number;

  constructor(private readonly o: SemanticEngineOptions) {
    this.manifest = o.manifest ?? E5_SMALL;
    this.now = o.now ?? Date.now;
  }

  state(): SemanticModelState {
    return { ...this.current };
  }

  onState(fn: (s: SemanticModelState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: SemanticModelState): void {
    this.current = next;
    for (const fn of this.listeners) fn(this.state());
  }

  /**
   * O modelo já carregado, sem esperar nada: a busca da pessoa nunca espera o download nem a carga. Se ele saiu da
   * memória por falta de uso, a busca volta a carregá-lo em segundo plano e a próxima já usa.
   */
  loaded(): Embedder | null {
    if (this.model) this.touch();
    else if (this.current.phase === "ready") void this.start();
    return this.model;
  }

  private touch(): void {
    this.lastUse = this.now();
    this.schedule(this.o.idleMs ?? IDLE_MS);
  }

  private schedule(ms: number): void {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.sweep();
    }, Math.max(ms, 1000));
    this.idleTimer.unref();
  }

  /** Solta o modelo sem uso há `idleMs`; senão, confere de novo quando completar. */
  async sweep(): Promise<void> {
    const idle = this.o.idleMs ?? IDLE_MS;
    if (!this.model) return;
    const quiet = this.now() - this.lastUse;
    if (quiet < idle) return this.schedule(idle - quiet);
    const model = this.model;
    this.model = null;
    await model.close().catch(() => {});
  }

  /** Começa (ou espera) o download e a carga. `null` quando está desligado ou falhou. */
  start(): Promise<Embedder | null> {
    if (this.model) {
      this.touch();
      return Promise.resolve(this.model);
    }
    this.starting ??= this.boot().finally(() => {
      this.starting = null;
      this.download = null;
    });
    return this.starting;
  }

  private async boot(): Promise<Embedder | null> {
    if (!(await this.o.enabled())) {
      this.set({ phase: "off" });
      return null;
    }
    if (this.current.phase === "error" && this.now() - this.failedAt < RETRY_MS) return null;
    try {
      const present = await modelPresent(this.o.modelsDir, this.manifest);
      if (!present && this.o.download === false) {
        this.set({ phase: "idle" });
        return null;
      }
      if (!present) this.set({ phase: "downloading", done: 0, total: 0 });
      const download = (this.download = new AbortController());
      const dir = await ensureModel(this.o.modelsDir, this.manifest, {
        fetch: this.o.fetch,
        signal: download.signal,
        ...(this.o.stallMs !== undefined ? { stallMs: this.o.stallMs } : {}),
        onProgress: (done, total) => {
          if (!present) this.set({ phase: "downloading", done, total });
        },
      });
      if (!(await this.o.enabled())) {
        this.set({ phase: "off" });
        return null;
      }
      this.set({ phase: "loading" });
      const load = this.o.load ?? (async (d: string) => (await import("./embedder.ts")).onnxEmbedder(d));
      this.model = await load(dir);
      this.touch();
      this.set({ phase: "ready" });
      return this.model;
    } catch (e) {
      // Desligado ou saindo no meio do download: não é uma falha, e quem abortou põe o estado.
      if (this.download?.signal.aborted) return null;
      this.failedAt = this.now();
      this.set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      console.error("[semantic] model:", e);
      return null;
    }
  }

  /** Desligado na Configuração: solta o modelo e apaga os arquivos dele. */
  async disable(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.download?.abort();
    await this.starting?.catch(() => null);
    const model = this.model;
    this.model = null;
    await model?.close().catch(() => {});
    await rm(path.dirname(modelDir(this.o.modelsDir, this.manifest)), { recursive: true, force: true });
    this.failedAt = -Infinity;
    this.set({ phase: "off" });
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.download?.abort();
    await this.starting?.catch(() => null);
    const model = this.model;
    this.model = null;
    await model?.close().catch(() => {});
  }
}
