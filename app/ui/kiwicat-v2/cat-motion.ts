// Portado de docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx (o `animate` do ByteKiwiCat), T14885, spec #14813.
// Mudanças: a conta de cada quadro saiu do React para uma classe pura (testada no `bun test`); o sorteio da piscada
// vem de fora (`random`), para a prova quadro a quadro usar a mesma semente; a voz simulada só no `respondendo`.
//
// O movimento do gato novo: a cada quadro, o tempo passado (`dt`) leva o gato do estado de antes ao alvo do estado de
// agora (STATE_TARGETS) e devolve tudo o que a névoa, o rosto e os emotes desenham. Nada aqui toca o DOM.

import { CAT_CONFIG, STATE_TARGETS, type CatConfig, type KiwiEmote, type KiwiState, type StateTarget } from "./cat-config";
import type { KiwiPose } from "./renderer";

export interface CatInput {
  state: KiwiState;
  emote: KiwiEmote;
  /** A voz de 0 a 1 (o Control); `null` sem voz. */
  audio: number | null;
}

export interface CatFrame {
  state: KiwiState;
  /** O emote que aparece: o escolhido, ou o do próprio estado no `auto`. */
  emote: KiwiEmote | KiwiState;
  /** A pose da névoa (`FogRenderer.draw`). */
  pose: KiwiPose;
  /** O rosto. */
  earPerk: number;
  eyeOpenY: number;
  eyeScale: number;
  gazeX: number;
  gazeY: number;
  blinkAmount: number;
  /** A máscara radial da camada da névoa (%), e a opacidade dela. */
  fogCore: number;
  fogMid: number;
  fogMist: number;
  fogEdge: number;
  fogOpacity: number;
  /** O deslocamento e a escala dos emotes (no `viewBox` de 240). */
  emoteX: number;
  emoteY: number;
  emoteScale: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Um sorteio com semente (mulberry32), para a piscada sair igual nas provas. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CatMotion {
  private current: StateTarget;
  private phase = 0;
  private mistPhase = 0;
  private wavePhase = 0;
  private orbitAngle = 0.58;
  private lagX = 0;
  private lagY = -0.05;
  private blinkTimer = 2.6;
  private blinkAmount = 0;
  private audioSmoothed = 0;
  private fogCore = 43;
  private fogMid = 67;
  private fogMist = 85;
  private fogEdge = 96;
  /** O relógio da voz simulada (s), como o `now` do pacote. */
  private clock = 0;

  constructor(
    state: KiwiState,
    private readonly random: () => number = Math.random,
    private readonly c: CatConfig = CAT_CONFIG,
  ) {
    this.current = { ...STATE_TARGETS[state] };
  }

  /** Avança `dt` segundos (o pacote corta em 50 ms) e devolve o quadro. */
  step(dtSeconds: number, input: CatInput): CatFrame {
    const c = this.c, s = input.state, cur = this.current;
    const dt = Math.min(0.05, Math.max(0, dtSeconds));
    this.clock += dt;
    const em = input.emote;
    const resolvedEmote: KiwiEmote | KiwiState = em !== "auto" ? em : s;
    const target = STATE_TARGETS[s];
    const fluidity = 0.04 + (c.motionFluidity / 100) * 0.14;
    const follow = Math.min(1, dt * (60 * fluidity * 0.18));

    cur.breathSpeed = lerp(cur.breathSpeed, target.breathSpeed, follow);
    cur.breathAmp = lerp(cur.breathAmp, target.breathAmp, follow);
    cur.eyeOpenY = lerp(cur.eyeOpenY, target.eyeOpenY, follow * 1.4);
    cur.eyeScale = lerp(cur.eyeScale, target.eyeScale, follow * 1.3);
    cur.gazeX = lerp(cur.gazeX, target.gazeX, follow);
    cur.gazeY = lerp(cur.gazeY, target.gazeY, follow);
    cur.headTiltDeg = lerp(cur.headTiltDeg, target.headTiltDeg, follow);
    cur.headLiftY = lerp(cur.headLiftY, target.headLiftY, follow);
    cur.earPerk = lerp(cur.earPerk, target.earPerk, follow * 1.2);
    cur.prismOpacity = lerp(cur.prismOpacity, target.prismOpacity, follow);
    cur.mistPulseSpeed = lerp(cur.mistPulseSpeed, target.mistPulseSpeed, follow);
    cur.ringScale = lerp(cur.ringScale, target.ringScale, follow);
    cur.yawAmp = lerp(cur.yawAmp, target.yawAmp, follow);
    cur.pitchAmp = lerp(cur.pitchAmp, target.pitchAmp, follow);
    cur.pitchBias = lerp(cur.pitchBias, target.pitchBias, follow);
    cur.rollAmp = lerp(cur.rollAmp, target.rollAmp, follow);
    cur.rollBias = lerp(cur.rollBias, target.rollBias, follow);
    cur.bodyScale = lerp(cur.bodyScale, target.bodyScale, follow * 0.85);
    cur.tailStretch = lerp(cur.tailStretch, target.tailStretch, follow * 0.85);
    cur.liquidAmp = lerp(cur.liquidAmp, target.liquidAmp, follow);

    // A voz: a do Control; sem ela, o `respondendo` simula a fala, como o `simulateVoice` do pacote.
    let rawAudio = input.audio ?? 0;
    if (input.audio === null && s === "respondendo") {
      const t = this.clock;
      rawAudio = Math.max(0, 0.25 + 0.35 * Math.sin(t * 7.2) * Math.cos(t * 2.9));
    }
    this.audioSmoothed = lerp(this.audioSmoothed, rawAudio * (c.voiceReactivity / 100), Math.min(1, dt * 16));
    const audio = this.audioSmoothed;

    this.phase += dt * cur.breathSpeed * c.speedMultiplier;
    this.mistPhase += dt * cur.mistPulseSpeed * c.speedMultiplier;
    this.wavePhase += dt * (0.95 + audio * 1.45) * c.speedMultiplier;
    const phase = this.phase;

    const orbitSpeed =
      c.auraStyle === 1 ? 0.08
      : c.auraStyle === 3 ? 0.25
      : s === "respondendo" ? 1.1 + audio * 1.15
      : s === "ouvindo" ? 0.72 + audio * 0.75
      : s === "pensando" ? 0.92
      : s === "dormindo" ? 0.22
      : 0.5;
    this.orbitAngle += dt * orbitSpeed * c.speedMultiplier;

    if (s !== "dormindo") {
      this.blinkTimer -= dt * c.speedMultiplier;
      if (this.blinkTimer <= 0) this.blinkTimer = s === "ouvindo" ? 4.4 + this.random() * 2.4 : 3.0 + this.random() * 2.6;
      const isClosing = this.blinkTimer > 4.2 || (this.blinkTimer < 0.18 && this.blinkTimer > 0.02);
      this.blinkAmount = lerp(this.blinkAmount, isClosing ? 1 : 0, Math.min(1, dt * 24));
    } else {
      this.blinkAmount = lerp(this.blinkAmount, 0, dt * 6);
    }

    const yaw = Math.sin(phase * 0.42 + 0.4) * cur.yawAmp + Math.sin(phase * 0.86) * (cur.yawAmp * 0.18);
    const pitch = cur.pitchBias + Math.cos(phase * 0.38 + 0.7) * cur.pitchAmp;
    const roll = cur.rollBias + Math.sin(phase * 0.46) * cur.rollAmp + Math.sin(phase * 0.94) * (cur.rollAmp * 0.18);

    const breathWave = Math.sin(phase);
    const headOffsetX = Math.sin(phase * 0.42) * 0.01;
    const headOffsetY = cur.headLiftY + breathWave * cur.breathAmp * 0.72 + audio * 0.022;

    const organicMorph = Math.sin(phase * 0.34);
    const bodyScale = cur.bodyScale + organicMorph * (s === "dormindo" ? 0.025 : 0.042) +
      audio * (s === "respondendo" ? 0.14 : s === "ouvindo" ? 0.09 : 0.04);
    const tailStretch = cur.tailStretch + (0.5 + 0.5 * Math.sin(phase * 0.29 + 1.1)) * (s === "dormindo" ? 0.03 : 0.1) +
      audio * (s === "respondendo" ? 0.18 : 0.1);
    const liquidAmp = cur.liquidAmp + audio * (s === "respondendo" ? 0.56 : 0.34);

    this.lagX = lerp(this.lagX, -yaw * 0.24 - Math.sin(phase * 0.4) * 0.028 - headOffsetX * 0.9 - roll * 0.16, Math.min(1, dt * 3.2));
    this.lagY = lerp(this.lagY, -pitch * 0.15 - 0.015 + Math.cos(phase * 0.55) * 0.018 - audio * 0.022, Math.min(1, dt * 3.2));

    const shimmerWave = 0.92 + 0.08 * Math.sin(this.mistPhase * 1.4);
    const aura = Math.min(100, c.auraIntensity * cur.prismOpacity * shimmerWave * (1 + audio * 0.28));

    const fogFollow = Math.min(1, dt * 8);
    const scaleShift = (bodyScale - 0.9) * 24;
    const tCore = (s === "dormindo" ? 34 : s === "pensando" ? 42 : s === "ouvindo" ? 45 + audio * 5 : s === "respondendo" ? 47 + audio * 7 : 41) + scaleShift * 0.7;
    const tMid = (s === "dormindo" ? 54 : s === "pensando" ? 66 : s === "ouvindo" ? 70 + audio * 6 : s === "respondendo" ? 74 + audio * 8 : 64) + scaleShift * 0.85;
    const tMist = (s === "dormindo" ? 73 : s === "pensando" ? 84 : s === "ouvindo" ? 88 + audio * 5 : s === "respondendo" ? 92 + audio * 6 : 82) + scaleShift * 0.7;
    const tEdge = s === "dormindo" ? 86 : s === "pensando" ? 95 : s === "ouvindo" ? Math.min(100, 97 + audio * 3) : s === "respondendo" ? 100 : Math.min(100, 94 + scaleShift * 0.4);
    this.fogCore = lerp(this.fogCore, tCore, fogFollow);
    this.fogMid = lerp(this.fogMid, tMid, fogFollow);
    this.fogMist = lerp(this.fogMist, tMist, fogFollow);
    this.fogEdge = lerp(this.fogEdge, tEdge, fogFollow);
    const fogOpacity = s === "dormindo" ? 0.76 + 0.04 * Math.sin(phase)
      : s === "pensando" ? 0.89 + 0.04 * Math.sin(phase * 1.4)
      : s === "ouvindo" ? Math.min(1, 0.93 + audio * 0.07)
      : s === "respondendo" ? Math.min(1, 0.95 + audio * 0.05)
      : 0.91 + 0.03 * Math.sin(phase);

    const pose: KiwiPose = {
      mistPhase: this.mistPhase, yaw, pitch, roll, headOffsetX, headOffsetY, lagX: this.lagX, lagY: this.lagY,
      softness: c.silhouetteSoftness / 100, auraIntensity: aura, orbitAngle: this.orbitAngle, wavePhase: this.wavePhase,
      bodyScale, tailStretch, liquidAmp, audio,
      // O rosto do gato é o `drawCatFace`; estes são só da intro.
      earAppear: 1, eyeAppear: 1, mouthAppear: 1, earPerkL: cur.earPerk, earPerkR: cur.earPerk,
      eyeOpenY: cur.eyeOpenY, eyeScale: cur.eyeScale, mouthCheer: 0, happyArc: 0,
    };
    return {
      state: s, emote: resolvedEmote, pose,
      earPerk: cur.earPerk, eyeOpenY: cur.eyeOpenY, eyeScale: cur.eyeScale, gazeX: cur.gazeX, gazeY: cur.gazeY,
      blinkAmount: this.blinkAmount,
      fogCore: this.fogCore, fogMid: this.fogMid, fogMist: this.fogMist, fogEdge: this.fogEdge, fogOpacity,
      emoteX: headOffsetX * 55 + yaw * 8,
      emoteY: Math.sin(phase * 1.4) * 2.5 - headOffsetY * 45,
      emoteScale: 1 + audio * 0.07,
    };
  }
}
