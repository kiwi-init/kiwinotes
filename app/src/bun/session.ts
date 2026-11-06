// A sessão de ditado do app (T58): o sidecar, o fluxo do ditado e o que precisa ficar em sincronia com
// os arquivos (o dicionário vai para o STT no `config.set`, a cada `ready` e a cada mudança).

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sidecarLlm } from "../cleanup/index.ts";
import type { LlmMode } from "../cleanup/types.ts";
import { defaultSocketPath, type Event, type LlmStatus, type Permission, type Permissions } from "../shared/ipc.ts";
import type { AudioInputs } from "../shared/microphone.ts";
import { listAudioInputs } from "./audio-inputs.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../store/settings.ts";
import type { Snippet } from "../store/snippets.ts";
import { Dictation } from "./dictation.ts";
import { fileAskedStore, missing, PermissionFlow } from "./permissions.ts";
import { MeetingLiveTracker } from "./meetings.ts";
import { MeetingAcks } from "./meeting-acks.ts";
import { Sidecar, type SupervisorStatus } from "./sidecar.ts";
import { MeetingNoteSession } from "./meeting-notes.ts";
import { stores } from "./stores.ts";

/** O helper que vai dentro do .app (o `copy` do electrobun.config.ts), ou `KIWI_HELPER`. */
export function helperPath(viewsFolder: string): string {
  return process.env.KIWI_HELPER || path.join(viewsFolder, "..", "bin", "kiwi-helper");
}

/** Um socket unix aceita no máximo ~104 bytes de caminho: um `KIWI_DATA_DIR` fundo cai no tmp. */
export function socketPathFor(dir: string, fallbackDir = os.tmpdir()): string {
  if (!process.env.KIWI_DATA_DIR) return defaultSocketPath();
  const p = path.join(dir, "sidecar.sock");
  return Buffer.byteLength(p) <= 100 ? p : path.join(fallbackDir, `kiwi-${process.pid}.sock`);
}

/** O que o `config.set {dictionary}` leva: só a grafia, ou a grafia com os aliases. */
export const sttDictionary = (terms: DictionaryTerm[]) =>
  terms.map((t) => (t.aliases.length ? { term: t.term, aliases: t.aliases } : t.term));

/**
 * O dicionário e os snippets dos arquivos. Os dois são editáveis à mão: um JSON estragado vale como lista vazia, com
 * um aviso, em vez de uma rejeição sem tratamento que derruba o processo do Bun (T914). O arquivo fica como está:
 * só a janela grava, e ela não grava enquanto não conseguiu ler.
 */
export async function loadLists(
  from: { dictionary: { load(): Promise<DictionaryTerm[]>; file: string }; snippets: { load(): Promise<Snippet[]>; file: string } },
  warn: (message: string) => void = console.warn,
): Promise<{ terms: DictionaryTerm[]; snippets: Snippet[] }> {
  const orEmpty = <T>(load: Promise<T[]>, file: string) =>
    load.catch((e) => {
      warn(`[session] couldn't read ${path.basename(file)} (${e instanceof Error ? e.message : String(e)}); using an empty list`);
      return [] as T[];
    });
  const [terms, snippets] = await Promise.all([
    orEmpty(from.dictionary.load(), from.dictionary.file),
    orEmpty(from.snippets.load(), from.snippets.file),
  ]);
  return { terms, snippets };
}

export type SttState = Extract<Event, { type: "stt.status" }>["state"] | "starting";

export interface SessionStatus {
  supervision?: SupervisorStatus;
  connected: boolean;
  stt: SttState;
  /** O modelo do boosting do vocabulário (T1973); `undefined` até o helper dizer. */
  boosting?: Extract<Event, { type: "stt.boosting" }>["state"];
  hotkeyActive: boolean;
  /** As permissões que faltam, na ordem em que o app pede (T532). */
  missing: Permission[];
}

/**
 * O que um `log` do helper vira no log do app, ou null. Só o diagnóstico do mic, do ditado e da reunião (#208, T5350:
 * vão para o arquivo, para os testes do harry); o resto fica de fora, porque o dryRun loga o texto do ditado.
 */
export function helperLogLine(message: string): string | null {
  return message.startsWith("mic: ") || message.startsWith("meeting mic: ") ? `[sidecar] ${message}` : null;
}

export interface SessionDiagnostics extends SessionStatus {
  /** O último `ready` do helper, ou null se ele não está de pé. */
  helper: { version: string; pid: number; permissions: Permissions; llm?: LlmStatus } | null;
  exits: Sidecar["exits"];
}

export class Session {
  readonly sidecar: Sidecar;
  readonly dictation: Dictation;
  readonly meetingNotes: MeetingNoteSession;
  readonly permissions: PermissionFlow;
  /** A gravação de reunião ao vivo (R6), pelos eventos do helper: o card da aba Reuniões. */
  readonly meetings: MeetingLiveTracker;
  private stt: SttState = "starting";
  private boosting: SessionStatus["boosting"];
  private statusListeners = new Set<(s: SessionStatus) => void>();

  constructor(viewsFolder: string) {
    const helper = helperPath(viewsFolder);
    if (!existsSync(helper)) console.warn(`[session] no helper at ${helper}: build it with \`swift build\` in native/`);
    this.sidecar = new Sidecar({
      helper,
      socketPath: socketPathFor(stores.dir),
      // O `debug.transcribe` (áudio sintético, sem mic) só existe com KIWI_DEBUG=1 (T457); nunca no app de release.
      env: process.env.KIWI_DEBUG === "1" ? { KIWI_DEBUG: "1" } : undefined,
    });
    // O modo do LLM fica `off` por padrão (ADR 0002). KIWI_LLM_MODE=auto|always para testar.
    const llmMode = (["auto", "always"].includes(process.env.KIWI_LLM_MODE ?? "") ? process.env.KIWI_LLM_MODE : "off") as LlmMode;
    const llm = sidecarLlm({ status: () => this.sidecar.ready?.llm, request: (c, signal) => this.sidecar.send(c, signal) });
    // Com KIWI_DEBUG=1 nada é colado nem vai para o clipboard (testes de agente, #490).
    const dryRun = process.env.KIWI_DEBUG === "1";
    this.dictation = new Dictation({ sidecar: this.sidecar, history: stores.history, notes: stores.dictationNotes, llm, llmMode, dryRun });
    // Com KIWI_DEBUG=1 (agentes), nada é pedido sozinho: nenhum diálogo do macOS abre (#537, #551).
    // Nem o reset do clique no menu (#666).
    this.meetingNotes = new MeetingNoteSession(this.sidecar, stores.meetingNotes);
    this.permissions = new PermissionFlow(this.sidecar, fileAskedStore(stores.dir), undefined, !dryRun, !dryRun);
    this.meetings = new MeetingLiveTracker((c) => this.sidecar.send(c));
    // R3: o áudio da reunião só sai do disco do helper depois que o texto dele está salvo na nota (#5061, #5064).
    this.meetingAcks = new MeetingAcks((ack) => {
      void this.sidecar.send(ack).then(
        (r) => r.ok || console.warn(`[meetings] meeting.ack ${ack.channel}: ${r.error}`),
        () => console.warn("[meetings] meeting.ack: helper gone; the audio stays for the recovery"),
      );
    });
  }

  /** As acks da reunião (R3): os eventos do helper e as confirmações do R4 entram. */
  readonly meetingAcks: MeetingAcks;

  start(): void {
    this.dictation.attach();
    this.meetingNotes.attach();
    this.permissions.attach();
    for (const type of ["meeting.started", "meeting.stopped", "meeting.minePaused", "meeting.warning"] as const) {
      this.sidecar.on(type, (e) => this.meetings.feed(e));
    }
    // R3: a marca d'água de cada canal, a correção do VBx e o fim (#5131: o sistema só no fim).
    stores.meetingNotes.onCommitted((session, segments) => this.meetingAcks.committed(session, segments));
    this.sidecar.on("meeting.segment", (e) => this.meetingAcks.segment(e));
    this.sidecar.on("meeting.settled", (e) => this.meetingAcks.settled(e.session, e.channel, e.frame));
    this.sidecar.on("meeting.drained", (e) => this.meetingAcks.drained(e.session, e.channel, e.frame));
    this.sidecar.on("meeting.relabel", (e) => {
      this.meetingAcks.relabelStarted(e.session);
      stores.meetingNotes.relabel(e.session, e.turns, { failed: e.failed === true }).then(
        () => this.meetingAcks.relabelDone(e.session),
        () => console.error("[meetings] speaker correction not written; the system audio stays for the recovery"),
      );
    });
    this.sidecar.on("meeting.warning", (e) => console.warn(`[meetings] ${e.channel ?? ""} ${e.warning}`));
    // O helper que caiu levou a captura junto (R6): o card ao vivo some.
    this.sidecar.onClose(() => this.meetings.reset());
    this.sidecar.on("ready", () => {
      this.meetings.reset();
      this.stt = "starting";
      this.boosting = undefined;
      this.emitStatus();
      void this.syncAll();
    });
    this.sidecar.on("stt.status", (e) => {
      this.stt = e.state;
      this.emitStatus();
    });
    this.sidecar.on("stt.boosting", (e) => {
      this.boosting = e.state;
      this.emitStatus();
    });
    this.sidecar.on("permissions.changed", () => this.emitStatus());
    // O que o mic fez (engine novo, quanto tempo até o primeiro áudio depois do atalho, T985): só números e nomes
    // de evento, nunca áudio nem texto. Os outros logs do helper ficam de fora (o dryRun loga o texto).
    this.sidecar.on("log", (e) => {
      const line = helperLogLine(e.message);
      if (line) console.log(line);
    });
    // O helper caiu: o menu sai de "Pronto para ditar" até o próximo `ready` (T914).
    this.sidecar.onClose(() => this.emitStatus());
    if (process.env.KIWI_DEBUG === "1") {
      // Só o tipo e o app, nunca o texto do ditado.
      this.sidecar.on("*", (e) => {
        if (e.type === "audio.level") return;
        const app = e.type === "app.active" ? ` ${e.bundleId}` : e.type === "record.started" ? ` ${e.app?.bundleId ?? "-"}` : "";
        const extra = e.type === "stt.status" || e.type === "stt.boosting" ? ` ${e.state}` : e.type === "transcript.final" ? ` ${e.latencyMs} ms` : "";
        console.log(`[sidecar] ${e.type}${app}${extra}`);
      });
    }
    this.sidecar.onSupervision(() => this.emitStatus());
    this.sidecar.start();
  }

  stop(): Promise<void> {
    this.dictation.detach();
    this.permissions.detach();
    return Promise.all([this.sidecar.stop(),this.meetingNotes.detach()]).then(()=>{});
  }

  /** O estado do helper para o "Salvar diagnóstico" (T5350): só leitura, nunca pede permissão. */
  diagnostics(): SessionDiagnostics {
    const ready = this.sidecar.ready;
    return {
      ...this.status(),
      helper: ready ? { version: ready.version, pid: ready.pid, permissions: ready.permissions, ...(ready.llm ? { llm: ready.llm } : {}) } : null,
      exits: [...this.sidecar.exits],
    };
  }

  status(): SessionStatus {
    const ready = this.sidecar.ready;
    return { supervision:this.sidecar.supervision(), connected: !!ready, stt: this.stt, boosting: this.boosting, hotkeyActive: ready?.hotkeyActive ?? false, missing: missing(ready?.permissions) };
  }

  onStatus(fn: (s: SessionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus() {
    const s = this.status();
    for (const fn of this.statusListeners) fn(s);
  }

  /** Lê o dicionário, os snippets e as Configurações dos arquivos e manda ao helper o vocabulário e o atalho. */
  async syncAll(): Promise<void> {
    const { terms, snippets } = await loadLists(stores);
    this.dictation.setSnippets(snippets);
    const settings = await stores.settings.load().catch((e) => {
      console.warn(`[session] couldn't read settings.json (${e instanceof Error ? e.message : String(e)}); using the defaults`);
      return DEFAULT_SETTINGS;
    });
    await Promise.all([this.dictionaryChanged(terms), this.settingsChanged(settings)]);
  }

  /** O helper vigia o atalho da janela Notas que está nas Configurações (T1499); null desliga. */
  async settingsChanged(settings: AppSettings): Promise<void> {
    const result = await this.sidecar.send({ type: "config.set", notesShortcut: settings.notesShortcut }).catch(() => undefined);
    if (result && !result.ok) console.warn(`[session] config.set notesShortcut: ${result.error}`);
    // O microfone vai num `config.set` só dele (T3230): um helper de antes do #3202 que recusar o campo não leva junto o
    // atalho das notas.
    const mic = await this.sidecar.send({ type: "config.set", microphone: settings.microphone }).catch(() => undefined);
    if (mic && !mic.ok) console.warn(`[session] config.set microphone: ${mic.error}`);
    // Os ajustes de reunião (R6) num `config.set` só deles, pelo mesmo motivo: um helper de antes do R2 recusa os campos.
    const m = settings.meetings;
    const meeting = await this.sidecar
      .send({ type: "config.set", meetingShortcut: m.shortcut, meetingPauseShortcut: m.pauseShortcut, meetingSuggest: m.suggest, meetingApps: m.apps })
      .catch(() => undefined);
    if (meeting && !meeting.ok) console.warn(`[session] config.set meetings: ${meeting.error}`);
  }

  /** As entradas de áudio para o seletor dos Ajustes (T3230); null sem o helper, ou com um que não sabe listar. */
  audioInputs(): Promise<AudioInputs | null> {
    return listAudioInputs((c) => this.sidecar.send(c));
  }

  async dictionaryChanged(terms: DictionaryTerm[]): Promise<void> {
    this.dictation.setDictionary(terms);
    const result = await this.sidecar.send({ type: "config.set", dictionary: sttDictionary(terms) }).catch(() => undefined);
    if (result && !result.ok) console.warn(`[session] config.set dictionary: ${result.error}`);
  }

  snippetsChanged(snippets: Snippet[]): void {
    this.dictation.setSnippets(snippets);
  }
}

let current: Session | undefined;
/** A sessão do app (criada no index.ts). As janelas avisam por aqui quando o dicionário ou os snippets mudam. */
export const session = {
  set: (s: Session) => void (current = s),
  get: () => current,
};
