// O estado que o gato mostra, no tempo (T14885, spec #14813). O desenho mudou; os tempos são os do gato de antes
// (o `GestureMachine` do T8959), porque são função e não desenho:
//
// - o `pronto` volta sozinho ao `repouso` em 1,1 s;
// - parado no `repouso`, o gato dorme depois de 240 a 360 s (um sorteio por vez); um novo `repouso` recomeça a conta;
// - o `acordou` segura 0,32 s antes do `ouvindo`, para a entrada aparecer;
// - o resto (o `erro`, o `thinking`, o `agindo`) fica até o próximo estado.
//
// TypeScript puro, no relógio de quem chama (segundos): testado no `bun test`.

import { catLook, type CatLook } from "../hub/cat-state";

export const STATES = ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"] as const;
export type FogState = (typeof STATES)[number];

/** O `pronto` dura isto antes de voltar ao `repouso` (s). */
export const READY_SECONDS = 1.1;
/** O `acordou` segura isto antes do `ouvindo` (s). */
export const WAKE_HOLD_SECONDS = 0.32;

export interface VisualOptions {
  random?: () => number;
  /** Quanto tempo parado até dormir (s); o padrão sorteia de 240 a 360. */
  sleepSeconds?: () => number;
}

export class CatVisual {
  state: FogState;
  /** O `erro` foi o limite de uso: o emote é o `limite`. */
  limit = false;
  private entered: number;
  private requested: FogState;
  private pending: { state: FogState; at: number } | null = null;
  private sleepAt = Infinity;
  private readyAt = Infinity;

  constructor(state: FogState, now: number, private readonly options: VisualOptions = {}) {
    this.state = this.requested = state;
    this.entered = now;
    this.arm(now);
  }

  private arm(at: number) {
    this.readyAt = this.state === "pronto" ? at + READY_SECONDS : Infinity;
    if (this.state === "repouso") {
      const r = this.options.sleepSeconds?.() ?? 240 + 120 * (this.options.random ?? Math.random)();
      this.sleepAt = at + Math.max(0.001, Number.isFinite(r) ? r : 300);
    } else this.sleepAt = Infinity;
  }

  private enter(state: FogState, at: number) {
    this.state = state;
    this.entered = at;
    this.pending = null;
    this.arm(at);
  }

  /** A próxima troca sozinha (s), ou `Infinity`. */
  nextBoundary(): number {
    return Math.min(this.pending?.at ?? Infinity, this.readyAt, this.sleepAt);
  }

  /** Leva o estado até `t`, passando pelas trocas sozinhas. */
  sample(t: number): FogState {
    for (let i = 0; i < 8; i++) {
      const due = this.nextBoundary();
      if (!(due <= t)) break;
      if (this.pending && due === this.pending.at) this.enter(this.pending.state, due);
      else if (due === this.readyAt) this.enter("repouso", due);
      else if (due === this.sleepAt) this.enter("dormindo", due);
    }
    return this.state;
  }

  /** O estado pedido, em `t`. `limit` diz que o `erro` é o limite de uso. */
  update(next: FogState, t: number, limit = false): FogState {
    this.sample(t);
    this.limit = next === "erro" && limit;
    const changed = next !== this.requested || (next === "repouso" && this.state === "dormindo");
    this.requested = next;
    if (changed) {
      if (this.state === "acordou" && next === "ouvindo" && t < this.entered + WAKE_HOLD_SECONDS)
        this.pending = { state: next, at: this.entered + WAKE_HOLD_SECONDS };
      else this.enter(next, t);
    } else if (next === "repouso" && this.state === "repouso") this.arm(t);
    return this.state;
  }

  /** O que o gato novo desenha agora. */
  get look(): CatLook {
    return catLook(this.state, this.state === "erro" && this.limit);
  }
}

/** Quantos intervalos ativos a guarda olha, e a média acima da qual o gato congela (s): abaixo de 24 fps. */
export const SLOW_WINDOW = 60;
export const SLOW_INTERVAL = 1 / 24;

/**
 * A guarda da GPU lenta (a `DrawingPolicy` do gato de antes, T8487): se os últimos 60 quadros trabalhando saíram, em
 * média, abaixo de 24 fps, o gato desiste do movimento e fica num quadro parado por estado, como no reduzir movimento.
 * Não volta sozinho. O repouso (o ritmo baixo de propósito) não conta: quem chama zera a conta nele.
 */
export class SlowGuard {
  slow = false;
  private intervals: number[] = [];
  private previous: number | undefined;

  /** Um quadro trabalhando desenhado em `t` (s). Devolve `true` no quadro em que o gato fica lento. */
  observe(t: number): boolean {
    if (this.slow) return false;
    if (this.previous !== undefined) {
      this.intervals.push(t - this.previous);
      if (this.intervals.length > SLOW_WINDOW) this.intervals.shift();
    }
    this.previous = t;
    if (this.intervals.length === SLOW_WINDOW && this.intervals.reduce((a, b) => a + b, 0) / SLOW_WINDOW > SLOW_INTERVAL) {
      this.slow = true;
      return true;
    }
    return false;
  }

  /** Uma pausa (repouso, escondido, troca de estado): o próximo quadro não mede o buraco. */
  reset() {
    this.previous = undefined;
    this.intervals = [];
  }
}
