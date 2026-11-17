import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * Byte Kiwi Cat — Pacote Auto-Contido de Mascote & Overlay (60fps)
 * Dependências: apenas React 18/19+ (zero bibliotecas externas de animação).
 * Preset selecionado: "KiwiCat Ver Final Perfect" (custom-1794801995497)
 * Estado padrão: "respondendo"
 * Paleta selecionada: "prisma-original" · Distribuição na névoa: "borda-suave"
 * Transição de overlay escolhida: "materializacao-nevoa" · Posição: "bottom-right"
 */

export type KiwiState = 'repouso' | 'ouvindo' | 'pensando' | 'respondendo' | 'dormindo';
export type KiwiEarStyle = 'pontiagudas' | 'arredondadas' | 'alongadas' | 'compactas';
export type KiwiEyeStyle = 'circulares' | 'ovalados' | 'expressivos' | 'minimalistas';
export type KiwiAuraStyle = 'contorno-sutil' | 'halo-difuso' | 'nuvem-base' | 'borda-suave';
export type KiwiFrameStyle = 'squircle' | 'circulo' | 'dock' | 'livre';
export type KiwiComicEmote = 'auto' | 'alerta' | 'confuso' | 'cansado' | 'feliz' | 'limite';

export type KiwiOverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type KiwiOverlayTransition =
  | 'auto-direcional'
  | 'materializacao-nevoa'
  | 'salto-elastico'
  | 'espreitar-borda';

export interface KiwiConfig {
  earStyle: KiwiEarStyle;
  earScale: number;
  eyeStyle: KiwiEyeStyle;
  eyeScale: number;
  eyeSpacing: number;
  silhouetteSoftness: number;
  bodyWidth: number;
  paletteId: string;
  bodyColor: string;
  accentColor: string;
  surfaceBg: string;
  eyeColor: string;
  prismStops: [string, string, string];
  mistBaseColor: string;
  auraIntensity: number;
  prismSpread: number;
  auraStyle: KiwiAuraStyle;
  motionFluidity: number;
  speedMultiplier: number;
  voiceReactivity: number;
  eyeExpressiveness: number;
  uiFrame: KiwiFrameStyle;
  showAmbientMist: boolean;
  showAcousticRings: boolean;
  showMascotDetails: boolean;
  showChinEqualizer: boolean;
  showComicEmotes: boolean;
  comicEmote: KiwiComicEmote;
  showSpeechBubble: boolean;
  speechBubbleText: string;
  speechBubbleColor: string;
  speechBubbleOffsetX: number;
  speechBubbleOffsetY: number;
  overlayPosition: KiwiOverlayPosition;
  overlayTransition: KiwiOverlayTransition;
  overlayEntryMs: number;
  overlayExitMs: number;
  overlaySpringBounce: number;
}

export const ACTIVE_KIWI_PRESET_ID: string = "custom-1794801995497";

export const DEFAULT_KIWI_CONFIG: KiwiConfig = {
  "earStyle": "compactas",
  "earScale": 0.75,
  "eyeStyle": "circulares",
  "eyeScale": 1.05,
  "eyeSpacing": 1,
  "silhouetteSoftness": 18,
  "bodyWidth": 1.06,
  "paletteId": "prisma-original",
  "bodyColor": "#050507",
  "accentColor": "#F472B6",
  "surfaceBg": "#090A0E",
  "eyeColor": "#FFFFFF",
  "prismStops": [
    "#22D3EE",
    "#6366F1",
    "#EC4899"
  ],
  "mistBaseColor": "#D4D8E4",
  "auraIntensity": 95,
  "prismSpread": 78,
  "auraStyle": "borda-suave",
  "motionFluidity": 100,
  "speedMultiplier": 1.2,
  "voiceReactivity": 85,
  "eyeExpressiveness": 88,
  "uiFrame": "livre",
  "showAmbientMist": false,
  "showAcousticRings": false,
  "showMascotDetails": true,
  "showChinEqualizer": false,
  "showComicEmotes": true,
  "comicEmote": "auto",
  "showSpeechBubble": true,
  "speechBubbleText": "Pronto para criar. Pode falar!",
  "speechBubbleColor": "#F472B6",
  "speechBubbleOffsetX": -56,
  "speechBubbleOffsetY": -48,
  "overlayPosition": "bottom-right",
  "overlayTransition": "materializacao-nevoa",
  "overlayEntryMs": 420,
  "overlayExitMs": 280,
  "overlaySpringBounce": 68
};

export interface KiwiPaletteOption {
  id: string;
  name: string;
  description: string;
  prismStops: [string, string, string];
  surfaceBg: string;
  silhouetteColor: string;
  accentColor: string;
  mistColor: string;
  eyeColor: string;
  isSelected: boolean;
}

export const KIWI_COLOR_PALETTES: KiwiPaletteOption[] = [
  {
    "id": "prisma-original",
    "name": "Prisma Original",
    "description": "Ciano, índigo e magenta suaves na névoa atrás da silhueta escura",
    "prismStops": [
      "#22D3EE",
      "#6366F1",
      "#EC4899"
    ],
    "surfaceBg": "#090A0E",
    "silhouetteColor": "#050507",
    "accentColor": "#F472B6",
    "mistColor": "#D4D8E4",
    "eyeColor": "#FFFFFF",
    "isSelected": true
  },
  {
    "id": "kiwi-neon",
    "name": "Kiwi Elétrico",
    "description": "Chassi obsidiana com destaque verde-lima e aura ciano-esmeralda",
    "prismStops": [
      "#A3E635",
      "#22D3EE",
      "#10B981"
    ],
    "surfaceBg": "#080B09",
    "silhouetteColor": "#050705",
    "accentColor": "#A3E635",
    "mistColor": "#D9F99D",
    "eyeColor": "#FFFFFF",
    "isSelected": false
  },
  {
    "id": "ambar-solar",
    "name": "Âmbar Noturno",
    "description": "Calor coral e dourado para alertas de limite e foco calmo",
    "prismStops": [
      "#FBBF24",
      "#F97316",
      "#FB7185"
    ],
    "surfaceBg": "#0C0908",
    "silhouetteColor": "#070505",
    "accentColor": "#FB7185",
    "mistColor": "#FED7AA",
    "eyeColor": "#FFFFFF",
    "isSelected": false
  },
  {
    "id": "soul-claro",
    "name": "Soul Mist · Claro (Ref.)",
    "description": "Fundo branco fiel ao vídeo MP4 com tinta escura e fita ciano-azul-magenta",
    "prismStops": [
      "#22D3EE",
      "#3B82F6",
      "#EC4899"
    ],
    "surfaceBg": "#FFFFFF",
    "silhouetteColor": "#050507",
    "accentColor": "#EC4899",
    "mistColor": "#050507",
    "eyeColor": "#FFFFFF",
    "isSelected": false
  },
  {
    "id": "nevoa-violeta",
    "name": "Névoa Violeta",
    "description": "Atmosfera noturna roxo-azulada com contorno luminescente",
    "prismStops": [
      "#38BDF8",
      "#A855F7",
      "#F472B6"
    ],
    "surfaceBg": "#090810",
    "silhouetteColor": "#06050A",
    "accentColor": "#C084FC",
    "mistColor": "#DDD6FE",
    "eyeColor": "#FFFFFF",
    "isSelected": false
  }
];

export const KIWI_AURA_STYLES: {
  id: KiwiAuraStyle;
  label: string;
  desc: string;
  isSelected: boolean;
}[] = [
  {
    "id": "borda-suave",
    "label": "Arco Orbital (MP4)",
    "desc": "Fita prismática que abraça o contorno e desliza continuamente em volta do mascote.",
    "isSelected": true
  },
  {
    "id": "contorno-sutil",
    "label": "Crescente Diagonal (JPEG)",
    "desc": "Fixa o arco ciano-índigo-rosa na curva inferior direita e pulsa com a voz.",
    "isSelected": false
  },
  {
    "id": "halo-difuso",
    "label": "Aurora Dupla",
    "desc": "Duas fitas iridescentes em lados opostos envolvendo toda a silhueta orgânica.",
    "isSelected": false
  },
  {
    "id": "nuvem-base",
    "label": "Véu na Cauda",
    "desc": "Concentra o brilho colorido abaixo do queixo e ao longo da cauda de fumaça.",
    "isSelected": false
  }
];

export const KIWI_OVERLAY_TRANSITIONS: {
  id: KiwiOverlayTransition;
  label: string;
  desc: string;
  isSelected: boolean;
}[] = [
  {
    "id": "auto-direcional",
    "label": "Auto Direcional",
    "desc": "Sai da borda/canto escolhido e materializa no centro com névoa",
    "isSelected": false
  },
  {
    "id": "materializacao-nevoa",
    "label": "Materialização Névoa",
    "desc": "Surge condensando da névoa com desfoque suave em qualquer ponto",
    "isSelected": true
  },
  {
    "id": "salto-elastico",
    "label": "Salto Elástico HQ",
    "desc": "Pop expressivo estilo mangá com overshoot de escala ao pousar",
    "isSelected": false
  },
  {
    "id": "espreitar-borda",
    "label": "Espreitar Rápido",
    "desc": "Deslize ágil com inclinação de cabeça e saída imediata",
    "isSelected": false
  }
];

export const KIWI_OVERLAY_POSITIONS: {
  id: KiwiOverlayPosition;
  label: string;
  motionCue: string;
  isSelected: boolean;
}[] = [
  {
    "id": "top-left",
    "label": "Canto Superior Esquerdo",
    "motionCue": "Entra na diagonal para baixo e para a direita com leve inclinação de orelha",
    "isSelected": false
  },
  {
    "id": "top-center",
    "label": "Centro Superior",
    "motionCue": "Desce da barra superior como um HUD elástico com pouso suave",
    "isSelected": false
  },
  {
    "id": "top-right",
    "label": "Canto Superior Direito",
    "motionCue": "Entra na diagonal para baixo e para a esquerda saindo do canto direito",
    "isSelected": false
  },
  {
    "id": "center-left",
    "label": "Borda Esquerda",
    "motionCue": "Espreita da borda esquerda para o palco com rotação suave",
    "isSelected": false
  },
  {
    "id": "center",
    "label": "Centro da Tela",
    "motionCue": "Materializa no centro com expansão da névoa prismática e pouso elástico",
    "isSelected": false
  },
  {
    "id": "center-right",
    "label": "Borda Direita",
    "motionCue": "Espreita da borda direita para dentro com balão voltado à esquerda",
    "isSelected": false
  },
  {
    "id": "bottom-left",
    "label": "Canto Inferior Esquerdo",
    "motionCue": "Sobe na diagonal a partir do canto inferior esquerdo",
    "isSelected": false
  },
  {
    "id": "bottom-center",
    "label": "Centro Inferior",
    "motionCue": "Emerge acima do Dock do Mac com impulso vertical e amortecimento",
    "isSelected": false
  },
  {
    "id": "bottom-right",
    "label": "Canto Inferior Direito",
    "motionCue": "Sobe na diagonal a partir do canto inferior direito com balão acima à esquerda",
    "isSelected": true
  }
];

export interface KiwiPersonalityPreset {
  id: string;
  name: string;
  subtitle: string;
  isBuiltIn: boolean;
  isSelected: boolean;
  state: KiwiState;
  config: KiwiConfig;
}

export const KIWI_PERSONALITY_PRESETS: KiwiPersonalityPreset[] = [
  {
    "id": "custom-1794801995497",
    "name": "KiwiCat Ver Final Perfect",
    "subtitle": "Byte Kiwi Cat · respondendo",
    "isBuiltIn": false,
    "isSelected": true,
    "state": "respondendo",
    "config": {
      "earStyle": "compactas",
      "earScale": 0.75,
      "eyeStyle": "circulares",
      "eyeScale": 1.05,
      "eyeSpacing": 1,
      "silhouetteSoftness": 18,
      "bodyWidth": 1.06,
      "paletteId": "prisma-original",
      "bodyColor": "#050507",
      "accentColor": "#F472B6",
      "surfaceBg": "#090A0E",
      "eyeColor": "#FFFFFF",
      "prismStops": [
        "#22D3EE",
        "#6366F1",
        "#EC4899"
      ],
      "mistBaseColor": "#D4D8E4",
      "auraIntensity": 95,
      "prismSpread": 78,
      "auraStyle": "borda-suave",
      "motionFluidity": 100,
      "speedMultiplier": 1.2,
      "voiceReactivity": 85,
      "eyeExpressiveness": 88,
      "uiFrame": "livre",
      "showAmbientMist": false,
      "showAcousticRings": false,
      "showMascotDetails": true,
      "showChinEqualizer": false,
      "showComicEmotes": true,
      "comicEmote": "auto",
      "showSpeechBubble": true,
      "speechBubbleText": "Pronto para criar. Pode falar!",
      "speechBubbleColor": "#F472B6",
      "speechBubbleOffsetX": -56,
      "speechBubbleOffsetY": -48,
      "overlayPosition": "bottom-right",
      "overlayTransition": "materializacao-nevoa",
      "overlayEntryMs": 420,
      "overlayExitMs": 280,
      "overlaySpringBounce": 68
    }
  },
  {
    "id": "custom-1794801023987",
    "name": "KiwiCat Quase final",
    "subtitle": "Byte Kiwi Cat · repouso",
    "isBuiltIn": false,
    "isSelected": false,
    "state": "repouso",
    "config": {
      "earStyle": "compactas",
      "earScale": 0.85,
      "eyeStyle": "circulares",
      "eyeScale": 1.05,
      "eyeSpacing": 1,
      "silhouetteSoftness": 21,
      "bodyWidth": 0.98,
      "paletteId": "prisma-original",
      "bodyColor": "#050507",
      "accentColor": "#F472B6",
      "surfaceBg": "#090A0E",
      "eyeColor": "#FFFFFF",
      "prismStops": [
        "#22D3EE",
        "#6366F1",
        "#EC4899"
      ],
      "mistBaseColor": "#D4D8E4",
      "auraIntensity": 95,
      "prismSpread": 78,
      "auraStyle": "borda-suave",
      "motionFluidity": 100,
      "speedMultiplier": 1.2,
      "voiceReactivity": 85,
      "eyeExpressiveness": 88,
      "uiFrame": "livre",
      "showAmbientMist": true,
      "showAcousticRings": false,
      "showMascotDetails": true,
      "showChinEqualizer": false,
      "showComicEmotes": true,
      "comicEmote": "auto",
      "showSpeechBubble": false,
      "speechBubbleText": "Analisando seu pedido...",
      "speechBubbleColor": "#F472B6",
      "speechBubbleOffsetX": -56,
      "speechBubbleOffsetY": -48,
      "overlayPosition": "bottom-right",
      "overlayTransition": "materializacao-nevoa",
      "overlayEntryMs": 420,
      "overlayExitMs": 280,
      "overlaySpringBounce": 68
    }
  },
  {
    "id": "preset-byte-kiwi-cat",
    "name": "Byte Kiwi Cat · Soul Mist (Escuro)",
    "subtitle": "Tinta orgânica + fita prismática orbital pronta para overlay no Mac",
    "isBuiltIn": true,
    "isSelected": false,
    "state": "ouvindo",
    "config": {
      "earStyle": "pontiagudas",
      "earScale": 1,
      "eyeStyle": "circulares",
      "eyeScale": 1.05,
      "eyeSpacing": 1,
      "silhouetteSoftness": 46,
      "bodyWidth": 1,
      "paletteId": "prisma-original",
      "bodyColor": "#050507",
      "accentColor": "#F472B6",
      "surfaceBg": "#090A0E",
      "eyeColor": "#FFFFFF",
      "prismStops": [
        "#22D3EE",
        "#3B82F6",
        "#EC4899"
      ],
      "mistBaseColor": "#D4D8E4",
      "auraIntensity": 95,
      "prismSpread": 78,
      "auraStyle": "borda-suave",
      "motionFluidity": 80,
      "speedMultiplier": 1,
      "voiceReactivity": 85,
      "eyeExpressiveness": 88,
      "uiFrame": "livre",
      "showAmbientMist": true,
      "showAcousticRings": false,
      "showMascotDetails": false,
      "showChinEqualizer": false,
      "showComicEmotes": true,
      "comicEmote": "alerta",
      "showSpeechBubble": true,
      "speechBubbleText": "Pronto para criar. Pode falar!",
      "speechBubbleColor": "#F472B6",
      "speechBubbleOffsetX": -56,
      "speechBubbleOffsetY": -48,
      "overlayPosition": "bottom-right",
      "overlayTransition": "materializacao-nevoa",
      "overlayEntryMs": 420,
      "overlayExitMs": 280,
      "overlaySpringBounce": 68
    }
  },
  {
    "id": "preset-soul-reference-mp4",
    "name": "Soul Mist · Referência MP4 (Claro)",
    "subtitle": "Visual puro da referência em fundo branco sem balão nem emotes",
    "isBuiltIn": true,
    "isSelected": false,
    "state": "ouvindo",
    "config": {
      "earStyle": "pontiagudas",
      "earScale": 1,
      "eyeStyle": "circulares",
      "eyeScale": 1.05,
      "eyeSpacing": 1,
      "silhouetteSoftness": 52,
      "bodyWidth": 1,
      "paletteId": "soul-claro",
      "bodyColor": "#050507",
      "accentColor": "#F472B6",
      "surfaceBg": "#FFFFFF",
      "eyeColor": "#FFFFFF",
      "prismStops": [
        "#22D3EE",
        "#3B82F6",
        "#EC4899"
      ],
      "mistBaseColor": "#050507",
      "auraIntensity": 95,
      "prismSpread": 78,
      "auraStyle": "borda-suave",
      "motionFluidity": 80,
      "speedMultiplier": 1,
      "voiceReactivity": 85,
      "eyeExpressiveness": 88,
      "uiFrame": "livre",
      "showAmbientMist": true,
      "showAcousticRings": false,
      "showMascotDetails": false,
      "showChinEqualizer": false,
      "showComicEmotes": false,
      "comicEmote": "alerta",
      "showSpeechBubble": false,
      "speechBubbleText": "Pronto para criar. Pode falar!",
      "speechBubbleColor": "#F472B6",
      "speechBubbleOffsetX": -56,
      "speechBubbleOffsetY": -48,
      "overlayPosition": "bottom-right",
      "overlayTransition": "materializacao-nevoa",
      "overlayEntryMs": 420,
      "overlayExitMs": 280,
      "overlaySpringBounce": 68
    }
  }
];

interface StateTarget {
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

const STATE_TARGETS: Record<KiwiState, StateTarget> = {
  repouso: {
    breathSpeed: 1.05,
    breathAmp: 0.018,
    eyeOpenY: 1,
    eyeScale: 1,
    gazeX: 0,
    gazeY: 0,
    headTiltDeg: 0,
    headLiftY: 0,
    earPerk: 0,
    prismOpacity: 0.88,
    mistPulseSpeed: 0.72,
    ringScale: 1.0,
    yawAmp: 0.032,
    pitchAmp: 0.014,
    pitchBias: 0,
    rollAmp: 0.018,
    rollBias: -0.01,
    bodyScale: 0.85,
    tailStretch: 0.12,
    liquidAmp: 0.34,
  },
  ouvindo: {
    breathSpeed: 1.65,
    breathAmp: 0.022,
    eyeOpenY: 1.06,
    eyeScale: 1.08,
    gazeX: 0,
    gazeY: 0,
    headTiltDeg: 2,
    headLiftY: 0.015,
    earPerk: 0.80,
    prismOpacity: 1.0,
    mistPulseSpeed: 1.45,
    ringScale: 1.12,
    yawAmp: 0.038,
    pitchAmp: 0.016,
    pitchBias: 0,
    rollAmp: 0.022,
    rollBias: 0.045,
    bodyScale: 0.94,
    tailStretch: 0.22,
    liquidAmp: 0.62,
  },
  pensando: {
    breathSpeed: 1.35,
    breathAmp: 0.020,
    eyeOpenY: 0.93,
    eyeScale: 0.98,
    gazeX: 0,
    gazeY: 0,
    headTiltDeg: -4,
    headLiftY: 0.010,
    earPerk: 0.35,
    prismOpacity: 0.96,
    mistPulseSpeed: 1.85,
    ringScale: 1.05,
    yawAmp: 0.048,
    pitchAmp: 0.018,
    pitchBias: 0,
    rollAmp: 0.028,
    rollBias: -0.055,
    bodyScale: 0.91,
    tailStretch: 0.24,
    liquidAmp: 0.70,
  },
  respondendo: {
    breathSpeed: 2.25,
    breathAmp: 0.026,
    eyeOpenY: 1.01,
    eyeScale: 1.06,
    gazeX: 0,
    gazeY: 0,
    headTiltDeg: 1,
    headLiftY: 0.020,
    earPerk: 0.65,
    prismOpacity: 1.0,
    mistPulseSpeed: 2.25,
    ringScale: 1.18,
    yawAmp: 0.050,
    pitchAmp: 0.020,
    pitchBias: 0,
    rollAmp: 0.030,
    rollBias: 0.01,
    bodyScale: 0.99,
    tailStretch: 0.28,
    liquidAmp: 0.78,
  },
  dormindo: {
    breathSpeed: 0.72,
    breathAmp: 0.022,
    eyeOpenY: 0.12,
    eyeScale: 0.94,
    gazeX: 0,
    gazeY: -0.35,
    headTiltDeg: -6,
    headLiftY: -0.025,
    earPerk: -0.45,
    prismOpacity: 0.52,
    mistPulseSpeed: 0.38,
    ringScale: 0.92,
    yawAmp: 0.025,
    pitchAmp: 0.020,
    pitchBias: -0.10,
    rollAmp: 0.020,
    rollBias: -0.08,
    bodyScale: 0.78,
    tailStretch: 0.06,
    liquidAmp: 0.22,
  },
};

function isLightHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function hexToRgbVec(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

const CAM_Z = 3.1;
const FOCAL_LEN = 2.45;

function rotatePoint3D(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  roll: number
): [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp + z1 * sp;
  const z2 = -y * sp + z1 * cp;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
}

function project3DPointToCanvas(
  localX: number,
  localY: number,
  localZ: number,
  yaw: number,
  pitch: number,
  roll: number,
  headOffsetX: number,
  headOffsetY: number,
  canvasSize: number
): { x: number; y: number; z: number } {
  const [rx, ry, rz] = rotatePoint3D(localX, localY, localZ, yaw, pitch, roll);
  const wx = rx + headOffsetX;
  const wy = ry + headOffsetY;
  const dz = Math.max(0.5, CAM_Z - rz);
  return {
    x: (0.5 + 0.5 * ((wx * FOCAL_LEN) / dz)) * canvasSize,
    y: (0.5 - 0.5 * ((wy * FOCAL_LEN) / dz)) * canvasSize,
    z: rz,
  };
}

function project3DFacePoint(
  localX: number,
  localY: number,
  localZ: number,
  yaw: number,
  pitch: number,
  roll: number,
  headOffsetX: number,
  headOffsetY: number,
  canvasSize: number
) {
  const pt = project3DPointToCanvas(
    localX,
    localY,
    localZ,
    yaw,
    pitch,
    roll,
    headOffsetX,
    headOffsetY,
    canvasSize
  );
  const nLen = Math.hypot(localX, localY, localZ) || 1;
  const [nx, ny, nz] = rotatePoint3D(localX / nLen, localY / nLen, localZ / nLen, yaw, pitch, roll);
  const [tx, ty] = rotatePoint3D(1, 0, 0, yaw, pitch, roll);
  const depthScale = (CAM_Z - 0.45) / Math.max(0.5, CAM_Z - pt.z);
  const facing = Math.max(0.32, nz);
  return {
    x: pt.x,
    y: pt.y,
    scaleX: Math.max(0.40, Math.sqrt(Math.max(0.1, 1 - nx * nx * 0.62))) * depthScale * (0.88 + 0.12 * facing),
    scaleY: Math.max(0.45, Math.sqrt(Math.max(0.1, 1 - ny * ny * 0.52))) * depthScale,
    angleRad: Math.atan2(-ty, tx),
    visible: nz > -0.15,
  };
}

function drawSeparateFlat3DEars(
  ctx: CanvasRenderingContext2D,
  earCanvas: HTMLCanvasElement,
  size: number,
  backingPx: number,
  dpr: number,
  yaw: number,
  pitch: number,
  roll: number,
  headOffsetX: number,
  headOffsetY: number,
  bodyWidth: number,
  earStyle: KiwiEarStyle,
  earScale: number,
  earPerk: number,
  bodyColor: string
) {
  if (earCanvas.width !== backingPx || earCanvas.height !== backingPx) {
    earCanvas.width = backingPx;
    earCanvas.height = backingPx;
  }
  const eCtx = earCanvas.getContext('2d');
  if (!eCtx) return;

  const earH =
    earStyle === 'alongadas' ? 0.43 : earStyle === 'compactas' ? 0.21 : earStyle === 'arredondadas' ? 0.28 : 0.34;
  const tipRound =
    earStyle === 'arredondadas' ? 0.34 : earStyle === 'compactas' ? 0.27 : earStyle === 'alongadas' ? 0.17 : 0.22;
  const w = bodyWidth;
  const lift = earPerk * 0.055;
  const tipY = 0.36 + earH * earScale + lift;
  const spreadX = 0.50 * w + (earScale - 1) * 0.07;
  const proj = (lx: number, ly: number, lz: number) =>
    project3DPointToCanvas(lx, ly, lz, yaw, pitch, roll, headOffsetX, headOffsetY, size);

  const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });

  const drawSingleEar = (side: -1 | 1) => {
    const pOuterBase = proj(side * 0.45 * w, 0.13, 0.03);
    const pOuterCtrl = proj(side * (0.49 * w + (earScale - 1) * 0.04), 0.30 + earH * earScale * 0.40, -0.01);
    const pTip = proj(side * spreadX, tipY, -0.04);
    const pInnerCtrl = proj(side * 0.29 * w, 0.36 + earH * earScale * 0.34 + lift * 0.45, 0.06);
    const pInnerBase = proj(side * 0.135 * w, 0.295 + lift * 0.2, 0.12);
    const pRootMid = proj(side * 0.30 * w, 0.21, 0.10);

    const inOuter = lerpPt(pTip, pOuterCtrl, tipRound);
    const inInner = lerpPt(pTip, pInnerCtrl, tipRound);

    eCtx.save();
    eCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    eCtx.clearRect(0, 0, size, size);
    eCtx.globalCompositeOperation = 'source-over';

    eCtx.beginPath();
    eCtx.moveTo(pOuterBase.x, pOuterBase.y);
    eCtx.quadraticCurveTo(pOuterCtrl.x, pOuterCtrl.y, inOuter.x, inOuter.y);
    eCtx.quadraticCurveTo(pTip.x, pTip.y, inInner.x, inInner.y);
    eCtx.quadraticCurveTo(pInnerCtrl.x, pInnerCtrl.y, pInnerBase.x, pInnerBase.y);
    eCtx.quadraticCurveTo(pRootMid.x, pRootMid.y, pOuterBase.x, pOuterBase.y);
    eCtx.closePath();

    eCtx.fillStyle = bodyColor;
    eCtx.shadowColor = bodyColor;
    eCtx.shadowBlur = Math.max(2.0, size * 0.014);
    eCtx.fill();
    eCtx.shadowBlur = 0;

    const pFadeStart = proj(side * 0.30 * w, 0.32, 0.10);
    const pFadeEnd = proj(side * 0.30 * w, 0.10, 0.12);
    eCtx.globalCompositeOperation = 'destination-in';
    const fadeMask = eCtx.createLinearGradient(pFadeStart.x, pFadeStart.y, pFadeEnd.x, pFadeEnd.y);
    fadeMask.addColorStop(0, 'rgba(255,255,255,1)');
    fadeMask.addColorStop(0.58, 'rgba(255,255,255,0.88)');
    fadeMask.addColorStop(1, 'rgba(255,255,255,0)');
    eCtx.fillStyle = fadeMask;
    eCtx.fillRect(0, 0, size, size);
    eCtx.restore();

    ctx.drawImage(earCanvas, 0, 0, size, size);
  };

  drawSingleEar(-1);
  drawSingleEar(1);
}

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0); }
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime, uAudio, uYaw, uPitch, uRoll;
uniform float uBodyWidth, uSoftness, uAuraIntensity, uMistDiffusion, uPrismSpread, uShowMist;
uniform float uOrbitPhase, uWavePhase, uIsLight, uBodyScale, uTailStretch, uLiquidAmp;
uniform int uAuraStyle, uSteps;
uniform vec2 uHeadOffset, uLagOffset;
uniform vec3 uBodyColor, uPrismStart, uPrismMid, uPrismEnd, uMistColor;

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i), n100 = hash31(i + vec3(1,0,0)), n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1)), n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  return 0.62 * noise3(p) + 0.38 * noise3(p * 2.07 + vec3(13.1, 7.7, 5.3));
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float mapSmokeBody(vec3 pw) {
  vec3 pBase = pw - vec3(uHeadOffset, 0.0);
  float bScale = clamp(uBodyScale, 0.70, 1.26);
  float tStretch = clamp(uTailStretch, 0.0, 0.65);
  vec3 orbCenter = vec3(uLagOffset.x * 0.12, -0.075 + uLagOffset.y * 0.08, -0.06);
  float dOrb = (length((pBase - orbCenter) / vec3(0.46 * uBodyWidth * bScale, 0.42 * bScale, 0.43 * bScale)) - 1.0) * 0.40 * bScale;
  float dLobe1 = (length((pBase - vec3(uLagOffset.x * 0.65, -0.17 - 0.055 * tStretch + uLagOffset.y * 0.28, -0.14)) / vec3(0.42 * uBodyWidth * (0.78 + 0.30 * bScale), (0.26 + 0.06 * tStretch) * bScale, 0.35 * bScale)) - 1.0) * 0.31 * bScale;
  float dLobe2 = (length((pBase - vec3(uLagOffset.x * 1.05, -0.24 - 0.085 * tStretch + uLagOffset.y * 0.42, -0.22)) / vec3(0.29 * uBodyWidth * (0.74 + 0.30 * bScale), (0.19 + 0.065 * tStretch) * bScale, 0.26 * bScale)) - 1.0) * 0.24 * bScale;
  float dLobe3 = (length((pBase - vec3(-uLagOffset.x * 0.35, 0.01, -0.26)) / vec3(0.39 * uBodyWidth * bScale, 0.27 * bScale, 0.30 * bScale)) - 1.0) * 0.28 * bScale;
  float dMass = smin(dOrb, dLobe1, 0.24 * bScale);
  dMass = smin(dMass, dLobe2, 0.24 * bScale);
  if (uShowMist > 0.5) dMass = smin(dMass, dLobe3, 0.25 * bScale);
  float fbmSwirl = fbm3(pBase * 2.15 + vec3(-uLagOffset.x * 0.85, -uTime * 0.52, uTime * 0.18)) - 0.5;
  float liquidWave = 0.55 * sin(pBase.y * 3.6 - uTime * 2.1 + pBase.x * 1.9) + 0.45 * cos(pBase.x * 3.2 + uTime * 1.65 - pBase.y * 2.2);
  float lowerWeight = smoothstep(0.32, -0.40, pBase.y);
  float outerRimWeight = smoothstep(-0.18, 0.05, dMass);
  float wholeBodyMix = 0.52 + 0.48 * max(lowerWeight, outerRimWeight);
  float disp = (fbmSwirl * 0.82 + liquidWave * 0.18) * (0.050 + 0.115 * uSoftness + 0.082 * uLiquidAmp) * wholeBodyMix;
  return dMass + disp;
}
vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.005, -0.005);
  return normalize(e.xyy*mapSmokeBody(p+e.xyy) + e.yyx*mapSmokeBody(p+e.yyx) + e.yxy*mapSmokeBody(p+e.yxy) + e.xxx*mapSmokeBody(p+e.xxx));
}
vec4 evalAurora(vec3 p, vec3 n, vec3 viewDir, float dSmoke) {
  if (uAuraIntensity <= 0.01) return vec4(0.0);
  vec3 pSmoke = p - vec3(uHeadOffset, 0.0);
  vec3 sweepDir = uAuraStyle == 1 ? normalize(vec3(0.72,-0.62,0.28))
    : uAuraStyle == 3 ? normalize(vec3(0.36,-0.88,0.24))
    : normalize(vec3(cos(uOrbitPhase), sin(uOrbitPhase * 0.75) * 0.80, 0.36));
  float waveBend = 0.068 * sin(pSmoke.y * 1.45 - uWavePhase * 0.34) + 0.042 * cos(pSmoke.x * 1.25 + uWavePhase * 0.22);
  float spread = 0.72 + uPrismSpread * 0.52;
  float bandHalf = 0.36 * spread;
  float distToBand = (dot(pSmoke, sweepDir) + waveBend - 0.18) / bandHalf;
  float bandMask = exp(-distToBand * distToBand * 1.38);
  if (uAuraStyle == 2) {
    vec3 sweepDir2 = normalize(vec3(-cos(uOrbitPhase), -sin(uOrbitPhase * 0.78) * 0.68, 0.30));
    float d2 = (dot(pSmoke, sweepDir2) - waveBend * 0.65 - 0.18) / (bandHalf * 0.92);
    bandMask = max(bandMask, exp(-d2 * d2 * 1.38) * 0.85);
  }
  float shellCoord = clamp(smoothstep(-0.10, 0.18 * spread, dSmoke), 0.0, 1.0);
  float colorCoord = clamp(mix(0.48 + distToBand * 0.36, shellCoord, 0.68), 0.0, 1.0);
  vec3 auroraCol = mix(mix(uPrismEnd, uPrismMid, smoothstep(0.06, 0.52, colorCoord)), uPrismStart, smoothstep(0.46, 0.94, colorCoord));
  float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 1.25);
  float rimEnvelope = smoothstep(0.30 * spread, 0.02, dSmoke) * smoothstep(-0.20, 0.02, dSmoke);
  float surfaceGrazing = fresnel * smoothstep(0.24 * spread, -0.08, dSmoke);
  float intensity = bandMask * max(surfaceGrazing * 0.88, rimEnvelope * 1.08) * uAuraIntensity * (1.0 + uAudio * 0.30);
  return vec4(auroraCol, clamp(intensity, 0.0, 1.0));
}
void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  vec3 ro = vec3(0.0, 0.0, 3.1);
  vec3 rd = normalize(vec3(uv.x, uv.y, -2.45));
  vec3 oc = ro - vec3(uHeadOffset.x + uLagOffset.x * 0.22, uHeadOffset.y - 0.18, -0.10);
  float b = dot(oc, rd); float disc = b * b - (dot(oc, oc) - 1.62 * 1.62);
  if (disc < 0.0) { fragColor = vec4(0.0); return; }
  float t = max(0.5, -b - sqrt(disc)); float tFar = -b + sqrt(disc);
  float minD = 10.0; float minT = t;
  for (int i = 0; i < 32; i++) {
    if (i >= uSteps) break;
    float d = mapSmokeBody(ro + rd * t);
    if (d < minD) { minD = d; minT = t; }
    if (d < 0.003 || t > tFar) break;
    t += max(0.015, d * 0.72);
  }
  vec3 pClosest = ro + rd * minT; vec3 n = calcNormal(pClosest);
  float bodyFeather = 0.115 + 0.185 * uSoftness + 0.085 * uMistDiffusion;
  float inkAlpha = pow(smoothstep(bodyFeather, -0.068, minD), 1.38);
  float outerHaze = uShowMist > 0.5 ? pow(smoothstep(bodyFeather * (1.68 + 0.45 * uMistDiffusion), -0.02, minD), 1.45) * (0.20 + 0.15 * uMistDiffusion) : 0.0;
  vec3 coreShade = mix(mix(uBodyColor, vec3(0.085, 0.045, 0.15), 0.75), uBodyColor, smoothstep(0.18, 0.80, inkAlpha));
  float totalInkAlpha = clamp(max(inkAlpha, outerHaze), 0.0, 1.0);
  vec4 aurora = evalAurora(pClosest, n, -rd, minD);
  float auroraOuter = aurora.a * smoothstep(0.32, -0.02, minD) * (0.68 + 0.22 * uMistDiffusion);
  vec3 finalRgb = coreShade; float finalAlpha = totalInkAlpha;
  if (uIsLight > 0.5) {
    vec3 mixedInk = mix(coreShade, aurora.rgb, clamp(aurora.a * 0.90, 0.0, 1.0));
    finalAlpha = clamp(max(totalInkAlpha, auroraOuter * 0.90), 0.0, 1.0);
    finalRgb = mix(mixedInk, aurora.rgb, clamp((auroraOuter * 0.90) / max(0.001, finalAlpha), 0.0, 1.0) * (1.0 - inkAlpha));
  } else {
    float boost = 1.12;
    vec3 glowAdded = coreShade + aurora.rgb * (aurora.a * (0.35 + 0.65 * totalInkAlpha) * boost * 0.88);
    finalAlpha = clamp(max(totalInkAlpha, auroraOuter * 0.95), 0.0, 1.0);
    finalRgb = mix(aurora.rgb * boost, glowAdded, smoothstep(0.05, 0.55, totalInkAlpha));
  }
  float dither = (hash31(vec3(gl_FragCoord.xy, fract(uTime) * 60.0)) - 0.5) * (1.4 / 255.0);
  finalAlpha = clamp(finalAlpha + dither, 0.0, 1.0);
  finalRgb = clamp(finalRgb + dither * 0.5, 0.0, 1.0);
  fragColor = vec4(finalRgb * finalAlpha, finalAlpha);
}
`;

class KiwiSoulMist3DEngine {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private failed = false;

  private ensureInit(): boolean {
    if (this.failed) return false;
    if (this.gl && !this.gl.isContextLost() && this.program) return true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
      if (!gl) { this.failed = true; return false; }
      const vs = gl.createShader(gl.VERTEX_SHADER);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      if (!vs || !fs) { this.failed = true; return false; }
      gl.shaderSource(vs, VERTEX_SHADER_SRC); gl.compileShader(vs);
      gl.shaderSource(fs, FRAGMENT_SHADER_SRC); gl.compileShader(fs);
      const prog = gl.createProgram();
      if (!prog) { this.failed = true; return false; }
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.failed = true; return false; }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const names = ['uResolution','uTime','uAudio','uYaw','uPitch','uRoll','uHeadOffset','uLagOffset','uBodyWidth','uSoftness','uAuraIntensity','uMistDiffusion','uPrismSpread','uAuraStyle','uShowMist','uOrbitPhase','uWavePhase','uIsLight','uBodyScale','uTailStretch','uLiquidAmp','uSteps','uBodyColor','uPrismStart','uPrismMid','uPrismEnd','uMistColor'];
      for (const n of names) this.uniforms[n] = gl.getUniformLocation(prog, n);
      this.canvas = canvas; this.gl = gl; this.program = prog; this.vao = vao;
      return true;
    } catch { this.failed = true; return false; }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    drawSize: number,
    backingPx: number,
    cfg: KiwiConfig,
    yaw: number,
    pitch: number,
    roll: number,
    headX: number,
    headY: number,
    lagX: number,
    lagY: number,
    auraPct: number,
    orbitPhase: number,
    wavePhase: number,
    time: number,
    audio: number,
    isLight: boolean,
    bodyScale: number,
    tailStretch: number,
    liquidAmp: number
  ): boolean {
    if (!this.ensureInit() || !this.gl || !this.canvas || !this.program) return false;
    const gl = this.gl;
    const px = Math.max(96, Math.min(560, Math.round(backingPx)));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px; this.canvas.height = px;
    }
    gl.viewport(0, 0, px, px);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const styleInt = cfg.auraStyle === 'contorno-sutil' ? 1 : cfg.auraStyle === 'halo-difuso' ? 2 : cfg.auraStyle === 'nuvem-base' ? 3 : 0;
    const bc = hexToRgbVec(cfg.bodyColor);
    const p1 = hexToRgbVec(cfg.prismStops[0]);
    const p2 = hexToRgbVec(cfg.prismStops[1]);
    const p3 = hexToRgbVec(cfg.prismStops[2]);
    const mc = hexToRgbVec(cfg.mistBaseColor);
    const u = this.uniforms;
    gl.uniform2f(u.uResolution, px, px);
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uAudio, audio);
    gl.uniform1f(u.uYaw, yaw); gl.uniform1f(u.uPitch, pitch); gl.uniform1f(u.uRoll, roll);
    gl.uniform2f(u.uHeadOffset, headX, headY); gl.uniform2f(u.uLagOffset, lagX, lagY);
    gl.uniform1f(u.uBodyWidth, cfg.bodyWidth); gl.uniform1f(u.uSoftness, cfg.silhouetteSoftness / 100);
    gl.uniform1f(u.uAuraIntensity, auraPct / 100); gl.uniform1f(u.uMistDiffusion, cfg.prismSpread / 100);
    gl.uniform1f(u.uPrismSpread, cfg.prismSpread / 100); gl.uniform1i(u.uAuraStyle, styleInt);
    gl.uniform1f(u.uShowMist, cfg.showAmbientMist ? 1.0 : 0.0);
    gl.uniform1f(u.uOrbitPhase, orbitPhase); gl.uniform1f(u.uWavePhase, wavePhase);
    gl.uniform1f(u.uIsLight, isLight ? 1.0 : 0.0);
    gl.uniform1f(u.uBodyScale, bodyScale);
    gl.uniform1f(u.uTailStretch, tailStretch);
    gl.uniform1f(u.uLiquidAmp, liquidAmp);
    gl.uniform1i(u.uSteps, 30);
    gl.uniform3f(u.uBodyColor, bc[0], bc[1], bc[2]);
    gl.uniform3f(u.uPrismStart, p1[0], p1[1], p1[2]);
    gl.uniform3f(u.uPrismMid, p2[0], p2[1], p2[2]);
    gl.uniform3f(u.uPrismEnd, p3[0], p3[1], p3[2]);
    gl.uniform3f(u.uMistColor, mc[0], mc[1], mc[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(this.canvas, 0, 0, drawSize, drawSize);
    return true;
  }
}

const kiwi3DEngine = new KiwiSoulMist3DEngine();

export interface KiwiSpeechBubbleProps {
  text: string;
  accentColor?: string;
  tailSide?: 'right' | 'left';
}

export const KiwiSpeechBubble: React.FC<KiwiSpeechBubbleProps> = ({
  text,
  accentColor = DEFAULT_KIWI_CONFIG.speechBubbleColor,
  tailSide = 'right',
}) => {
  if (!text.trim()) return null;
  const isLeftTail = tailSide === 'left';

  return (
    <div style={{ position: 'relative', display: 'inline-flex', maxWidth: 320 }}>
      <div
        style={{
          position: 'relative',
          borderRadius: 22,
          backgroundColor: '#07080B',
          color: '#FFFFFF',
          border: `2px solid ${accentColor}`,
          boxShadow: `0 4px 0 ${accentColor}`,
          minWidth: 96,
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.35,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <span>{text}</span>
        <svg
          width="34"
          height="24"
          viewBox="0 0 34 24"
          style={{
            position: 'absolute',
            bottom: -24,
            overflow: 'visible',
            pointerEvents: 'none',
            ...(isLeftTail ? { left: 24, transform: 'scaleX(-1)' } : { right: 24 }),
          }}
          aria-hidden="true"
        >
          <path d="M 2 1 L 2 6 Q 11 16, 29.5 20.5 Q 24 12, 19.5 6 L 19.5 1 Z" fill={accentColor} />
          <path d="M 4 -2 L 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1 L 18 -2 Z" fill="#07080B" />
          <path
            d="M 4 1 Q 12 12, 28.5 19.5 Q 22 10, 18 1"
            fill="none"
            stroke={accentColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};

export interface ByteKiwiCatProps {
  state?: KiwiState;
  emote?: KiwiComicEmote;
  audioLevel?: number; // 0..1 externo (ex: microfone ou TTS)
  simulateVoice?: boolean;
  size?: number;
  config?: Partial<KiwiConfig>;
  backdropTone?: 'dark' | 'light';
}

export const ByteKiwiCat: React.FC<ByteKiwiCatProps> = ({
  state = 'respondendo',
  emote,
  audioLevel,
  simulateVoice = true,
  size = 240,
  config: overrides,
  backdropTone,
}) => {
  const cfg: KiwiConfig = { ...DEFAULT_KIWI_CONFIG, ...overrides };
  const uid = useId().replace(/:/g, '');
  const activeComicEmote = emote ?? cfg.comicEmote;
  const isLightBackdrop = backdropTone ? backdropTone === 'light' : isLightHex(cfg.surfaceBg);

  const fogLayerRef = useRef<HTMLDivElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chinLedCoreRef = useRef<SVGCircleElement | null>(null);
  const chinLedHaloRef = useRef<SVGCircleElement | null>(null);
  const chinEqBarRefs = useRef<(SVGRectElement | null)[]>([]);
  const comicOverlayRef = useRef<SVGGElement | null>(null);
  const ring1Ref = useRef<SVGCircleElement | null>(null);
  const ring2Ref = useRef<SVGCircleElement | null>(null);

  const liveRef = useRef({ state, cfg, activeComicEmote, audioLevel, simulateVoice, isLightBackdrop });
  liveRef.current = { state, cfg, activeComicEmote, audioLevel, simulateVoice, isLightBackdrop };

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    const current = { ...STATE_TARGETS[liveRef.current.state] };
    let phase = 0;
    let mistPhase = 0;
    let wavePhase = 0;
    let orbitAngle = 0.58;
    let lagX = 0;
    let lagY = -0.05;
    let blinkTimer = 2.6;
    let blinkAmount = 0;
    let audioSmoothed = 0;
    let fogCore = 43;
    let fogMid = 67;
    let fogMist = 85;
    let fogEdge = 96;

    const earCanvas = document.createElement('canvas');
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) * 0.001);
      lastTime = now;
      const {
        state: s,
        cfg: c,
        activeComicEmote: em,
        audioLevel: extAudio,
        simulateVoice: sim,
        isLightBackdrop: lightBg,
      } = liveRef.current;

      const resolvedEmote = em !== 'auto' ? em : s;
      const target = STATE_TARGETS[s];
      const fluidity = 0.04 + (c.motionFluidity / 100) * 0.14;
      const follow = Math.min(1, dt * (60 * fluidity * 0.18));

      current.breathSpeed = lerp(current.breathSpeed, target.breathSpeed, follow);
      current.breathAmp = lerp(current.breathAmp, target.breathAmp, follow);
      current.eyeOpenY = lerp(current.eyeOpenY, target.eyeOpenY, follow * 1.4);
      current.eyeScale = lerp(current.eyeScale, target.eyeScale, follow * 1.3);
      current.gazeX = lerp(current.gazeX, target.gazeX, follow);
      current.gazeY = lerp(current.gazeY, target.gazeY, follow);
      current.headTiltDeg = lerp(current.headTiltDeg, target.headTiltDeg, follow);
      current.headLiftY = lerp(current.headLiftY, target.headLiftY, follow);
      current.earPerk = lerp(current.earPerk, target.earPerk, follow * 1.2);
      current.prismOpacity = lerp(current.prismOpacity, target.prismOpacity, follow);
      current.mistPulseSpeed = lerp(current.mistPulseSpeed, target.mistPulseSpeed, follow);
      current.ringScale = lerp(current.ringScale, target.ringScale, follow);
      current.yawAmp = lerp(current.yawAmp, target.yawAmp, follow);
      current.pitchAmp = lerp(current.pitchAmp, target.pitchAmp, follow);
      current.pitchBias = lerp(current.pitchBias, target.pitchBias, follow);
      current.rollAmp = lerp(current.rollAmp, target.rollAmp, follow);
      current.rollBias = lerp(current.rollBias, target.rollBias, follow);
      current.bodyScale = lerp(current.bodyScale, target.bodyScale, follow * 0.85);
      current.tailStretch = lerp(current.tailStretch, target.tailStretch, follow * 0.85);
      current.liquidAmp = lerp(current.liquidAmp, target.liquidAmp, follow);

      let rawAudio = extAudio ?? 0;
      if (extAudio === undefined && sim && (s === 'ouvindo' || s === 'respondendo')) {
        const t = now * 0.001;
        rawAudio = Math.max(0, 0.25 + 0.35 * Math.sin(t * 7.2) * Math.cos(t * 2.9));
      }
      audioSmoothed = lerp(audioSmoothed, rawAudio * (c.voiceReactivity / 100), Math.min(1, dt * 16));

      phase += dt * current.breathSpeed * c.speedMultiplier;
      mistPhase += dt * current.mistPulseSpeed * c.speedMultiplier;
      wavePhase += dt * (0.95 + audioSmoothed * 1.45) * c.speedMultiplier;

      const orbitSpeed =
        c.auraStyle === 'contorno-sutil'
          ? 0.08
          : c.auraStyle === 'nuvem-base'
          ? 0.25
          : s === 'respondendo'
          ? 1.1 + audioSmoothed * 1.15
          : s === 'ouvindo'
          ? 0.72 + audioSmoothed * 0.75
          : s === 'pensando'
          ? 0.92
          : s === 'dormindo'
          ? 0.22
          : 0.5;
      orbitAngle += dt * orbitSpeed * c.speedMultiplier;

      if (s !== 'dormindo') {
        blinkTimer -= dt * c.speedMultiplier;
        if (blinkTimer <= 0) blinkTimer = s === 'ouvindo' ? 4.4 + Math.random() * 2.4 : 3.0 + Math.random() * 2.6;
        const isClosing = blinkTimer > 4.2 || (blinkTimer < 0.18 && blinkTimer > 0.02);
        blinkAmount = lerp(blinkAmount, isClosing ? 1 : 0, Math.min(1, dt * 24));
      } else {
        blinkAmount = lerp(blinkAmount, 0, dt * 6);
      }

      const yaw =
        Math.sin(phase * 0.42 + 0.4) * current.yawAmp +
        Math.sin(phase * 0.86) * (current.yawAmp * 0.18);
      const pitch =
        current.pitchBias +
        Math.cos(phase * 0.38 + 0.7) * current.pitchAmp;
      const roll =
        current.rollBias +
        Math.sin(phase * 0.46) * current.rollAmp +
        Math.sin(phase * 0.94) * (current.rollAmp * 0.18);

      const breathWave = Math.sin(phase);
      const headOffsetX = Math.sin(phase * 0.42) * 0.010;
      const headOffsetY = current.headLiftY + breathWave * current.breathAmp * 0.72 + audioSmoothed * 0.022;

      const organicMorph = Math.sin(phase * 0.34);
      const effectiveBodyScale =
        current.bodyScale +
        organicMorph * (s === 'dormindo' ? 0.025 : 0.042) +
        audioSmoothed * (s === 'respondendo' ? 0.14 : s === 'ouvindo' ? 0.09 : 0.04);
      const effectiveTailStretch =
        current.tailStretch +
        (0.5 + 0.5 * Math.sin(phase * 0.29 + 1.1)) * (s === 'dormindo' ? 0.03 : 0.10) +
        audioSmoothed * (s === 'respondendo' ? 0.18 : 0.10);
      const effectiveLiquidAmp =
        current.liquidAmp +
        audioSmoothed * (s === 'respondendo' ? 0.56 : 0.34);

      lagX = lerp(lagX, -yaw * 0.24 - Math.sin(phase * 0.40) * 0.028 - headOffsetX * 0.9 - roll * 0.16, Math.min(1, dt * 3.2));
      lagY = lerp(lagY, -pitch * 0.15 - 0.015 + Math.cos(phase * 0.55) * 0.018 - audioSmoothed * 0.022, Math.min(1, dt * 3.2));

      const shimmerWave = 0.92 + 0.08 * Math.sin(mistPhase * 1.4);
      const effectiveAura = Math.min(100, c.auraIntensity * current.prismOpacity * shimmerWave * (1 + audioSmoothed * 0.28));

      const fogFollow = Math.min(1, dt * 8);
      const scaleShift = (effectiveBodyScale - 0.90) * 24;
      const targetFogCore = (s === 'dormindo' ? 34 : s === 'pensando' ? 42 : s === 'ouvindo' ? 45 + audioSmoothed * 5 : s === 'respondendo' ? 47 + audioSmoothed * 7 : 41) + scaleShift * 0.7;
      const targetFogMid = (s === 'dormindo' ? 54 : s === 'pensando' ? 66 : s === 'ouvindo' ? 70 + audioSmoothed * 6 : s === 'respondendo' ? 74 + audioSmoothed * 8 : 64) + scaleShift * 0.85;
      const targetFogMist = (s === 'dormindo' ? 73 : s === 'pensando' ? 84 : s === 'ouvindo' ? 88 + audioSmoothed * 5 : s === 'respondendo' ? 92 + audioSmoothed * 6 : 82) + scaleShift * 0.7;
      const targetFogEdge = s === 'dormindo' ? 86 : s === 'pensando' ? 95 : s === 'ouvindo' ? Math.min(100, 97 + audioSmoothed * 3) : s === 'respondendo' ? 100 : Math.min(100, 94 + scaleShift * 0.4);

      fogCore = lerp(fogCore, targetFogCore, fogFollow);
      fogMid = lerp(fogMid, targetFogMid, fogFollow);
      fogMist = lerp(fogMist, targetFogMist, fogFollow);
      fogEdge = lerp(fogEdge, targetFogEdge, fogFollow);

      const fogLayerOpacity = s === 'dormindo' ? 0.76 + 0.04 * Math.sin(phase) : s === 'pensando' ? 0.89 + 0.04 * Math.sin(phase * 1.4) : s === 'ouvindo' ? Math.min(1, 0.93 + audioSmoothed * 0.07) : s === 'respondendo' ? Math.min(1, 0.95 + audioSmoothed * 0.05) : 0.91 + 0.03 * Math.sin(phase);
      const fogLayerEl = fogLayerRef.current;
      if (fogLayerEl) {
        fogLayerEl.style.opacity = fogLayerOpacity.toFixed(3);
        fogLayerEl.style.setProperty('--fog-core', `${fogCore.toFixed(1)}%`);
        fogLayerEl.style.setProperty('--fog-mid', `${fogMid.toFixed(1)}%`);
        fogLayerEl.style.setProperty('--fog-mist', `${fogMist.toFixed(1)}%`);
        fogLayerEl.style.setProperty('--fog-edge', `${fogEdge.toFixed(1)}%`);
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const backingPx = Math.round(size * dpr);

      const fogCanvas = fogCanvasRef.current;
      if (fogCanvas) {
        if (fogCanvas.width !== backingPx || fogCanvas.height !== backingPx) {
          fogCanvas.width = backingPx;
          fogCanvas.height = backingPx;
        }
        const fogCtx = fogCanvas.getContext('2d');
        if (fogCtx) {
          fogCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          fogCtx.clearRect(0, 0, size, size);
          const rendered3D = kiwi3DEngine.render(
            fogCtx,
            size,
            backingPx,
            c,
            yaw,
            pitch,
            roll,
            headOffsetX,
            headOffsetY,
            lagX,
            lagY,
            effectiveAura,
            orbitAngle,
            wavePhase,
            mistPhase,
            audioSmoothed,
            lightBg,
            effectiveBodyScale,
            effectiveTailStretch,
            effectiveLiquidAmp
          );
          if (!rendered3D) {
            const cx = size * (0.5 + headOffsetX * 0.4 + lagX * 0.15);
            const cy = size * (0.54 - headOffsetY * 0.4 - lagY * 0.15);
            const r = size * 0.25;
            fogCtx.save();
            fogCtx.translate(cx, cy);
            const grad = fogCtx.createRadialGradient(r * 0.2, r * 0.25, r * 0.25, 0, 0, r * 1.45);
            grad.addColorStop(0, c.bodyColor);
            grad.addColorStop(0.62, c.bodyColor);
            grad.addColorStop(0.82, c.prismStops[2]);
            grad.addColorStop(0.93, c.prismStops[0]);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            fogCtx.fillStyle = grad;
            fogCtx.beginPath();
            fogCtx.arc(0, 0, r * 1.38, 0, Math.PI * 2);
            fogCtx.fill();
            fogCtx.restore();
          }
        }
      }

      const faceCanvas = faceCanvasRef.current;
      if (faceCanvas) {
        if (faceCanvas.width !== backingPx || faceCanvas.height !== backingPx) {
          faceCanvas.width = backingPx;
          faceCanvas.height = backingPx;
        }
        const ctx = faceCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, size, size);

          drawSeparateFlat3DEars(
            ctx,
            earCanvas,
            size,
            backingPx,
            dpr,
            yaw,
            pitch,
            roll,
            headOffsetX,
            headOffsetY,
            c.bodyWidth,
            c.earStyle,
            c.earScale,
            current.earPerk,
            c.bodyColor
          );

          const expFactor = c.eyeExpressiveness / 100;
          const eyeSpanX = 0.195 * c.eyeSpacing * c.bodyWidth;
          const eyeLocalY = 0.018 + current.gazeY * 0.020 * expFactor;
          const gazeShiftX = current.gazeX * 0.024 * expFactor;
          const computeSurfaceZ = (lx: number, ly: number) => {
            const nx = lx / (0.56 * c.bodyWidth);
            const ny = (ly - 0.018) / 0.46;
            return 0.30 * Math.sqrt(Math.max(0.22, 1 - nx * nx - ny * ny)) + 0.14;
          };
          const lx = -eyeSpanX + gazeShiftX;
          const rxPos = eyeSpanX + gazeShiftX;
          const leftProj = project3DFacePoint(lx, eyeLocalY, computeSurfaceZ(lx, eyeLocalY), yaw, pitch, roll, headOffsetX, headOffsetY, size);
          const rightProj = project3DFacePoint(rxPos, eyeLocalY, computeSurfaceZ(rxPos, eyeLocalY), yaw, pitch, roll, headOffsetX, headOffsetY, size);

          const baseEyeR = size * 0.032 * c.eyeScale * current.eyeScale;
          const openY = Math.max(0.08, current.eyeOpenY * (1 - blinkAmount * 0.92));
          const styleScaleX = c.eyeStyle === 'ovalados' ? 0.82 : c.eyeStyle === 'minimalistas' ? 0.72 : 1.0;
          const styleScaleY = c.eyeStyle === 'ovalados' ? 1.18 : c.eyeStyle === 'minimalistas' ? 0.72 : 1.0;
          const isHalfLid = c.showComicEmotes && (resolvedEmote === 'cansado' || resolvedEmote === 'pensando');
          const isAsymmetric = c.showComicEmotes && resolvedEmote === 'confuso';
          const isWideAlert = c.showComicEmotes && resolvedEmote === 'alerta';
          const alertScale = isWideAlert ? 1.22 : 1.0;
          const scanClosed = s === 'dormindo' || resolvedEmote === 'dormindo' || blinkAmount > 0.62;
          const happyArc =
            (resolvedEmote === 'feliz' && c.showComicEmotes) ||
            (s === 'respondendo' && resolvedEmote !== 'cansado' && resolvedEmote !== 'confuso' && resolvedEmote !== 'alerta' && resolvedEmote !== 'limite' && audioSmoothed > 0.42 && expFactor > 0.35);

          const drawOneEye = (proj: ReturnType<typeof project3DFacePoint>, asym: number) => {
            if (!proj.visible) return;
            const erx = baseEyeR * styleScaleX * alertScale * asym;
            const ery = baseEyeR * styleScaleY * openY * alertScale * asym;
            ctx.save();
            ctx.translate(proj.x, proj.y);
            ctx.rotate(proj.angleRad);
            ctx.scale(proj.scaleX, proj.scaleY);
            if (scanClosed || happyArc) {
              ctx.strokeStyle = c.eyeColor;
              ctx.globalAlpha = scanClosed ? 0.95 : 1.0;
              ctx.lineWidth = Math.max(1.4, size * 0.0115);
              ctx.lineCap = 'round';
              ctx.beginPath();
              const arcW = baseEyeR * styleScaleX * 0.96;
              const sweep = scanClosed ? baseEyeR * 0.85 : -baseEyeR * 0.82;
              const yOff = scanClosed ? -baseEyeR * 0.12 : baseEyeR * 0.25;
              ctx.moveTo(-arcW, yOff);
              ctx.quadraticCurveTo(0, yOff + sweep, arcW, yOff);
              ctx.stroke();
            } else {
              if (isHalfLid) {
                ctx.beginPath();
                ctx.rect(-erx * 1.4, -ery * 0.18, erx * 2.8, ery * 1.8);
                ctx.clip();
              }
              ctx.fillStyle = c.eyeColor;
              ctx.beginPath();
              ctx.ellipse(0, 0, erx, Math.max(1, ery), 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          };
          drawOneEye(leftProj, 1.0);
          drawOneEye(rightProj, isAsymmetric ? 0.44 : 1.0);

          if (c.showMascotDetails) {
            const mouthProj = project3DFacePoint(0, -0.135, 0.48, yaw, pitch, roll, headOffsetX, headOffsetY, size);
            if (mouthProj.visible) {
              ctx.save();
              ctx.translate(mouthProj.x, mouthProj.y);
              ctx.rotate(mouthProj.angleRad);
              ctx.scale(mouthProj.scaleX, mouthProj.scaleY);
              const mw = size * 0.036;
              if (s === 'respondendo' && audioSmoothed > 0.14) {
                ctx.fillStyle = c.accentColor;
                ctx.beginPath();
                ctx.ellipse(0, mw * 0.25, mw * (0.85 + audioSmoothed * 0.65), mw * (0.28 + audioSmoothed * 0.95), 0, 0, Math.PI * 2);
                ctx.fill();
              } else {
                ctx.strokeStyle = c.eyeColor;
                ctx.lineWidth = Math.max(1.2, size * 0.011);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(-mw, 0);
                ctx.quadraticCurveTo(-mw * 0.5, mw * 0.52, 0, 0);
                ctx.quadraticCurveTo(mw * 0.5, mw * 0.52, mw, 0);
                ctx.stroke();
              }
              ctx.restore();
            }
          }
        }
      }

      if (comicOverlayRef.current) {
        const floatBob = Math.sin(phase * 1.4) * 2.5 - headOffsetY * 45;
        const shiftX = headOffsetX * 55 + yaw * 8;
        const pulseScale = 1 + audioSmoothed * 0.07;
        comicOverlayRef.current.setAttribute('transform', `translate(${shiftX.toFixed(2)}, ${floatBob.toFixed(2)}) scale(${pulseScale.toFixed(4)})`);
      }

      if (chinLedCoreRef.current && chinLedHaloRef.current) {
        const dotColor = s === 'ouvindo' ? '#34D399' : s === 'pensando' ? '#FBBF24' : s === 'respondendo' ? c.accentColor : s === 'dormindo' ? '#64748B' : c.prismStops[0];
        const dotPulse = s === 'dormindo' ? 0.24 + 0.12 * Math.sin(phase * 1.1) : s === 'pensando' ? 0.55 + 0.45 * Math.sin(phase * 4.6) : 0.72 + 0.28 * Math.min(1, audioSmoothed * 1.4 + Math.sin(phase * 2.1) * 0.25);
        chinLedCoreRef.current.setAttribute('fill', dotColor);
        chinLedCoreRef.current.setAttribute('opacity', Math.max(0.2, Math.min(1, dotPulse)).toFixed(2));
        chinLedHaloRef.current.setAttribute('fill', dotColor);
        chinLedHaloRef.current.setAttribute('opacity', s === 'dormindo' ? '0.08' : Math.max(0.1, Math.min(0.42, dotPulse * 0.36)).toFixed(2));
      }

      const eqHarmonics = [
        Math.min(1, audioSmoothed * (0.85 + 0.22 * Math.sin(now * 0.0052))),
        Math.min(1, audioSmoothed * (0.92 + 0.18 * Math.cos(now * 0.0074))),
        Math.min(1, audioSmoothed * (0.98 + 0.16 * Math.sin(now * 0.0091))),
        Math.min(1, audioSmoothed * (0.82 + 0.24 * Math.cos(now * 0.0112))),
        Math.min(1, audioSmoothed * (0.72 + 0.32 * Math.sin(now * 0.0135))),
      ];
      for (let i = 0; i < 5; i++) {
        const barEl = chinEqBarRefs.current[i];
        if (!barEl) continue;
        let level = 0;
        let barOpacity = 0.75;
        if (s === 'dormindo') { level = 0.04; barOpacity = 0.16; }
        else if (s === 'pensando') { const wave = Math.sin(phase * 3.4 - i * 0.95); level = 0.18 + Math.max(0, wave) * 0.74; barOpacity = 0.42 + Math.max(0, wave) * 0.56; }
        else if (s === 'ouvindo' || s === 'respondendo') { level = Math.max(0.14, Math.min(1, eqHarmonics[i] * 0.92 + audioSmoothed * 0.24)); barOpacity = Math.min(1, 0.58 + level * 0.42); }
        else { const idleRipple = 0.5 + 0.5 * Math.sin(phase * 1.4 - i * 0.6); level = 0.12 + idleRipple * 0.18 + audioSmoothed * 0.6; barOpacity = 0.36 + idleRipple * 0.28 + audioSmoothed * 0.35; }
        const barH = 1.6 + level * 6.4;
        barEl.setAttribute('y', (176 - barH / 2).toFixed(2));
        barEl.setAttribute('height', barH.toFixed(2));
        barEl.setAttribute('opacity', Math.min(1, barOpacity).toFixed(2));
      }

      if (ring1Ref.current && ring2Ref.current) {
        const showRings = c.showAcousticRings && (s === 'ouvindo' || s === 'respondendo' || audioSmoothed > 0.1);
        if (showRings) {
          ring1Ref.current.setAttribute('r', (76 * current.ringScale + audioSmoothed * 20 + Math.sin(phase * 1.4) * 2).toFixed(2));
          ring1Ref.current.setAttribute('opacity', (Math.min(0.68, 0.12 + audioSmoothed * 0.4) * (c.auraIntensity / 100)).toFixed(3));
          ring2Ref.current.setAttribute('r', (92 * current.ringScale + audioSmoothed * 28 + Math.cos(phase * 1.1) * 3).toFixed(2));
          ring2Ref.current.setAttribute('opacity', (Math.min(0.4, 0.07 + audioSmoothed * 0.26) * (c.auraIntensity / 100)).toFixed(3));
        } else {
          ring1Ref.current.setAttribute('opacity', '0');
          ring2Ref.current.setAttribute('opacity', '0');
        }
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [size]);

  const displayedEmote = activeComicEmote !== 'auto' ? activeComicEmote : state;
  const emoteInk = isLightBackdrop ? '#0A0B10' : '#FFFFFF';
  const emoteFill = isLightBackdrop ? '#FFFFFF' : '#090A0E';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: cfg.uiFrame === 'livre' ? 'visible' : 'hidden',
        borderRadius:
          cfg.uiFrame === 'squircle'
            ? '24%'
            : cfg.uiFrame === 'circulo'
            ? '9999px'
            : cfg.uiFrame === 'dock'
            ? '16px'
            : '0px',
        backgroundColor: cfg.uiFrame === 'livre' ? 'transparent' : cfg.surfaceBg,
        userSelect: 'none',
      }}
    >
      <div
        ref={fogLayerRef}
        className="fog-layer"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          maskImage:
            'radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%))',
          WebkitMaskImage:
            'radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%))',
        }}
        aria-hidden="true"
      >
        <canvas
          ref={fogCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
      </div>

      <div
        className="face-layer"
        style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}
        aria-label={`Byte Kiwi Cat 3D no estado ${state}`}
      >
        <canvas
          ref={faceCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
        <svg
          viewBox="0 0 240 240"
          width={size}
          height={size}
          style={{ position: 'relative', zIndex: 10, overflow: 'visible', display: 'block', pointerEvents: 'none' }}
        >
        <defs>
          <linearGradient id={`${uid}-prism`} x1="8%" y1="88%" x2="92%" y2="12%">
            <stop offset="0%" stopColor={cfg.prismStops[2]} />
            <stop offset="48%" stopColor={cfg.prismStops[1]} />
            <stop offset="100%" stopColor={cfg.prismStops[0]} />
          </linearGradient>
        </defs>

        <circle ref={ring1Ref} cx="120" cy="122" r="76" fill="none" stroke={`url(#${uid}-prism)`} strokeWidth="1.4" opacity="0" />
        <circle ref={ring2Ref} cx="120" cy="122" r="92" fill="none" stroke={cfg.prismStops[0]} strokeWidth="1.2" opacity="0" />

        {cfg.showChinEqualizer && (
          <g>
            <rect x={120 - 28 * cfg.bodyWidth} y="170.5" width={56 * cfg.bodyWidth} height="11" rx="5.5" fill="#0B1117" stroke={cfg.accentColor} strokeWidth="1" strokeOpacity="0.34" />
            <circle ref={chinLedHaloRef} cx={120 - 20.5 * cfg.bodyWidth} cy="176" r="4.2" fill={cfg.prismStops[0]} opacity="0.22" />
            <circle ref={chinLedCoreRef} cx={120 - 20.5 * cfg.bodyWidth} cy="176" r="2.1" fill={cfg.prismStops[0]} opacity="0.9" />
            <line x1={120 - 14.5 * cfg.bodyWidth} y1="173" x2={120 - 14.5 * cfg.bodyWidth} y2="179" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="1" strokeLinecap="round" />
            {[-9, -3, 3, 9, 15].map((dx, idx) => (
              <rect
                key={idx}
                ref={(el) => {
                  chinEqBarRefs.current[idx] = el;
                }}
                x={120 + dx * cfg.bodyWidth - 1.5}
                y="174.5"
                width="3"
                height="3"
                rx="1.5"
                fill={`url(#${uid}-prism)`}
                opacity="0.7"
              />
            ))}
          </g>
        )}

        {cfg.showComicEmotes && (
          <g ref={comicOverlayRef} style={{ transformOrigin: '120px 120px' }}>
            {displayedEmote === 'ouvindo' && (
              <g fill="none" stroke={emoteInk} strokeWidth="2.8" strokeLinecap="round">
                <path d="M 184 96 Q 192 108, 184 120" />
                <path d="M 192 90 Q 203 108, 192 126" opacity="0.88" />
                <path d="M 200 84 Q 214 108, 200 132" opacity="0.72" />
              </g>
            )}
            {displayedEmote === 'pensando' && (
              <g>
                <circle cx="176" cy="78" r="2.5" fill={emoteInk} />
                <path d="M 176 54 C 176 47, 184 44, 190 47 C 194 42, 204 43, 207 49 C 214 50, 217 58, 212 64 C 213 70, 205 74, 198 71 C 193 75, 182 74, 180 68 C 174 66, 173 59, 176 54 Z" fill={emoteFill} stroke={emoteInk} strokeWidth="2.4" strokeLinejoin="round" />
                <circle cx="188" cy="58" r="2" fill={emoteInk} />
                <circle cx="195" cy="58" r="2" fill={emoteInk} />
                <circle cx="202" cy="58" r="2" fill={emoteInk} />
              </g>
            )}
            {displayedEmote === 'dormindo' && (
              <g fill="none" stroke={emoteInk} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 172 68 L 184 68 L 172 80 L 184 80" />
                <path d="M 190 48 L 206 48 L 190 64 L 206 64" strokeWidth="3.0" />
              </g>
            )}
            {displayedEmote === 'alerta' && (
              <g fill={emoteInk} stroke={emoteInk} strokeLinecap="round">
                <path d="M 186 44 L 183 66" strokeWidth="4.2" />
                <circle cx="182" cy="75" r="2.6" stroke="none" />
                <line x1="196" y1="54" x2="204" y2="50" strokeWidth="2.4" />
                <line x1="198" y1="64" x2="206" y2="66" strokeWidth="2.4" />
              </g>
            )}
            {(displayedEmote === 'feliz' || displayedEmote === 'respondendo') && (
              <g fill={emoteInk}>
                <path d="M 52 96 L 54.5 103 L 61.5 105.5 L 54.5 108 L 52 115 L 49.5 108 L 42.5 105.5 L 49.5 103 Z" />
                <path d="M 190 66 L 192.5 73 L 199.5 75.5 L 192.5 78 L 190 85 L 187.5 78 L 180.5 75.5 L 187.5 73 Z" />
                <path d="M 196 120 L 197.5 124.5 L 202 126 L 197.5 127.5 L 196 132 L 194.5 127.5 L 190 126 L 194.5 124.5 Z" opacity="0.85" />
              </g>
            )}
            {displayedEmote === 'cansado' && (
              <g>
                <path d="M 192 78 C 192 78, 198 87, 198 91 A 6 6 0 1 1 186 91 C 186 87, 192 78, 192 78 Z" fill={emoteInk} />
                <path d="M 205 96 C 205 96, 209 102, 209 105 A 4 4 0 1 1 201 105 C 201 102, 205 96, 205 96 Z" fill={emoteInk} opacity="0.9" />
                <g stroke={emoteInk} strokeWidth="2.4" strokeLinecap="round">
                  <line x1="36" y1="104" x2="52" y2="108" />
                  <line x1="33" y1="118" x2="50" y2="119" />
                  <line x1="37" y1="132" x2="52" y2="130" />
                </g>
              </g>
            )}
            {displayedEmote === 'confuso' && (
              <g>
                <path d="M 178 58 C 175 50, 184 44, 191 48 C 197 42, 208 45, 210 53 C 216 56, 215 67, 207 68 C 202 74, 190 73, 187 68 C 179 69, 175 63, 178 58 Z" fill={emoteFill} stroke={emoteInk} strokeWidth="2.4" strokeLinejoin="round" />
                <path d="M 186 58 Q 190 53, 195 58 T 204 58" fill="none" stroke={emoteInk} strokeWidth="2.2" strokeLinecap="round" />
              </g>
            )}
            {displayedEmote === 'limite' && (
              <path d="M 176 58 C 174 44, 188 40, 190 52 C 192 64, 180 68, 186 52 C 191 40, 204 42, 204 55 C 204 64, 196 68, 210 60" fill="none" stroke={emoteInk} strokeWidth="3.2" strokeLinecap="round" />
            )}
          </g>
        )}
        </svg>
      </div>
    </div>
  );
};

export interface ByteKiwiOverlayProps extends ByteKiwiCatProps {
  isOpen: boolean;
  position?: KiwiOverlayPosition;
  transitionStyle?: KiwiOverlayTransition;
  speechText?: string;
  showBubble?: boolean;
  onExited?: () => void;
}

export const ByteKiwiOverlay: React.FC<ByteKiwiOverlayProps> = ({
  isOpen,
  position = DEFAULT_KIWI_CONFIG.overlayPosition,
  transitionStyle = DEFAULT_KIWI_CONFIG.overlayTransition,
  speechText,
  showBubble,
  size = 180,
  config: overrides,
  onExited,
  ...catProps
}) => {
  const cfg: KiwiConfig = { ...DEFAULT_KIWI_CONFIG, ...overrides };
  const [mounted, setMounted] = useState(isOpen);
  const [phase, setPhase] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>(
    isOpen ? 'visible' : 'hidden'
  );

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setPhase('entering');
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setPhase('visible'));
      });
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) {
      setPhase('exiting');
      const t = setTimeout(() => {
        setMounted(false);
        setPhase('hidden');
        onExited?.();
      }, cfg.overlayExitMs);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen, cfg.overlayExitMs, mounted, onExited]);

  if (!mounted) return null;

  const bounceFactor = 1 + (cfg.overlaySpringBounce / 100) * 0.48;
  const enterCurve = `cubic-bezier(0.22, ${bounceFactor.toFixed(2)}, 0.36, 1)`;
  const exitCurve = 'cubic-bezier(0.4, 0, 0.7, 0.25)';

  let vx = 0;
  let vy = 0;
  let rot = 0;
  if (position.includes('left')) { vx = -78; rot -= 8; }
  else if (position.includes('right')) { vx = 78; rot += 8; }
  if (position.startsWith('top')) vy = -78;
  else if (position.startsWith('bottom')) vy = 78;
  if (transitionStyle === 'espreitar-borda') {
    vx = vx === 0 ? 0 : Math.sign(vx) * 112;
    vy = vy === 0 ? (position === 'center' ? 48 : 0) : Math.sign(vy) * 104;
    rot *= 1.45;
  }

  const hiddenTransform =
    transitionStyle === 'materializacao-nevoa' ||
    (transitionStyle === 'auto-direcional' && position === 'center')
      ? 'translate3d(0px, 18px, 0) scale(0.54)'
      : transitionStyle === 'salto-elastico'
      ? `translate3d(${Math.round(vx * 0.45)}px, ${Math.round(vy * 0.45)}px, 0) scale(0.42) rotate(${rot}deg)`
      : `translate3d(${vx}px, ${vy}px, 0) scale(0.72) rotate(${rot}deg)`;

  const exitTransform =
    transitionStyle === 'materializacao-nevoa' ||
    (transitionStyle === 'auto-direcional' && position === 'center')
      ? 'translate3d(0px, -12px, 0) scale(0.62)'
      : `translate3d(${Math.round(vx * 0.85)}px, ${Math.round(vy * 0.85)}px, 0) scale(0.76) rotate(${Math.round(
          rot * 0.7
        )}deg)`;

  const isMistTransition =
    transitionStyle === 'materializacao-nevoa' ||
    (transitionStyle === 'auto-direcional' && position === 'center');
  const hiddenBlur = isMistTransition
    ? 'blur(10px)'
    : transitionStyle === 'salto-elastico'
    ? 'blur(2px)'
    : 'blur(3px)';
  const exitBlur = isMistTransition ? 'blur(8px)' : 'blur(2px)';

  const transformStyle =
    phase === 'entering'
      ? { transform: hiddenTransform, opacity: 0, filter: hiddenBlur, transition: 'none' }
      : phase === 'exiting'
      ? {
          transform: exitTransform,
          opacity: 0,
          filter: exitBlur,
          transition: `transform ${cfg.overlayExitMs}ms ${exitCurve}, opacity ${Math.round(
            cfg.overlayExitMs * 0.82
          )}ms ease-in, filter ${cfg.overlayExitMs}ms ease-in`,
        }
      : {
          transform: 'translate3d(0px, 0px, 0) scale(1) rotate(0deg)',
          opacity: 1,
          filter: 'blur(0px)',
          transition: `transform ${cfg.overlayEntryMs}ms ${enterCurve}, opacity ${Math.round(
            cfg.overlayEntryMs * 0.6
          )}ms ease-out, filter ${Math.round(cfg.overlayEntryMs * 0.7)}ms ease-out`,
        };

  const bubbleEnabled = showBubble ?? cfg.showSpeechBubble;
  const bubbleText = speechText ?? cfg.speechBubbleText;
  const scale = Math.max(0.55, size / 240);
  const effectiveOffsetX = position.includes('left') ? Math.max(140, cfg.speechBubbleOffsetX + 210) : cfg.speechBubbleOffsetX;
  const effectiveOffsetY = position.startsWith('top') ? Math.max(60, cfg.speechBubbleOffsetY + 135) : cfg.speechBubbleOffsetY;

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...transformStyle }}>
      {bubbleEnabled && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            zIndex: 20,
            width: 'max-content',
            transform: `translate(calc(-100% + ${Math.round(
              effectiveOffsetX * scale
            )}px), calc(-100% + ${Math.round(effectiveOffsetY * scale)}px))`,
          }}
        >
          <KiwiSpeechBubble
            text={bubbleText}
            accentColor={cfg.speechBubbleColor}
            tailSide={effectiveOffsetX > 120 ? 'left' : 'right'}
          />
        </div>
      )}
      <ByteKiwiCat size={size} config={overrides} {...catProps} />
    </div>
  );
};
