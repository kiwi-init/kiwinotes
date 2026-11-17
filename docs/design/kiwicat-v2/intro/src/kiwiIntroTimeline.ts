export type KiwiEarStyle = 'pontiagudas' | 'arredondadas' | 'alongadas' | 'compactas';
export type KiwiEyeStyle = 'circulares' | 'ovalados' | 'expressivos' | 'minimalistas';
export type KiwiAuraStyle = 'contorno-sutil' | 'halo-difuso' | 'nuvem-base' | 'borda-suave';

export interface KiwiIntroConfig {
  earStyle: KiwiEarStyle;
  earScale: number;
  eyeStyle: KiwiEyeStyle;
  eyeScale: number;
  eyeSpacing: number;
  bodyWidth: number;
  bodyColor: string;
  accentColor: string;
  surfaceBg: string;
  eyeColor: string;
  prismStops: [string, string, string];
  mistBaseColor: string;
  prismSpread: number;
  auraStyle: KiwiAuraStyle;
  showAmbientMist: boolean;
  showMascotDetails: boolean;
}

/**
 * Configuração derivada diretamente do preset ativo "KiwiCat Ver Final Perfect"
 * com foco total no mascote (sem balão de fala, sem equalizador, sem texto).
 */
export const KIWI_INTRO_CONFIG: KiwiIntroConfig = {
  earStyle: 'compactas',
  earScale: 0.75,
  eyeStyle: 'circulares',
  eyeScale: 1.05,
  eyeSpacing: 1,
  bodyWidth: 1.06,
  bodyColor: '#050507',
  accentColor: '#F472B6',
  surfaceBg: '#090A0E',
  eyeColor: '#FFFFFF',
  prismStops: ['#22D3EE', '#6366F1', '#EC4899'],
  mistBaseColor: '#D4D8E4',
  prismSpread: 78,
  auraStyle: 'borda-suave',
  showAmbientMist: false,
  showMascotDetails: true,
};

export const INTRO_CAT_DURATION = 4.4;
export const INTRO_DURATION = 5.35;
export const REDUCED_DURATION = 1.5;
export const STORYBOARD_TIMESTAMPS = [0.45, 1.55, 2.2, 3.55, 4.55, 5.2] as const;
export const FRAMELESS_STORYBOARD_TIMESTAMPS = [0.4, 1.05, 1.55, 2.15, 2.85, 3.55] as const;

export interface IntroPhaseInfo {
  id: string;
  label: string;
  start: number;
  end: number;
}

export const INTRO_PHASES: IntroPhaseInfo[] = [
  { id: 'condense', label: 'Névoa & Condensação', start: 0.0, end: 1.4 },
  { id: 'waking', label: 'Despertar & Orelhas', start: 1.4, end: 2.6 },
  { id: 'aurora', label: 'Foco & Aurora', start: 2.6, end: 3.18 },
  { id: 'happy', label: 'Reação Feliz', start: 3.18, end: 3.92 },
  { id: 'exit', label: 'Pouso do Kiwi Cat', start: 3.92, end: 4.34 },
  { id: 'expand', label: 'Janela & App', start: 4.34, end: 5.35 },
];

export interface IntroPose {
  t: number;
  duration: number;
  done: boolean;
  reducedMotion: boolean;
  phaseIndex: number;
  phaseLabel: string;
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function windowCurve(t: number, start: number, end: number): number {
  return clamp01((t - start) / (end - start));
}

function pulseBell(t: number, start: number, end: number): number {
  if (t < start || t > end) return 0;
  return Math.sin(((t - start) / (end - start)) * Math.PI);
}

/**
 * Avalia de forma 100% determinística a pose completa do Byte Kiwi Cat e da transição da moldura para o app.
 */
export function evaluateIntroPose(
  rawTime: number,
  reducedMotion: boolean,
  skipStartedAt: number | null = null,
  showFrame = true
): IntroPose {
  const fullDuration = showFrame ? INTRO_DURATION : INTRO_CAT_DURATION;
  const duration = reducedMotion ? REDUCED_DURATION : fullDuration;
  const t = Math.max(0, Math.min(duration, rawTime));

  let skipFade = 1;
  if (skipStartedAt !== null) {
    const skipElapsed = Math.max(0, rawTime - skipStartedAt);
    skipFade = 1 - easeInOutCubic(skipElapsed / 0.26);
  }

  if (reducedMotion) {
    const exitProgress = smoothstep(0.95, REDUCED_DURATION, t);
    const mascotOpacity = showFrame ? (1 - smoothstep(0.85, 1.12, t)) * skipFade : (1 - exitProgress) * skipFade;
    const windowExpand = showFrame ? easeInOutCubic(windowCurve(t, 1.0, 1.38)) : 0;
    const windowChromeOpacity = showFrame ? smoothstep(1.18, 1.4, t) : 0;
    const appContentOpacity = showFrame ? smoothstep(1.26, 1.48, t) : 0;
    const stageOpacity = showFrame ? skipFade : (1 - exitProgress) * skipFade;
    const done = t >= REDUCED_DURATION - 0.001 || (skipStartedAt !== null && skipFade <= 0.005);

    return {
      t,
      duration,
      done,
      reducedMotion: true,
      phaseIndex: t < 1.0 ? 0 : 1,
      phaseLabel:
        t < 1.0
          ? 'Pose Calma (Movimento Reduzido)'
          : showFrame
          ? 'Abertura do App'
          : 'Encerramento Suave',
      stageOpacity,
      stageScale: showFrame ? 1 : lerp(1, 0.98, exitProgress),
      mascotOpacity,
      windowExpand,
      windowChromeOpacity,
      appContentOpacity,
      fogOpacity: 0.94,
      fogCore: 46,
      fogMid: 71,
      fogMist: 89,
      fogEdge: 98,
      particleProgress: 0,
      particleOpacity: 0,
      coreGlowOpacity: 0,
      bodyScale: 0.93,
      tailStretch: 0.2,
      liquidAmp: 0.28,
      softness: 0.18,
      auraIntensity: 90,
      orbitAngle: 0.85,
      wavePhase: 0.4,
      mistPhase: 0.5,
      yaw: 0,
      pitch: 0,
      roll: 0,
      headOffsetX: 0,
      headOffsetY: 0.01,
      lagX: 0,
      lagY: -0.02,
      earAppear: 1,
      eyeAppear: 1,
      mouthAppear: 1,
      earPerkL: 0.65,
      earPerkR: 0.65,
      eyeOpenY: 1.02,
      eyeScale: 1.04,
      happyArc: 0,
      mouthCheer: 0.15,
      sparkleOpacity: 0,
      sparkleScale: 0.8,
      sparkleRotationDeg: 0,
    };
  }

  // 1. Palco squircle aparece suavemente; com moldura ativa, ela permanece para virar a janela do app
  const entryFade = smoothstep(0.0, 0.16, t);
  const framelessExitFade = 1 - easeInOutCubic(windowCurve(t, 4.02, INTRO_CAT_DURATION));
  const stageOpacity = showFrame ? entryFade * skipFade : entryFade * framelessExitFade * skipFade;
  const stageScale = showFrame
    ? lerp(0.96, 1.0, easeOutCubic(windowCurve(t, 0.0, 0.35)))
    : lerp(0.96, 1.0, easeOutCubic(windowCurve(t, 0.0, 0.35))) *
      lerp(1.0, 0.95, smoothstep(4.02, INTRO_CAT_DURATION, t));

  // Apenas o Kiwi Cat desaparece suavemente no pouso (3.96s - 4.30s), deixando a moldura sozinha
  const mascotExitFade = 1 - easeInOutCubic(windowCurve(t, 3.96, 4.3));
  const mascotOpacity = showFrame ? mascotExitFade * skipFade : 1;

  // Moldura se estica suavemente para virar janela (4.28s - 4.92s) e renderiza o app (4.80s - 5.26s)
  const windowExpand = showFrame ? easeInOutCubic(windowCurve(t, 4.28, 4.92)) : 0;
  const windowChromeOpacity = showFrame ? smoothstep(4.62, 4.94, t) * skipFade : 0;
  const appContentOpacity = showFrame ? smoothstep(4.8, 5.26, t) * skipFade : 0;

  // 2. Névoa & Condensação (0.00s - 1.40s): bolinha uniforme cresce em assinatura líquida até formar o corpo dormindo
  const particleProgress = 0;
  const particleOpacity = 0;
  const coreGlowOpacity = 0;

  const orbGrow = easeInOutCubic(windowCurve(t, 0.0, 1.34));
  const happyBounce = pulseBell(t, 3.2, 3.7) * 0.07;
  const settle = smoothstep(3.9, 4.3, t);

  const bodyScale =
    lerp(0.14, 0.89, orbGrow) +
    smoothstep(1.38, 2.55, t) * 0.05 +
    happyBounce -
    settle * 0.08;

  const tailStretch = lerp(0.0, 0.26, smoothstep(0.7, 2.45, t)) + happyBounce * 0.55;
  const liquidAmp =
    lerp(0.42, 0.72, smoothstep(0.15, 2.15, t)) +
    Math.sin(t * 3.4) * 0.06 -
    settle * 0.2;
  const softness = lerp(0.46, 0.18, smoothstep(0.2, 1.45, t));

  // 3. Máscara radial acompanha o crescimento orgânico do corpo
  const maskBloom = smoothstep(0.05, 1.36, t);
  const happyBloom = smoothstep(3.15, 3.5, t) * (1 - smoothstep(3.9, 4.3, t));

  const fogCore = lerp(16, 44, maskBloom) + happyBloom * 4;
  const fogMid = lerp(34, 69, maskBloom) + happyBloom * 5;
  const fogMist = lerp(54, 87, maskBloom) + happyBloom * 4;
  const fogEdge = lerp(74, 97, maskBloom) + happyBloom * 3;
  const fogOpacity = lerp(0.88, 0.97, maskBloom) - settle * 0.06;

  const auraIntensity =
    lerp(36, 95, smoothstep(0.18, 2.1, t)) +
    happyBloom * 5 -
    settle * 22;

  const orbitAngle =
    0.4 + t * 0.95 + easeInOutCubic(windowCurve(t, 2.4, 3.38)) * 1.45;
  const wavePhase = t * 1.65;
  const mistPhase = t * 1.55;

  // 4. Postura dormindo olhando para baixo -> acorda levantando a cabeça com titubeio (1.82s - 2.36s)
  const wakeLift = smoothstep(1.45, 2.42, t);
  const wobbleEnv = pulseBell(t, 1.82, 2.36);
  const wobbleRoll = wobbleEnv * Math.sin((t - 1.82) * 26) * 0.105;
  const wobbleYaw = wobbleEnv * Math.cos((t - 1.82) * 21) * 0.065;
  const wobbleHeadX = wobbleEnv * Math.sin((t - 1.82) * 26) * 0.016;

  const happyTilt = smoothstep(3.14, 3.46, t) * (1 - smoothstep(3.86, 4.25, t));

  const headOffsetX = wobbleHeadX + Math.sin(t * 2.0) * 0.01 * wakeLift;
  const headOffsetY =
    lerp(-0.072, 0.014, wakeLift) +
    Math.sin(t * 3.8) * 0.007 * wakeLift +
    happyBounce * 0.25;

  const yaw =
    lerp(-0.03, 0.035, smoothstep(1.5, 2.4, t)) +
    wobbleYaw -
    smoothstep(2.6, 3.12, t) * 0.035 +
    Math.sin(t * 2.3) * 0.014;
  const pitch =
    lerp(-0.26, 0.025, wakeLift) + happyTilt * 0.03 - settle * 0.025;
  const roll =
    lerp(-0.1, 0.03, wakeLift) +
    wobbleRoll -
    happyTilt * 0.035 +
    Math.sin(t * 2.1) * 0.01;

  const lagX = -yaw * 0.25 - roll * 0.16 - headOffsetX * 0.85;
  const lagY = -pitch * 0.16 - 0.02 - happyBounce * 0.18;

  // 5. Aparição passo a passo: Corpo -> Orelhas (1.24s) -> Olhos (1.70s) -> Boca (2.08s)
  const earAppear = smoothstep(1.24, 1.54, t);
  const eyeAppear = smoothstep(1.7, 1.94, t);
  const mouthAppear = smoothstep(2.08, 2.34, t);

  // Orelhas surgem abaixadas dormindo (-1.35) e levantam com espasmos independentes
  const baseEarLift =
    lerp(-1.35, 0.88, easeOutBack(windowCurve(t, 1.38, 2.38))) -
    smoothstep(3.86, 4.3, t) * 0.2;

  const twitchR = pulseBell(t, 1.44, 1.72) * 0.52;
  const twitchL = pulseBell(t, 1.66, 1.96) * 0.58;
  const alertSnap = pulseBell(t, 2.24, 2.58) * 0.16;

  const earPerkL = baseEarLift + twitchL + alertSnap;
  const earPerkR = baseEarLift + twitchR + alertSnap;

  // 6. Olhos surgem fechados após as orelhas e abrem em duas piscadinhas sonolentas
  const sleepyOpen1 = smoothstep(1.7, 1.9, t) * 0.45;
  const sleepyOpen2 = smoothstep(1.94, 2.4, t) * 0.61;
  const blink1 = pulseBell(t, 1.88, 2.04) * 0.88;
  const blink2 = pulseBell(t, 2.12, 2.28) * 0.86;
  const rawOpen = 0.08 + sleepyOpen1 + sleepyOpen2;
  const eyeOpenY = Math.max(0.08, rawOpen * (1 - Math.max(blink1, blink2)));
  const eyeScale = lerp(0.92, 1.06, smoothstep(1.7, 2.38, t)) + happyTilt * 0.04;

  // 7. Reação feliz (^ ^) e faíscas comic (3.18s - 3.92s)
  const happyArc =
    smoothstep(3.16, 3.36, t) * (1 - smoothstep(3.88, 4.12, t));

  const mouthCheer =
    smoothstep(2.12, 2.48, t) * 0.24 +
    smoothstep(3.18, 3.4, t) * (1 - smoothstep(3.9, 4.15, t)) * 0.76;

  const sparkleEnter = easeOutBack(windowCurve(t, 3.2, 3.46));
  const sparkleExit = 1 - smoothstep(3.78, 4.0, t);
  const sparkleOpacity = clamp01(smoothstep(3.18, 3.3, t) * sparkleExit);
  const sparkleScale =
    t < 3.2 ? 0.2 : Math.max(0.4, sparkleEnter * (0.94 + 0.08 * Math.sin((t - 3.2) * 14)));
  const sparkleRotationDeg = (t - 3.2) * 14;

  const activePhases = showFrame ? INTRO_PHASES : INTRO_PHASES.slice(0, 5);
  const phaseIdx = activePhases.findIndex((p) => t >= p.start && t <= p.end);
  const resolvedPhaseIndex = phaseIdx >= 0 ? phaseIdx : activePhases.length - 1;
  const done = t >= duration - 0.001 || (skipStartedAt !== null && skipFade <= 0.005);

  return {
    t,
    duration,
    done,
    reducedMotion: false,
    phaseIndex: resolvedPhaseIndex,
    phaseLabel: activePhases[resolvedPhaseIndex].label,
    stageOpacity,
    stageScale,
    mascotOpacity,
    windowExpand,
    windowChromeOpacity,
    appContentOpacity,
    fogOpacity,
    fogCore,
    fogMid,
    fogMist,
    fogEdge,
    particleProgress,
    particleOpacity,
    coreGlowOpacity,
    bodyScale,
    tailStretch,
    liquidAmp,
    softness,
    auraIntensity,
    orbitAngle,
    wavePhase,
    mistPhase,
    yaw,
    pitch,
    roll,
    headOffsetX,
    headOffsetY,
    lagX,
    lagY,
    earAppear,
    eyeAppear,
    mouthAppear,
    earPerkL,
    earPerkR,
    eyeOpenY,
    eyeScale,
    happyArc,
    mouthCheer,
    sparkleOpacity,
    sparkleScale,
    sparkleRotationDeg,
  };
}
