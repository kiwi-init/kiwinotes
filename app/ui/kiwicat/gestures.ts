// T8959: elapsed-time gesture machine. No DOM, microphone or host actions.
import { clamp, smooth, voiceEnvelope, voiceLevel, type FogInputs, type FogState } from "./state";
export interface EyePose {
  x: number; y: number; size: number; rightSize: number;
  opening: number; blink: number; happy: number; asleep: number;
}
export interface CatFrame {
  state: FogState; eyes: EyePose; time: number; stateTime: number;
  symbol: FogState | null; symbolAlpha: number; symbolScale: number;
  symbolY: number; progress: number; jitter: [number, number];
  waves: number[]; dots: number[]; work: number; workOffsets: number[];
}
interface Blink { at: number; close: number; hold: number; open: number; second: boolean }
interface Look { at: number; to: number; up: number; go: number; hold: number; back: number; completedFreeze: number; freezeAt: number; freezeFor: number }
export interface GestureEvent { kind: string; at: number; values: number[] }
export interface GestureOptions {
  clock: () => number;
  random: () => number;
  /** One value per inactivity episode; defaults to uniform 240..360 seconds. */
  sleepSeconds?: () => number;
  onEvent?: (event: GestureEvent) => void;
}
export function seededRandom(seed: number) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
const neutral = (): EyePose => ({ x: 0, y: 0, size: 1, rightSize: 1, opening: 1, blink: 1, happy: 0, asleep: 0 });
const mix = (a: number, b: number, u: number) => a + (b - a) * u;
const blend = (a: EyePose, b: EyePose, u: number): EyePose => Object.fromEntries(
  Object.keys(a).map((k) => [k, mix(a[k as keyof EyePose], b[k as keyof EyePose], u)]),
) as unknown as EyePose;
const out = (u: number) => 1 - (1 - clamp(u)) ** 3;
const waveMask = (band: number) => [1, ...[1, 2].map((j) => j <= band ? 1 : 0)];
export class GestureMachine {
  readonly inputs: FogInputs;
  visualState: FogState;
  private requested: FogState;
  private now: number;
  private entered: number;
  private origin: EyePose;
  private transition = 0;
  private transitionAt = 0;
  private readyAt = Infinity;
  private resumed: { at: number; frame: CatFrame } | null = null;
  private previousFrame: CatFrame | null = null;
  private workOffsets = [0, 0, 0];
  private pending: { state: FogState; at: number } | null = null;
  private blink: Blink | null = null;
  private look: Look | null = null;
  private nextBlink = Infinity;
  private nextLook = Infinity;
  private sleepAt = Infinity;
  private nextCycle = Infinity;
  private cycleAt = 0;
  private cycleSeconds = 1;
  private dotAt = 0;
  private dotIndex = 0;
  private nextDot = Infinity;
  private voiceAt = 0;
  private voiceFrom = 0;
  private voiceTarget = 0;
  private waveBand = 0;
  private waveFrom = waveMask(0);
  private waveTo = waveMask(0);
  private waveAt = 0;
  private jitterPhase: number;
  constructor(inputs: Partial<FogInputs>, private readonly options: GestureOptions) {
    this.inputs = { estado: "repouso", voz: null, cor: "padrao", parado: false, ...inputs };
    this.visualState = this.requested = this.inputs.estado;
    this.now = this.entered = options.clock();
    this.origin = neutral();
    this.jitterPhase = this.range(0, Math.PI * 2);
    this.enter(this.visualState, this.now, true);
    this.setVoice(this.now);
  }
  private range(a: number, b: number) {
    const r = this.options.random();
    return mix(a, b, Number.isFinite(r) ? clamp(r, 0, 1 - Number.EPSILON) : .5);
  }
  private event(kind: string, at: number, ...values: number[]) {
    this.options.onEvent?.({ kind, at, values });
  }
  private resetSleep(at: number) {
    const duration = this.options.sleepSeconds?.() ?? this.range(240, 360);
    this.sleepAt = at + Math.max(.001, Number.isFinite(duration) ? duration : 300);
    this.event("tempo_ate_dormir", at, this.sleepAt - at);
  }
  private arm(at: number) {
    this.nextBlink = this.visualState === "repouso" ? at + this.range(4.5, 9) :
      this.visualState === "ouvindo" ? at + this.range(6, 11) : Infinity;
    this.nextLook = this.visualState === "repouso" ? at + this.range(6, 14) :
      this.visualState === "thinking" ? at + this.range(1.5, 3.5) : Infinity;
  }
  private enter(state: FogState, at: number, initial = false) {
    const old = this.project(at);
    const from = this.visualState;
    this.origin = initial ? neutral() : old.eyes;
    this.previousFrame = initial ? null : old;
    this.visualState = state; this.entered = at;
    this.transitionAt = at; this.resumed = null; this.doublePending = false;
    this.readyAt = state === "pronto" ? at + 1.1 : Infinity;
    this.transition = initial ? 0 : state === "dormindo" ? .6 :
      from === "acordou" && state === "ouvindo" ? .22 :
      state === "erro" ? .2 : state === "pronto" ? .18 : .24;
    this.blink = this.look = null; this.pending = null;
    this.sleepAt = this.nextCycle = this.nextDot = Infinity;
    if (state === "repouso") this.resetSleep(at);
    this.arm(at + this.transition);
    this.cycleAt = at + (state === "dormindo" ? .56 : 0);
    this.cycleSeconds = state === "dormindo" ? this.range(1.6, 2.3) :
      state === "erro" ? this.range(.94, 1.08) : state === "agindo" ? this.range(.65, .95) : 1;
    if (["dormindo", "erro", "agindo"].includes(state)) this.nextCycle = this.cycleAt + this.cycleSeconds;
    if (state === "agindo") this.workOffsets = [this.range(0, 1), this.range(0, 1), this.range(0, 1)];
    this.dotAt = at; this.dotIndex = 0;
    if (state === "thinking") this.nextDot = at + this.range(.32, .46);
    this.event("estado", at, ["repouso", "dormindo", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"].indexOf(state));
  }
  private voice(t: number) {
    return this.visualState === "ouvindo" && typeof this.inputs.voz === "number" ?
      voiceEnvelope(this.voiceFrom, this.voiceTarget, t - this.voiceAt) : 0;
  }
  private setVoice(t: number, restart = false) {
    const active = this.visualState === "ouvindo" && typeof this.inputs.voz === "number";
    this.voiceFrom = restart || !active ? 0 : this.voice(t);
    this.voiceAt = t;
    this.voiceTarget = active ? voiceLevel(this.inputs.voz) : 0;
    if (!active || restart) {
      this.waveBand = 0; this.waveFrom = this.waveTo = waveMask(0); this.waveAt = t;
    }
  }
  private nextWave() {
    if (this.visualState !== "ouvindo" || typeof this.inputs.voz !== "number") return Infinity;
    const current = this.voice(this.now), target = this.voiceTarget;
    if (target === current) return Infinity;
    const threshold = target > current ? (this.waveBand + 1) / 3 : this.waveBand / 3;
    if (threshold <= 0 || threshold >= 1 || (target - threshold) * (current - threshold) >= 0) return Infinity;
    const tau = target > this.voiceFrom ? .06 : .28;
    const at = this.voiceAt - tau * Math.log((threshold - target) / (this.voiceFrom - target));
    return at >= this.now - 1e-9 ? Math.max(this.now, at) : Infinity;
  }
  private blinkEnd() { const b = this.blink; return b ? b.at + b.close + b.hold + b.open : Infinity; }
  private lookEnd() { const l = this.look; return l ? l.at + l.go + l.hold + l.back + l.completedFreeze + l.freezeFor : Infinity; }
  nextBoundary() {
    if (this.inputs.parado) return Infinity;
    return Math.min(this.pending?.at ?? Infinity, this.sleepAt, this.nextBlink, this.nextLook,
      this.blinkEnd(), this.lookEnd(), this.nextCycle, this.nextDot, this.nextWave(),
      this.readyAt);
  }
  nextWake() {
    const phases: number[] = [];
    if (this.blink) phases.push(this.blink.at + this.blink.close, this.blink.at + this.blink.close + this.blink.hold);
    if (this.look) {
      const l = this.look;
      for (const phase of [l.at + l.go, l.at + l.go + l.hold]) {
        const at = phase + l.completedFreeze;
        phases.push(at + (at >= l.freezeAt ? l.freezeFor : 0));
      }
      phases.push(l.freezeAt, l.freezeAt + l.freezeFor);
    }
    return Math.min(this.nextBoundary(), ...phases.filter(at => at > this.now + 1e-8),
      this.transitionAt + this.transition > this.now ? this.transitionAt + this.transition : Infinity,
      this.resumed && this.resumed.at + .24 > this.now ? this.resumed.at + .24 : Infinity);
  }
  get moving() {
    return !this.inputs.parado && (this.visualState !== "repouso" || !!this.blink || !!this.look ||
      this.now < this.transitionAt + this.transition || !!this.resumed && this.now < this.resumed.at + .24);
  }
  private startBlink(t: number, second: boolean) {
    this.blink = { at: t, close: this.range(.24, .32), hold: this.range(.06, .1), open: this.range(.3, .44), second };
    this.nextBlink = Infinity;
    if (this.look) {
      // A second blink starts a new pause without replaying elapsed look time.
      this.look.completedFreeze += clamp(t - this.look.freezeAt, 0, this.look.freezeFor);
      this.look.freezeAt = t;
      this.look.freezeFor = this.blink.close + this.blink.hold;
    }
    this.event(second ? "piscar_duplo" : "piscar_lento", t, this.blink.close, this.blink.hold, this.blink.open);
  }
  /** Consume due events at their exact deadlines, independent of display FPS. */
  sample(t = this.options.clock()): CatFrame {
    const end = Math.max(this.now, Number.isFinite(t) ? t : this.now);
    if (!this.inputs.parado) {
      for (let count = 0; ; count++) {
        const due = this.nextBoundary();
        if (due > end || !Number.isFinite(due)) break;
        if (count > 100000) throw new Error("Gesture event scheduler did not advance");
        this.now = due;
        if (this.pending && due === this.pending.at) {
          const state = this.pending.state; this.enter(state, due); this.setVoice(due, true);
        } else if (due === this.sleepAt) this.enter("dormindo", due);
        else if (due === this.readyAt) this.enter("repouso", due);
        else if (due === this.blinkEnd()) {
          const second = this.blink!.second;
          this.blink = null;
          const double = !second && this.visualState === "repouso" && this.range(0, 1) < .18;
          this.nextBlink = due + (double ? this.range(.12, .22) : this.visualState === "repouso" ? this.range(4.5, 9) : this.range(6, 11));
          this.doublePending = double;
        } else if (due === this.nextBlink) {
          this.startBlink(due, this.doublePending); this.doublePending = false;
        } else if (due === this.lookEnd()) {
          this.look = null;
          this.nextLook = due + (this.visualState === "thinking" ? this.range(1.5, 3.5) : this.range(6, 14));
        } else if (due === this.nextLook) {
          if (this.blink && due < this.blink.at + this.blink.close + this.blink.hold) this.nextLook = this.blinkEnd();
          else {
            const thinking = this.visualState === "thinking";
            this.lookSide = thinking ? -this.lookSide : this.range(0, 1) < .5 ? -1 : 1;
            this.look = { at: due, to: this.lookSide * (thinking ? 30 : this.range(18, 30)), up: thinking ? -24 : 0,
              go: thinking ? .26 : this.range(.18, .26), hold: thinking ? this.range(.6, 1.1) : this.range(.6, 1.5),
              back: thinking ? .32 : this.range(.26, .36), completedFreeze: 0, freezeAt: Infinity, freezeFor: 0 };
            this.nextLook = Infinity;
            this.event(thinking ? "olhar_busca" : "olhar_lateral", due, this.look.to, this.look.go, this.look.hold, this.look.back);
          }
        } else if (due === this.nextCycle) {
          this.cycleAt = due;
          this.cycleSeconds = this.visualState === "dormindo" ? this.range(1.6, 2.3) : this.visualState === "erro" ? this.range(.94, 1.08) : this.range(.65, .95);
          this.nextCycle = due + this.cycleSeconds;
          this.event("ciclo_" + this.visualState, due, this.cycleSeconds);
        } else if (due === this.nextDot) {
          this.dotIndex = (this.dotIndex + 1) % 3; this.dotAt = due; this.nextDot = due + this.range(.32, .46);
        } else {
          this.waveFrom = this.waveValues(due);
          this.waveBand += this.voiceTarget > this.voice(due - 1e-8) ? 1 : -1;
          this.waveBand = clamp(this.waveBand, 0, 2);
          this.waveTo = waveMask(this.waveBand); this.waveAt = due;
          // Advance the comparison point beyond this exact crossing.
          this.now += 1e-10;
        }
      }
    }
    this.now = end;
    return this.project(end);
  }
  private doublePending = false;
  private lookSide = -1;
  update(input: Partial<FogInputs>, t = this.options.clock()) {
    const before = this.sample(t);
    const wasCapture = typeof this.inputs.voz === "number";
    const wasReduced = this.inputs.parado;
    const previousState = this.visualState;
    const next = input.estado;
    if (next !== undefined) {
      const changed = next !== this.requested || (next === "repouso" && this.visualState === "dormindo");
      this.requested = next;
      if (changed) {
        if (!(input.parado ?? this.inputs.parado) && this.visualState === "acordou" && next === "ouvindo" && this.now < this.entered + .32)
          this.pending = { state: next, at: this.entered + .32 };
        else this.enter(next, this.now);
      } else if (next === "repouso" && this.visualState === "repouso") this.resetSleep(this.now);
    }
    // Anchor the envelope before replacing the old numeric target.
    const voiceBefore = this.voice(this.now);
    Object.assign(this.inputs, input);
    this.inputs.estado = this.requested;
    if ("voz" in input || previousState !== this.visualState) {
      this.voiceFrom = voiceBefore; this.voiceAt = this.now;
      this.voiceTarget = voiceLevel(this.inputs.voz);
      if (previousState !== this.visualState || !wasCapture || typeof this.inputs.voz !== "number") this.setVoice(this.now, true);
    }
    if (wasReduced !== this.inputs.parado) {
      if (this.inputs.parado && this.pending) {
        this.enter(this.pending.state, this.now); this.setVoice(this.now, true);
      }
      this.blink = this.look = null; this.doublePending = false; this.pending = null;
      this.origin = before.eyes;
      this.transitionAt = this.now; this.transition = this.inputs.parado ? 0 : .24;
      this.resumed = this.inputs.parado ? null : { at: this.now, frame: before };
      this.arm(this.now + this.transition);
      if (this.visualState === "repouso") this.resetSleep(this.now);
      if (!this.inputs.parado) {
        if (this.visualState === "pronto") this.readyAt = this.now + .24;
        if (["dormindo", "erro", "agindo"].includes(this.visualState)) {
          const phase = this.visualState === "erro" ? 1 - .24 / this.cycleSeconds : .5;
          this.cycleAt = this.now - phase * this.cycleSeconds;
          this.nextCycle = this.cycleAt + this.cycleSeconds;
        }
        if (this.visualState === "thinking") {
          this.dotAt = this.now; this.nextDot = this.now + this.range(.32, .46);
        }
      }
    }
    return this.project(this.now);
  }
  /** Visibility resume discards old gestures instead of replaying a backlog. */
  resume(t = this.options.clock()) {
    this.now = t; this.blink = this.look = null; this.doublePending = false;
    this.arm(t + .24);
    if (this.visualState === "repouso") this.resetSleep(t);
    if (this.visualState === "pronto") this.readyAt = t + .24;
    if (this.nextCycle !== Infinity) { this.cycleAt = t; this.nextCycle = t + this.cycleSeconds; }
    if (this.nextDot !== Infinity) { this.dotAt = t; this.nextDot = t + this.range(.32, .46); }
    if (this.pending) this.pending.at = t + Math.max(0, this.entered + .32 - t);
    this.waveBand = Math.min(2, Math.floor(this.voice(t) * 3));
    this.waveFrom = this.waveTo = waveMask(this.waveBand); this.waveAt = t;
  }
  private waveValues(t: number) {
    return this.waveFrom.map((v, i) => mix(v, this.waveTo[i]!, smooth((t - this.waveAt) / .1)));
  }
  /** Read-only projection of already scheduled gestures, used for compositor keyframes. */
  project(t: number): CatFrame {
    const state = this.visualState, fixed = this.inputs.parado, age = Math.max(0, t - this.entered);
    const eyes = neutral();
    if (state === "dormindo") { eyes.asleep = 1; eyes.opening = 0; }
    if (state === "acordou") {
      eyes.opening = fixed ? 1 : mix(.65, 1, smooth(age / .35));
      eyes.size = fixed ? 1.24 : age < .2 ? 1 : age < .53 ? mix(1, 1.24, smooth((age - .2) / .33)) :
        age < .72 ? 1.24 : age < 1.05 ? mix(1.24, 1.1, smooth((age - .72) / .33)) :
        age < 1.4 ? mix(1.1, 1, smooth((age - 1.05) / .35)) : 1;
    }
    if (state === "thinking") { eyes.opening = .58; eyes.y = -24; eyes.x = fixed ? 30 : 0; }
    if (state === "agindo") { eyes.opening = .6; eyes.x = fixed ? 0 : 10 * smooth(age / .24); }
    if (state === "pronto") {
      eyes.happy = fixed ? 1 : age < .16 ? smooth(age / .16) : age < .7 ? 1 : 1 - smooth((age - .7) / .4);
      eyes.opening = 1 - eyes.happy;
    }
    if (state === "erro") { eyes.size = .72; eyes.rightSize = .62; }
    if (!fixed && this.look) {
      const l = this.look;
      const u = t - l.at - l.completedFreeze - clamp(t - l.freezeAt, 0, l.freezeFor);
      const strength = u < l.go ? smooth(u / l.go) : u < l.go + l.hold ? 1 : 1 - smooth((u - l.go - l.hold) / l.back);
      eyes.x = l.to * strength;
    }
    if (!fixed && this.blink) {
      const b = this.blink, u = t - b.at;
      eyes.blink = u < b.close ? 1 - smooth(u / b.close) : u < b.close + b.hold ? 0 : smooth((u - b.close - b.hold) / b.open);
    }
    const pose = fixed ? eyes : blend(this.origin ?? neutral(), eyes, this.transition ? smooth((t - this.transitionAt) / this.transition) : 1);
    let symbol: FogState | null = state === "repouso" ? null : state;
    let alpha = 1, scale = 1, y = 0, progress = 1;
    const cycle = fixed ? .5 : clamp((t - this.cycleAt) / this.cycleSeconds);
    if (state === "dormindo") { y = -120 * cycle; alpha = fixed ? 1 : smooth(cycle / .2) * (1 - smooth((cycle - .75) / .25)); }
    if (state === "acordou") {
      alpha = fixed ? 1 : age < .3 ? 0 : age < .46 ? out((age - .3) / .16) : 1 - smooth((age - .97) / .23);
      scale = fixed ? 1 : mix(.35, 1, out((age - .3) / .16));
      y = fixed ? 0 : 70 * (1 - out((age - .3) / .16)) - 28 * Math.sin(Math.PI * clamp((age - .46) / .51));
    }
    if (state === "pronto") {
      alpha = fixed ? 1 : out((age - .12) / .18) * (1 - smooth((age - .7) / .4));
      scale = fixed ? 1 : age < .3 ? mix(.75, 1, out((age - .12) / .18)) : mix(1, .85, smooth((age - .7) / .4));
    }
    if (state === "erro") {
      progress = fixed ? 1 : clamp(cycle / .9);
      alpha = fixed ? 1 : smooth(cycle / .08) * (1 - smooth((cycle - .92) / .08));
    }
    // No overlap between departing and arriving symbols.
    if (!fixed && this.previousFrame?.symbol && age < .08) {
      symbol = this.previousFrame.symbol; alpha = this.previousFrame.symbolAlpha * (1 - smooth(age / .08));
      scale = this.previousFrame.symbolScale; y = this.previousFrame.symbolY; progress = this.previousFrame.progress;
    }
    else if (!fixed && this.transition && state !== "acordou" && state !== "pronto") {
      const delay = state === "erro" ? .12 : state === "dormindo" ? .56 : .08;
      alpha *= out((age - delay) / .16); scale *= mix(.72, 1, out((age - delay) / .16)); y += 32 * (1 - out((age - delay) / .16));
    }
    const capturing = typeof this.inputs.voz === "number";
    const fading = !fixed && this.previousFrame?.symbol && age < .08 ? this.previousFrame : null;
    const waves = symbol === "ouvindo" && capturing ? fixed ? [1, 1, 1] : fading ? [...fading.waves] : this.waveValues(t).map((a, i) => i ? a : .35 + .65 * clamp(this.voice(t) * 3)) : [0, 0, 0];
    const dots = [0, 1, 2].map((j) => fixed ? 1 : mix(j === (this.dotIndex + 2) % 3 ? 1 : .35, j === this.dotIndex ? 1 : .35, smooth((t - this.dotAt) / .1)));
    if (!fixed && this.resumed && t < this.resumed.at + .24) {
      const u = smooth((t - this.resumed.at) / .24), previous = this.resumed.frame;
      alpha = mix(previous.symbolAlpha, alpha, u);
      scale = mix(previous.symbolScale, scale, u); y = mix(previous.symbolY, y, u);
      if (state === "erro") progress = previous.progress;
      for (let i = 0; i < dots.length; i++) dots[i] = mix(previous.dots[i]!, dots[i]!, u);
    }
    return { state, eyes: pose, time: t, stateTime: age, symbol, symbolAlpha: clamp(alpha), symbolScale: scale,
      symbolY: y, progress, waves, dots: fading ? [...fading.dots] : dots, work: fading ? fading.work : cycle,
      workOffsets: fixed ? [0, 0, 0] : fading ? [...fading.workOffsets] : this.workOffsets.map(v => v * (this.resumed ? smooth((t - this.resumed.at) / .24) : 1)),
      jitter: fixed ? [0, 0] : fading ? [...fading.jitter] : [2 * Math.sin(t * 19 + this.jitterPhase), 2 * Math.sin(t * 23 + this.jitterPhase + 1.1)].map(v => v * (this.resumed ? smooth((t - this.resumed.at) / .24) : 1)) as [number, number] };
  }
}
