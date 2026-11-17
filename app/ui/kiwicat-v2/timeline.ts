// Portado de docs/design/kiwicat-v2/intro/src/exportStandaloneHtml.ts (o script do build), T14851, spec #14766.
// A linha do tempo da intro: a pose do gato e da moldura em cada instante. As contas são as do build, sem mudança
// (a intro do app é igual à do pacote, quadro a quadro): o print do app e o do build saem iguais (`intro-igual.ts`).

/** As cores e as proporções do KiwiCat da intro (o preset "KiwiCat Ver Final Perfect" do pacote). */
export const KIWI_INTRO_CONFIG = {
  earStyle: "compactas",
  earScale: 0.75,
  eyeStyle: "circulares",
  eyeScale: 1.05,
  eyeSpacing: 1,
  bodyWidth: 1.06,
  bodyColor: "#050507",
  accentColor: "#F472B6",
  surfaceBg: "#090A0E",
  eyeColor: "#FFFFFF",
  prismStops: ["#22D3EE", "#6366F1", "#EC4899"],
  mistBaseColor: "#D4D8E4",
  prismSpread: 78,
  auraStyle: "borda-suave",
  showAmbientMist: false,
  showMascotDetails: true,
} as const;
export type KiwiIntroConfig = typeof KIWI_INTRO_CONFIG;

/** A intro inteira, com a moldura que vira janela. */
export const INTRO_DURATION = 5.35;
const INTRO_FULL = INTRO_DURATION;
/** Só o gato, sem a moldura. */
export const INTRO_CAT_DURATION = 4.4;
/** O "Reduzir movimento": a pose calma e a abertura. */
export const REDUCED_DURATION = 1.5;

/** As 6 fases (o `?t=` de cada uma nos prints). */
export const INTRO_PHASES = [
  { id: "condensa", start: 0.0, end: 1.4 },
  { id: "orelhas", start: 1.4, end: 2.6 },
  { id: "aurora", start: 2.6, end: 3.18 },
  { id: "feliz", start: 3.18, end: 3.92 },
  { id: "some", start: 3.92, end: 4.34 },
  { id: "janela", start: 4.34, end: 5.35 },
] as const;

export interface IntroPose {
  t: number;
  duration: number;
  done: boolean;
  stageOpacity: number;
  stageScale: number;
  mascotOpacity: number;
  windowExpand: number;
  windowChromeOpacity: number;
  appContentOpacity: number;
  fogOpacity: number;
  fogCore: number;
  fogMid: number;
  fogMist: number;
  fogEdge: number;
  particleProgress: number;
  particleOpacity: number;
  coreGlowOpacity: number;
  bodyScale: number;
  tailStretch: number;
  liquidAmp: number;
  softness: number;
  auraIntensity: number;
  orbitAngle: number;
  wavePhase: number;
  mistPhase: number;
  yaw: number;
  pitch: number;
  roll: number;
  headOffsetX: number;
  headOffsetY: number;
  lagX: number;
  lagY: number;
  earAppear: number;
  eyeAppear: number;
  mouthAppear: number;
  earPerkL: number;
  earPerkR: number;
  eyeOpenY: number;
  eyeScale: number;
  happyArc: number;
  mouthCheer: number;
  sparkleOpacity: number;
  sparkleScale: number;
  sparkleRotationDeg: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutCubic = (t: number): number => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOutBack = (t: number): number => { const x = clamp01(t); const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const win = (t: number, s: number, e: number): number => clamp01((t - s) / (e - s));
const pulseBell = (t: number, s: number, e: number): number => (t < s || t > e ? 0 : Math.sin(((t - s) / (e - s)) * Math.PI));

/**
 * A pose no instante `rawTime` (s). `skipAt` é quando a pessoa clicou para pular (o fim esmaece em 0,26 s);
 * `showFrame` diz se há a moldura (a intro do app tem).
 */
export function evaluateIntroPose(rawTime: number, reduced: boolean, skipAt: number | null = null, showFrame = true): IntroPose {
  const SHOW_FRAME = showFrame;
  const INTRO_DURATION = showFrame ? INTRO_FULL : INTRO_CAT_DURATION;
  const duration = reduced ? REDUCED_DURATION : INTRO_DURATION;
  const t = Math.max(0, Math.min(duration, rawTime));
  let skipFade = 1;
  if (skipAt !== null) skipFade = 1 - easeInOutCubic(Math.max(0, rawTime - skipAt) / 0.26);

  if (reduced) {
    const ex = smoothstep(0.95, REDUCED_DURATION, t);
    const mascotOpacity = SHOW_FRAME ? (1 - smoothstep(0.85, 1.12, t)) * skipFade : (1 - ex) * skipFade;
    const windowExpand = SHOW_FRAME ? easeInOutCubic(win(t, 1.0, 1.38)) : 0;
    const windowChromeOpacity = SHOW_FRAME ? smoothstep(1.18, 1.4, t) * skipFade : 0;
    const appContentOpacity = SHOW_FRAME ? smoothstep(1.26, 1.48, t) * skipFade : 0;
    const stageOpacity = SHOW_FRAME ? skipFade : (1 - ex) * skipFade;
    const done = t >= REDUCED_DURATION - 0.001 || (skipAt !== null && skipFade <= 0.005);
    return {
      t, duration, done, stageOpacity, stageScale: SHOW_FRAME ? 1 : lerp(1, 0.98, ex),
      mascotOpacity, windowExpand, windowChromeOpacity, appContentOpacity,
      fogOpacity: 0.94, fogCore: 46, fogMid: 71, fogMist: 89, fogEdge: 98,
      particleProgress: 0, particleOpacity: 0, coreGlowOpacity: 0,
      bodyScale: 0.93, tailStretch: 0.2, liquidAmp: 0.28, softness: 0.18, auraIntensity: 90,
      orbitAngle: 0.85, wavePhase: 0.4, mistPhase: 0.5,
      yaw: 0, pitch: 0, roll: 0, headOffsetX: 0, headOffsetY: 0.01, lagX: 0, lagY: -0.02,
      earAppear: 1, eyeAppear: 1, mouthAppear: 1,
      earPerkL: 0.65, earPerkR: 0.65, eyeOpenY: 1.02, eyeScale: 1.04, happyArc: 0, mouthCheer: 0.15,
      sparkleOpacity: 0, sparkleScale: 0.8, sparkleRotationDeg: 0
    };
  }

  const entryFade = smoothstep(0.0, 0.16, t);
  const framelessExit = 1 - easeInOutCubic(win(t, 4.02, INTRO_DURATION));
  const stageOpacity = SHOW_FRAME ? entryFade * skipFade : entryFade * framelessExit * skipFade;
  const stageScale = SHOW_FRAME
    ? lerp(0.96, 1.0, easeOutCubic(win(t, 0.0, 0.35)))
    : lerp(0.96, 1.0, easeOutCubic(win(t, 0.0, 0.35))) * lerp(1.0, 0.95, smoothstep(4.02, INTRO_DURATION, t));
  const mascotOpacity = SHOW_FRAME ? (1 - easeInOutCubic(win(t, 3.96, 4.3))) * skipFade : 1;
  const windowExpand = SHOW_FRAME ? easeInOutCubic(win(t, 4.28, 4.92)) : 0;
  const windowChromeOpacity = SHOW_FRAME ? smoothstep(4.62, 4.94, t) * skipFade : 0;
  const appContentOpacity = SHOW_FRAME ? smoothstep(4.8, 5.26, t) * skipFade : 0;
  const particleProgress = 0;
  const particleOpacity = 0;
  const coreGlowOpacity = 0;
  const orbGrow = easeInOutCubic(win(t, 0.0, 1.34));
  const happyBounce = pulseBell(t, 3.2, 3.7) * 0.07;
  const settle = smoothstep(3.9, 4.3, t);
  const bodyScale = lerp(0.14, 0.89, orbGrow) + smoothstep(1.38, 2.55, t) * 0.05 + happyBounce - settle * 0.08;
  const tailStretch = lerp(0.0, 0.26, smoothstep(0.7, 2.45, t)) + happyBounce * 0.55;
  const liquidAmp = lerp(0.42, 0.72, smoothstep(0.15, 2.15, t)) + Math.sin(t * 3.4) * 0.06 - settle * 0.2;
  const softness = lerp(0.46, 0.18, smoothstep(0.2, 1.45, t));
  const maskBloom = smoothstep(0.05, 1.36, t);
  const happyBloom = smoothstep(3.15, 3.5, t) * (1 - smoothstep(3.9, 4.3, t));
  const wakeLift = smoothstep(1.45, 2.42, t);
  const wobbleEnv = pulseBell(t, 1.82, 2.36);
  const wobbleRoll = wobbleEnv * Math.sin((t - 1.82) * 26) * 0.105;
  const wobbleYaw = wobbleEnv * Math.cos((t - 1.82) * 21) * 0.065;
  const wobbleHeadX = wobbleEnv * Math.sin((t - 1.82) * 26) * 0.016;
  const happyTilt = smoothstep(3.14, 3.46, t) * (1 - smoothstep(3.86, 4.25, t));
  const headOffsetX = wobbleHeadX + Math.sin(t * 2.0) * 0.01 * wakeLift;
  const headOffsetY = lerp(-0.072, 0.014, wakeLift) + Math.sin(t * 3.8) * 0.007 * wakeLift + happyBounce * 0.25;
  const yaw = lerp(-0.03, 0.035, smoothstep(1.5, 2.4, t)) + wobbleYaw - smoothstep(2.6, 3.12, t) * 0.035 + Math.sin(t * 2.3) * 0.014;
  const pitch = lerp(-0.26, 0.025, wakeLift) + happyTilt * 0.03 - settle * 0.025;
  const roll = lerp(-0.1, 0.03, wakeLift) + wobbleRoll - happyTilt * 0.035 + Math.sin(t * 2.1) * 0.01;
  const earAppear = smoothstep(1.24, 1.54, t);
  const eyeAppear = smoothstep(1.7, 1.94, t);
  const mouthAppear = smoothstep(2.08, 2.34, t);
  const baseEarLift = lerp(-1.35, 0.88, easeOutBack(win(t, 1.38, 2.38))) - smoothstep(3.86, 4.3, t) * 0.2;
  const twitchR = pulseBell(t, 1.44, 1.72) * 0.52;
  const twitchL = pulseBell(t, 1.66, 1.96) * 0.58;
  const alertSnap = pulseBell(t, 2.24, 2.58) * 0.16;
  const sleepyOpen1 = smoothstep(1.7, 1.9, t) * 0.45;
  const sleepyOpen2 = smoothstep(1.94, 2.4, t) * 0.61;
  const blink1 = pulseBell(t, 1.88, 2.04) * 0.88;
  const blink2 = pulseBell(t, 2.12, 2.28) * 0.86;
  const rawOpen = 0.08 + sleepyOpen1 + sleepyOpen2;
  const sparkleEnter = easeOutBack(win(t, 3.2, 3.46));
  const sparkleExit = 1 - smoothstep(3.78, 4.0, t);

  return {
    t, duration,
    done: t >= duration - 0.001 || (skipAt !== null && skipFade <= 0.005),
    stageOpacity, stageScale,
    mascotOpacity, windowExpand, windowChromeOpacity, appContentOpacity,
    fogOpacity: lerp(0.88, 0.97, maskBloom) - settle * 0.06,
    fogCore: lerp(16, 44, maskBloom) + happyBloom * 4,
    fogMid: lerp(34, 69, maskBloom) + happyBloom * 5,
    fogMist: lerp(54, 87, maskBloom) + happyBloom * 4,
    fogEdge: lerp(74, 97, maskBloom) + happyBloom * 3,
    particleProgress, particleOpacity, coreGlowOpacity,
    bodyScale, tailStretch, liquidAmp, softness,
    auraIntensity: lerp(36, 95, smoothstep(0.18, 2.1, t)) + happyBloom * 5 - settle * 22,
    orbitAngle: 0.4 + t * 0.95 + easeInOutCubic(win(t, 2.4, 3.38)) * 1.45,
    wavePhase: t * 1.65, mistPhase: t * 1.55,
    yaw, pitch, roll, headOffsetX, headOffsetY,
    lagX: -yaw * 0.25 - roll * 0.16 - headOffsetX * 0.85,
    lagY: -pitch * 0.16 - 0.02 - happyBounce * 0.18,
    earAppear, eyeAppear, mouthAppear,
    earPerkL: baseEarLift + twitchL + alertSnap,
    earPerkR: baseEarLift + twitchR + alertSnap,
    eyeOpenY: Math.max(0.08, rawOpen * (1 - Math.max(blink1, blink2))),
    eyeScale: lerp(0.92, 1.06, smoothstep(1.7, 2.38, t)) + happyTilt * 0.04,
    happyArc: smoothstep(3.16, 3.36, t) * (1 - smoothstep(3.88, 4.12, t)),
    mouthCheer: smoothstep(2.12, 2.48, t) * 0.24 + smoothstep(3.18, 3.4, t) * (1 - smoothstep(3.9, 4.15, t)) * 0.76,
    sparkleOpacity: clamp01(smoothstep(3.18, 3.3, t) * sparkleExit),
    sparkleScale: t < 3.2 ? 0.2 : Math.max(0.4, sparkleEnter * (0.94 + 0.08 * Math.sin((t - 3.2) * 14))),
    sparkleRotationDeg: (t - 3.2) * 14
  };
}
