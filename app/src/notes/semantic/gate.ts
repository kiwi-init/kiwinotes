// Quando o trabalho de fundo da busca pelo sentido pode andar (P0 de CPU, spec #24228). O modelo para enquanto a pessoa
// usa o Mac: dita, fala com o agente, grava uma reunião ou digita numa nota. Também para na bateria. Volta depois de
// um tempo sem nada disso (`QUIET_MS`).

import { spawn } from "node:child_process";

/** Quanto tempo parado, depois do último uso, antes de o modelo voltar. */
export const QUIET_MS = 20_000;
/** De quanto em quanto tempo a bateria é conferida (o `pmset` é um processo). */
const BATTERY_EVERY_MS = 60_000;

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

export interface BackgroundGateOptions {
  now?(): number;
  /** A saída do `pmset -g batt` (nos testes, de mentira). `null` não confere a bateria. */
  battery?: (() => Promise<string>) | null;
  sleep?(ms: number): Promise<void>;
  quietMs?: number;
}

export class BackgroundGate {
  private readonly holds = new Set<string>();
  private lastActive = -Infinity;
  private battery = { at: -Infinity, on: false };
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly readBattery: (() => Promise<string>) | null;
  private readonly quietMs: number;

  constructor(o: BackgroundGateOptions = {}) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.readBattery = o.battery === undefined ? pmsetOutput : o.battery;
    this.quietMs = o.quietMs ?? QUIET_MS;
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

  /** Por que o modelo está parado agora, ou `null` se pode andar. */
  async blocked(): Promise<string | null> {
    if (this.holds.size) return [...this.holds][0]!;
    if (this.now() - this.lastActive < this.quietMs) return "active";
    if (this.readBattery) {
      if (this.now() - this.battery.at >= BATTERY_EVERY_MS) {
        this.battery = { at: this.now(), on: onBattery(await this.readBattery().catch(() => "")) };
      }
      if (this.battery.on) return "battery";
    }
    return null;
  }

  /** Espera até poder andar. `stop()` corta a espera (o índice fechando). */
  async wait(stop: () => boolean = () => false): Promise<void> {
    for (;;) {
      if (stop()) return;
      const why = await this.blocked();
      if (!why) return;
      const left = why === "active" ? this.lastActive + this.quietMs - this.now() : 0;
      await this.sleep(Math.min(Math.max(left, 1000), why === "battery" ? BATTERY_EVERY_MS : 5000));
    }
  }
}
