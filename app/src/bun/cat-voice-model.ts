// A voz do gato baixada no clique (T26729, spec #26687, ADR 0014): o Qwen3-TTS do mlx-community numa revisão fixa e a
// voz de referência, com o SHA-256 de cada arquivo conferido, pelo mesmo caminho dos outros modelos
// (`ensureModel`, src/notes/semantic/model.ts). Nada baixa sozinho: só o `download()`, que é o clique da pessoa.
//
// - **Estados:** `off` (nada no disco), `downloading` (bytes e total), `warming` (o `kiwi-voice` compila os kernels
//   Metal), `ready`, `noVoice` (o modelo está no disco, e falta alguma referência) e `error` (qual passo).
// - **Ao terminar**, manda o `warmup` ao processo: a 1ª vez de um binário leva ~20 s compilando os kernels Metal (T26732),
//   e assim a 1ª fala não paga esse tempo.
// - **As vozes** (spec #27531, T27778): o catálogo `CAT_VOICE_REFS`, uma referência por voz, cada uma com o manifesto
//   próprio e o idioma. O clique baixa o modelo e todas; a que falha é o erro só dela. A escolhida (`kiwicat.voz`) é a que
//   o processo carrega e a que cada fala leva. O modelo sem as referências é o `noVoice`, e o mesmo clique as completa.
// - **Cancelar** para o download no meio: o `.part` sai junto, e o que já conferiu fica. **Remover** apaga o modelo e
//   as vozes, e derruba o processo que os usava.

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { linguaOuNada } from "../agent/lingua.ts";
import { ensureModel, type Fetcher, modelBytes, modelDir, type ModelManifest, modelPresent } from "../notes/semantic/model.ts";
import { CAT_VOICE_IDS, CAT_VOICES, type CatVoiceId, type CatVoiceLanguage, DEFAULT_CAT_VOICE, isCatVoiceId } from "../shared/cat-voices.ts";
import type { CatVoiceItem, CatVoiceStatus } from "../shared/ui-contract.ts";
import { type FalaLingua, type VoiceAssets, VoiceProcess } from "./voice-process.ts";

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
  /** O idioma da fala (o `language` do Qwen3-TTS). Sem ele, o `VoiceProcess` cai em português. */
  language?: string;
  /** O texto fixo do Ouvir nos Ajustes: as falas do gato (#27474), no idioma da voz. */
  preview?: readonly string[];
}

/** As falas do gato do #27474, as mesmas que as referências inglesas falam (#27781). */
const EN_LINES = "Hi. I'm Kiwi. Your notes have a cat now. Hmm. Found it. That note was hiding. Done. Your note is right where it belongs.";
const EN_PREVIEW = ["Hi. I'm Kiwi. Your notes have a cat now.", "Hmm. Found it. That note was hiding.", "Done. Your note is right where it belongs."];

/** A voz em português (#28142): o texto exato da referência (a R0, harry #28133) e as falas da prévia. */
const PT_LINES = "Achei! Era exatamente essa nota que você queria! Pronto. A nota está salva e organizada.";
const PT_PREVIEW = ["Oi. Eu sou o Kiwi. Suas notas agora têm um gato.", "Hum. Achei. Essa nota estava escondida.", "Pronto. Sua nota está no lugar certo."];

/** Um WAV do release `cat-voices-1` (spec #27531): a URL fixa, os bytes e o SHA-256 de lá. */
const releaseWav = (id: string, name: string, size: number, sha256: string): ModelManifest => ({
  id: `cat-voice-${id}`,
  repo: "kiwi-init/kiwinotes",
  revision: "cat-voices-1",
  files: [{ name, size, sha256, url: `https://github.com/kiwi-init/kiwinotes/releases/download/cat-voices-1/${name}` }],
});

/**
 * A voz de uma frase (T31030, harry #31028): a voz inglesa lendo português sai com sotaque, e o contrário também. Uma
 * frase na língua da voz escolhida fica nela; na outra língua, vai para a voz do catálogo daquela língua: a `pt-a` para
 * o português, a `en-a` para o inglês. A escolha da pessoa nos Ajustes não muda. Sem a língua (`null`), a escolhida.
 */
export function voiceForLingua(chosen: CatVoiceId, lingua: FalaLingua): CatVoiceId {
  if (!lingua) return chosen;
  const wanted: CatVoiceLanguage = lingua === "pt" ? "portuguese" : "english";
  if (CAT_VOICES[chosen].language === wanted) return chosen;
  return LINGUA_VOICE[lingua];
}
/** A voz de cada língua quando a escolhida é da outra. */
export const LINGUA_VOICE: Record<"pt" | "en", CatVoiceId> = { pt: "pt-a", en: "en-a" };

/**
 * As referências do catálogo (spec #27531, #27781, #28142). `null`: a voz ainda não tem referência e aparece como
 * "em breve".
 */
export const CAT_VOICE_REFS: Record<CatVoiceId, CatVoiceRef | null> = {
  "en-a": {
    manifest: releaseWav("en-a", "T-ref.wav", 566_444, "e1fe8f725c475e65be6dcceb5128e07ae693ec6be3c605da20a48a0dc26f7d80"),
    text: EN_LINES,
    language: "english",
    preview: EN_PREVIEW,
  },
  "en-b": {
    manifest: releaseWav("en-b", "B-ref.wav", 662_444, "0c75109a3de8af28611055f249d3f9263b052d229878a9db6b928b3c922418d8"),
    text: EN_LINES,
    language: "english",
    preview: EN_PREVIEW,
  },
  "pt-a": {
    manifest: releaseWav("pt-a", "PT-ref.wav", 440_684, "76f2e075ec3659fe120b690274337b1d9fb8209f6c7c9340b84336d79b6b20e1"),
    text: PT_LINES,
    language: "portuguese",
    preview: PT_PREVIEW,
  },
};

/**
 * O prazo do aquecimento (#27141). A 1ª vez de um binário leva ~20 s compilando os kernels Metal (T26732); 2 min deixam
 * folga para um Mac quente ou ocupado. Um `kiwi-voice` vivo que trava não prende o estado em `warming` para sempre.
 */
export const WARM_MS = 120_000;

export interface CatVoiceModelOptions {
  modelsDir: string;
  manifest?: ModelManifest;
  /** O catálogo; o que falta aqui conta como "em breve". Por padrão, o `CAT_VOICE_REFS`. */
  voices?: Partial<Record<CatVoiceId, CatVoiceRef | null>>;
  /** A voz guardada nos Ajustes (`kiwicat.voz`). Sem ela, a `DEFAULT_CAT_VOICE`. */
  selected?: () => CatVoiceId | Promise<CatVoiceId>;
  fetch?: Fetcher;
  /** `false`: nunca baixa (o headless), só usa o que já está na pasta. */
  download?: boolean;
  /** Sem nenhum byte por este tempo, o download desiste (o `STALL_MS`, 30 s, por padrão). */
  stallMs?: number;
  /** O `warmup` do processo da voz (`VoiceProcess.warmup`). */
  warm?: () => Promise<unknown>;
  /** O prazo do `warm` (o `WARM_MS`, 2 min, por padrão): passou, o processo travado cai e o estado vira `error: warmup`. */
  warmMs?: number;
  /** Derruba o processo da voz antes de apagar os arquivos que ele usa. */
  stopVoice?: () => Promise<void>;
  log?: (msg: string) => void;
}

type Phase = Omit<CatVoiceStatus, "size" | "voice" | "model" | "voices" | "selected" | "preview">;
type RefError = "download" | "hash";

export class CatVoiceModel {
  private current: Phase = { phase: "off" };
  private readonly manifest: ModelManifest;
  private readonly refs: [CatVoiceId, CatVoiceRef][];
  private readonly listeners = new Set<(s: CatVoiceStatus) => void>();
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  /** Cada `download`/`cancel`/`remove` ganha um número: o que termina depois de um mais novo não muda o estado. */
  private generation = 0;
  private readonly log: (msg: string) => void;
  /** O que o disco tinha na última leitura: o modelo e cada referência. */
  private modelHere = false;
  private readonly here = new Set<CatVoiceId>();
  /** A referência que falhou no último clique, e como: o erro é só dela (spec #27531). */
  private readonly refErrors = new Map<CatVoiceId, RefError>();
  private chosen: CatVoiceId = DEFAULT_CAT_VOICE;
  private previewing: CatVoiceId | null = null;

  constructor(private readonly o: CatVoiceModelOptions) {
    this.manifest = o.manifest ?? QWEN3_TTS;
    const voices = o.voices ?? CAT_VOICE_REFS;
    this.refs = CAT_VOICE_IDS.flatMap((id) => (voices[id] ? [[id, voices[id]!] as [CatVoiceId, CatVoiceRef]] : []));
    this.log = o.log ?? ((m) => console.log(`[cat-voice] ${m}`));
  }

  /** A referência de uma voz do catálogo, ou `null` ("em breve"). */
  ref(id: CatVoiceId): CatVoiceRef | null {
    return this.refs.find(([v]) => v === id)?.[1] ?? null;
  }

  /** O tamanho do que o clique baixa: o modelo e todas as referências. */
  size(): number {
    return modelBytes(this.manifest) + this.refs.reduce((n, [, r]) => n + modelBytes(r.manifest), 0);
  }

  status(): CatVoiceStatus {
    const voices: CatVoiceItem[] = CAT_VOICE_IDS.map((id) => {
      const ref = this.ref(id);
      if (!ref) return { id, state: "soon" };
      const error = this.refErrors.get(id);
      if (this.here.has(id)) return { id, state: "ready", size: modelBytes(ref.manifest) };
      return error ? { id, state: "error", error, size: modelBytes(ref.manifest) } : { id, state: "missing", size: modelBytes(ref.manifest) };
    });
    return {
      ...this.current,
      size: this.size(),
      voice: this.modelHere && this.here.has(this.chosen),
      model: this.modelHere,
      voices,
      selected: this.chosen,
      preview: this.previewing,
    };
  }

  onStatus(fn: (s: CatVoiceStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A prévia que está tocando (o `CatVoicePreview` avisa): sai no `status`, para a linha mostrar o "Parar". */
  setPreview(id: CatVoiceId | null): void {
    if (this.previewing === id) return;
    this.previewing = id;
    this.set(this.current);
  }

  /** Lê o disco e a escolha: o que já foi baixado numa sessão anterior conta como pronto, sem baixar nem aquecer nada. */
  async refresh(): Promise<CatVoiceStatus> {
    this.chosen = await this.readChoice();
    if (this.running) return this.status();
    await this.readDisk();
    if (this.running) return this.status();
    // Pronta só com todas as vozes do catálogo; sem nenhuma (todas "em breve"), o gato ainda não tem voz.
    if (this.modelHere) this.set(this.complete() ? { phase: "ready" } : { phase: "noVoice" });
    else if (this.current.phase !== "error") this.set({ phase: "off" });
    else this.set(this.current);
    return this.status();
  }

  /**
   * O clique: baixa o que falta (o modelo e as referências), confere e aquece o processo. Com o modelo já no disco, só
   * as referências que faltam (o "Completar"). Clicar de novo durante o download não faz nada.
   */
  download(): Promise<void> {
    if (this.running) return this.running;
    const generation = ++this.generation;
    const abort = (this.abort = new AbortController());
    // Já no clique, pelo que o disco tinha: a resposta do `catVoice.download` e a primeira leitura da tela veem o
    // andamento, e não o "off" de antes (o `run` ainda lê a escolha e o disco antes do primeiro byte).
    if (this.o.download !== false && (!this.modelHere || !this.complete())) this.set({ phase: "downloading", done: this.bytesHere(), total: this.size() });
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

  /** Apaga o modelo e todas as referências (e derruba o processo que os usa). */
  async remove(): Promise<void> {
    await this.cancel();
    ++this.generation;
    await this.o.stopVoice?.().catch(() => {});
    for (const m of [this.manifest, ...this.refs.map(([, r]) => r.manifest)]) {
      await rm(path.dirname(modelDir(this.o.modelsDir, m)), { recursive: true, force: true });
    }
    this.modelHere = false;
    this.here.clear();
    this.refErrors.clear();
    this.set({ phase: "off" });
  }

  /** O que uma voz precisa no `kiwi-voice`: o modelo e a referência dela. Sem um dos dois no disco, um throw. */
  async voiceAssets(id: CatVoiceId): Promise<VoiceAssets> {
    const ref = this.ref(id);
    if (!ref) throw new Error(`a voz ${id} ainda não tem referência`);
    if (!(await modelPresent(this.o.modelsDir, this.manifest))) throw new Error("o modelo da voz não foi baixado");
    if (!(await modelPresent(this.o.modelsDir, ref.manifest))) throw new Error(`a voz ${id} não foi baixada`);
    return {
      modelDir: modelDir(this.o.modelsDir, this.manifest),
      refAudio: path.join(modelDir(this.o.modelsDir, ref.manifest), ref.manifest.files[0]!.name),
      refText: ref.text,
      ...(ref.language ? { language: ref.language } : {}),
    };
  }

  /**
   * A voz escolhida, que o `VoiceProcess` lê no começo de cada fala. Com a língua da frase (T31030), a voz daquela
   * língua: a escolhida, se ela fala essa língua, ou a do catálogo para ela (`voiceForLingua`). Se ela não está no disco (falhou, ou ainda é
   * "em breve"), a primeira do catálogo que está: uma voz quebrada não cala o gato (spec #27531). Sem nenhuma, um throw:
   * a fala falha, e nada baixa por isso.
   */
  async assets(lingua?: FalaLingua): Promise<VoiceAssets> {
    const chosen = await this.readChoice();
    // A voz da língua da frase (T31030), e a escolhida se ela não está no disco.
    const first = [...new Set([voiceForLingua(chosen, lingua ?? null), chosen])];
    for (const id of first) {
      if (!this.ref(id)) continue;
      try {
        return await this.voiceAssets(id);
      } catch {}
    }
    for (const [id] of this.refs) {
      if (first.includes(id)) continue;
      try {
        return await this.voiceAssets(id);
      } catch {}
    }
    if (this.refs.length === 0) throw new Error("nenhuma voz do gato tem referência ainda");
    if (!(await modelPresent(this.o.modelsDir, this.manifest))) throw new Error("o modelo da voz não foi baixado");
    throw new Error("nenhuma voz do gato foi baixada");
  }

  /** Os bytes que já estão no disco: o modelo e as referências conferidas. */
  private bytesHere(): number {
    return (this.modelHere ? modelBytes(this.manifest) : 0) + this.refs.filter(([id]) => this.here.has(id)).reduce((n, [, r]) => n + modelBytes(r.manifest), 0);
  }

  private complete(): boolean {
    return this.refs.length > 0 && this.refs.every(([id]) => this.here.has(id));
  }

  private async readChoice(): Promise<CatVoiceId> {
    try {
      const id = (await this.o.selected?.()) ?? DEFAULT_CAT_VOICE;
      return isCatVoiceId(id) ? id : DEFAULT_CAT_VOICE;
    } catch {
      return DEFAULT_CAT_VOICE;
    }
  }

  private async readDisk(): Promise<void> {
    this.modelHere = await modelPresent(this.o.modelsDir, this.manifest);
    for (const [id, r] of this.refs) {
      if (await modelPresent(this.o.modelsDir, r.manifest)) {
        this.here.add(id);
        this.refErrors.delete(id);
      } else this.here.delete(id);
    }
  }

  private async run(generation: number, abort: AbortController): Promise<void> {
    const live = () => generation === this.generation;
    const total = this.size();
    const fetchOpts = {
      signal: abort.signal,
      ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
      ...(this.o.stallMs !== undefined ? { stallMs: this.o.stallMs } : {}),
    };
    let before = 0;
    const missingRefs: [CatVoiceId, CatVoiceRef][] = [];
    try {
      this.chosen = await this.readChoice();
      await this.readDisk();
      for (const [id, r] of this.refs) if (!this.here.has(id)) missingRefs.push([id, r]);
      const modelMissing = !this.modelHere;
      if ((modelMissing || missingRefs.length > 0) && this.o.download === false)
        throw Object.assign(new Error("no download here, and the voice isn't in the folder"), { step: "download" as const });
      before = this.bytesHere();
      if ((modelMissing || missingRefs.length > 0) && live()) this.set({ phase: "downloading", done: before, total });
      // O modelo primeiro: sem ele, nenhuma voz fala, e a falha é do clique todo.
      if (modelMissing) {
        await ensureModel(this.o.modelsDir, this.manifest, {
          ...fetchOpts,
          onProgress: (done) => {
            if (live()) this.set({ phase: "downloading", done: before + done, total });
          },
        });
        before += modelBytes(this.manifest);
        this.modelHere = true;
      }
    } catch (e) {
      if (!live()) return;
      const hash = (e as { code?: string }).code === "E_MODEL_HASH";
      this.log(`download: ${e instanceof Error ? e.message : String(e)}`);
      this.set({ phase: "error", error: hash ? "hash" : "download" });
      return;
    }
    // Cada referência por si: uma que falha (a rede, o hash) vira o erro daquela voz, e as outras seguem.
    for (const [id, r] of missingRefs) {
      if (!live()) return;
      try {
        await ensureModel(this.o.modelsDir, r.manifest, {
          ...fetchOpts,
          onProgress: (done) => {
            if (live()) this.set({ phase: "downloading", done: before + done, total });
          },
        });
        this.here.add(id);
        this.refErrors.delete(id);
      } catch (e) {
        if (!live()) return;
        const hash = (e as { code?: string }).code === "E_MODEL_HASH";
        this.log(`download da voz ${id}: ${e instanceof Error ? e.message : String(e)}`);
        this.refErrors.set(id, hash ? "hash" : "download");
      }
      before += modelBytes(r.manifest);
    }
    if (!live()) return;
    const complete = this.complete();
    if (this.here.size === 0) {
      this.set({ phase: "noVoice" });
      return;
    }
    if (this.o.warm) {
      this.set({ phase: "warming" });
      try {
        const ms = await this.warmWithin(abort.signal);
        this.log(`warmup: ${typeof ms === "number" ? `${ms} ms` : "ok"}`);
      } catch (e) {
        // Travado (o prazo) ou cancelado no meio: o processo cai, para não ficar preso num aquecimento sem fim.
        if ((e as { code?: string }).code === "E_WARM_STOP") await this.o.stopVoice?.().catch(() => {});
        if (!live()) return;
        this.log(`warmup: ${e instanceof Error ? e.message : String(e)}`);
        this.set({ phase: "error", error: "warmup" });
        return;
      }
      if (!live()) return;
    }
    this.set({ phase: complete ? "ready" : "noVoice" });
  }

  /** O `warm` com o prazo e o `cancel`: o que vier primeiro. Os dois casos saem com o código `E_WARM_STOP`. */
  private warmWithin(signal: AbortSignal): Promise<unknown> {
    const ms = this.o.warmMs ?? WARM_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<never>((_, reject) => {
      const fail = (why: string) => reject(Object.assign(new Error(why), { code: "E_WARM_STOP" }));
      timer = setTimeout(() => fail(`sem resposta em ${Math.round(ms / 1000)} s`), ms);
      onAbort = () => fail("cancelado");
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    return Promise.race([this.o.warm!(), stop]).finally(() => {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    });
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
export function createCatVoice(
  o: { modelsDir: string; bin: string; download: boolean; /** A língua de cada frase (T31030); o padrão é o `linguaOuNada`. */ lingua?: (frase: string) => FalaLingua } & Pick<
    CatVoiceModelOptions,
    "manifest" | "voices" | "fetch" | "selected"
  >,
): { model: CatVoiceModel; voice: VoiceProcess } {
  const log = (m: string) => console.log(`[cat-voice] ${m}`);
  let model: CatVoiceModel | undefined;
  const voice = new VoiceProcess({ bin: o.bin, assets: (l) => model!.assets(l), lingua: o.lingua ?? linguaOuNada, log });
  model = new CatVoiceModel({
    modelsDir: o.modelsDir,
    download: o.download,
    ...(o.manifest ? { manifest: o.manifest } : {}),
    ...(o.voices !== undefined ? { voices: o.voices } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.selected ? { selected: o.selected } : {}),
    warm: () => voice.warmup(),
    stopVoice: () => voice.stop(),
    log,
  });
  return { model, voice };
}

/**
 * A chave de teste do headless (T26736), como o `KIWI_ADAPTER_REGISTRY` do agente: `KIWI_CAT_VOICE_MANIFEST` aponta
 * um JSON `{ host, model, voices }` com um modelo e as vozes inventados (por id do catálogo), servidos por um servidor
 * falso e local. O `voice` de antes vale como a `en-a` sozinha. Com ela, o headless baixa só desse `host` (o roteiro de
 * tela mostra o andamento); sem ela, não baixa nunca. O app não lê a chave.
 */
export function headlessCatVoiceSource(env: Record<string, string | undefined>): Pick<CatVoiceModelOptions, "manifest" | "voices" | "fetch"> | null {
  if (!env.KIWI_CAT_VOICE_MANIFEST) return null;
  const t = JSON.parse(readFileSync(env.KIWI_CAT_VOICE_MANIFEST, "utf8")) as {
    host: string;
    model: ModelManifest;
    voices?: Partial<Record<CatVoiceId, CatVoiceRef | null>>;
    voice?: CatVoiceRef | null;
  };
  const host = new URL(t.host);
  if (host.hostname !== "127.0.0.1" && host.hostname !== "localhost") throw new Error("KIWI_CAT_VOICE_MANIFEST: o host de teste tem de ser local");
  const local = (url: string) => {
    const u = new URL(url.replace("https://huggingface.co", host.origin));
    if (u.origin !== host.origin) throw new Error(`KIWI_CAT_VOICE_MANIFEST: ${u.origin} não é o host de teste`);
    return u.href;
  };
  const voices = t.voices ?? { "en-a": t.voice ?? null };
  return { manifest: t.model, voices, fetch: async (url, init) => fetch(local(url), init?.signal ? { signal: init.signal } : {}) };
}
