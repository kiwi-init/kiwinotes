// Quando o trabalho de fundo da busca pelo sentido pode andar (P0 de CPU, spec #24228). O modelo para enquanto a pessoa
// usa o Mac: dita, fala com o agente, grava uma reunião ou digita numa nota. Também para na bateria. Volta depois de
// um tempo sem nada disso (`QUIET_MS`). Fora do Kiwi, o tempo parado do sistema (`HIDIdleTime`, só o número, sem
// permissão nem tecla nenhuma) também segura o modelo: a pessoa passa o dia em outros apps (lead #24259).

import { spawn } from "node:child_process";

/** Quanto tempo parado, depois do último uso, antes de o modelo voltar. */
export const QUIET_MS = 20_000;
/** De quanto em quanto tempo a bateria é conferida (o `pmset` é um processo). */
const BATTERY_EVERY_MS = 60_000;
/** Menos que isto parado no sistema (teclado, mouse, trackpad, em qualquer app): o modelo espera. */
export const SYSTEM_IDLE_MS = 30_000;
/** De quanto em quanto tempo o tempo parado é lido (o `ioreg` é um processo), só enquanto há fila. */
export const SYSTEM_IDLE_EVERY_MS = 10_000;

/** `pmset -g batt`: o Mac está na bateria? Um Mac de mesa, ou sem resposta: não. */
export function onBattery(pmsetOutput: string): boolean {
  return /Now drawing from 'Battery Power'/.test(pmsetOutput);
}

export function pmsetOutput(): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("/usr/bin/pmset", ["-g", "batt"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out));
  });
}

/** `ioreg -c IOHIDSystem`: há quanto tempo, em ms, ninguém mexe no teclado nem no mouse. Sem resposta: `null`. */
export function hidIdleMs(ioregOutput: string): number | null {
  const m = /"HIDIdleTime" = (\d+)/.exec(ioregOutput);
  return m ? Number(m[1]) / 1e6 : null;
}

export function ioregOutput(): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-r", "-d", "1", "-k", "HIDIdleTime"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out));
  });
}

export interface BackgroundGateOptions {
  now?(): number;
  /** A saída do `pmset -g batt` (nos testes, de mentira). `null` não confere a bateria. */
  battery?: (() => Promise<string>) | null;
  /** A saída do `ioreg` do tempo parado (nos testes, de mentira). `null` não confere. */
  systemIdle?: (() => Promise<string>) | null;
  sleep?(ms: number): Promise<void>;
  quietMs?: number;
}

/** O que segura a espera: `battery: false` pula a bateria (só o uso segura). */
export interface WaitOptions {
  battery?: boolean;
}

export class BackgroundGate {
  private readonly holds = new Set<string>();
  private lastActive = -Infinity;
  private battery = { at: -Infinity, on: false };
  /** A última leitura do tempo parado do sistema: quando, e quanto (`Infinity` sem resposta). */
  private idle = { at: -Infinity, ms: Infinity };
  private readonly readIdle: (() => Promise<string>) | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly readBattery: (() => Promise<string>) | null;
  private readonly quietMs: number;

  constructor(o: BackgroundGateOptions = {}) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.readBattery = o.battery === undefined ? pmsetOutput : o.battery;
    this.quietMs = o.quietMs ?? QUIET_MS;
    this.readIdle = o.systemIdle === undefined ? ioregOutput : o.systemIdle;
  }

  /** Algo da pessoa começou (`dictation`, `meeting`, `agent`): o modelo para até o `release`. */
  hold(reason: string): void {
    this.holds.add(reason);
  }

  /** Terminou: conta como uso, e o modelo volta depois de `QUIET_MS`. */
  release(reason: string): void {
    if (this.holds.delete(reason)) this.touch();
  }

  /** Um uso que não tem fim marcado (digitar numa nota, uma busca). */
  touch(): void {
    this.lastActive = this.now();
  }

  /**
   * Por que o modelo está parado agora, ou `null` se pode andar. `battery: false`: a bateria não segura (o índice do
   * conteúdo, leve, segue na bateria com o teto dele; lead #24453).
   */
  async blocked(o: WaitOptions = {}): Promise<string | null> {
    if (this.holds.size) return [...this.holds][0]!;
    if (this.now() - this.lastActive < this.quietMs) return "active";
    if (this.readIdle) {
      if (this.now() - this.idle.at >= SYSTEM_IDLE_EVERY_MS) {
        this.idle = { at: this.now(), ms: hidIdleMs(await this.readIdle().catch(() => "")) ?? Infinity };
      }
      // Entre leituras, o parado cresce com o relógio; um uso novo aparece na próxima leitura.
      if (this.idle.ms + (this.now() - this.idle.at) < SYSTEM_IDLE_MS) return "system";
    }
    if (this.readBattery && o.battery !== false) {
      if (this.now() - this.battery.at >= BATTERY_EVERY_MS) {
        this.battery = { at: this.now(), on: onBattery(await this.readBattery().catch(() => "")) };
      }
      if (this.battery.on) return "battery";
    }
    return null;
  }

  /** Espera até poder andar. `stop()` corta a espera (o índice fechando). */
  async wait(stop: () => boolean = () => false, o: WaitOptions = {}): Promise<void> {
    for (;;) {
      if (stop()) return;
      const why = await this.blocked(o);
      if (!why) return;
      const left =
        why === "active" ? this.lastActive + this.quietMs - this.now()
        : why === "system" ? SYSTEM_IDLE_MS - this.idle.ms - (this.now() - this.idle.at)
        : 0;
      await this.sleep(Math.min(Math.max(left, 1000), why === "battery" ? BATTERY_EVERY_MS : why === "system" ? SYSTEM_IDLE_EVERY_MS : 5000));
    }
  }
}

/** Os eventos do helper que seguram o modelo. */
type GateEvent =
  | "record.started" | "record.stopped" | "record.cancelled"
  | "agent.record.started" | "agent.record.stopped" | "agent.record.cancelled"
  | "ready";

/**
 * Liga o portão ao helper e às reuniões: o ditado, a fala com o agente e a gravação de uma reunião seguram o modelo até
 * o fim. O helper que cai no meio de uma gravação não manda o fim: o `ready` do helper novo solta o ditado e o agente.
 */
export function wireGate(
  sidecar: { on(type: GateEvent, fn: () => void): unknown },
  meetings: { onChange(fn: (live: { recording: boolean }) => void): unknown },
  gate: Pick<BackgroundGate, "hold" | "release">,
): void {
  sidecar.on("record.started", () => gate.hold("dictation"));
  sidecar.on("record.stopped", () => gate.release("dictation"));
  sidecar.on("record.cancelled", () => gate.release("dictation"));
  sidecar.on("agent.record.started", () => gate.hold("agent"));
  sidecar.on("agent.record.stopped", () => gate.release("agent"));
  sidecar.on("agent.record.cancelled", () => gate.release("agent"));
  sidecar.on("ready", () => {
    gate.release("dictation");
    gate.release("agent");
  });
  meetings.onChange((live) => (live.recording ? gate.hold("meeting") : gate.release("meeting")));
}
