// O fluxo do ditado no Bun (T58): o `transcript.final` do sidecar vira texto limpo no app da pessoa.
//
//   record.started  → guarda o app da frente (é para ele que o texto vai) e aquece o LLM, se ele estiver ligado
//   transcript.final → limpeza (regras + LLM opcional, tom pelo app) → snippets → insert.text → histórico
//                      → pílula em done (ou error, com o motivo)
//
// Os ditados são tratados um por vez, na ordem em que chegaram, para dois textos nunca se misturarem.

import { cleanup, llmSystemMessage } from "../cleanup/index.ts";
import type { LlmBackend, LlmMode, Tone } from "../cleanup/types.ts";
import type { AppRef, Command, Event, EventMessage, InsertSimulation, ResultMessage } from "../shared/ipc.ts";
import { sanitizeMicInUse } from "../shared/microphone.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, NewHistoryEntry } from "../store/history.ts";
import { expandSnippets, type Snippet } from "../store/snippets.ts";
import { toneFor } from "../cleanup/tone.ts";
import type { ToNoteResult } from "../notes/fromDictation.ts";

type Transcript = Extract<Event, { type: "transcript.final" }>;
type InsertResult = ResultMessage<"insert.text">;

/** O pedaço do `Sidecar` que o fluxo usa (os testes passam um falso). */
export interface DictationSidecar {
  send<C extends Command>(command: C): Promise<ResultMessage<C["type"]>>;
  on<T extends Event["type"]>(type: T, fn: (e: EventMessage<Extract<Event, { type: T }>>) => void): () => void;
}

export interface DictationOptions {
  sidecar: DictationSidecar;
  history: { add(entry: NewHistoryEntry): Promise<HistoryEntry> };
  llm?: LlmBackend;
  llmMode?: LlmMode;
  /** Devolver o clipboard da pessoa depois de colar. Padrão: sim. */
  restoreClipboard?: boolean;
  /** Testes de agente (`KIWI_DEBUG=1`): o `insert.text` vai com `dryRun`, sem tocar no clipboard nem no teclado. */
  dryRun?: boolean;
  log?: (message: string) => void;
  /** A nota rápida (T1320): um ditado com `target: "note"` vira uma nota nova, em vez de ser colado. */
  notes?: { toNew(text: string, at: Date, id: string, options?: { fresh?: boolean }): Promise<ToNoteResult> };
}

/** O que a pílula diz quando o texto não foi colado (ele ficou no clipboard). */
export const NOT_PASTED: Record<string, string> = {
  no_focus: "Nenhum campo em foco: está no clipboard",
  no_text_field: "Não é um campo de texto: está no clipboard",
  no_accessibility: "Falta a Acessibilidade: está no clipboard",
};
/** Com secure input o ⌘V pode ter sido descartado: o texto fica no clipboard, e o antigo não volta (#224). */
export const SECURE_INPUT_NOTICE = "O texto também ficou no clipboard";
/** O mic caiu no meio do ditado: o que ele ouviu até ali foi transcrito, em vez de ir para o lixo (T883). */
export const MIC_LOST_NOTICE = "O microfone caiu: transcrevi até aqui";
/** O mic escolhido nos Ajustes não estava conectado, e o ditado gravou por outro (T3344, spec #3202). */
/**
 * O mic escolhido não estava conectado e o ditado gravou por outro (T3344). A pílula tem uma linha de 38 letras
 * (`OverlayModel.maxMessageLength`): o do Mac e o padrão cabem inteiros; o nome de outro mic pode sair cortado.
 */
export const micFellBackNotice = (mic: string) => `Mic escolhido ausente: usei o ${mic}`;
/** Como o aviso chama o mic: "do Mac", "padrão" ou o nome. */
export const micShortName = (m: { name: string; transport: string | null; systemDefault: boolean }) =>
  m.transport === "builtin" ? "do Mac" : m.systemDefault || !m.name ? "padrão" : m.name;
/** O mic caiu e o que ele ouviu não tinha fala. */
export const MIC_LOST_EMPTY = "Sem áudio do microfone";
/** A nota rápida deu certo: a pílula diz o título. */
export const noteCreated = (title: string) => `Virou nota: ${title}`;
/** A nota rápida não deu: o texto não se perde, fica no Histórico. */
export const NOTE_FAILED = "Não deu para criar a nota: o texto está no Histórico";
export const TRANSCRIPT_ERROR: Record<string, string> = {
  model_unavailable: "O modelo de voz não está pronto",
  stt_failed: "Não deu para transcrever",
};

export interface DictationOutcome {
  entry?: HistoryEntry;
  text: string;
  tone?: Tone;
  pasted: boolean;
  /** `empty`: sem fala, nada colado nem guardado. `error`: o `transcript.error` (com o código em `error`). */
  skipped?: "empty" | "error";
  error?: string;
  /** Da chegada do transcript até a pílula em `done`. */
  appMs: number;
  /** A nota rápida: a nota que o ditado virou (T1320). */
  note?: ToNoteResult;
  /** O que o STT deu (antes da limpeza) e quanto ele levou (T1740). */
  raw?: string;
  sttMs?: number;
  /** O app do ditado (o tom sai dele). */
  app?: AppRef;
  /** O que o `insert.text` faria (T1740: só com `simulate`, no dryRun): o plano, o motivo e o espaço automático. */
  insert?: { plan?: string; reason?: string; autoSpace: boolean; spaced?: boolean; error?: string };
}

/** Um ditado da CLI dos agentes (T1740): o app da frente, a nota rápida e o campo descrito. Nunca cola de verdade. */
export interface SimulatedDictation {
  app?: AppRef;
  note?: boolean;
  simulate?: InsertSimulation;
}

type Recording = {
  app?: AppRef;
  lost?: string;
  note?: boolean;
  simulate?: InsertSimulation;
  /** O mic salvo não estava conectado e gravou por este (T3344): o fim avisa. */
  fellBackTo?: string;
  done?: (o: DictationOutcome) => void;
};

/** Um ditado que não chegou a texto (a gravação caiu, o STT falhou, o helper reiniciou). */
const failed = (error: string): DictationOutcome => ({ text: "", pasted: false, skipped: "error", error, appMs: 0 });

export class Dictation {
  private dictionary: DictionaryTerm[] = [];
  private snippets: Snippet[] = [];
  /** O app da frente agora (`app.active`). */
  private activeApp?: AppRef;
  /**
   * O app de cada gravação que ainda espera o texto, na ordem (`record.started`). Uma gravação nova pode começar
   * antes de chegar o texto da anterior, e cada texto sai com o tom do app em que foi ditado (review #521).
   */
  /** As gravações à espera do texto, na ordem: o app da frente e, se o mic caiu no meio, o código (T883). */
  private recordings: Recording[] = [];
  /** Os `dictateWav` à espera do `record.started` do `debug.transcribe` deles, na ordem. */
  private pendingWav: Recording[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private offs: (() => void)[] = [];
  /** Avisa cada ditado terminado, inclusive o vazio e o que deu erro (testes, a ação `debug-transcribe`). */
  onDone?: (outcome: DictationOutcome) => void;

  constructor(private readonly options: DictationOptions) {}

  attach(): void {
    const { sidecar } = this.options;
    this.offs.push(
      // Um helper novo (restart depois de cair): as gravações do anterior não vão ter texto. Sem isso, cada ditado
      // dali em diante sairia com o app e o tom do ditado anterior (T914).
      sidecar.on("ready", () => {
        for (const r of [...this.recordings, ...this.pendingWav]) r.done?.(failed("helper_restarted"));
        this.recordings = [];
        this.pendingWav = [];
      }),
      sidecar.on("app.active", (e) => {
        this.activeApp = { bundleId: e.bundleId, name: e.name };
      }),
      sidecar.on("record.started", (e) => {
        const app = e.app ?? this.activeApp;
        const note = e.target === "note" && !!this.options.notes;
        const cli = e.reason === "debug" ? this.pendingWav.shift() : undefined;
        const mic = sanitizeMicInUse(e.microphone);
        // Com a tampa fechada o escolhido (o mic do Mac) está conectado, só não grava: a Ajustes explica, a pílula não.
        const fellBackTo = mic?.fellBack && !mic.lidClosed ? micShortName(mic) : undefined;
        this.recordings.push({ app, note, simulate: cli?.simulate, done: cli?.done, ...(fellBackTo ? { fellBackTo } : {}) });
        // A nota não leva o tom do app da frente (um terminal daria o tom literal): o prewarm é o do tom padrão.
        this.prewarm(note ? undefined : app);
      }),
      // A gravação que acabou de começar não vai ter texto.
      sidecar.on("record.cancelled", () => void this.recordings.pop()?.done?.(failed("record_cancelled"))),
      sidecar.on("record.error", () => void this.recordings.pop()?.done?.(failed("record_error"))),
      // O mic caiu, mas o que ele ouviu vai ser transcrito: a pílula avisa no fim.
      sidecar.on("record.stopped", (e) => {
        const last = this.recordings.at(-1);
        if (e.lost && last) last.lost = e.lost;
      }),
      sidecar.on("transcript.final", (e) => {
        const recording = this.recordings.shift();
        const app = recording?.app ?? this.activeApp;
        this.enqueue(async () => {
          const outcome = await (recording?.note ? this.handleNote(e, app, recording.lost) : this.handle(e, app, recording?.lost, recording?.simulate, recording?.fellBackTo));
          recording?.done?.(outcome);
        });
      }),
      sidecar.on("transcript.error", (e) => {
        const recording = this.recordings.shift();
        this.enqueue(async () => {
          await this.overlay("error", TRANSCRIPT_ERROR[e.error] ?? TRANSCRIPT_ERROR.stt_failed);
          const outcome = this.done(failed(e.error));
          recording?.done?.(outcome);
        });
      }),
    );
  }

  detach(): void {
    for (const off of this.offs.splice(0)) off();
  }

  setDictionary(terms: DictionaryTerm[]): void {
    this.dictionary = terms;
  }

  setSnippets(snippets: Snippet[]): void {
    this.snippets = snippets;
  }

  /** Espera os ditados na fila (testes). */
  idle(): Promise<unknown> {
    return this.queue;
  }

  private enqueue(job: () => Promise<unknown>) {
    this.queue = this.queue.then(job).catch((e) => this.log(`dictation failed: ${String(e)}`));
  }

  private done(outcome: DictationOutcome): DictationOutcome {
    this.onDone?.(outcome);
    return outcome;
  }

  /**
   * A CLI dos agentes (T1740): um transcript dado, sem STT, pelo mesmo caminho de um ditado (limpeza, snippets,
   * `insert.text` em dryRun, Histórico, nota rápida). Entra na fila como os outros.
   */
  dictateText(text: string, request: SimulatedDictation = {}): Promise<DictationOutcome> {
    const t: Transcript = { type: "transcript.final", text, raw: text, lang: "", durationMs: 0, latencyMs: 0 };
    return new Promise((resolve, reject) => {
      this.enqueue(() =>
        (request.note && this.options.notes ? this.handleNote(t, request.app) : this.handle(t, request.app, undefined, request.simulate ?? {})).then(
          resolve,
          reject,
        ),
      );
    });
  }

  /**
   * A CLI dos agentes (T1740): um WAV (áudio sintético) pelo `debug.transcribe` do helper, que faz o STT de verdade e
   * manda os mesmos eventos de uma gravação. Resolve com o ditado dele.
   */
  async dictateWav(path: string, request: SimulatedDictation = {}): Promise<DictationOutcome> {
    let recording!: Recording;
    const outcome = new Promise<DictationOutcome>((resolve) => {
      recording = { simulate: request.simulate ?? {}, done: resolve };
    });
    this.pendingWav.push(recording);
    const command = {
      type: "debug.transcribe" as const,
      path,
      ...(request.app ? { app: request.app } : {}),
      ...(request.note ? { target: "note" as const } : {}),
    };
    const result = await this.options.sidecar.send(command).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!result.ok) {
      this.pendingWav = this.pendingWav.filter((r) => r !== recording);
      throw new Error(result.error);
    }
    return outcome;
  }

  /** Com o LLM ligado, aquece o Foundation Models com o prompt certo enquanto a pessoa fala. */
  private prewarm(app: AppRef | undefined) {
    const { llm, llmMode = "off" } = this.options;
    if (llmMode === "off" || !llm?.available() || llm.name !== "foundation-models") return;
    const tone = toneFor(app?.bundleId);
    if (tone === "literal") return;
    void this.options.sidecar.send({ type: "llm.prewarm", system: llmSystemMessage(tone, this.dictionary) }).catch(() => {});
  }

  private async handle(t: Transcript, app: AppRef | undefined, lost?: string, simulate?: InsertSimulation, fellBackTo?: string): Promise<DictationOutcome> {
    const started = performance.now();
    const empty = async () => {
      // Sem fala depois de o mic cair: o mesmo aviso de antes do T883, em vez de sumir sem dizer nada.
      await (lost ? this.overlay("error", MIC_LOST_EMPTY) : this.overlay("hidden"));
      return this.done({ text: "", raw: t.text, sttMs: t.latencyMs, app, pasted: false, skipped: "empty", appMs: Math.round(performance.now() - started) });
    };
    // Sem fala (gravação vazia ou só ruído com o VAD): nada para colar nem guardar.
    if (!t.text.trim()) return empty();

    const result = await cleanup(
      { raw: t.text, bundleId: app?.bundleId, dictionary: this.dictionary },
      { llm: this.options.llm, llmMode: this.options.llmMode ?? "off" },
    );
    // Os snippets entram depois da limpeza, para o texto deles sair exatamente como a pessoa escreveu.
    const text = expandSnippets(result.text, this.snippets);
    if (!text.trim()) return empty();

    let insert: InsertResult;
    try {
      // No terminal (tom literal), nada de espaço automático: o cursor da Acessibilidade não acompanha o do shell, e
      // um comando que começa com espaço fica fora do histórico do zsh e do bash (HIST_IGNORE_SPACE, ignorespace).
      const command = {
        type: "insert.text" as const,
        text,
        restoreClipboard: this.options.restoreClipboard ?? true,
        autoSpace: result.tone !== "literal",
      };
      // Um ditado simulado (a CLI, T1740) nunca cola de verdade, nem num app sem dryRun.
      insert = await this.options.sidecar.send(simulate ? { ...command, dryRun: true, simulate } : this.options.dryRun ? { ...command, dryRun: true } : command);
    } catch (e) {
      insert = { v: 1, type: "result", id: "", ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    // Um dryRun conta como colado: o teste segue o caminho de um ditado que deu certo.
    const pasted = insert.ok && (insert.data.pasted || insert.data.dryRun === true);
    if (!insert.ok) await this.overlay("error", "Não deu para colar o texto");
    // O mic escolhido não estava conectado (T3344): avisa por qual gravou. Também no dryRun, para o teste ver.
    else if (insert.data.dryRun) await this.overlay("done", fellBackTo && micFellBackNotice(fellBackTo));
    else if (!insert.data.pasted) await this.overlay("error", NOT_PASTED[insert.data.reason ?? ""] ?? NOT_PASTED.no_focus);
    // Colou, mas o texto ficou também no clipboard: secure input, ou um foco que não parece campo de texto (T984).
    else if (insert.data.reason) await this.overlay("done", SECURE_INPUT_NOTICE);
    else if (lost) await this.overlay("done", MIC_LOST_NOTICE);
    else if (fellBackTo) await this.overlay("done", micFellBackNotice(fellBackTo));
    else await this.overlay("done");
    const appMs = Math.round(performance.now() - started);

    let entry: HistoryEntry | undefined;
    try {
      entry = await this.options.history.add({
        raw: t.text,
        text,
        app: app ? { bundleId: app.bundleId, name: app.name } : undefined,
        tone: result.tone,
        lang: t.lang || undefined,
        durationMs: t.durationMs,
        audioPath: t.audioPath,
      });
    } catch (e) {
      this.log(`history add failed: ${String(e)}`);
    }
    this.log(
      `dictation: stt ${t.latencyMs} ms + app ${appMs} ms (cleanup ${result.ms} ms${result.llm ? `, llm ${result.llm.used ? "used" : result.llm.reason}` : ""}) · ${result.tone} · ${insert.ok && insert.data.dryRun ? "dry run" : pasted ? `pasted${insert.ok && insert.data.reason ? ` (${insert.data.reason})` : ""}` : `not pasted${insert.ok ? `: ${insert.data.reason}` : `: ${insert.error}`}`}${insert.ok && insert.data.focusVia ? ` · focus ${insert.data.focusVia}` : ""}`,
    );
    return this.done({
      entry,
      text,
      raw: t.text,
      sttMs: t.latencyMs,
      app,
      tone: result.tone,
      pasted,
      appMs,
      insert: insert.ok
        ? { plan: insert.data.plan, reason: insert.data.reason, autoSpace: result.tone !== "literal", spaced: insert.data.spaced }
        : { autoSpace: result.tone !== "literal", error: insert.error },
    });
  }

  /**
   * A nota rápida (T1320): limpa e expande como um ditado normal, mas no tom padrão, e o texto vira uma nota nova em
   * `Caixa de entrada/` em vez de ser colado. Vai para o Histórico do mesmo jeito: se a nota falhar, nada se perde.
   */
  private async handleNote(t: Transcript, app: AppRef | undefined, lost?: string): Promise<DictationOutcome> {
    const started = performance.now();
    const base = { raw: t.text, sttMs: t.latencyMs, app };
    if (!t.text.trim()) {
      await (lost ? this.overlay("error", MIC_LOST_EMPTY) : this.overlay("hidden"));
      return this.done({ ...base, text: "", pasted: false, skipped: "empty", appMs: Math.round(performance.now() - started) });
    }
    const result = await cleanup({ raw: t.text, dictionary: this.dictionary }, { llm: this.options.llm, llmMode: this.options.llmMode ?? "off" });
    const text = expandSnippets(result.text, this.snippets);
    if (!text.trim()) {
      await this.overlay("hidden");
      return this.done({ ...base, text: "", pasted: false, skipped: "empty", appMs: Math.round(performance.now() - started) });
    }
    const at = new Date();
    // Primeiro o Histórico, para a nota levar o id do ditado (T1565): um "Enviar para nota" depois reconhece o trecho.
    let entry: HistoryEntry | undefined;
    try {
      entry = await this.options.history.add({
        raw: t.text,
        text,
        app: app ? { bundleId: app.bundleId, name: app.name } : undefined,
        tone: result.tone,
        lang: t.lang || undefined,
        durationMs: t.durationMs,
        audioPath: t.audioPath,
        at,
      });
    } catch (e) {
      this.log(`history add failed: ${String(e)}`);
    }
    let note: ToNoteResult | undefined;
    try {
      // Sem o Histórico, um id só desta nota: ela não tem como ser mandada de novo.
      const id = entry?.id ?? `note-${at.toISOString()}-${Math.random().toString(16).slice(2, 6)}`;
      note = await this.options.notes!.toNew(text, at, id, { fresh: true });
      await this.overlay("done", noteCreated(note.note.title));
    } catch (e) {
      this.log(`quick note failed: ${String(e)}`);
      await this.overlay("error", NOTE_FAILED);
    }
    const appMs = Math.round(performance.now() - started);
    this.log(`quick note: stt ${t.latencyMs} ms + app ${appMs} ms · ${note ? `${note.created ? "created" : "already in"} ${note.note.path}` : "failed"}`);
    return this.done({ ...base, entry, text, tone: result.tone, pasted: false, appMs, note });
  }

  private async overlay(state: "hidden" | "done" | "error", message?: string) {
    try {
      await this.options.sidecar.send(message ? { type: "overlay.state", state, message } : { type: "overlay.state", state });
    } catch {
      // Sem sidecar não há pílula para mexer.
    }
  }

  private log(message: string) {
    (this.options.log ?? console.log)(`[dictation] ${message}`);
  }
}
