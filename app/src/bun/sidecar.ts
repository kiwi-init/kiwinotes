// O lado Bun do socket com o sidecar Swift (ADR 0001): escuta o socket unix, sobe o helper com
// `--socket <path>`, casa cada comando com o seu `result` pelo `id` e repassa os eventos.
// Se o helper cair, sobe de novo (com espera crescente), e os pedidos pendentes falham com `sidecar_closed`.

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { constants } from "node:os";

import {
  type Command,
  type CommandType,
  encode,
  type Event,
  type EventMessage,
  IPC_VERSION,
  isEvent,
  isResult,
  LineDecoder,
  type Message,
  type ResultMessage,
} from "../shared/ipc.ts";

type Ready = Extract<Event, { type: "ready" }>;
type Listener = (e: EventMessage) => void;

export interface HelperProcess {
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
  exited: Promise<unknown>;
  pid?: number;
  exitCode?: number | null;
  signalCode?: string | number | null;
}
export interface SupervisorStatus {
  state: "starting" | "ready" | "backoff" | "failed" | "stopped";
  crashes: number;
  reason?: string;
  restartInMs?: number;
}
export const SUPERVISOR_DEFAULTS = {
  stableMs: 60_000,
  readyTimeoutMs: 15_000,
  pingIntervalMs: 10_000,
  maxMissedPings: 3,
  pingTimeoutMs: 5_000,
  terminateMs: 2_000,
  maxCrashes: 5,
  windowMs: 5 * 60_000,
  backoffMs: 500,
  maxBackoffMs: 30_000,
};

export interface SidecarOptions {
  /** O executável `kiwi-helper`. */
  helper: string;
  socketPath: string;
  /** Variáveis a mais para o helper (por exemplo `KIWI_DEBUG=1` nos testes). */
  env?: Record<string, string>;
  /** Quanto esperar por um `result` antes de desistir. */
  requestTimeoutMs?: number;
  /** Troca o `Bun.spawn` (testes). Devolve algo que dá para matar e que avisa quando sai. */
  spawn?: (argv: string[], env: Record<string, string>) => HelperProcess;
  /** Só os testes encurtam os prazos; o app usa SUPERVISOR_DEFAULTS. */
  supervision?: Partial<typeof SUPERVISOR_DEFAULTS>;
  log?: (message: string, level?: "info" | "warn" | "error") => void;
}

/** Erro de um comando: o código curto do `result` (ou `sidecar_closed`, `sidecar_timeout`). */
export class SidecarError extends Error {
  constructor(
    readonly code: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "SidecarError";
  }
}

type Socket = { write(data: Uint8Array): number; end(): void };

const encoder = new TextEncoder();

export class Sidecar {
  private server?: { stop(closeActive?: boolean): void };
  private socket?: Socket;
  private proc?: HelperProcess;
  private readonly limits: typeof SUPERVISOR_DEFAULTS;
  private health: SupervisorStatus = { state: "starting", crashes: 0 };
  private healthListeners = new Set<(status: SupervisorStatus) => void>();
  private crashTimes: number[] = [];
  private readyTimer?: Timer;
  private stableTimer?: Timer;
  private pingTimer?: Timer;
  private restartTimer?: Timer;
  private killTimer?: Timer;
  private terminationReason?: string;
  private stopping?: Promise<void>;
  private missedPings = 0;
  private pingIds = new Set<string>();
  private pending = new Map<
    string,
    { resolve(r: ResultMessage): void; reject(e: Error): void; timer: Timer }
  >();
  private listeners = new Map<string, Set<Listener>>();
  private closeListeners = new Set<() => void>();
  private nextId = 0;
  private stopped = false;
  private restarts = 0;
  /**
   * O que ainda não coube no socket. O `write` do Bun escreve só o que cabe no buffer e devolve quantos bytes
   * foram; o resto sai no `drain`, na ordem (review #521: um `config.set` de 30 KB chegava cortado em 8 KB).
   */
  private outbox: Uint8Array[] = [];
  private connected?: {
    promise: Promise<Ready>;
    resolve(r: Ready): void;
    reject(e: Error): void;
  };
  /** O último `ready`, com o `llm` atualizado pelos `permissions.changed`. */
  ready?: Ready;
  /** As quedas do helper desde que o app abriu, as 20 últimas (T5350: vão no "Salvar diagnóstico"). */
  readonly exits: { at: string; code: number | null; signal?: string }[] = [];

  constructor(private readonly options: SidecarOptions) {
    this.limits = { ...SUPERVISOR_DEFAULTS, ...options.supervision };
    this.resetConnected();
  }

  supervision(): SupervisorStatus {
    return { ...this.health };
  }
  onSupervision(fn: (status: SupervisorStatus) => void): () => void {
    this.healthListeners.add(fn);
    return () => this.healthListeners.delete(fn);
  }
  private setHealth(status: SupervisorStatus) {
    this.health = status;
    for (const fn of this.healthListeners) {
      try {
        fn(this.supervision());
      } catch {
        this.log("supervisor listener_failed");
      }
    }
  }

  private resetConnected() {
    let resolve!: (r: Ready) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Ready>((r, j) => {
      resolve = r;
      reject = j;
    });
    // A sessão usa eventos e pode nunca chamar whenReady; falha terminal não vira rejeição solta.
    void promise.catch(() => {});
    this.connected = { promise, resolve, reject };
  }

  /** Resolve no próximo `ready` (o primeiro, ou o de depois de um restart). */
  whenReady(): Promise<Ready> {
    return this.ready && this.socket
      ? Promise.resolve(this.ready)
      : this.connected!.promise;
  }

  start(): void {
    if (this.server || this.stopped) return;
    const { socketPath } = this.options;
    mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    rmSync(socketPath, { force: true });
    const decoder = () =>
      new LineDecoder(
        (m) => this.receive(m),
        (e) => this.log(`bad line from the sidecar: ${e.code}`),
      );
    let current: LineDecoder | undefined;
    this.server = Bun.listen({
      unix: socketPath,
      socket: {
        open: (s) => {
          // Um helper por vez: uma segunda conexão (um helper antigo que não morreu) é recusada.
          if (
            this.socket ||
            this.stopped ||
            !this.proc ||
            this.terminationReason
          )
            return void s.end();
          this.socket = s;
          this.outbox = [];
          current = decoder();
        },
        drain: (s) => {
          if (s === this.socket) this.flush();
        },
        data: (s, chunk) => {
          if (s === this.socket) current?.push(chunk);
        },
        close: (s) => {
          if (s !== this.socket) return;
          this.disconnect();
          if (!this.stopped && this.proc) this.terminate("socket_closed");
        },
      },
    });
    chmodSync(socketPath, 0o600);
    this.spawnHelper();
  }

  private spawnHelper(): void {
    if (this.stopped || this.proc || this.health.state === "failed") return;
    this.restartTimer = undefined;
    this.terminationReason = undefined;
    this.missedPings = 0;
    this.pingIds.clear();
    this.setHealth({ state: "starting", crashes: this.crashTimes.length });
    const argv = [this.options.helper, "--socket", this.options.socketPath];
    const env = {
      ...(process.env as Record<string, string>),
      ...this.options.env,
    };
    const spawn =
      this.options.spawn ??
      ((a: string[], e: Record<string, string>) =>
        Bun.spawn(a, { env: e, stdout: "inherit", stderr: "inherit" }));
    let proc: HelperProcess;
    try {
      proc = spawn(argv, env);
    } catch {
      this.log("supervisor spawn_error");
      this.failedAttempt("spawn_error");
      return;
    }
    this.proc = proc;
    this.log(
      `supervisor spawn pid=${proc.pid ?? "unknown"} attempt=${this.restarts + 1}`,
      "info",
    );
    this.readyTimer = setTimeout(() => {
      if (this.proc === proc && !this.ready) this.terminate("ready_timeout");
    }, this.limits.readyTimeoutMs);
    void proc.exited.then(
      (result) => this.exited(proc, result),
      () => this.exited(proc, undefined),
    );
  }

  private exited(proc: HelperProcess, result: unknown) {
    if (this.proc !== proc) return;
    const reason = this.terminationReason ?? "exit";
    const code = typeof result === "number" ? result : (proc.exitCode ?? null);
    const rawSignal = proc.signalCode;
    const signal =
      typeof rawSignal === "number"
        ? (Object.entries(constants.signals).find(
            ([, n]) => n === rawSignal,
          )?.[0] ?? String(rawSignal))
        : (rawSignal ?? undefined);
    this.exits.push({
      at: new Date().toISOString(),
      code,
      ...(signal ? { signal } : {}),
    });
    if (this.exits.length > 20) this.exits.shift();
    this.log(
      `supervisor exit pid=${proc.pid ?? "unknown"} exitCode=${code ?? "unknown"} signal=${signal ?? "none"} reason=${reason}`,
      this.stopped ? "info" : "warn",
    );
    this.clearWatch();
    clearTimeout(this.killTimer);
    this.killTimer = undefined;
    this.proc = undefined;
    this.disconnect();
    if (!this.stopped) this.failedAttempt(reason);
  }

  private failedAttempt(reason: string) {
    const now = performance.now();
    this.crashTimes = this.crashTimes.filter(
      (t) => now - t < this.limits.windowMs,
    );
    this.crashTimes.push(now);
    if (this.crashTimes.length >= this.limits.maxCrashes) {
      this.setHealth({
        state: "failed",
        crashes: this.crashTimes.length,
        reason,
      });
      this.connected!.reject(new SidecarError("sidecar_failed"));
      this.log(
        `supervisor failed crashes=${this.crashTimes.length} windowMs=${this.limits.windowMs} reason=${reason}`,
        "error",
      );
      return;
    }
    const wait = Math.min(
      this.limits.maxBackoffMs,
      this.limits.backoffMs * 2 ** this.restarts++,
    );
    this.setHealth({
      state: "backoff",
      crashes: this.crashTimes.length,
      reason,
      restartInMs: wait,
    });
    this.log(
      `supervisor backoff waitMs=${wait} crashes=${this.crashTimes.length} reason=${reason}`,
    );
    this.restartTimer = setTimeout(() => this.spawnHelper(), wait);
  }

  private clearWatch() {
    clearTimeout(this.readyTimer);
    clearTimeout(this.stableTimer);
    clearTimeout(this.pingTimer);
    this.pingIds.clear();
    this.readyTimer = this.stableTimer = this.pingTimer = undefined;
  }

  private watchReady() {
    const proc = this.proc!;
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.setHealth({ state: "ready", crashes: this.crashTimes.length });
    this.log(`supervisor ready pid=${proc.pid ?? "unknown"}`, "info");
    // Ready só diz que o IPC subiu. STT carregando pode derrubar o processo logo depois.
    if (!this.stableTimer)
      this.stableTimer = setTimeout(() => {
        if (this.proc === proc && this.ready && !this.terminationReason) {
          this.restarts = 0;
          this.log(
            `supervisor stable stableMs=${this.limits.stableMs}`,
            "info",
          );
        }
        this.stableTimer = undefined;
      }, this.limits.stableMs);
    this.schedulePing(proc);
  }

  private schedulePing(proc: HelperProcess) {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      this.pingTimer = undefined;
      if (this.proc !== proc || this.stopped || this.terminationReason) return;
      void this.request(
        { type: "ping" },
        undefined,
        this.limits.pingTimeoutMs,
      ).then(
        () => {
          if (this.proc === proc && !this.stopped && !this.terminationReason)
            this.schedulePing(proc);
        },
        () => {
          if (this.proc !== proc || this.stopped || this.terminationReason)
            return;
          this.missedPings++;
          this.log(
            `supervisor ping_missed pid=${proc.pid ?? "unknown"} missed=${this.missedPings} limit=${this.limits.maxMissedPings}`,
          );
          if (this.missedPings >= this.limits.maxMissedPings)
            this.terminate("ping_timeout");
          else this.schedulePing(proc);
        },
      );
    }, this.limits.pingIntervalMs);
  }

  /** Não cria outro helper enquanto o anterior ainda existe. O SIGKILL tem prazo mesmo sem socket. */
  private terminate(reason: string) {
    const proc = this.proc;
    if (!proc || this.terminationReason) return;
    this.terminationReason = reason;
    this.clearWatch();
    this.log(
      `supervisor terminate pid=${proc.pid ?? "unknown"} signal=SIGTERM reason=${reason}`,
      reason === "stop" ? "info" : "warn",
    );
    try {
      proc.kill("SIGTERM");
    } catch {
      this.log("supervisor signal_failed signal=SIGTERM");
    }
    this.killTimer = setTimeout(() => {
      if (this.proc !== proc) return;
      this.log(
        `supervisor kill pid=${proc.pid ?? "unknown"} signal=SIGKILL reason=${reason}`,
      );
      try {
        proc.kill("SIGKILL");
      } catch {
        this.log("supervisor signal_failed signal=SIGKILL", "error");
      }
    }, this.limits.terminateMs);
    this.disconnect();
  }

  private disconnect() {
    const socket = this.socket;
    const wasReady = !!this.ready;
    this.socket = undefined;
    this.ready = undefined;
    this.outbox = [];
    if (wasReady) this.resetConnected();
    this.failPending("sidecar_closed");
    try {
      socket?.end();
    } catch {
      this.log("supervisor socket_close_failed");
    }
    if (socket || wasReady)
      for (const fn of this.closeListeners) {
        try {
          fn();
        } catch {
          this.log("close listener failed");
        }
      }
  }

  /** Escreve a linha inteira, agora ou no próximo `drain`. */
  private write(line: string) {
    this.outbox.push(encoder.encode(line));
    if (this.outbox.length === 1) this.flush();
  }

  private flush() {
    const socket = this.socket;
    while (socket && this.outbox.length) {
      const chunk = this.outbox[0]!;
      const n = socket.write(chunk);
      if (n >= chunk.length) {
        this.outbox.shift();
        continue;
      }
      // Coube só uma parte (ou nada, `n` ≤ 0): o resto espera o `drain`.
      if (n > 0) this.outbox[0] = chunk.subarray(n);
      return;
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.clearWatch();
    this.setHealth({ state: "stopped", crashes: this.crashTimes.length });
    const proc = this.proc;
    this.terminate("stop");
    this.disconnect();
    this.connected!.reject(new SidecarError("sidecar_closed"));
    this.server?.stop(true);
    rmSync(this.options.socketPath, { force: true });
    this.stopping = proc
      ? proc.exited.then(
          () => {},
          () => {},
        )
      : Promise.resolve();
    return this.stopping;
  }

  /** Última defesa síncrona no evento exit do Bun, onde não há mais tempo para timers. */
  forceKill(): void {
    if (!this.proc) return;
    this.log(
      `supervisor kill pid=${this.proc.pid ?? "unknown"} signal=SIGKILL reason=app_exit`,
    );
    try {
      this.proc.kill("SIGKILL");
    } catch {
      /* o processo já pode ter saído */
    }
  }

  on<T extends Event["type"]>(
    type: T | "*",
    fn: (e: EventMessage<Extract<Event, { type: T }>>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener);
    return () => set!.delete(fn as Listener);
  }

  /** Avisa quando o helper desconecta (caiu ou foi morto): o `ready` acabou de virar `undefined` (T914). */
  onClose(fn: () => void): () => void {
    this.closeListeners.add(fn);
    return () => this.closeListeners.delete(fn);
  }

  /** Manda um comando e espera o `result`. Rejeita com `SidecarError` quando o `ok` é `false`. */
  async request<C extends Command>(
    command: C,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ResultMessage<C["type"]> & { ok: true }> {
    const result = await this.send(command, signal, timeoutMs);
    if (!result.ok) throw new SidecarError(result.error, result.data);
    return result as ResultMessage<C["type"]> & { ok: true };
  }

  /**
   * Igual ao `request`, mas devolve o `result` como veio, com `ok: false` incluído. `timeoutMs`: para um comando que
   * espera a pessoa (o `shortcut.record`, T5349); o padrão é o `requestTimeoutMs`.
   */
  send<C extends Command>(
    command: C,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ResultMessage<C["type"]>> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new SidecarError("sidecar_closed"));
    if (signal?.aborted) return Promise.reject(new SidecarError("aborted"));
    const id = `b${++this.nextId}`;
    if (command.type === "ping") {
      this.pingIds.add(id);
      // Retém poucos ids após o prazo: um pong tardio ainda prova que o helper está vivo.
      if (this.pingIds.size > 10)
        this.pingIds.delete(this.pingIds.values().next().value!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id, new SidecarError("sidecar_timeout")),
        timeoutMs ?? this.options.requestTimeoutMs ?? 15_000,
      );
      this.pending.set(id, {
        resolve: resolve as (r: ResultMessage) => void,
        reject,
        timer,
      });
      signal?.addEventListener(
        "abort",
        () => this.settle(id, new SidecarError("aborted")),
        { once: true },
      );
      try {
        this.write(encode({ ...command, v: IPC_VERSION, id } as Message));
      } catch (e) {
        this.settle(id, e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private settle(id: string, outcome: ResultMessage | Error) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (outcome instanceof Error) p.reject(outcome);
    else p.resolve(outcome);
  }

  private failPending(code: string) {
    for (const id of [...this.pending.keys()])
      this.settle(id, new SidecarError(code));
  }

  private receive(m: Message) {
    if (isResult(m)) {
      if (this.pingIds.delete(m.id) && m.ok) this.missedPings = 0;
      return this.settle(m.id, m);
    }
    if (!isEvent(m)) return;
    if (m.type === "ready") {
      if (this.stopped || !this.proc || this.terminationReason) return;
      const firstReady = !this.ready;
      this.ready = m;
      if (firstReady) this.watchReady();
      this.connected!.resolve(m);
    } else if (m.type === "permissions.changed" && this.ready) {
      this.ready = {
        ...this.ready,
        permissions: m.permissions,
        hotkeyActive: m.hotkeyActive,
        hotkeyPriority: m.hotkeyPriority ?? this.ready.hotkeyPriority,
        llm: m.llm ?? this.ready.llm,
      };
    }
    for (const key of [m.type, "*"]) {
      for (const fn of this.listeners.get(key) ?? []) {
        try {
          fn(m);
        } catch (e) {
          this.log(`listener for ${m.type} failed: ${String(e)}`);
        }
      }
    }
  }

  private log(message: string, level: "info" | "warn" | "error" = "warn") {
    if (this.options.log) this.options.log(`[sidecar] ${message}`, level);
    else
      (level === "info"
        ? console.log
        : level === "error"
          ? console.error
          : console.warn)(`[sidecar] ${message}`);
  }
}

export type { CommandType };
