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
}

/** Depois de uma falha (sem rede, hash errado), espera isto antes de tentar de novo. */
export const RETRY_MS = 10 * 60_000;

export class SemanticEngine {
  private model: Embedder | null = null;
  private starting: Promise<Embedder | null> | null = null;
  private current: SemanticModelState = { phase: "idle" };
  private failedAt = -Infinity;
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

  /** O modelo já carregado, sem esperar nada: a busca da pessoa nunca espera o download. */
  loaded(): Embedder | null {
    return this.model;
  }

  /** Começa (ou espera) o download e a carga. `null` quando está desligado ou falhou. */
  start(): Promise<Embedder | null> {
    if (this.model) return Promise.resolve(this.model);
    this.starting ??= this.boot().finally(() => {
      this.starting = null;
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
      const dir = await ensureModel(this.o.modelsDir, this.manifest, {
        fetch: this.o.fetch,
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
      this.set({ phase: "ready" });
      return this.model;
    } catch (e) {
      this.failedAt = this.now();
      this.set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      console.error("[semantic] model:", e);
      return null;
    }
  }

  /** Desligado na Configuração: solta o modelo e apaga os arquivos dele. */
  async disable(): Promise<void> {
    await this.starting?.catch(() => null);
    const model = this.model;
    this.model = null;
    await model?.close().catch(() => {});
    await rm(path.dirname(modelDir(this.o.modelsDir, this.manifest)), { recursive: true, force: true });
    this.failedAt = -Infinity;
    this.set({ phase: "off" });
  }

  async close(): Promise<void> {
    await this.starting?.catch(() => null);
    const model = this.model;
    this.model = null;
    await model?.close().catch(() => {});
  }
}
