import type { SpellingResult } from "./spelling.ts";
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

import type { AudioInputs, MicrophoneChoice } from "./microphone.ts";

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
export type Permission = "microphone" | "accessibility" | "inputMonitoring" | "systemAudio";
export type PermissionState = "granted" | "denied" | "restricted" | "undetermined";
export type Permissions = Record<Exclude<Permission, "systemAudio">, PermissionState> & { systemAudio?: PermissionState };

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
/** `escape`: o atalho de cancelar (o Esc) durante a gravação (L5, T5458). */
export type RecordReason = "hotkey" | "command" | "config" | "overlay" | "debug" | "escape";

/** Como a gravação terminou: soltou a tecla, bateu de novo no toggle, ou pelo app. */
export type StopMode = "ptt" | "toggle" | "command" | "debug";

/** Um app do Mac, pelo bundle id. */
export interface AppRef {
  bundleId: string;
  name: string;
}

// ---------------------------------------------------------- Bun → sidecar

export interface RecordingRef { id:string;at:string }
export interface RecoveredTranscript { text:string;raw:string;lang:"pt"|"en"|"mix"|"";durationMs:number;latencyMs:number }

export type Command =
  | { type: "ping" }
  | { type: "spelling.check"; word: string; language?: string }
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
       * fonética. Os `aliases` também entram na correção fonética, que pega uma forma parecida com o alias, e
       * depois viram o termo (as substituições do VoiceInk; T591). Uma string vale `{term}`.
       */
      dictionary?: (string | { term: string; aliases?: string[] })[];
      /**
       * O atalho que abre a janela Notas (T1499): "control+option+n" (os modificadores e uma letra ou um dígito,
       * com pelo menos ⌃, ⌥ ou ⌘), ou null para desligar. Sem ele, o helper não vigia combinação nenhuma.
       */
      notesShortcut?: string | null;
      /** VAD (Silero) antes do modelo: só a fala vai para o STT, e áudio sem fala dá `text: ""`. Padrão: `false`. */
      vad?: boolean;
      /**
       * Por qual entrada gravar (spec #3202, T3229/T3230): "auto" (padrão; com a saída em Bluetooth, outro mic), "builtin",
       * "system" (o padrão do macOS) ou "uid:<UID do CoreAudio>". Um UID que sumiu volta para o automático, com aviso
       * no overlay. Vai num `config.set` só dele: um helper antigo que recusa o campo não derruba os outros.
       */
      microphone?: MicrophoneChoice;
      /**
       * R2 (#195): o atalho de gravar e parar a reunião e o de "pausar meu mic", no formato do `notesShortcut`, ou null
       * para desligar. Sem eles, o helper usa ⌃⌥R e ⌃⌥M.
       */
      meetingShortcut?: string | null;
      meetingPauseShortcut?: string | null;
      /**
       * T5349 (#175): os atalhos globais, cada um no texto de `shared/shortcuts.ts` ("fn", "double:rightCommand",
       * "control+option+r", "control+k r r"), ou null para desligar. Só os dados mudam. Substitui o `hotkey`, o
       * `notesShortcut`, o `meetingShortcut` e o `meetingPauseShortcut`, que ainda valem.
       */
      shortcuts?: Partial<Record<"dictation" | "cancel" | "pasteLast" | "notes" | "meeting" | "meetingPause", string | null>>;
      /** O pop-up "Gravar esta reunião?" (padrão: ligado). Desligado, o atalho ainda grava. */
      meetingSuggest?: boolean;
      /** Os apps que contam como reunião (substitui a lista padrão: Teams, Zoom, Webex, Slack, FaceTime e os navegadores). */
      meetingApps?: MeetingApp[];
    }
  | { type: "meeting.start"; app?: string; chunkDuration?: number }
  | { type: "meeting.stop" }
  | { type: "meeting.pauseMine" }
  | { type: "meeting.resumeMine" }
  | { type: "meeting.pending" }
  /** Um botão do painel de reunião, vindo do app (o card do hub no R6, ou um teste): o mesmo que o clique no pop-up. */
  | { type: "meeting.answer"; answer: MeetingAnswer }
  /** Delete whole chunks ending before the final watermark minus the ASR look-behind (2 s by default). */
  | { type: "meeting.ack"; session: string; channel: "mine" | "system"; finalThroughFrame: number; contextFrames?: number }
  | { type: "dictation.retry"; recordingId:string }
  | { type: "record.start" }
  | { type: "record.stop" }
  /** `message` vale no `error` e no `done` (secure input, #224): com mensagem, o `done` fica 2,5 s em vez de 0,7 s. */
  | { type: "overlay.state"; state: OverlayState; message?: string }
  /**
   * `dryRun: true` (os testes de agente, #490): o sidecar não toca no clipboard nem no teclado e responde
   * `{pasted: false, restored: false, dryRun: true, app?}`. O app conta isso como colado.
   * `autoSpace` (padrão `true`, T733): se o cursor está logo depois de um texto (letra, número, pontuação), o sidecar
   * põe um espaço na frente, para dois ditados seguidos não saírem grudados. Ele lê só os dois caracteres antes do
   * cursor, pela Acessibilidade; se o campo não diz, não põe nada. O app manda `false` no tom literal (terminal).
   */
  | { type: "insert.text"; text: string; restoreClipboard: boolean; autoSpace?: boolean; dryRun?: boolean; simulate?: InsertSimulation }
  | { type: "notify"; title: string; body: string }
  /**
   * Pede a permissão: o diálogo do macOS na primeira vez, os Ajustes depois. `reset: true` (só no clique de uma pessoa no
   * menu, nunca sozinho nem com KIWI_DEBUG=1) apaga a entrada do app (`tccutil reset`) e pede de novo, para a chave que
   * aparece ligada nos Ajustes mas não vale (T658). O sidecar só apaga se a permissão já foi pedida e segue faltando,
   * e nunca quando o app responsável não é o Kiwi Notes.app (`app.kiwinotes.desktop`): pelo probe num terminal, o
   * reset tiraria a permissão do terminal (review #693). O clique sempre termina em algo visível (T825): depois do
   * diálogo, abre os Ajustes (Acessibilidade e Monitoramento de Entrada sempre; o microfone se o diálogo não apareceu).
   */
  | { type: "permissions.request"; permission: Permission; reset?: boolean }
  /**
   * Uma resposta do Apple Foundation Models, sempre numa sessão nova (sem contexto entre chamadas).
   * `temperature: 0` é greedy. Passou de `timeoutMs`, o sidecar cancela e devolve `llm_timeout`.
   * Erros: `llm_unavailable` (com `data.reason`), `llm_timeout`, `llm_refused` (guardrail),
   * `llm_unsupported_language`, `llm_failed`. Só o modelo on-device (`SystemLanguageModel`), nunca o Private Cloud Compute.
   */
  | { type: "llm.complete"; system: string; prompt: string; maxTokens?: number; temperature?: number; timeoutMs?: number }
  /** Aquece o modelo com estas instruções. O Bun manda no `record.started`, antes da transcrição chegar. */
  | { type: "llm.prewarm"; system: string }
  /** As entradas de áudio e a saída padrão (T3229/T3230), para o seletor dos Ajustes. Só lista: não abre a entrada. */
  | { type: "audio.inputs" }
  /**
   * "Aperte o atalho" das Configurações (T5349): o tap do helper lê as teclas (o WebView não vê o Fn nem o lado dos
   * modificadores) e responde quando a pessoa termina. Enquanto isso, nenhum atalho dispara.
   */
  /** `bareKey`: gravando o cancelar (L5), onde ⌫ ou ↩ sozinhos também valem. */
  | { type: "shortcut.record"; bareKey?: boolean }
  | { type: "shortcut.cancel" }
  /**
   * Só com `KIWI_DEBUG=1` no sidecar (sem isso, `unknown_type`), e só com áudio sintético (`say`): o arquivo faz o
   * caminho de uma gravação que terminou (`record.started`/`record.stopped` com `reason: "debug"`, a pílula, o
   * `transcript.final`), para testar o app sem o mic. `invalid_value` se o arquivo não abre; `already_recording`.
   */
  /** `app` e `target` (T1740): a CLI dos agentes diz qual app está na frente e se é a nota rápida. */
  | { type: "debug.transcribe"; path: string; app?: AppRef; target?: "note" }
  /** KIWI_DEBUG=1: processos inventados usando o mic, para testar o perceber a reunião sem olhar o áudio de verdade (R2). */
  | { type: "debug.meetingMicUsers"; users: { pid: number; bundleId: string }[] };

/**
 * O campo descrito em vez de lido (T1740): com `insert.text {dryRun, simulate}`, o helper responde o plano e o espaço
 * que o paste de verdade daria, pelas mesmas regras, sem perguntar nada à Acessibilidade. Tudo opcional: um campo de
 * texto com cursor e todas as permissões. `role: null` é sem foco; `textBefore: null`, um campo que não diz.
 */
export interface InsertSimulation {
  accessibility?: boolean;
  secureInput?: boolean;
  role?: string | null;
  hasCaret?: boolean;
  textBefore?: string | null;
}

export type CommandType = Command["type"];

/** O que cada comando devolve no `result` quando dá certo. */
export interface CommandResults {
  ping: Record<string, never>;
  "spelling.check": SpellingResult;
  /** `hotkey`: o atalho do ditado, no texto de `shortcuts.ts` (desde o T5349; antes, só a tecla). */
  "config.set": { hotkey: string; hotkeyActive: boolean; hotkeyPriority?: boolean };
  /** O atalho que a pessoa apertou (T5349). Erros: `cancelled` (Esc ou `shortcut.cancel`), `invalid_shortcut`, `hotkey_inactive`. */
  "shortcut.record": { shortcut: string };
  "shortcut.cancel": Record<string, never>;
  "meeting.start": { session: string };
  "meeting.stop": Record<string, never>;
  "meeting.pauseMine": Record<string, never>;
  "meeting.resumeMine": Record<string, never>;
  "meeting.pending": { chunks: MeetingChunk[] };
  "meeting.ack": Record<string, never>;
  "meeting.answer": Record<string, never>;
  "dictation.retry": RecoveredTranscript;
  "record.start": Record<string, never>;
  "record.stop": Record<string, never>;
  "overlay.state": Record<string, never>;
  /**
   * `pasted: false`: o texto ficou no clipboard, e o app avisa a pessoa. `reason` diz por quê:
   * `no_focus` (nenhum app na frente) ou `no_accessibility` (falta a permissão). Com um app na frente o ⌘V vai sempre,
   * mesmo sem foco visível pela Acessibilidade (o Teams novo, T984); `pasted: true, restored: false, reason:
   * "no_text_field"`: colou, mas o foco não parecia campo de texto (um botão), então o texto ficou também no clipboard.
   * `pasted: true, restored: false, reason: "secure_input"`: o ⌘V foi, mas algum app segura o secure input e o
   * macOS pode tê-lo descartado; o texto continua no clipboard, e o clipboard antigo não volta.
   * `app` é o bundle id do app em foco.
   */
  "insert.text": {
    pasted: boolean;
    restored: boolean;
    reason?: "no_focus" | "no_text_field" | "no_accessibility" | "secure_input";
    app?: string;
    /** Um espaço foi na frente do texto, porque ele entrou logo depois de outro texto (T733). */
    spaced?: boolean;
    /** Onde a Acessibilidade achou o foco: no pedido ao sistema, no pedido ao app da frente (T984) ou em nenhum. */
    focusVia?: "system" | "app" | "none";
    /** Só no `dryRun`: nada foi colado nem copiado. */
    dryRun?: true;
    /** Só no `dryRun` com `simulate` (T1740): o que o paste faria naquele campo. */
    plan?: "paste" | "pasteKeepingText" | "clipboardOnly";
  };
  notify: Record<string, never>;
  "permissions.request": { permission: Permission; state: PermissionState };
  "llm.complete": { text: string; ms: number };
  "llm.prewarm": Record<string, never>;
  "audio.inputs": AudioInputs;
  "debug.transcribe": Record<string, never>;
  "debug.meetingMicUsers": Record<string, never>;
}

// ---------------------------------------------------------- sidecar → Bun

export interface MeetingChunk {
  session: string;
  chunkId: string;
  channel: "mine" | "system";
  startFrame: number;
  frames: number;
  sampleRate: 16000;
  format: "f32le";
  path: string;
}

/** Um app que conta como reunião (R2): o processo conta quando o bundle id é este ou começa com ele e um ponto. */
export interface MeetingApp {
  bundleId: string;
  name: string;
}

/** Os botões do painel de reunião: "Gravar" e "Agora não" no pop-up; "Parar" e "Continuar" no "A reunião acabou?". */
export type MeetingAnswer = "record" | "notNow" | "stop" | "keepGoing";

export type Event =
  /** Um app de reunião pegou o mic, e o helper mostrou "Gravar esta reunião?" (um por reunião; R2). */
  | { type: "meeting.suggested"; app: MeetingApp }
  /** O app gravado ficou ~2 min sem o mic, e o helper perguntou "A reunião acabou?". Nunca para sozinho (#4846). */
  | { type: "meeting.endSuggested"; app: MeetingApp }
  /** A pessoa respondeu no painel (ou o app mandou `meeting.answer`). */
  | { type: "meeting.answered"; answer: MeetingAnswer }
  /**
   * R3 (T4943): o texto ao vivo. `id` é o lugar no canal (o provisório leva o id do final que virá). `startFrame` e
   * `endFrame` são o relógio do R1 (16 kHz), para o `meeting.ack`. O helper manda sempre `session` e `channel` (#5064).
   */
  | { type: "meeting.segment"; session?: string; start: number; end: number; speaker: string; text: string; final: boolean; channel?: "mine" | "system"; id?: string; startFrame?: number; endFrame?: number; words?: { start: number; end: number; text: string }[] }
  /** R3: nesse canal, nada novo sai antes deste frame além dos finais já mandados (a marca d'água do "você"). */
  | { type: "meeting.settled"; session: string; channel: "mine" | "system"; frame: number }
  /** R3: o stream do canal acabou neste frame; todos os finais saíram (o sistema, depois da correção do VBx). */
  | { type: "meeting.drained"; session: string; channel: "mine" | "system"; frame: number }
  /**
   * R3: a linha do tempo do VBx no fim (opção B, #5131), antes do `drained` do sistema; o writer corrige os blocos
   * salvos por ela. `failed`: o VBx não rodou nem na 2ª tentativa (#5176), e a nota ganha uma linha que diz isso.
   */
  | { type: "meeting.relabel"; session: string; turns: { speaker: number; start: number; end: number }[]; failed?: boolean }
  /** R3: `system_audio_silent` (o canal sistema só trouxe zeros: a permissão, #5030) ou `transcription_unavailable`. */
  | { type: "meeting.warning"; session: string; channel?: "mine" | "system"; warning: string }
  | { type: "meeting.started"; session: string; app?: string; sampleRate: 16000; output: "headphones" | "speaker" | "unknown"; microphone?: Record<string, unknown> }
  /** `reason: "error"` (R6): a captura caiu (o mic sumiu, o tap falhou), e o `meeting.error` veio antes. */
  | { type: "meeting.stopped"; session: string; pendingChunks: number; reason?: "error"; error?: string }
  /** O canal "você" pausou ou voltou: o mute do app de reunião, o "pausar meu mic" ou o app (R2, para o card do R6). */
  | { type: "meeting.minePaused"; paused: boolean }
  | { type: "meeting.level"; channel: "mine" | "system"; rms: number }
  | { type: "meeting.error"; error: string; microphone?: PermissionState }
  | ({ type: "meeting.chunk"; recovered?: boolean } & MeetingChunk)
  | {
      type: "ready";
      version: string;
      pid: number;
      /** O atalho do ditado, no texto de `shortcuts.ts` (desde o T5349; antes, só a tecla). */
      hotkey: string;
      /** `false` quando falta permissão e o atalho não recebe tecla. */
      hotkeyActive: boolean;
      /**
       * Os atalhos têm prioridade (T5349): o app da frente não recebe a tecla. `false` sem Acessibilidade: eles
       * funcionam, mas o outro app também vê a tecla. Ausente num helper de antes do T5349.
       */
      hotkeyPriority?: boolean;
      permissions: Permissions;
      /** Texto para explicar cada permissão na UI. */
      permissionHelp?: Partial<Record<Permission, string>>;
      /** Se o LLM local está pronto. Opcional até o sidecar mandar (T52). */
      llm?: LlmStatus;
    }
  | { type: "permissions.changed"; permissions: Permissions; hotkeyActive: boolean; hotkeyPriority?: boolean; llm?: LlmStatus }
  /** Entrou ou saiu um dispositivo de áudio, ou mudou a saída padrão (T3229): os Ajustes listam de novo. */
  | { type: "audio.inputs.changed" }
  | { type: "hotkey.down"; key: string }
  | { type: "hotkey.up"; key: string }
  | { type: "hotkey.toggle"; on: boolean }
  /** O atalho do `notesShortcut` foi apertado: o app abre ou traz para a frente a janela Notas (T1499). */
  | { type: "hotkey.notes" }
  /** O atalho "colar a última" (L9, T5459): o app cola de novo o último ditado do Histórico. */
  | { type: "hotkey.pasteLast" }
  /** O sidecar começa a gravar sozinho no hotkey.down, para não perder a primeira sílaba. */
  /**
   * `app`: o que estava na frente quando a gravação começou (pode ser o próprio Kiwi). `target: "note"`: a nota
   * rápida (⌥ segurado ao apertar o atalho, T1320). O texto vira uma nota em vez de ser colado.
   */
  | {
      type: "record.started";
      recovery?: RecordingRef;
      reason: RecordReason;
      app?: AppRef;
      target?: "note";
      /**
       * Por qual mic grava (T3229): o que o helper escolheu, com `fellBack` quando o mic salvo não estava conectado e
       * valeu o automático (o fim do ditado avisa, T3344). Um helper de antes do T3229 não manda.
       */
      microphone?: { uid?: string; name?: string; transport?: string; systemDefault?: boolean; fellBack?: boolean; reason?: string; lidClosed?: boolean };
    }
  /**
   * `lost`: a gravação acabou porque o mic caiu (`no_audio` ou `device_changed`), e o que ele ouviu até ali segue para
   * a transcrição como num fim normal (T883). Com menos de 0,3 s, vem `record.error` no lugar.
   */
  | {
      type: "record.stopped";
      recovery?: RecordingRef;
      reason: RecordReason;
      mode: StopMode;
      durationMs: number;
      samples: number;
      audioPath?: string;
      lost?: "no_audio" | "device_changed";
    }
  /** Batida curta sozinha ou tecla usada como modificador (Fn+F5): esconda o overlay sem esperar transcrição. */
  | { type: "record.cancelled"; reason: RecordReason }
  /**
   * Não deu para gravar: sem microfone, sem permissão, `device_changed` (o mic trocou no meio e o novo não subiu)
   * ou `no_audio` (o mic parou de mandar áudio, mesmo depois de um engine novo; T590). Nesses dois, só quando havia
   * menos de 0,3 s gravado; com mais, vem `record.stopped` com `lost` (T883).
   * Pode vir logo depois do `record.started`, que sai antes de o mic subir.
   * `mic_busy` (#5154): sem áudio, ou o engine não subiu, enquanto outro app (`busyApp`, ex.: "Chrome" no Meet) usa o
   * mesmo mic. O helper já tentou um engine novo antes de desistir; a pílula diz "Mic ocupado por <app>".
   */
  | { type: "record.error"; recovery?:RecordingRef; reason: RecordReason; error: string; microphone: PermissionState; busyApp?: string }
  /** Nível RMS de 0 a 1, ~30 Hz enquanto grava. Alimenta a onda do overlay. */
  | { type: "audio.level"; rms: number }
  /**
   * O app da frente, para o tom da limpeza: logo depois do `ready` e a cada troca. Nunca o próprio Kiwi, nem o mesmo
   * app duas vezes seguidas.
   */
  | { type: "app.active"; bundleId: string; name: string; pid: number }
  | { type: "transcript.partial"; text: string }
  /**
   * O texto de uma gravação, na ordem em que terminaram. `text` já passou pelo pós-processamento do VoiceInk
   * (filtro, correção fonética, aliases); `raw` é o do modelo. `lang`: `pt`, `en`, `mix`, ou `""` sem texto.
   * `latencyMs`: do fim da gravação até aqui.
   */
  | { type: "transcript.final"; text: string; raw: string; lang: "pt" | "en" | "mix" | ""; durationMs: number; latencyMs: number; audioPath?: string;recovery?:RecordingRef }
  /**
   * O modelo de STT: `loading` logo depois do `ready` (a primeira carga pode levar um minuto: download, ou o
   * CoreML compilando depois de atualizar o macOS), depois `ready` ou `unavailable`.
   */
  | { type: "stt.status"; state: "loading" | "ready" | "unavailable"; loadMs?: number; error?: "model_unavailable" }
  /**
   * O modelo CTC do boosting do vocabulário (T1973), que carrega depois do principal e em segundo plano: `loading`
   * (a primeira vez, baixando 99 MB), `ready`, ou `unavailable` (offline, por exemplo). O ditado não espera por ele:
   * sem o modelo, sai sem boosting. Depois de um `unavailable`, tenta de novo num ditado, no mínimo 10 min depois.
   */
  | { type: "stt.boosting"; state: "loading" | "ready" | "unavailable" }
  /** A gravação não virou texto: `model_unavailable` (sem modelo, ex.: offline na primeira vez) ou `stt_failed`. */
  | { type: "transcript.error"; recovery?:RecordingRef; error: "model_unavailable" | "stt_failed" }
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
  "spelling.check",
  "config.set",
  "meeting.start",
  "meeting.stop",
  "meeting.pauseMine",
  "meeting.resumeMine",
  "meeting.pending",
  "meeting.ack",
  "meeting.answer",
  "dictation.retry",
  "record.start",
  "record.stop",
  "overlay.state",
  "insert.text",
  "notify",
  "permissions.request",
  "llm.complete",
  "llm.prewarm",
  "audio.inputs",
  "shortcut.record",
  "shortcut.cancel",
  "debug.transcribe",
  "debug.meetingMicUsers",
]);

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "meeting.suggested",
  "meeting.endSuggested",
  "meeting.answered",
  "meeting.minePaused",
  "meeting.segment",
  "meeting.settled",
  "meeting.drained",
  "meeting.relabel",
  "meeting.warning",
  "meeting.started",
  "meeting.stopped",
  "meeting.level",
  "meeting.error",
  "meeting.chunk",
  "ready",
  "permissions.changed",
  "audio.inputs.changed",
  "hotkey.down",
  "hotkey.up",
  "hotkey.toggle",
  "hotkey.notes",
  "hotkey.pasteLast",
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
  "stt.boosting",
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
