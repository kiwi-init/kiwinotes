// A sessão de ditado do app (T58): o sidecar, o fluxo do ditado e o que precisa ficar em sincronia com
// os arquivos (o dicionário vai para o STT no `config.set`, a cada `ready` e a cada mudança).

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sidecarLlm } from "../cleanup/index.ts";
import type { LlmMode } from "../cleanup/types.ts";
import { defaultSocketPath, type Event, type Permission } from "../shared/ipc.ts";
import type { DictionaryTerm } from "../store/dictionary.ts";
import type { Snippet } from "../store/snippets.ts";
import { Dictation } from "./dictation.ts";
import { fileAskedStore, missing, PermissionFlow } from "./permissions.ts";
import { Sidecar } from "./sidecar.ts";
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

export type SttState = Extract<Event, { type: "stt.status" }>["state"] | "starting";

export interface SessionStatus {
  connected: boolean;
  stt: SttState;
  hotkeyActive: boolean;
  /** As permissões que faltam, na ordem em que o app pede (T532). */
  missing: Permission[];
}

export class Session {
  readonly sidecar: Sidecar;
  readonly dictation: Dictation;
  readonly permissions: PermissionFlow;
  private stt: SttState = "starting";
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
    this.dictation = new Dictation({ sidecar: this.sidecar, history: stores.history, llm, llmMode, dryRun });
    // Com KIWI_DEBUG=1 (agentes), nada é pedido sozinho: nenhum diálogo do macOS abre (#537, #551).
    // Nem o reset do clique no menu (#666).
    this.permissions = new PermissionFlow(this.sidecar, fileAskedStore(stores.dir), undefined, !dryRun, !dryRun);
  }

  start(): void {
    this.dictation.attach();
    this.permissions.attach();
    this.sidecar.on("ready", () => {
      this.stt = "starting";
      this.emitStatus();
      void this.syncAll();
    });
    this.sidecar.on("stt.status", (e) => {
      this.stt = e.state;
      this.emitStatus();
    });
    this.sidecar.on("permissions.changed", () => this.emitStatus());
    if (process.env.KIWI_DEBUG === "1") {
      // Só o tipo e o app, nunca o texto do ditado.
      this.sidecar.on("*", (e) => {
        if (e.type === "audio.level") return;
        const app = e.type === "app.active" ? ` ${e.bundleId}` : e.type === "record.started" ? ` ${e.app?.bundleId ?? "-"}` : "";
        const extra = e.type === "stt.status" ? ` ${e.state}` : e.type === "transcript.final" ? ` ${e.latencyMs} ms` : "";
        console.log(`[sidecar] ${e.type}${app}${extra}`);
      });
    }
    this.sidecar.start();
  }

  stop(): void {
    this.dictation.detach();
    this.permissions.detach();
    this.sidecar.stop();
  }

  status(): SessionStatus {
    const ready = this.sidecar.ready;
    return { connected: !!ready, stt: this.stt, hotkeyActive: ready?.hotkeyActive ?? false, missing: missing(ready?.permissions) };
  }

  onStatus(fn: (s: SessionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus() {
    const s = this.status();
    for (const fn of this.statusListeners) fn(s);
  }

  /** Lê o dicionário e os snippets dos arquivos e manda o vocabulário para o STT. */
  async syncAll(): Promise<void> {
    const [terms, snippets] = await Promise.all([stores.dictionary.load(), stores.snippets.load()]);
    this.dictation.setSnippets(snippets);
    await this.dictionaryChanged(terms);
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
