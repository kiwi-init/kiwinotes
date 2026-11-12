// T8487: pure fog inputs/time policy. The cat, eyes and symbols never animate here.
import { Color, SRGBColorSpace } from "three";
export const STATES = [
  "repouso",
  "dormindo",
  "acordou",
  "ouvindo",
  "thinking",
  "agindo",
  "pronto",
  "erro",
] as const;
export type FogState = (typeof STATES)[number];
export interface FogInputs {
  estado: FogState;
  voz?: number | null;
  cor: string;
  parado: boolean;
}
export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const smooth = (n: number) => {
  const x = clamp(n);
  return x * x * (3 - 2 * x);
};
const presets: Record<string, string> = {
  padrao: "#a69ac5",
  claude: "#ff9b5e",
  codex: "#faf9ff",
};
export function palette(input: string): [number, number, number] {
  const c = new Color().setStyle(presets[input] ?? input, SRGBColorSpace);
  const rgb: [number, number, number] = [clamp(c.r), clamp(c.g), clamp(c.b)];
  const y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  if (y < 0.28) {
    const lift = (0.28 - y) / (1 - y);
    return rgb.map((v) => v + (1 - v) * lift) as typeof rgb;
  }
  return rgb;
}
export function voiceLevel(input: number | null | undefined) {
  return typeof input === "number" && Number.isFinite(input)
    ? clamp((input - 0.04) / 0.96)
    : 0;
}
export function voiceEnvelope(previous: number, target: number, dt: number) {
  const tau = target > previous ? 0.06 : 0.28;
  return target + (previous - target) * Math.exp(-Math.max(0, dt) / tau);
}
const activeState = (state: FogState) =>
  state !== "repouso" && state !== "dormindo";
export interface FogFrame {
  activity: number;
  activeFlow: number;
  radialFlow: number;
  phase: number;
  exposure: number;
  side: number;
  upper: number;
  volume: number;
  pace: number;
  time: number;
  flow: number;
  tint: [number, number, number];
  custom: number;
  state: FogState;
}
class Drift {
  private seed: number;
  private next: number;
  private start = 0;
  private from = 0;
  private target = 0;
  private duration = 1;
  constructor(
    private state: FogState,
    seed: number,
  ) {
    this.seed = seed >>> 0 || 1;
    this.next = this.interval();
  }
  private random() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  private interval() {
    const ranges =
      this.state === "repouso"
        ? [5, 11]
        : this.state === "thinking"
          ? [2.5, 5]
          : [2, 4];
    return ranges[0]! + (ranges[1]! - ranges[0]!) * this.random();
  }
  private at(t: number) {
    return (
      this.from +
      (this.target - this.from) * smooth((t - this.start) / this.duration)
    );
  }
  value(t: number) {
    while (t >= this.next) {
      this.from = this.at(this.next);
      this.start = this.next;
      this.target = this.random() * 2 - 1;
      this.duration =
        this.state === "repouso"
          ? 3 + this.random() * 3
          : this.state === "thinking"
            ? 1.6 + this.random() * 0.8
            : 1.4;
      this.next += this.interval();
    }
    return this.at(t);
  }
}
function pose(
  state: FogState,
  t: number,
  y: number,
  side = 0,
): Pick<FogFrame, "exposure" | "side" | "upper" | "volume" | "pace"> {
  switch (state) {
    case "repouso":
      return {
        exposure: 1 + 0.05 * side,
        side: 0,
        upper: 0,
        volume: 1,
        pace: 0.035,
      };
    case "dormindo":
      return { exposure: 0.5, side: 0, upper: 0, volume: 1, pace: 0.012 };
    case "acordou": {
      const rise = smooth((t - 0.2) / 0.33),
        fall = smooth((t - 0.72) / 0.68);
      return {
        exposure: 0.82 + 0.34 * rise - 0.14 * fall,
        side: 0,
        upper: 0.16 * rise * (1 - fall),
        volume: 1 + 0.08 * rise * (1 - fall),
        pace: 0.05,
      };
    }
    case "ouvindo":
      return {
        exposure: 0.66 + 0.6 * y,
        side: 0,
        upper: 0.1 * y,
        volume: 1 + 0.16 * y,
        pace: 0.06,
      };
    case "thinking":
      return {
        exposure: 0.95,
        side: 0.28 * side,
        upper: 0.2,
        volume: 1,
        pace: 0.045,
      };
    case "agindo":
      return {
        exposure: 1.12,
        side: 0.12 * side,
        upper: 0,
        volume: 1,
        pace: 0.06,
      };
    case "pronto":
      return {
        exposure: 1.06 - 0.1 * smooth(t / 1.1),
        side: 0,
        upper: 0,
        volume: 1 + 0.08 * Math.sin(Math.PI * clamp(t / 0.9)),
        pace: 0.04,
      };
    case "erro":
      return {
        exposure: 0.68 - 0.18 * smooth(t / 0.7),
        side: 0,
        upper: 0,
        volume: 1,
        pace: 0.02,
      };
  }
}
export class FogDynamics {
  inputs: FogInputs;
  private last = 0;
  private drift: Drift;
  private serial = 0;
  private entered = 0;
  private transitionStart = -Infinity;
  private voice = 0;
  private activityFrom: number;
  private flow = 0;
  private activeFlow = 0;
  private origin: ReturnType<typeof pose>;
  private tintFrom: [number, number, number];
  private tintTo: [number, number, number];
  private colourStart = 0;
  private customFrom: number;
  private customTo: number;
  constructor(
    inputs: Partial<FogInputs> = {},
    private seed = 1,
  ) {
    this.inputs = {
      estado: "repouso",
      voz: null,
      cor: "padrao",
      parado: false,
      ...inputs,
    };
    this.origin = pose(this.inputs.estado, 0, 0);
    this.activityFrom = activeState(this.inputs.estado) ? 1 : 0;
    this.drift = new Drift(this.inputs.estado, seed);
    this.tintFrom = this.tintTo = palette(this.inputs.cor);
    this.customFrom = this.customTo = this.inputs.cor === "padrao" ? 0 : 1;
  }
  update(patch: Partial<FogInputs>, now: number) {
    const current = this.sample(now),
      next = { ...this.inputs, ...patch };
    if (next.estado !== this.inputs.estado) {
      this.origin = current;
      this.activityFrom = current.activity;
      this.entered = now;
      this.transitionStart = now;
      this.drift = new Drift(next.estado, this.seed + ++this.serial * 7919);
    }
    if (next.cor !== this.inputs.cor) {
      this.tintFrom = current.tint;
      this.customFrom = current.custom;
      this.tintTo = palette(next.cor);
      this.customTo = next.cor === "padrao" ? 0 : 1;
      this.colourStart = now;
    }
    this.inputs = next;
    if (typeof next.voz !== "number") this.voice = 0;
    if (next.parado) {
      this.tintFrom = this.tintTo;
      this.customFrom = this.customTo;
    }
  }
  sample(now: number): FogFrame {
    const dt = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.voice =
      typeof this.inputs.voz === "number"
        ? voiceEnvelope(this.voice, voiceLevel(this.inputs.voz), dt)
        : 0;
    const t = this.inputs.parado ? 0 : Math.max(0, now - this.entered);
    const target = pose(
      this.inputs.estado,
      this.inputs.parado && this.inputs.estado === "acordou"
        ? 1.4
        : this.inputs.parado && this.inputs.estado === "erro"
          ? 0.7
          : t,
      this.inputs.parado ? 0 : this.voice,
      this.inputs.parado ? 0 : this.drift.value(t),
    );
    if (this.inputs.parado && this.inputs.estado === "ouvindo")
      target.exposure = typeof this.inputs.voz === "number" ? 0.8 : 0.66;
    const blend = this.inputs.parado
      ? 1
      : smooth((now - this.transitionStart) / 0.24);
    const colour = this.inputs.parado
      ? 1
      : smooth((now - this.colourStart) / 0.4);
    const mix = (a: number, b: number, u: number) => a + (b - a) * u;
    const fields = {
      activity: mix(
        this.activityFrom,
        activeState(this.inputs.estado) ? 1 : 0,
        blend,
      ),
      exposure: mix(this.origin.exposure, target.exposure, blend),
      side: mix(this.origin.side, target.side, blend),
      upper: mix(this.origin.upper, target.upper, blend),
      volume: mix(this.origin.volume, target.volume, blend),
      pace: mix(this.origin.pace, target.pace, blend),
    };
    if (!this.inputs.parado) {
      const step = dt * fields.pace;
      this.flow += step;
      this.activeFlow += step * fields.activity;
    }
    // Keep the approved first eight seconds unchanged. Thereafter bound the
    // radial stretch below the point where the spatial Jacobian collapses;
    // upward drift and the third noise dimension continue without a loop.
    const tail = Math.max(0, this.activeFlow - 0.5);
    const radialFlow =
      Math.min(this.activeFlow, 0.5) + tail / Math.hypot(1, tail / 1.5);
    const phase =
      this.activeFlow === this.flow
        ? Math.fround(Math.fround(this.flow) * 3)
        : Math.fround(
            Math.fround(this.flow) +
              Math.fround(Math.fround(this.activeFlow) * 2),
          );
    return {
      ...fields,
      activeFlow: this.inputs.parado ? 0 : this.activeFlow,
      radialFlow: this.inputs.parado ? 0 : radialFlow,
      phase: this.inputs.parado ? 0 : phase,
      flow: this.inputs.parado ? 0 : this.flow,
      exposure: Math.max(0.5, fields.exposure),
      time: this.inputs.parado ? 0 : now,
      tint: this.tintFrom.map((v, i) => mix(v, this.tintTo[i]!, colour)) as [
        number,
        number,
        number,
      ],
      custom: mix(this.customFrom, this.customTo, colour),
      state: this.inputs.estado,
    };
  }
}
export class DrawingPolicy {
  readonly idleFPS: number;
  constructor(idleFPS = 3) {
    this.idleFPS = Number.isFinite(idleFPS) ? clamp(idleFPS, 1, 30) : 3;
  }
  hidden = false;
  reduced = false;
  slow = false;
  private intervals: number[] = [];
  private previous: number | undefined;
  get continuous() {
    return !this.hidden && !this.reduced && !this.slow;
  }
  interval(state: FogState, transition = false) {
    return state === "repouso" || state === "dormindo"
      ? transition
        ? 1 / 30
        : 1 / this.idleFPS
      : 1 / 60;
  }
  observe(seconds: number) {
    if (this.previous !== undefined) {
      this.intervals.push(seconds - this.previous);
      if (this.intervals.length > 60) this.intervals.shift();
    }
    this.previous = seconds;
    if (
      this.intervals.length === 60 &&
      this.intervals.reduce((a, b) => a + b, 0) / 60 > 1 / 24
    )
      this.slow = true;
  }
  resetCadence() {
    this.previous = undefined;
    this.intervals = [];
  }
}
