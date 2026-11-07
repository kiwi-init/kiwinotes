// O modo preciso do ditado (T6602, decisão do harry no #6894): o Whisper small (Q8_0, 270 MB) pelo transcribe.cpp no
// helper, com o dicionário como prompt. Desligado por padrão. Ligar baixa o modelo uma vez, do huggingface.co, com a
// revisão fixa e o SHA-256 conferido (o mesmo caminho da busca pelo sentido), e manda o caminho ao helper no
// `config.set {precise}`. Desligar solta o modelo no helper e apaga o arquivo.

import { rm } from "node:fs/promises";
import path from "node:path";

import { ensureModel, type Fetcher, modelBytes, modelDir, type ModelManifest, modelPresent } from "../notes/semantic/model.ts";
import type { Command, PreciseModelState } from "../shared/ipc.ts";
import type { PreciseStatus } from "../shared/ui-contract.ts";

/** O Whisper small do ADR 0003 (T6602): na voz do harry, 20,5% nos termos técnicos contra 27,4% e 32,9% do Parakeet. */
export const WHISPER_SMALL: ModelManifest = {
  id: "whisper-small",
  repo: "handy-computer/whisper-small-gguf",
  revision: "4afdc7942ecf1997f359deae48a63506b062eac4",
  files: [{ name: "whisper-small-Q8_0.gguf", size: 269_751_136, sha256: "9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860" }],
};

/** Depois de um download que falhou, só tenta de novo depois disso (ou quando a pessoa desliga e liga). */
const RETRY_MS = 10 * 60_000;

type Reply = { ok: boolean; error?: string } | undefined;

export interface PreciseDictationOptions {
  modelsDir: string;
  /** Manda um comando ao helper; `undefined` sem helper de pé. */
  send(command: Extract<Command, { type: "config.set" }>): Promise<Reply>;
  manifest?: ModelManifest;
  fetch?: Fetcher;
  /** `false`: nunca baixa (o headless), só usa o modelo que já está na pasta. */
  download?: boolean;
  now?: () => number;
}

export class PreciseDictation {
  private enabled = false;
  private current: Omit<PreciseStatus, "enabled" | "size"> = { phase: "off" };
  /** Cada `apply` ganha um número: um download que termina depois de desligar não liga nada. */
  private generation = 0;
  private downloading: Promise<string> | null = null;
  private abort: AbortController | null = null;
  private failedAt = -Infinity;
  private listeners = new Set<(s: PreciseStatus) => void>();
  private readonly manifest: ModelManifest;
  private readonly now: () => number;

  constructor(private readonly o: PreciseDictationOptions) {
    this.manifest = o.manifest ?? WHISPER_SMALL;
    this.now = o.now ?? Date.now;
  }

  status(): PreciseStatus {
    return { enabled: this.enabled, ...this.current, size: modelBytes(this.manifest) };
  }

  onStatus(fn: (s: PreciseStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** O arquivo do modelo, como o helper o abre. */
  modelPath(): string {
    return path.join(modelDir(this.o.modelsDir, this.manifest), this.manifest.files[0]!.name);
  }

  /**
   * A configuração mandou ligar ou desligar, ou o helper (re)começou: ligado, garante o modelo e manda o caminho;
   * desligado, manda `null` e, se estava ligado, apaga o arquivo. Chamar de novo com o mesmo valor reenvia, para o helper que reiniciou.
   */
  async apply(enabled: boolean): Promise<void> {
    const generation = ++this.generation;
    const was = this.enabled;
    this.enabled = enabled;
    if (!enabled) {
      if (was || this.current.phase !== "off") this.failedAt = -Infinity;
      this.set({ phase: "off" });
      await this.o.send({ type: "config.set", precise: null }).catch(() => undefined);
      // Um download pela metade para aqui: o `.part` sai junto, e nada fica no lugar do modelo.
      this.abort?.abort();
      await this.downloading?.catch(() => null);
      // Só quando a pessoa desliga: o `ready` de um helper com o modo desligado não apaga nada (KIWI_MODELS_DIR é
      // compartilhado entre as pastas de teste dos agentes, como na busca pelo sentido).
      if (generation !== this.generation || !was) return;
      await rm(path.dirname(modelDir(this.o.modelsDir, this.manifest)), { recursive: true, force: true });
      return;
    }
    if (!was) this.failedAt = -Infinity;
    if (this.current.phase === "error" && this.now() - this.failedAt < RETRY_MS) return;
    let file: string;
    try {
      file = await this.ensure();
    } catch (e) {
      if (generation !== this.generation) return;
      this.failedAt = this.now();
      this.set({ phase: "error", error: "download" });
      console.error("[precise] model:", e instanceof Error ? e.message : String(e));
      return;
    }
    if (generation !== this.generation) return;
    this.set({ phase: "loading" });
    const reply = await this.o.send({ type: "config.set", precise: file }).catch(() => undefined);
    if (generation !== this.generation) return;
    // Sem helper (ou um que não conhece o campo), o modelo fica baixado e vai no próximo `ready`.
    if (!reply) this.set({ phase: "waiting" });
    else if (!reply.ok) this.set({ phase: "error", error: "helper" });
  }

  /** O `stt.precise` do helper. */
  helperState(state: PreciseModelState): void {
    if (!this.enabled) return;
    if (state === "ready") this.set({ phase: "ready" });
    else if (state === "unavailable") this.set({ phase: "error", error: "load" });
    else if (state === "loading") this.set({ phase: "loading" });
  }

  /** O helper caiu: o modelo saiu junto, e volta no próximo `ready`. */
  helperGone(): void {
    if (this.enabled && this.current.phase !== "downloading" && this.current.phase !== "error") this.set({ phase: "waiting" });
  }

  private ensure(): Promise<string> {
    this.downloading ??= (async () => {
      const present = await modelPresent(this.o.modelsDir, this.manifest);
      if (!present && this.o.download === false) throw new Error("no download here, and the model isn't in the folder");
      if (!present) this.set({ phase: "downloading", done: 0, total: modelBytes(this.manifest) });
      const abort = (this.abort = new AbortController());
      const get: Fetcher = this.o.fetch ?? ((url) => fetch(url, { redirect: "follow", signal: abort.signal }));
      await ensureModel(this.o.modelsDir, this.manifest, {
        fetch: (url) => (abort.signal.aborted ? Promise.reject(new Error("aborted")) : get(url)),
        onProgress: (done, total) => {
          if (!present && this.enabled) this.set({ phase: "downloading", done, total });
        },
      });
      return this.modelPath();
    })().finally(() => {
      this.downloading = null;
      this.abort = null;
    });
    return this.downloading;
  }

  private set(next: Omit<PreciseStatus, "enabled" | "size">): void {
    this.current = next;
    const s = this.status();
    for (const fn of this.listeners) fn(s);
  }
}
