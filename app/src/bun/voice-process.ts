// O lado Bun do processo da voz do gato (ADR 0014, T26732): sobe o `kiwi-voice` (native-voice/) na 1ª frase, fala com
// ele por linhas de JSON no stdin/stdout e entrega o PCM ao player (T26734) pelo contrato `SinteseFala`.
//
// - Preguiçoso: o processo (e os ~4 GB do modelo) só existe enquanto o gato fala. Parado por `idleMs`, ele sai.
// - Uma frase por chamada, um id por frase. O abort manda `cancel`: o processo corta no próximo passo do codec, e o que
//   ainda chegar daquela frase é jogado fora.
// - O PCM sai em fatias de 80 ms (1920 amostras Int16 mono a 24 kHz); a última da frase pode ser menor.
// - O processo cair, ou dar erro numa frase, vira um throw no iterador daquela frase. A próxima frase sobe outro.
// - A voz (T27778): cada `speak` leva a referência, o texto e o idioma da voz. Ela é lida uma vez por fala (o `signal`
//   do turno, o mesmo para todas as frases dele): trocar a voz no meio de uma fala só vale a partir da próxima, e o
//   processo quente não recarrega o modelo. O Ouvir (`com`) fala numa voz fixa, sem mexer na escolhida.
// - A língua de cada frase (T31030, harry #31028): com o `lingua`, cada frase pede a voz da língua dela (`assets(lingua)`),
//   e uma frase sem sinal (`null`: "Hmm.", um número) segue na língua da anterior. Uma voz por língua e por fala.

import path from "node:path";

/** O contrato com o player (T26734, src/agent/fala-player.ts). */
export interface SinteseFala {
  sintetizar(frase: string, signal: AbortSignal): AsyncIterable<Int16Array>;
}

export const VOICE_SAMPLE_RATE = 24_000;
/** 80 ms a 24 kHz. */
export const VOICE_SLICE_SAMPLES = 1920;
/** O teto de cache do MLX do ADR 0014. */
export const VOICE_CACHE_MB = 512;
export const VOICE_IDLE_MS = 120_000;

/** A língua de uma frase, para a voz (T31030): `null` quando a frase não diz. */
export type FalaLingua = "pt" | "en" | null;

/** O modelo e a voz baixados no clique da pessoa (T26729). */
export interface VoiceAssets {
  modelDir: string;
  refAudio: string;
  refText: string;
  language?: string;
}

/** O que o cliente precisa de um processo: dá para trocar nos testes. */
export interface VoiceChild {
  write(line: string): void;
  /** Linhas do stdout, sem a quebra. Acaba quando o processo fecha o stdout. */
  lines: AsyncIterable<string>;
  exited: Promise<number | null>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

export interface VoiceProcessOptions {
  /** O executável: o `voicePath`. */
  bin: string;
  /**
   * O modelo e a voz escolhida: o `load` do processo, e a voz de cada fala nova. Com o `lingua`, a voz para a língua de
   * uma frase (T31030); sem a língua (o `load`, uma frase sem sinal no começo da fala), a escolhida.
   */
  assets: (lingua?: FalaLingua) => VoiceAssets | Promise<VoiceAssets>;
  /** A língua de cada frase (T31030). Sem ele, todas as frases na voz escolhida, como antes. */
  lingua?: (frase: string) => FalaLingua;
  idleMs?: number;
  cacheMB?: number;
  /** Quanto o `load` pode levar (a 1ª vez compila os kernels Metal). */
  loadTimeoutMs?: number;
  spawn?: (bin: string) => VoiceChild;
  log?: (msg: string) => void;
}

/** O `kiwi-voice` dentro do .app: o `copy` do electrobun.config.ts leva o app/.voice para `voice/`. Ou `KIWI_VOICE`. */
export function voicePath(viewsFolder: string, env = process.env): string {
  return env.KIWI_VOICE || path.join(viewsFolder, "..", "voice", "kiwi-voice");
}

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

type Msg =
  | { type: "ready"; sampleRate: number; loadMs: number }
  | { type: "pcm"; id: string; seq: number; pcm: string }
  | { type: "done"; id: string }
  | { type: "cancelled"; id: string }
  | { type: "warm"; ms: number }
  | { type: "error"; id?: string; message: string };

/** Uma frase em andamento: a fila do que chegou e quem espera por ela. */
class Turn {
  /** O processo que gera esta frase: um `stop` ou uma queda só derrubam as frases dele. */
  live: Live | null = null;
  chunks: Int16Array[] = [];
  end: { error?: Error } | null = null;
  private wake: (() => void) | null = null;
  push(c: Int16Array) {
    this.chunks.push(c);
    this.notify();
  }
  finish(error?: Error) {
    if (this.end) return;
    this.end = error ? { error } : {};
    this.notify();
  }
  notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
  wait(): Promise<void> {
    return new Promise((r) => (this.wake = r));
  }
}

interface Live {
  child: VoiceChild;
  ready: Promise<void>;
  dead: boolean;
}

export class VoiceProcess implements SinteseFala {
  private live: Live | null = null;
  private turns = new Map<string, Turn>();
  /** Os `warmup` esperando o `warm` do processo deles. */
  private warms = new Set<{ live: Live; resolve: (ms: number) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly log: (m: string) => void;
  /**
   * A voz de cada fala, pelo `signal` dela: lida na 1ª frase de cada língua, a mesma até o fim. `last` é a língua da
   * frase anterior, a de uma frase sem sinal.
   */
  private readonly voices = new WeakMap<AbortSignal, { last: FalaLingua; byLingua: Map<string, Promise<VoiceAssets>> }>();

  constructor(private readonly opts: VoiceProcessOptions) {
    this.idleMs = opts.idleMs ?? VOICE_IDLE_MS;
    this.log = opts.log ?? (() => {});
  }

  /** O processo está de pé (para os testes e o diagnóstico). */
  get running(): boolean {
    return this.live !== null && !this.live.dead;
  }

  sintetizar(frase: string, signal: AbortSignal): AsyncGenerator<Int16Array> {
    return this.gerar(frase, signal, this.opts.assets, this.opts.lingua?.(frase) ?? null);
  }

  /** A síntese numa voz fixa (o Ouvir dos Ajustes, T27778): a escolhida não muda, e a língua da frase não conta. */
  com(voz: () => VoiceAssets | Promise<VoiceAssets>): SinteseFala {
    return { sintetizar: (frase, signal) => this.gerar(frase, signal, voz, null) };
  }

  private voiceOf(signal: AbortSignal, voz: (lingua?: FalaLingua) => VoiceAssets | Promise<VoiceAssets>, lingua: FalaLingua): Promise<VoiceAssets> {
    let fala = this.voices.get(signal);
    if (!fala) this.voices.set(signal, (fala = { last: null, byLingua: new Map() }));
    const l = lingua ?? fala.last;
    fala.last = l;
    const key = l ?? "";
    let v = fala.byLingua.get(key);
    if (!v) {
      v = Promise.resolve().then(() => (l ? voz(l) : voz()));
      v.catch(() => {});
      fala.byLingua.set(key, v);
    }
    return v;
  }

  private async *gerar(
    frase: string,
    signal: AbortSignal,
    voz: (lingua?: FalaLingua) => VoiceAssets | Promise<VoiceAssets>,
    lingua: FalaLingua,
  ): AsyncGenerator<Int16Array> {
    if (signal.aborted) return;
    this.clearIdle();
    const id = `f${this.nextId++}`;
    const turn = new Turn();
    this.turns.set(id, turn);
    const onAbort = () => turn.notify();
    signal.addEventListener("abort", onAbort);
    let leftover = new Int16Array(0);
    try {
      const voice = this.voiceOf(signal, voz, lingua);
      const live = (turn.live = this.start());
      await Promise.race([live.ready, new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }))]);
      if (signal.aborted) return;
      let a: VoiceAssets;
      try {
        a = await voice;
      } catch (e) {
        throw new VoiceError(`kiwi-voice: sem a voz (${(e as Error).message})`);
      }
      if (signal.aborted) return;
      if (live.dead) throw new VoiceError("kiwi-voice: parado");
      live.child.write(
        JSON.stringify({ type: "speak", id, text: frase, voice: { refAudio: a.refAudio, refText: a.refText, language: a.language ?? "portuguese" } }),
      );
      for (;;) {
        if (signal.aborted) return;
        const c = turn.chunks.shift();
        if (c) {
          const all = concat(leftover, c);
          let off = 0;
          for (; off + VOICE_SLICE_SAMPLES <= all.length; off += VOICE_SLICE_SAMPLES) {
            yield all.slice(off, off + VOICE_SLICE_SAMPLES);
            if (signal.aborted) return;
          }
          leftover = all.slice(off);
          continue;
        }
        if (turn.end) {
          if (turn.end.error) throw turn.end.error;
          if (leftover.length > 0) yield leftover;
          return;
        }
        await turn.wait();
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      // Abortada (ou o player largou o iterador) antes do fim: o processo para de gerar essa frase.
      if (!turn.end && turn.live && !turn.live.dead) turn.live.child.write(JSON.stringify({ type: "cancel", id }));
      this.turns.delete(id);
      this.armIdle();
    }
  }

  /**
   * Aquece o processo sem falar nada (T26729): ele carrega o modelo e gera uma frase curta, que não vira PCM. Na 1ª vez
   * de um binário, o macOS compila os kernels Metal (~20 s no M1 Pro, T26732): o app manda isto quando o download
   * termina, para a 1ª fala não pagar esse tempo. Devolve os ms da geração; depois, o relógio do ocioso vale de novo.
   */
  async warmup(): Promise<number> {
    this.clearIdle();
    const live = this.start();
    let entry: { live: Live; resolve: (ms: number) => void; reject: (e: Error) => void } | undefined;
    try {
      await live.ready;
      return await new Promise<number>((resolve, reject) => {
        if (live.dead) return reject(new VoiceError("kiwi-voice: parado"));
        entry = { live, resolve, reject };
        this.warms.add(entry);
        live.child.write(JSON.stringify({ type: "warmup" }));
      });
    } finally {
      if (entry) this.warms.delete(entry);
      this.armIdle();
    }
  }

  /** Derruba o processo (o app saindo, ou a voz desligada nos Ajustes). */
  async stop(): Promise<void> {
    this.clearIdle();
    const live = this.live;
    if (!live || live.dead) return;
    this.live = null;
    live.dead = true;
    try {
      live.child.write(JSON.stringify({ type: "quit" }));
    } catch {}
    const t = setTimeout(() => live.child.kill("SIGKILL"), 2000);
    await live.child.exited;
    clearTimeout(t);
    // Só as frases deste processo: uma que chegou durante o `stop` já subiu outro.
    this.failAll(live, new VoiceError("kiwi-voice: parado"));
  }

  private start(): Live {
    if (this.live && !this.live.dead) return this.live;
    const t0 = performance.now();
    const child = (this.opts.spawn ?? spawnVoice)(this.opts.bin);
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => ((resolveReady = res), (rejectReady = rej)));
    ready.catch(() => {});
    const live: Live = { child, ready, dead: false };
    this.live = live;
    this.log("kiwi-voice: sobe");

    const loadTimeout = setTimeout(() => {
      rejectReady(new VoiceError("kiwi-voice: o modelo não carregou a tempo"));
      this.kill(live);
    }, this.opts.loadTimeoutMs ?? 120_000);

    const die = (reason: Error) => {
      clearTimeout(loadTimeout);
      rejectReady(reason);
      if (this.live === live) this.live = null;
      if (!live.dead) {
        live.dead = true;
        this.failAll(live, reason);
      }
    };

    (async () => {
      try {
        for await (const line of child.lines) {
          let m: Msg;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m.type === "ready") {
            clearTimeout(loadTimeout);
            this.log(`kiwi-voice: pronto em ${Math.round(performance.now() - t0)} ms (load ${m.loadMs} ms)`);
            resolveReady();
          } else if (m.type === "warm") {
            for (const w of this.warms) if (w.live === live) w.resolve(m.ms);
          } else if (m.type === "pcm") this.turns.get(m.id)?.push(decodePcm(m.pcm));
          else if (m.type === "done" || m.type === "cancelled") this.turns.get(m.id)?.finish();
          else if (m.type === "error") {
            if (m.id) this.turns.get(m.id)?.finish(new VoiceError(`kiwi-voice: ${m.message}`));
            else {
              // Sem id é o `load` (ou um comando que o processo não entendeu): sem modelo, nada fala.
              const e = new VoiceError(`kiwi-voice: ${m.message}`);
              die(e);
              this.kill(live);
            }
          }
        }
      } catch {}
      const code = await child.exited;
      die(new VoiceError(`kiwi-voice saiu (código ${code})`));
    })();

    (async () => {
      try {
        const a = await this.opts.assets();
        if (live.dead) return;
        child.write(
          JSON.stringify({
            type: "load",
            modelDir: a.modelDir,
            refAudio: a.refAudio,
            refText: a.refText,
            language: a.language ?? "portuguese",
            cacheMB: this.opts.cacheMB ?? VOICE_CACHE_MB,
          }),
        );
      } catch (e) {
        die(new VoiceError(`kiwi-voice: sem o modelo ou a voz (${(e as Error).message})`));
        this.kill(live);
      }
    })();
    return live;
  }

  private kill(live: Live) {
    try {
      live.child.kill("SIGKILL");
    } catch {}
  }

  private failAll(live: Live, e: Error) {
    for (const t of this.turns.values()) if (t.live === live) t.finish(e);
    for (const w of this.warms) if (w.live === live) w.reject(e);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdle() {
    this.clearIdle();
    if (this.turns.size > 0 || this.warms.size > 0 || !this.running) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.turns.size === 0 && this.warms.size === 0) {
        this.log("kiwi-voice: parado, sai e solta a memória");
        void this.stop();
      }
    }, this.idleMs);
    // O relógio do ocioso não segura o processo do app aberto.
    (this.idleTimer as { unref?: () => void }).unref?.();
  }
}

export function decodePcm(b64: string): Int16Array {
  const buf = Buffer.from(b64, "base64");
  const out = new Int16Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

function concat(a: Int16Array, b: Int16Array): Int16Array {
  if (a.length === 0) return b;
  const out = new Int16Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** O `Bun.spawn` de verdade: stdin e stdout são do protocolo, o stderr vai ao log do app. */
export function spawnVoice(bin: string, extraArgs: string[] = []): VoiceChild {
  const p = Bun.spawn([bin, ...extraArgs], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  return {
    write(line) {
      p.stdin.write(line + "\n");
      p.stdin.flush();
    },
    lines: splitLines(p.stdout),
    exited: p.exited,
    kill(signal = "SIGTERM") {
      p.kill(signal);
    },
  };
}

async function* splitLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  const reader = stream.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    buf += dec.decode(chunk, { stream: true });
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf) yield buf;
}
