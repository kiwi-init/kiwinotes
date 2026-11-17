// Portado de docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx (o DEFAULT_KIWI_CONFIG, a paleta prisma-original e os
// STATE_TARGETS), T14885, spec #14813. Mudanças: só o que o gato do app lê; os valores são os do pacote, sem mudar.
//
// O desenho do gato novo: a config padrão do pacote e o alvo de cada um dos 5 estados. As cores aqui são as da
// paleta padrão (`prisma-original`); a escolhida (spec #14963) troca os `prismStops`, o `accentColor` e o `eyeColor` no `cat.ts`.

/** Os 5 estados do pacote. */
export type KiwiState = "repouso" | "ouvindo" | "pensando" | "respondendo" | "dormindo";
/** Os emotes do pacote; `auto` é o símbolo do próprio estado (as ondas, o pensamento, o zZ, as estrelas). */
export type KiwiEmote = "auto" | "alerta" | "confuso" | "cansado" | "feliz" | "limite";
export type KiwiEarStyle = "pontiagudas" | "arredondadas" | "alongadas" | "compactas";
export type KiwiEyeStyle = "circulares" | "ovalados" | "expressivos" | "minimalistas";

export interface CatConfig {
  earStyle: KiwiEarStyle;
  earScale: number;
  eyeStyle: KiwiEyeStyle;
  eyeScale: number;
  eyeSpacing: number;
  silhouetteSoftness: number;
  bodyWidth: number;
  bodyColor: string;
  accentColor: string;
  eyeColor: string;
  prismStops: readonly [string, string, string];
  mistBaseColor: string;
  auraIntensity: number;
  prismSpread: number;
  /** 0 = `borda-suave` (o padrão do pacote). */
  auraStyle: number;
  motionFluidity: number;
  speedMultiplier: number;
  voiceReactivity: number;
  eyeExpressiveness: number;
  showAmbientMist: boolean;
  showMascotDetails: boolean;
  showComicEmotes: boolean;
}

/** O `DEFAULT_KIWI_CONFIG` do pacote, com a paleta `prisma-original`. */
export const CAT_CONFIG: CatConfig = {
  earStyle: "compactas",
  earScale: 0.75,
  eyeStyle: "circulares",
  eyeScale: 1.05,
  eyeSpacing: 1,
  silhouetteSoftness: 18,
  bodyWidth: 1.06,
  bodyColor: "#050507",
  accentColor: "#F472B6",
  eyeColor: "#FFFFFF",
  prismStops: ["#22D3EE", "#6366F1", "#EC4899"],
  mistBaseColor: "#D4D8E4",
  auraIntensity: 95,
  prismSpread: 78,
  auraStyle: 0,
  motionFluidity: 100,
  speedMultiplier: 1.2,
  voiceReactivity: 85,
  eyeExpressiveness: 88,
  showAmbientMist: false,
  showMascotDetails: true,
  showComicEmotes: true,
};

export interface StateTarget {
  breathSpeed: number;
  breathAmp: number;
  eyeOpenY: number;
  eyeScale: number;
  gazeX: number;
  gazeY: number;
  headTiltDeg: number;
  headLiftY: number;
  earPerk: number;
  prismOpacity: number;
  mistPulseSpeed: number;
  ringScale: number;
  yawAmp: number;
  pitchAmp: number;
  pitchBias: number;
  rollAmp: number;
  rollBias: number;
  bodyScale: number;
  tailStretch: number;
  liquidAmp: number;
}

export const STATE_TARGETS: Record<KiwiState, StateTarget> = {
  repouso: {
    breathSpeed: 1.05, breathAmp: 0.018, eyeOpenY: 1, eyeScale: 1, gazeX: 0, gazeY: 0, headTiltDeg: 0, headLiftY: 0,
    earPerk: 0, prismOpacity: 0.88, mistPulseSpeed: 0.72, ringScale: 1.0, yawAmp: 0.032, pitchAmp: 0.014, pitchBias: 0,
    rollAmp: 0.018, rollBias: -0.01, bodyScale: 0.85, tailStretch: 0.12, liquidAmp: 0.34,
  },
  ouvindo: {
    breathSpeed: 1.65, breathAmp: 0.022, eyeOpenY: 1.06, eyeScale: 1.08, gazeX: 0, gazeY: 0, headTiltDeg: 2,
    headLiftY: 0.015, earPerk: 0.8, prismOpacity: 1.0, mistPulseSpeed: 1.45, ringScale: 1.12, yawAmp: 0.038,
    pitchAmp: 0.016, pitchBias: 0, rollAmp: 0.022, rollBias: 0.045, bodyScale: 0.94, tailStretch: 0.22, liquidAmp: 0.62,
  },
  pensando: {
    breathSpeed: 1.35, breathAmp: 0.02, eyeOpenY: 0.93, eyeScale: 0.98, gazeX: 0, gazeY: 0, headTiltDeg: -4,
    headLiftY: 0.01, earPerk: 0.35, prismOpacity: 0.96, mistPulseSpeed: 1.85, ringScale: 1.05, yawAmp: 0.048,
    pitchAmp: 0.018, pitchBias: 0, rollAmp: 0.028, rollBias: -0.055, bodyScale: 0.91, tailStretch: 0.24, liquidAmp: 0.7,
  },
  respondendo: {
    breathSpeed: 2.25, breathAmp: 0.026, eyeOpenY: 1.01, eyeScale: 1.06, gazeX: 0, gazeY: 0, headTiltDeg: 1,
    headLiftY: 0.02, earPerk: 0.65, prismOpacity: 1.0, mistPulseSpeed: 2.25, ringScale: 1.18, yawAmp: 0.05,
    pitchAmp: 0.02, pitchBias: 0, rollAmp: 0.03, rollBias: 0.01, bodyScale: 0.99, tailStretch: 0.28, liquidAmp: 0.78,
  },
  dormindo: {
    breathSpeed: 0.72, breathAmp: 0.022, eyeOpenY: 0.12, eyeScale: 0.94, gazeX: 0, gazeY: -0.35, headTiltDeg: -6,
    headLiftY: -0.025, earPerk: -0.45, prismOpacity: 0.52, mistPulseSpeed: 0.38, ringScale: 0.92, yawAmp: 0.025,
    pitchAmp: 0.02, pitchBias: -0.1, rollAmp: 0.02, rollBias: -0.08, bodyScale: 0.78, tailStretch: 0.06, liquidAmp: 0.22,
  },
};
