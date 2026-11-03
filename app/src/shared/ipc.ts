// Contrato de IPC entre o app (main em Bun) e o sidecar Swift (native/).
// Decisão e motivos: docs/adr/0001-ipc.md. O lado Swift espelha estes tipos.
//
// Transporte: socket unix (0600). O Bun escuta e sobe o sidecar com
// `--socket <path>`; o sidecar conecta e sai sozinho quando o socket fecha.
// Framing: NDJSON, uma mensagem JSON por linha (`\n`), no máximo 1 MB por linha.
// Toda mensagem leva `v: 1` e `type`. Um comando com `id` recebe exatamente um
// `result` com o mesmo `id` (`data` se ok, um código em `error` se não). Eventos não levam `id`.
// O áudio cru nunca cruza o socket: gravação e STT ficam no sidecar.

import os from "node:os";
import path from "node:path";

export const IPC_VERSION = 1 as const;
export const MAX_LINE_BYTES = 1024 * 1024;

/** Onde fica o socket por padrão. */
export function defaultSocketPath(home = os.homedir()): string {
  return path.join(home, "Library", "Application Support", "KiwiNotes", "sidecar.sock");
}

// ---------------------------------------------------------------- tipos comuns

/**
 * A tecla do atalho. Os dois gestos ficam nela: segurar grava (push-to-talk) e
 * duas batidas travam a gravação ligada (toggle). O padrão sai do spec (Fn/🌐 ou ⌥ direito).
 */
export type HotkeyKey = "fn" | "rightOption" | "rightCommand" | "rightControl";

/** Sem `inputMonitoring` o event tap nasce, mas não recebe tecla: o atalho não funciona. */
export type Permission = "microphone" | "accessibility" | "inputMonitoring";
export type PermissionState = "granted" | "denied" | "restricted" | "undetermined";
export type Permissions = Record<Permission, PermissionState>;

/** Por que o LLM local (Apple Foundation Models) não está disponível. */
export type LlmUnavailableReason = "appleIntelligenceNotEnabled" | "deviceNotEligible" | "modelNotReady";
export interface LlmStatus {
  available: boolean;
  reason?: LlmUnavailableReason;
}

/** O que o overlay mostra. `level` vem do próprio sidecar (audio.level). */
export type OverlayState = "hidden" | "listening" | "processing" | "done" | "error";

/** Quem começou ou terminou a gravação. `config`: o atalho mudou no meio. */
/** `overlay`: o ✕ (cancelar) ou o ✓ (terminar) da pílula. */
export type RecordReason = "hotkey" | "command" | "config" | "overlay";

/** Como a gravação terminou: soltou a tecla, bateu de novo no toggle, ou pelo app. */
export type StopMode = "ptt" | "toggle" | "command";

// ---------------------------------------------------------- Bun → sidecar

export type Command =
  | { type: "ping" }
  | {
      type: "config.set";
      hotkey?: HotkeyKey;
      /** Quanto segurar até contar como push-to-talk. */
      holdThresholdMs?: number;
      /** Janela das duas batidas do toggle. */
      doubleTapMs?: number;
      /** Dica de idioma para o Parakeet (`auto`: nenhuma). */
      language?: "auto" | "pt" | "en";
      /**
       * O vocabulário do STT (T256): a grafia certa vai para o vocabulary boosting e para a correção
       * fonética; os `aliases` viram o termo depois (as substituições do VoiceInk). Uma string vale `{term}`.
       */
      dictionary?: (string | { term: string; aliases?: string[] })[];
      /** VAD (Silero) antes do modelo: só a fala vai para o STT, e áudio sem fala dá `text: ""`. Padrão: `false`. */
      vad?: boolean;
    }
  | { type: "record.start" }
  | { type: "record.stop" }
  | { type: "overlay.state"; state: OverlayState; message?: string }
  | { type: "insert.text"; text: string; restoreClipboard: boolean }
  | { type: "notify"; title: string; body: string }
  | { type: "permissions.request"; permission: Permission }
  /**
   * Uma resposta do Apple Foundation Models, sempre numa sessão nova (sem contexto entre chamadas).
   * `temperature: 0` é greedy. Passou de `timeoutMs`, o sidecar cancela e devolve `llm_timeout`.
   * Erros: `llm_unavailable` (com `data.reason`), `llm_timeout`, `llm_refused` (guardrail),
   * `llm_unsupported_language`, `llm_failed`. Só o modelo on-device (`SystemLanguageModel`), nunca o Private Cloud Compute.
   */
  | { type: "llm.complete"; system: string; prompt: string; maxTokens?: number; temperature?: number; timeoutMs?: number }
  /** Aquece o modelo com estas instruções. O Bun manda no `record.started`, antes da transcrição chegar. */
  | { type: "llm.prewarm"; system: string };

export type CommandType = Command["type"];

/** O que cada comando devolve no `result` quando dá certo. */
export interface CommandResults {
  ping: Record<string, never>;
  "config.set": { hotkey: HotkeyKey; hotkeyActive: boolean };
  "record.start": Record<string, never>;
  "record.stop": Record<string, never>;
  "overlay.state": Record<string, never>;
  /**
   * `pasted: false`: o texto ficou no clipboard, e o app avisa a pessoa. `reason` diz por quê:
   * `no_focus` (nada em foco), `no_text_field` (o foco é um botão etc.) ou `no_accessibility` (falta a permissão).
   * `pasted: true, restored: false, reason: "secure_input"`: o ⌘V foi, mas algum app segura o secure input e o
   * macOS pode tê-lo descartado; o texto continua no clipboard, e o clipboard antigo não volta.
   * `app` é o bundle id do app em foco.
   */
  "insert.text": {
    pasted: boolean;
    restored: boolean;
    reason?: "no_focus" | "no_text_field" | "no_accessibility" | "secure_input";
    app?: string;
  };
  notify: Record<string, never>;
  "permissions.request": { permission: Permission; state: PermissionState };
  "llm.complete": { text: string; ms: number };
  "llm.prewarm": Record<string, never>;
}

// ---------------------------------------------------------- sidecar → Bun

export type Event =
  | {
      type: "ready";
      version: string;
      pid: number;
      hotkey: HotkeyKey;
      /** `false` quando falta permissão e o atalho não recebe tecla. */
      hotkeyActive: boolean;
      permissions: Permissions;
      /** Texto para explicar cada permissão na UI. */
      permissionHelp?: Partial<Record<Permission, string>>;
      /** Se o LLM local está pronto. Opcional até o sidecar mandar (T52). */
      llm?: LlmStatus;
    }
  | { type: "permissions.changed"; permissions: Permissions; hotkeyActive: boolean; llm?: LlmStatus }
  | { type: "hotkey.down"; key: HotkeyKey }
  | { type: "hotkey.up"; key: HotkeyKey }
  | { type: "hotkey.toggle"; on: boolean }
  /** O sidecar começa a gravar sozinho no hotkey.down, para não perder a primeira sílaba. */
  | { type: "record.started"; reason: RecordReason }
  | { type: "record.stopped"; reason: RecordReason; mode: StopMode; durationMs: number; samples: number; audioPath?: string }
  /** Batida curta sozinha ou tecla usada como modificador (Fn+F5): esconda o overlay sem esperar transcrição. */
  | { type: "record.cancelled"; reason: RecordReason }
  /**
   * Não deu para gravar: sem microfone, sem permissão, ou `device_changed` (o mic trocou no meio).
   * Pode vir logo depois do `record.started`, que sai antes de o mic subir.
   */
  | { type: "record.error"; reason: RecordReason; error: string; microphone: PermissionState }
  /** Nível RMS de 0 a 1, ~30 Hz enquanto grava. Alimenta a onda do overlay. */
  | { type: "audio.level"; rms: number }
  /** App em foco, para ajustar o tom da limpeza. */
  | { type: "app.active"; bundleId: string; name: string }
  | { type: "transcript.partial"; text: string }
  /**
   * O texto de uma gravação, na ordem em que terminaram. `text` já passou pelo pós-processamento do VoiceInk
   * (filtro, correção fonética, aliases); `raw` é o do modelo. `lang`: `pt`, `en`, `mix`, ou `""` sem texto.
   * `latencyMs`: do fim da gravação até aqui.
   */
  | { type: "transcript.final"; text: string; raw: string; lang: "pt" | "en" | "mix" | ""; durationMs: number; latencyMs: number; audioPath?: string }
  /**
   * O modelo de STT: `loading` logo depois do `ready` (a primeira carga pode levar um minuto: download, ou o
   * CoreML compilando depois de atualizar o macOS), depois `ready` ou `unavailable`.
   */
  | { type: "stt.status"; state: "loading" | "ready" | "unavailable"; loadMs?: number; error?: "model_unavailable" }
  /** A gravação não virou texto: `model_unavailable` (sem modelo, ex.: offline na primeira vez) ou `stt_failed`. */
  | { type: "transcript.error"; error: "model_unavailable" | "stt_failed" }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string };

export type EventType = Event["type"];

// ---------------------------------------------------------- envelopes

export type CommandMessage<C extends Command = Command> = C & { v: typeof IPC_VERSION; id: string };
export type EventMessage<E extends Event = Event> = E & { v: typeof IPC_VERSION };

export type ResultMessage<T extends CommandType = CommandType> =
  | { v: typeof IPC_VERSION; type: "result"; id: string; ok: true; data: CommandResults[T] }
  /** `error` é um código curto: `not_implemented`, `unknown_type`, `unknown_hotkey`, `unknown_permission`, `bad_message`, `invalid_value`, `already_recording`, `llm_unavailable`, `llm_timeout`, `llm_refused`, `llm_unsupported_language`, `llm_failed`… */
  | { v: typeof IPC_VERSION; type: "result"; id: string; ok: false; error: string; data?: Record<string, unknown> };

export type Message = CommandMessage | EventMessage | ResultMessage;

const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandType>([
  "ping",
  "config.set",
  "record.start",
  "record.stop",
  "overlay.state",
  "insert.text",
  "notify",
  "permissions.request",
  "llm.complete",
  "llm.prewarm",
]);

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "ready",
  "permissions.changed",
  "hotkey.down",
  "hotkey.up",
  "hotkey.toggle",
  "record.started",
  "record.stopped",
  "record.cancelled",
  "record.error",
  "audio.level",
  "app.active",
  "transcript.partial",
  "transcript.final",
  "transcript.error",
  "stt.status",
  "log",
]);

export const isCommand = (m: Message): m is CommandMessage => COMMAND_TYPES.has(m.type);
export const isEvent = (m: Message): m is EventMessage => EVENT_TYPES.has(m.type);
export const isResult = (m: Message): m is ResultMessage => m.type === "result";

// ---------------------------------------------------------- framing

export class IpcError extends Error {
  constructor(
    readonly code: "line_too_long" | "bad_json" | "bad_message" | "bad_version",
    message: string,
  ) {
    super(message);
    this.name = "IpcError";
  }
}

const encoder = new TextEncoder();

/** Serializa uma mensagem numa linha NDJSON (com o `\n`). */
export function encode(message: Message): string {
  const line = `${JSON.stringify(message)}\n`;
  if (encoder.encode(line).byteLength > MAX_LINE_BYTES) {
    throw new IpcError("line_too_long", `message ${message.type} passes ${MAX_LINE_BYTES} bytes`);
  }
  return line;
}

/** Valida uma linha já sem o `\n`. */
export function parseLine(line: string): Message {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new IpcError("bad_json", "line isn't JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IpcError("bad_message", "message isn't an object");
  }
  const m = value as Record<string, unknown>;
  if (m.v !== IPC_VERSION) throw new IpcError("bad_version", `unsupported version ${String(m.v)}`);
  if (typeof m.type !== "string") throw new IpcError("bad_message", "message has no type");
  if (m.type === "result") {
    if (typeof m.id !== "string" || typeof m.ok !== "boolean") throw new IpcError("bad_message", "result needs id and ok");
  } else if (COMMAND_TYPES.has(m.type)) {
    if (typeof m.id !== "string") throw new IpcError("bad_message", `command ${m.type} needs an id`);
  } else if (!EVENT_TYPES.has(m.type)) {
    throw new IpcError("bad_message", `unknown type ${m.type}`);
  }
  return m as unknown as Message;
}

/**
 * Junta os pedaços que chegam do socket em mensagens. Uma linha ruim vira um
 * erro em `onError` e não derruba as próximas; uma linha longa demais é descartada
 * até o próximo `\n`.
 */
export class LineDecoder {
  private buffer = "";
  private bufferBytes = 0;
  private discarding = false;
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly onMessage: (m: Message) => void,
    private readonly onError: (e: IpcError) => void = () => {},
  ) {}

  push(chunk: Uint8Array | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
      this.append(text.slice(start, nl));
      this.flushLine();
      start = nl + 1;
    }
    this.append(text.slice(start));
  }

  private append(part: string): void {
    if (this.discarding || part.length === 0) return;
    this.bufferBytes += encoder.encode(part).byteLength;
    if (this.bufferBytes > MAX_LINE_BYTES) {
      this.discarding = true;
      this.buffer = "";
      this.onError(new IpcError("line_too_long", `line passes ${MAX_LINE_BYTES} bytes`));
      return;
    }
    this.buffer += part;
  }

  private flushLine(): void {
    const line = this.buffer;
    const skipped = this.discarding;
    this.buffer = "";
    this.bufferBytes = 0;
    this.discarding = false;
    if (skipped || line.trim() === "") return;
    try {
      this.onMessage(parseLine(line));
    } catch (e) {
      this.onError(e instanceof IpcError ? e : new IpcError("bad_message", String(e)));
    }
  }
}
