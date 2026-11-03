// O lado Bun do socket com o sidecar Swift (ADR 0001): escuta o socket unix, sobe o helper com
// `--socket <path>`, casa cada comando com o seu `result` pelo `id` e repassa os eventos.
// Se o helper cair, sobe de novo (com espera crescente), e os pedidos pendentes falham com `sidecar_closed`.

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

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

export interface SidecarOptions {
  /** O executável `kiwi-helper`. */
  helper: string;
  socketPath: string;
  /** Variáveis a mais para o helper (por exemplo `KIWI_DEBUG=1` nos testes). */
  env?: Record<string, string>;
  /** Quanto esperar por um `result` antes de desistir. */
  requestTimeoutMs?: number;
  /** Troca o `Bun.spawn` (testes). Devolve algo que dá para matar e que avisa quando sai. */
  spawn?: (argv: string[], env: Record<string, string>) => { kill(): void; exited: Promise<unknown> };
  log?: (message: string) => void;
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
  private proc?: { kill(): void; exited: Promise<unknown> };
  private pending = new Map<string, { resolve(r: ResultMessage): void; reject(e: Error): void; timer: Timer }>();
  private listeners = new Map<string, Set<Listener>>();
  private nextId = 0;
  private stopped = false;
  private restarts = 0;
  /**
   * O que ainda não coube no socket. O `write` do Bun escreve só o que cabe no buffer e devolve quantos bytes
   * foram; o resto sai no `drain`, na ordem (review #521: um `config.set` de 30 KB chegava cortado em 8 KB).
   */
  private outbox: Uint8Array[] = [];
  private connected?: { promise: Promise<Ready>; resolve(r: Ready): void };
  /** O último `ready`, com o `llm` atualizado pelos `permissions.changed`. */
  ready?: Ready;

  constructor(private readonly options: SidecarOptions) {
    this.resetConnected();
  }

  private resetConnected() {
    let resolve!: (r: Ready) => void;
    const promise = new Promise<Ready>((r) => (resolve = r));
    this.connected = { promise, resolve };
  }

  /** Resolve no próximo `ready` (o primeiro, ou o de depois de um restart). */
  whenReady(): Promise<Ready> {
    return this.ready && this.socket ? Promise.resolve(this.ready) : this.connected!.promise;
  }

  start(): void {
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
          if (this.socket) return void s.end();
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
          this.socket = undefined;
          this.outbox = [];
          this.ready = undefined;
          this.resetConnected();
          this.failPending("sidecar_closed");
        },
      },
    });
    chmodSync(socketPath, 0o600);
    this.spawnHelper();
  }

  private spawnHelper(): void {
    if (this.stopped) return;
    const argv = [this.options.helper, "--socket", this.options.socketPath];
    const env = { ...(process.env as Record<string, string>), ...this.options.env };
    const spawn =
      this.options.spawn ?? ((a: string[], e: Record<string, string>) => Bun.spawn(a, { env: e, stdout: "inherit", stderr: "inherit" }));
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(argv, env);
    } catch (e) {
      // Sem o executável (`bun dev` sem `swift build`, um KIWI_HELPER errado): o app fica de pé e tenta de novo.
      this.log(`couldn't start the helper (${String(e)}); retrying`);
      setTimeout(() => this.spawnHelper(), this.nextWait());
      return;
    }
    this.proc = proc;
    void proc.exited.then(() => {
      if (this.proc !== proc || this.stopped) return;
      const wait = this.nextWait();
      this.log(`sidecar exited; restarting in ${wait} ms`);
      setTimeout(() => this.spawnHelper(), wait);
    });
  }

  /** Sobe de novo: 0,5 s, 1 s, 2 s… até 30 s. Um `ready` zera a conta. */
  private nextWait(): number {
    return Math.min(30_000, 500 * 2 ** this.restarts++);
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

  stop(): void {
    this.stopped = true;
    this.failPending("sidecar_closed");
    this.proc?.kill();
    this.socket?.end();
    this.server?.stop(true);
    rmSync(this.options.socketPath, { force: true });
  }

  on<T extends Event["type"]>(type: T | "*", fn: (e: EventMessage<Extract<Event, { type: T }>>) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener);
    return () => set!.delete(fn as Listener);
  }

  /** Manda um comando e espera o `result`. Rejeita com `SidecarError` quando o `ok` é `false`. */
  async request<C extends Command>(command: C, signal?: AbortSignal): Promise<ResultMessage<C["type"]> & { ok: true }> {
    const result = await this.send(command, signal);
    if (!result.ok) throw new SidecarError(result.error, result.data);
    return result as ResultMessage<C["type"]> & { ok: true };
  }

  /** Igual ao `request`, mas devolve o `result` como veio, com `ok: false` incluído. */
  send<C extends Command>(command: C, signal?: AbortSignal): Promise<ResultMessage<C["type"]>> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new SidecarError("sidecar_closed"));
    if (signal?.aborted) return Promise.reject(new SidecarError("aborted"));
    const id = `b${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, new SidecarError("sidecar_timeout")), this.options.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve: resolve as (r: ResultMessage) => void, reject, timer });
      signal?.addEventListener("abort", () => this.settle(id, new SidecarError("aborted")), { once: true });
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
    for (const id of [...this.pending.keys()]) this.settle(id, new SidecarError(code));
  }

  private receive(m: Message) {
    if (isResult(m)) return this.settle(m.id, m);
    if (!isEvent(m)) return;
    if (m.type === "ready") {
      this.ready = m;
      this.restarts = 0;
      this.connected!.resolve(m);
    } else if (m.type === "permissions.changed" && this.ready) {
      this.ready = { ...this.ready, permissions: m.permissions, hotkeyActive: m.hotkeyActive, llm: m.llm ?? this.ready.llm };
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

  private log(message: string) {
    (this.options.log ?? console.warn)(`[sidecar] ${message}`);
  }
}

export type { CommandType };
