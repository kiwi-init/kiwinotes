// O fluxo do ditado no Bun (T58): o `transcript.final` do sidecar vira texto limpo no app da pessoa.
//
//   record.started  → guarda o app da frente (é para ele que o texto vai) e aquece o LLM, se ele estiver ligado
//   transcript.final → limpeza (regras + LLM opcional, tom pelo app) → snippets → insert.text → histórico
//                      → pílula em done (ou error, com o motivo)
//
// Os ditados são tratados um por vez, na ordem em que chegaram, para dois textos nunca se misturarem.

import { cleanup, llmSystemMessage } from "../cleanup/index.ts";
import type { LlmBackend, LlmMode, Tone } from "../cleanup/types.ts";
import type { AppRef, Command, Event, EventMessage, ResultMessage } from "../shared/ipc.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { HistoryEntry, NewHistoryEntry } from "../store/history.ts";
import { expandSnippets, type Snippet } from "../store/snippets.ts";
import { toneFor } from "../cleanup/tone.ts";

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
/** O mic caiu e o que ele ouviu não tinha fala. */
export const MIC_LOST_EMPTY = "Sem áudio do microfone";
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
}

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
  private recordings: { app?: AppRef; lost?: string }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private offs: (() => void)[] = [];
  /** Avisa cada ditado terminado, inclusive o vazio e o que deu erro (testes, a ação `debug-transcribe`). */
  onDone?: (outcome: DictationOutcome) => void;

  constructor(private readonly options: DictationOptions) {}

  attach(): void {
    const { sidecar } = this.options;
    this.offs.push(
      sidecar.on("app.active", (e) => {
        this.activeApp = { bundleId: e.bundleId, name: e.name };
      }),
      sidecar.on("record.started", (e) => {
        const app = e.app ?? this.activeApp;
        this.recordings.push({ app });
        this.prewarm(app);
      }),
      // A gravação que acabou de começar não vai ter texto.
      sidecar.on("record.cancelled", () => void this.recordings.pop()),
      sidecar.on("record.error", () => void this.recordings.pop()),
      // O mic caiu, mas o que ele ouviu vai ser transcrito: a pílula avisa no fim.
      sidecar.on("record.stopped", (e) => {
        const last = this.recordings.at(-1);
        if (e.lost && last) last.lost = e.lost;
      }),
      sidecar.on("transcript.final", (e) => {
        const recording = this.recordings.shift();
        this.enqueue(() => this.handle(e, recording?.app ?? this.activeApp, recording?.lost));
      }),
      sidecar.on("transcript.error", (e) => {
        this.recordings.shift();
        this.enqueue(async () => {
          await this.overlay("error", TRANSCRIPT_ERROR[e.error] ?? TRANSCRIPT_ERROR.stt_failed);
          this.onDone?.({ text: "", pasted: false, skipped: "error", error: e.error, appMs: 0 });
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

  /** Com o LLM ligado, aquece o Foundation Models com o prompt certo enquanto a pessoa fala. */
  private prewarm(app: AppRef | undefined) {
    const { llm, llmMode = "off" } = this.options;
    if (llmMode === "off" || !llm?.available() || llm.name !== "foundation-models") return;
    const tone = toneFor(app?.bundleId);
    if (tone === "literal") return;
    void this.options.sidecar.send({ type: "llm.prewarm", system: llmSystemMessage(tone, this.dictionary) }).catch(() => {});
  }

  private async handle(t: Transcript, app: AppRef | undefined, lost?: string): Promise<void> {
    const started = performance.now();
    const empty = async () => {
      // Sem fala depois de o mic cair: o mesmo aviso de antes do T883, em vez de sumir sem dizer nada.
      await (lost ? this.overlay("error", MIC_LOST_EMPTY) : this.overlay("hidden"));
      this.onDone?.({ text: "", pasted: false, skipped: "empty", appMs: Math.round(performance.now() - started) });
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
      insert = await this.options.sidecar.send(this.options.dryRun ? { ...command, dryRun: true } : command);
    } catch (e) {
      insert = { v: 1, type: "result", id: "", ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    // Um dryRun conta como colado: o teste segue o caminho de um ditado que deu certo.
    const pasted = insert.ok && (insert.data.pasted || insert.data.dryRun === true);
    if (!insert.ok) await this.overlay("error", "Não deu para colar o texto");
    else if (insert.data.dryRun) await this.overlay("done");
    else if (!insert.data.pasted) await this.overlay("error", NOT_PASTED[insert.data.reason ?? ""] ?? NOT_PASTED.no_focus);
    else if (insert.data.reason === "secure_input") await this.overlay("done", SECURE_INPUT_NOTICE);
    else if (lost) await this.overlay("done", MIC_LOST_NOTICE);
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
      `dictation: stt ${t.latencyMs} ms + app ${appMs} ms (cleanup ${result.ms} ms${result.llm ? `, llm ${result.llm.used ? "used" : result.llm.reason}` : ""}) · ${result.tone} · ${insert.ok && insert.data.dryRun ? "dry run" : pasted ? "pasted" : `not pasted${insert.ok ? `: ${insert.data.reason}` : `: ${insert.error}`}`}`,
    );
    this.onDone?.({ entry, text, tone: result.tone, pasted, appMs });
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
