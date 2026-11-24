// A voz do gato baixada no clique (T26729, spec #26687, ADR 0014): o Qwen3-TTS do mlx-community numa revisão fixa e a
// voz de referência, com o SHA-256 de cada arquivo conferido, pelo mesmo caminho dos outros modelos
// (`ensureModel`, src/notes/semantic/model.ts). Nada baixa sozinho: só o `download()`, que é o clique da pessoa.
//
// - **Estados:** `off` (nada no disco), `downloading` (bytes e total), `warming` (o `kiwi-voice` compila os kernels
//   Metal), `ready`, `noVoice` (o modelo está no disco, mas a voz ainda não foi escolhida) e `error` (qual passo).
// - **Ao terminar**, manda o `warmup` ao processo: a 1ª vez de um binário leva ~20 s compilando os kernels Metal (T26732),
//   e assim a 1ª fala não paga esse tempo.
// - **A voz de referência** é um item do manifesto, como o modelo. A voz desenhada ainda não foi escolhida (#26939):
//   até lá, o `CAT_VOICE_REF` é `null`, e os testes usam uma voz inventada.
// - **Cancelar** para o download no meio: o `.part` sai junto, e o que já conferiu fica. **Remover** apaga o modelo e a
//   voz, e derruba o processo que os usava.

import { rm } from "node:fs/promises";
import path from "node:path";

import { ensureModel, type Fetcher, modelBytes, modelDir, type ModelManifest, modelPresent } from "../notes/semantic/model.ts";
import type { CatVoiceStatus } from "../shared/ui-contract.ts";
import { type VoiceAssets, VoiceProcess } from "./voice-process.ts";

/** O modelo do ADR 0014: o Qwen3-TTS 0.6B Base em 8 bits, 1,9 GB. O `tokenizer.json` o `kiwi-voice` gera na 1ª carga. */
export const QWEN3_TTS: ModelManifest = {
  id: "qwen3-tts-0.6b-base-8bit",
  repo: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
  revision: "50f45ef0047cde7e84c2ef04326acb8ada2436a7",
  files: [
    { name: "config.json", size: 5522, sha256: "b404fb6f99dac6f7a81f3a03af5675b131ecf9936ac75a7c9d75e54044600044" },
    { name: "generation_config.json", size: 245, sha256: "f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa" },
    { name: "merges.txt", size: 1_671_839, sha256: "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3" },
    { name: "model.safetensors", size: 1_304_461_214, sha256: "9488e7005cc0cf44f8804eb543668d0763bb1c649ce6f1eddc663519524b3182" },
    { name: "model.safetensors.index.json", size: 77_731, sha256: "7829f1cc24f5cbd7d7a3ba888bb08c7cf52d82ba79a4f0f3756d41f8bf5e52b4" },
    { name: "preprocessor_config.json", size: 127, sha256: "efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119" },
    { name: "speech_tokenizer/config.json", size: 2336, sha256: "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167" },
    { name: "speech_tokenizer/configuration.json", size: 76, sha256: "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd" },
    { name: "speech_tokenizer/model.safetensors", size: 682_293_092, sha256: "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258" },
    { name: "speech_tokenizer/preprocessor_config.json", size: 234, sha256: "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb" },
    { name: "tokenizer_config.json", size: 7344, sha256: "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670" },
    { name: "vocab.json", size: 2_776_833, sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910" },
  ],
};

/** A voz de referência: um arquivo de áudio (com a URL fixa ou no Hugging Face) e o texto que ele fala. */
export interface CatVoiceRef {
  manifest: ModelManifest;
  /** O texto falado no áudio, palavra por palavra: o modelo copia a voz a partir dele. */
  text: string;
  language?: string;
}

/** A voz escolhida (#26939). Até a escolha, nenhuma: o modelo baixa, e o estado fica `noVoice`. */
export const CAT_VOICE_REF: CatVoiceRef | null = null;

export interface CatVoiceModelOptions {
  modelsDir: string;
  manifest?: ModelManifest;
  voice?: CatVoiceRef | null;
  fetch?: Fetcher;
  /** `false`: nunca baixa (o headless), só usa o que já está na pasta. */
  download?: boolean;
  /** Sem nenhum byte por este tempo, o download desiste (o `STALL_MS`, 30 s, por padrão). */
  stallMs?: number;
  /** O `warmup` do processo da voz (`VoiceProcess.warmup`). */
  warm?: () => Promise<unknown>;
  /** Derruba o processo da voz antes de apagar os arquivos que ele usa. */
  stopVoice?: () => Promise<void>;
  log?: (msg: string) => void;
}

type Phase = Omit<CatVoiceStatus, "size" | "voice">;

export class CatVoiceModel {
  private current: Phase = { phase: "off" };
  private readonly manifest: ModelManifest;
  private readonly voice: CatVoiceRef | null;
  private readonly listeners = new Set<(s: CatVoiceStatus) => void>();
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  /** Cada `download`/`cancel`/`remove` ganha um número: o que termina depois de um mais novo não muda o estado. */
  private generation = 0;
  private readonly log: (msg: string) => void;

  constructor(private readonly o: CatVoiceModelOptions) {
    this.manifest = o.manifest ?? QWEN3_TTS;
    this.voice = o.voice === undefined ? CAT_VOICE_REF : o.voice;
    this.log = o.log ?? ((m) => console.log(`[cat-voice] ${m}`));
  }

  /** O tamanho do que o clique baixa: o modelo e a voz. */
  size(): number {
    return modelBytes(this.manifest) + (this.voice ? modelBytes(this.voice.manifest) : 0);
  }

  status(): CatVoiceStatus {
    return { ...this.current, size: this.size(), voice: this.voice !== null };
  }

  onStatus(fn: (s: CatVoiceStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Lê o disco: o que já foi baixado numa sessão anterior conta como pronto, sem baixar nem aquecer nada. */
  async refresh(): Promise<CatVoiceStatus> {
    if (this.running) return this.status();
    const model = await modelPresent(this.o.modelsDir, this.manifest);
    const voice = this.voice ? await modelPresent(this.o.modelsDir, this.voice.manifest) : false;
    if (this.running) return this.status();
    if (model && voice) this.set({ phase: "ready" });
    else if (model && !this.voice) this.set({ phase: "noVoice" });
    else if (this.current.phase !== "error") this.set({ phase: "off" });
    return this.status();
  }

  /** O clique: baixa o que falta, confere e aquece o processo. Clicar de novo durante o download não faz nada. */
  download(): Promise<void> {
    if (this.running) return this.running;
    const generation = ++this.generation;
    const abort = (this.abort = new AbortController());
    this.running = this.run(generation, abort).finally(() => {
      if (this.generation === generation) {
        this.running = null;
        this.abort = null;
      }
    });
    return this.running;
  }

  /** Para o download no meio. O que já conferiu fica no disco; o `.part` sai. */
  async cancel(): Promise<void> {
    if (!this.running) return;
    ++this.generation;
    const running = this.running;
    this.abort?.abort();
    await running.catch(() => {});
    this.running = null;
    this.abort = null;
    this.set({ phase: "off" });
    await this.refresh();
  }

  /** Apaga o modelo e a voz (e derruba o processo que os usa). */
  async remove(): Promise<void> {
    await this.cancel();
    ++this.generation;
    await this.o.stopVoice?.().catch(() => {});
    for (const m of [this.manifest, this.voice?.manifest]) {
      if (m) await rm(path.dirname(modelDir(this.o.modelsDir, m)), { recursive: true, force: true });
    }
    this.set({ phase: "off" });
  }

  /** O que o `VoiceProcess` carrega. Sem o modelo ou a voz no disco, um throw: a fala falha, e nada baixa por isso. */
  async assets(): Promise<VoiceAssets> {
    if (!this.voice) throw new Error("a voz do gato ainda não foi escolhida");
    if (!(await modelPresent(this.o.modelsDir, this.manifest))) throw new Error("o modelo da voz não foi baixado");
    if (!(await modelPresent(this.o.modelsDir, this.voice.manifest))) throw new Error("a voz de referência não foi baixada");
    return {
      modelDir: modelDir(this.o.modelsDir, this.manifest),
      refAudio: path.join(modelDir(this.o.modelsDir, this.voice.manifest), this.voice.manifest.files[0]!.name),
      refText: this.voice.text,
      ...(this.voice.language ? { language: this.voice.language } : {}),
    };
  }

  private async run(generation: number, abort: AbortController): Promise<void> {
    const live = () => generation === this.generation;
    const parts = [this.manifest, ...(this.voice ? [this.voice.manifest] : [])];
    const total = this.size();
    try {
      const missing: ModelManifest[] = [];
      for (const m of parts) if (!(await modelPresent(this.o.modelsDir, m))) missing.push(m);
      if (missing.length > 0 && this.o.download === false) throw Object.assign(new Error("no download here, and the voice isn't in the folder"), { step: "download" as const });
      let before = parts.filter((m) => !missing.includes(m)).reduce((n, m) => n + modelBytes(m), 0);
      if (missing.length > 0 && live()) this.set({ phase: "downloading", done: before, total });
      for (const m of missing) {
        await ensureModel(this.o.modelsDir, m, {
          signal: abort.signal,
          ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
          ...(this.o.stallMs !== undefined ? { stallMs: this.o.stallMs } : {}),
          onProgress: (done) => {
            if (live()) this.set({ phase: "downloading", done: before + done, total });
          },
        });
        before += modelBytes(m);
      }
    } catch (e) {
      if (!live()) return;
      const hash = (e as { code?: string }).code === "E_MODEL_HASH";
      this.log(`download: ${e instanceof Error ? e.message : String(e)}`);
      this.set({ phase: "error", error: hash ? "hash" : "download" });
      return;
    }
    if (!live()) return;
    if (!this.voice) {
      this.set({ phase: "noVoice" });
      return;
    }
    if (this.o.warm) {
      this.set({ phase: "warming" });
      try {
        const ms = await this.o.warm();
        this.log(`warmup: ${typeof ms === "number" ? `${ms} ms` : "ok"}`);
      } catch (e) {
        if (!live()) return;
        this.log(`warmup: ${e instanceof Error ? e.message : String(e)}`);
        this.set({ phase: "error", error: "warmup" });
        return;
      }
      if (!live()) return;
    }
    this.set({ phase: "ready" });
  }

  private set(next: Phase): void {
    this.current = next;
    const s = this.status();
    for (const fn of this.listeners) fn(s);
  }
}

/**
 * O modelo da voz e o processo que o usa, ligados: o processo carrega o que o modelo baixou, o fim do download aquece o
 * processo, e remover derruba o processo antes de apagar. O app e o headless criam um par só.
 */
export function createCatVoice(o: { modelsDir: string; bin: string; download: boolean }): { model: CatVoiceModel; voice: VoiceProcess } {
  const log = (m: string) => console.log(`[cat-voice] ${m}`);
  let model: CatVoiceModel | undefined;
  const voice = new VoiceProcess({ bin: o.bin, assets: () => model!.assets(), log });
  model = new CatVoiceModel({ modelsDir: o.modelsDir, download: o.download, warm: () => voice.warmup(), stopVoice: () => voice.stop(), log });
  return { model, voice };
}
