import {
  INTRO_CAT_DURATION,
  INTRO_DURATION,
  KIWI_INTRO_CONFIG,
  REDUCED_DURATION,
} from './kiwiIntroTimeline';
import { FRAGMENT_SHADER_SRC, VERTEX_SHADER_SRC } from './kiwiRenderer';

export type ExportTargetMode = 'app' | 'prototype';

/**
 * Gera um arquivo `intro.html` 100% auto-contido (zero dependências externas)
 * compatível com a janela transparente do app macOS (`window.engine`, `intro.done`,
 * `prefers-reduced-motion`, `kn-appearance`, clique para pular e `?t=`).
 */
export function buildStandaloneIntroHtml(mode: ExportTargetMode, showFrame = true): string {
  const isAppMode = mode === 'app';
  const cfg = KIWI_INTRO_CONFIG;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Byte Kiwi Cat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: ${isAppMode ? 'transparent' : '#07080C'};
      font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", sans-serif;
      user-select: none;
    }
    #stage {
      position: relative;
      width: min(76vmin, 320px);
      height: min(76vmin, 320px);
      border-radius: ${showFrame ? '24%' : '0'};
      background: ${showFrame ? cfg.surfaceBg : 'transparent'};
      overflow: ${showFrame ? 'hidden' : 'visible'};
      box-shadow: ${showFrame ? '0 28px 80px -20px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) inset' : 'none'};
      cursor: pointer;
      will-change: width, height, border-radius, transform, opacity;
    }
    body.done #stage {
      cursor: default;
    }
    #cat-wrap {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    #fog-layer {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      -webkit-mask-image: radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%));
      mask-image: radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%));
    }
    #face-layer {
      position: absolute;
      inset: 0;
      z-index: 10;
      pointer-events: none;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    #sparkle-svg {
      position: relative;
      z-index: 10;
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
    }
    #app-win {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      opacity: 0;
      pointer-events: none;
    }
    .aw-bar {
      height: 40px;
      padding: 0 16px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      background: rgba(255,255,255,0.02);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .aw-dots { display: flex; align-items: center; gap: 7px; }
    .aw-dot { width: 10px; height: 10px; border-radius: 50%; }
    .aw-pill { height: 10px; width: 76px; border-radius: 4px; background: rgba(255,255,255,0.12); margin-left: 10px; }
    .aw-body { flex: 1; display: flex; min-height: 0; }
    .aw-side {
      width: 136px;
      border-right: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.015);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .aw-main { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .aw-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .aw-card { border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .aw-box { flex: 1; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); padding: 14px; display: flex; flex-direction: column; justify-content: space-between; }
    @media (max-width: 520px) { .aw-side { display: none; } }
    ${
      isAppMode
        ? '#again { display: none; }'
        : `#again {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 18px;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(14, 16, 23, 0.85);
      color: #f4f4f5;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms ease, background 150ms ease;
    }
    body.done #again {
      opacity: 1;
      pointer-events: auto;
    }
    #again:hover {
      background: rgba(255, 255, 255, 0.12);
    }`
    }
  </style>
</head>
<body>
  <div id="stage" role="button" tabindex="0" aria-label="Intro Byte Kiwi Cat — clique para pular">
    <div id="cat-wrap">
      <div id="fog-layer"><canvas id="fog-canvas"></canvas></div>
      <div id="face-layer">
        <canvas id="face-canvas"></canvas>
        <svg id="sparkle-svg" viewBox="0 0 240 240" aria-hidden="true">
          <g id="sparkles" fill="#FFFFFF" opacity="0">
            <path d="M 52 96 L 54.5 103 L 61.5 105.5 L 54.5 108 L 52 115 L 49.5 108 L 42.5 105.5 L 49.5 103 Z" />
            <path d="M 190 66 L 192.5 73 L 199.5 75.5 L 192.5 78 L 190 85 L 187.5 78 L 180.5 75.5 L 187.5 73 Z" />
            <path d="M 196 120 L 197.5 124.5 L 202 126 L 197.5 127.5 L 196 132 L 194.5 127.5 L 190 126 L 194.5 124.5 Z" opacity="0.85" />
          </g>
        </svg>
      </div>
    </div>
    ${
      showFrame
        ? `<div id="app-win" aria-hidden="true">
      <div class="aw-bar">
        <div class="aw-dots">
          <span class="aw-dot" style="background:rgba(255,95,87,0.85)"></span>
          <span class="aw-dot" style="background:rgba(254,188,46,0.85)"></span>
          <span class="aw-dot" style="background:rgba(40,200,64,0.85)"></span>
          <span class="aw-pill"></span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="height:16px;width:90px;border-radius:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.06)"></span>
          <span style="height:16px;width:16px;border-radius:6px;background:rgba(255,255,255,0.08)"></span>
        </div>
      </div>
      <div id="aw-body" class="aw-body">
        <div class="aw-side">
          <div style="height:24px;border-radius:8px;background:linear-gradient(90deg,rgba(34,211,238,0.2),rgba(99,102,241,0.2));border:1px solid rgba(34,211,238,0.16);display:flex;align-items:center;padding:0 8px;gap:6px">
            <span style="width:7px;height:7px;border-radius:50%;background:rgba(103,232,249,0.85)"></span>
            <span style="height:7px;width:54px;border-radius:3px;background:rgba(255,255,255,0.25)"></span>
          </div>
          <span style="height:9px;width:88px;border-radius:4px;background:rgba(255,255,255,0.12)"></span>
          <span style="height:9px;width:72px;border-radius:4px;background:rgba(255,255,255,0.07)"></span>
          <span style="height:9px;width:98px;border-radius:4px;background:rgba(255,255,255,0.07)"></span>
          <span style="height:9px;width:64px;border-radius:4px;background:rgba(255,255,255,0.07)"></span>
        </div>
        <div class="aw-main">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="height:13px;width:128px;border-radius:4px;background:rgba(255,255,255,0.16)"></span>
              <span style="height:8px;width:184px;border-radius:4px;background:rgba(255,255,255,0.07)"></span>
            </div>
            <span style="height:28px;width:78px;border-radius:8px;background:linear-gradient(90deg,rgba(34,211,238,0.25),rgba(99,102,241,0.25),rgba(236,72,153,0.25));border:1px solid rgba(255,255,255,0.12)"></span>
          </div>
          <div class="aw-cards">
            <div class="aw-card"><span style="width:20px;height:20px;border-radius:6px;background:rgba(34,211,238,0.2)"></span><span style="height:9px;width:56px;border-radius:4px;background:rgba(255,255,255,0.14)"></span><span style="height:7px;width:100%;border-radius:4px;background:rgba(255,255,255,0.06)"></span></div>
            <div class="aw-card"><span style="width:20px;height:20px;border-radius:6px;background:rgba(99,102,241,0.2)"></span><span style="height:9px;width:62px;border-radius:4px;background:rgba(255,255,255,0.14)"></span><span style="height:7px;width:82%;border-radius:4px;background:rgba(255,255,255,0.06)"></span></div>
            <div class="aw-card"><span style="width:20px;height:20px;border-radius:6px;background:rgba(236,72,153,0.2)"></span><span style="height:9px;width:48px;border-radius:4px;background:rgba(255,255,255,0.14)"></span><span style="height:7px;width:100%;border-radius:4px;background:rgba(255,255,255,0.06)"></span></div>
          </div>
          <div class="aw-box">
            <span style="height:10px;width:96px;border-radius:4px;background:rgba(255,255,255,0.12)"></span>
            <div style="display:flex;flex-direction:column;gap:8px">
              <span style="height:9px;width:100%;border-radius:4px;background:rgba(255,255,255,0.07)"></span>
              <span style="height:9px;width:84%;border-radius:4px;background:rgba(255,255,255,0.06)"></span>
              <span style="height:9px;width:66%;border-radius:4px;background:rgba(255,255,255,0.05)"></span>
            </div>
          </div>
        </div>
      </div>
    </div>`
        : ''
    }
  </div>
  ${isAppMode ? '' : '<button id="again" type="button">De novo</button>'}

  <script>
  (() => {
    const CFG = ${JSON.stringify(cfg)};
    const SHOW_FRAME = ${showFrame};
    const INTRO_DURATION = ${showFrame ? INTRO_DURATION : INTRO_CAT_DURATION};
    const REDUCED_DURATION = ${REDUCED_DURATION};

    const params = new URLSearchParams(window.location.search);
    const frozenParam = params.get('t');
    const frozenT = frozenParam !== null && !Number.isNaN(Number(frozenParam)) ? Math.max(0, Number(frozenParam)) : null;

    function isReducedMotion() {
      const osReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let appReduced = false;
      try {
        const raw = localStorage.getItem('kn-appearance');
        if (raw) appReduced = JSON.parse(raw).motion === 'reduced';
      } catch {}
      return osReduced || appReduced;
    }

    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
    const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
    const easeInOutCubic = (t) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    const easeOutBack = (t) => { const x = clamp01(t); const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    const win = (t, s, e) => clamp01((t - s) / (e - s));
    const pulseBell = (t, s, e) => (t < s || t > e ? 0 : Math.sin(((t - s) / (e - s)) * Math.PI));

    function evaluatePose(rawTime, reduced, skipAt) {
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

    const VS = ${JSON.stringify(VERTEX_SHADER_SRC)};
    const FS = ${JSON.stringify(FRAGMENT_SHADER_SRC)};
    const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255]; };

    let glCanvas = null, gl = null, prog = null, vao = null, u = {}, glFailed = false;
    function initGL() {
      if (glFailed) return false;
      if (gl && !gl.isContextLost() && prog) return true;
      try {
        glCanvas = document.createElement('canvas');
        gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
        if (!gl) { glFailed = true; return false; }
        const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS); gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, FS); gl.compileShader(fs);
        prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { glFailed = true; return false; }
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        ['uResolution','uTime','uAudio','uYaw','uPitch','uRoll','uHeadOffset','uLagOffset','uBodyWidth','uSoftness','uAuraIntensity','uMistDiffusion','uPrismSpread','uAuraStyle','uShowMist','uOrbitPhase','uWavePhase','uIsLight','uBodyScale','uTailStretch','uLiquidAmp','uSteps','uBodyColor','uPrismStart','uPrismMid','uPrismEnd','uMistColor'].forEach((n) => { u[n] = gl.getUniformLocation(prog, n); });
        return true;
      } catch { glFailed = true; return false; }
    }

    function rot3D(x, y, z, yaw, pitch, roll) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const cp = Math.cos(pitch), sp = Math.sin(pitch), y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
    }
    function projPt(lx, ly, lz, yaw, pitch, roll, ox, oy, size) {
      const [rx, ry, rz] = rot3D(lx, ly, lz, yaw, pitch, roll);
      const dz = Math.max(0.5, 3.1 - rz);
      return { x: (0.5 + 0.5 * (((rx + ox) * 2.45) / dz)) * size, y: (0.5 - 0.5 * (((ry + oy) * 2.45) / dz)) * size, z: rz };
    }
    function projFace(lx, ly, lz, yaw, pitch, roll, ox, oy, size) {
      const pt = projPt(lx, ly, lz, yaw, pitch, roll, ox, oy, size);
      const nLen = Math.hypot(lx, ly, lz) || 1;
      const [nx, ny, nz] = rot3D(lx/nLen, ly/nLen, lz/nLen, yaw, pitch, roll);
      const [tx, ty] = rot3D(1, 0, 0, yaw, pitch, roll);
      const ds = (3.1 - 0.45) / Math.max(0.5, 3.1 - pt.z);
      return {
        x: pt.x, y: pt.y,
        scaleX: Math.max(0.4, Math.sqrt(Math.max(0.1, 1 - nx*nx*0.62))) * ds * (0.88 + 0.12 * Math.max(0.32, nz)),
        scaleY: Math.max(0.45, Math.sqrt(Math.max(0.1, 1 - ny*ny*0.52))) * ds,
        angleRad: Math.atan2(-ty, tx), visible: nz > -0.15
      };
    }


    const stage = document.getElementById('stage');
    const catWrap = document.getElementById('cat-wrap');
    const appWin = document.getElementById('app-win');
    const awBody = document.getElementById('aw-body');
    const fogLayer = document.getElementById('fog-layer');
    const fogCanvas = document.getElementById('fog-canvas');
    const faceCanvas = document.getElementById('face-canvas');
    const sparkles = document.getElementById('sparkles');
    const earCanvas = document.createElement('canvas');
    const againBtn = document.getElementById('again');

    function renderPose(pose) {
      const size = Math.max(180, Math.round(Math.min(window.innerWidth * 0.76, window.innerHeight * 0.76, 320)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.round(size * dpr);

      const exp = SHOW_FRAME ? pose.windowExpand : 0;
      const targetW = Math.min(window.innerWidth * 0.92, 640);
      const targetH = Math.min(window.innerHeight * 0.8, 370);
      const w = size + (targetW - size) * exp;
      const h = size + (targetH - size) * exp;
      const r = size * 0.24 + (16 - size * 0.24) * exp;

      stage.style.width = w.toFixed(1) + 'px';
      stage.style.height = h.toFixed(1) + 'px';
      if (SHOW_FRAME) stage.style.borderRadius = r.toFixed(1) + 'px';
      stage.style.opacity = pose.stageOpacity.toFixed(3);
      stage.style.transform = 'scale(' + pose.stageScale.toFixed(4) + ')';

      catWrap.style.width = size + 'px';
      catWrap.style.height = size + 'px';
      catWrap.style.opacity = pose.mascotOpacity.toFixed(3);

      if (appWin) {
        appWin.style.opacity = pose.windowChromeOpacity.toFixed(3);
        if (awBody) {
          awBody.style.opacity = pose.appContentOpacity.toFixed(3);
          awBody.style.transform = 'translateY(' + ((1 - pose.appContentOpacity) * 10).toFixed(1) + 'px)';
        }
      }

      if (pose.mascotOpacity <= 0.004) return;

      fogLayer.style.opacity = pose.fogOpacity.toFixed(3);
      fogLayer.style.setProperty('--fog-core', pose.fogCore.toFixed(1) + '%');
      fogLayer.style.setProperty('--fog-mid', pose.fogMid.toFixed(1) + '%');
      fogLayer.style.setProperty('--fog-mist', pose.fogMist.toFixed(1) + '%');
      fogLayer.style.setProperty('--fog-edge', pose.fogEdge.toFixed(1) + '%');

      if (fogCanvas.width !== px || fogCanvas.height !== px) { fogCanvas.width = px; fogCanvas.height = px; }
      const fCtx = fogCanvas.getContext('2d');
      fCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fCtx.clearRect(0, 0, size, size);

      if (initGL()) {
        const gpx = Math.max(96, Math.min(560, px));
        if (glCanvas.width !== gpx || glCanvas.height !== gpx) { glCanvas.width = gpx; glCanvas.height = gpx; }
        gl.viewport(0, 0, gpx, gpx); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog); gl.bindVertexArray(vao);
        const bc = hexToRgb(CFG.bodyColor), p1 = hexToRgb(CFG.prismStops[0]), p2 = hexToRgb(CFG.prismStops[1]), p3 = hexToRgb(CFG.prismStops[2]), mc = hexToRgb(CFG.mistBaseColor);
        gl.uniform2f(u.uResolution, gpx, gpx); gl.uniform1f(u.uTime, pose.mistPhase); gl.uniform1f(u.uAudio, pose.happyArc * 0.35);
        gl.uniform1f(u.uYaw, pose.yaw); gl.uniform1f(u.uPitch, pose.pitch); gl.uniform1f(u.uRoll, pose.roll);
        gl.uniform2f(u.uHeadOffset, pose.headOffsetX, pose.headOffsetY); gl.uniform2f(u.uLagOffset, pose.lagX, pose.lagY);
        gl.uniform1f(u.uBodyWidth, CFG.bodyWidth); gl.uniform1f(u.uSoftness, pose.softness);
        gl.uniform1f(u.uAuraIntensity, pose.auraIntensity / 100); gl.uniform1f(u.uMistDiffusion, CFG.prismSpread / 100);
        gl.uniform1f(u.uPrismSpread, CFG.prismSpread / 100); gl.uniform1i(u.uAuraStyle, 0);
        gl.uniform1f(u.uShowMist, 0); gl.uniform1f(u.uOrbitPhase, pose.orbitAngle); gl.uniform1f(u.uWavePhase, pose.wavePhase);
        gl.uniform1f(u.uIsLight, 0); gl.uniform1f(u.uBodyScale, pose.bodyScale); gl.uniform1f(u.uTailStretch, pose.tailStretch);
        gl.uniform1f(u.uLiquidAmp, pose.liquidAmp); gl.uniform1i(u.uSteps, 30);
        gl.uniform3f(u.uBodyColor, bc[0], bc[1], bc[2]); gl.uniform3f(u.uPrismStart, p1[0], p1[1], p1[2]);
        gl.uniform3f(u.uPrismMid, p2[0], p2[1], p2[2]); gl.uniform3f(u.uPrismEnd, p3[0], p3[1], p3[2]); gl.uniform3f(u.uMistColor, mc[0], mc[1], mc[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        fCtx.drawImage(glCanvas, 0, 0, size, size);
      }


      if (faceCanvas.width !== px || faceCanvas.height !== px) { faceCanvas.width = px; faceCanvas.height = px; }
      const ctx = faceCanvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const earAppear = pose.earAppear;
      if (earAppear > 0.02) {
        if (earCanvas.width !== px || earCanvas.height !== px) { earCanvas.width = px; earCanvas.height = px; }
        const eCtx = earCanvas.getContext('2d');
        const es = CFG.earScale * (0.82 + 0.18 * earAppear);
        const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        ctx.save(); ctx.globalAlpha = earAppear;
        [[-1, pose.earPerkL], [1, pose.earPerkR]].forEach(([side, perk]) => {
          const droop = Math.max(0, -perk);
          const awakePerk = Math.max(0, perk);
          const lift = awakePerk * 0.062 - droop * 0.095;
          const tipY = 0.36 + 0.21 * es + lift;
          const spreadX = 0.5 * CFG.bodyWidth + (es - 1) * 0.07 + awakePerk * 0.02 + droop * 0.065;
          const pOB = projPt(side * 0.45 * CFG.bodyWidth, 0.13 - droop * 0.02, 0.03, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pOC = projPt(side * (0.49 * CFG.bodyWidth + (es - 1) * 0.04 + droop * 0.055), 0.3 + 0.21 * es * 0.4 + awakePerk * 0.062 * 0.35 - droop * 0.068, -0.01, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pT = projPt(side * spreadX, tipY, -0.04 + droop * 0.02, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pIC = projPt(side * (0.29 * CFG.bodyWidth + droop * 0.04), 0.36 + 0.21 * es * 0.34 + awakePerk * 0.062 * 0.45 - droop * 0.075, 0.06, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pIB = projPt(side * 0.135 * CFG.bodyWidth, 0.295 + lift * 0.2, 0.12, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pRM = projPt(side * 0.3 * CFG.bodyWidth, 0.21, 0.1, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const inO = lerpPt(pT, pOC, 0.27), inI = lerpPt(pT, pIC, 0.27);
          eCtx.save(); eCtx.setTransform(dpr, 0, 0, dpr, 0, 0); eCtx.clearRect(0, 0, size, size);
          eCtx.globalCompositeOperation = 'source-over';
          eCtx.beginPath(); eCtx.moveTo(pOB.x, pOB.y); eCtx.quadraticCurveTo(pOC.x, pOC.y, inO.x, inO.y);
          eCtx.quadraticCurveTo(pT.x, pT.y, inI.x, inI.y); eCtx.quadraticCurveTo(pIC.x, pIC.y, pIB.x, pIB.y);
          eCtx.quadraticCurveTo(pRM.x, pRM.y, pOB.x, pOB.y); eCtx.closePath();
          eCtx.fillStyle = CFG.bodyColor; eCtx.shadowColor = CFG.bodyColor; eCtx.shadowBlur = Math.max(2, size * 0.014); eCtx.fill(); eCtx.shadowBlur = 0;
          const pFS = projPt(side * 0.3 * CFG.bodyWidth, 0.32, 0.1, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          const pFE = projPt(side * 0.3 * CFG.bodyWidth, 0.1, 0.12, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          eCtx.globalCompositeOperation = 'destination-in';
          const fm = eCtx.createLinearGradient(pFS.x, pFS.y, pFE.x, pFE.y);
          fm.addColorStop(0, 'rgba(255,255,255,1)'); fm.addColorStop(0.58, 'rgba(255,255,255,0.88)'); fm.addColorStop(1, 'rgba(255,255,255,0)');
          eCtx.fillStyle = fm; eCtx.fillRect(0, 0, size, size); eCtx.restore();
          ctx.drawImage(earCanvas, 0, 0, size, size);
        });
        ctx.restore();
      }

      const eyeAppear = pose.eyeAppear;
      if (eyeAppear > 0.02) {
        const spanX = 0.195 * CFG.eyeSpacing * CFG.bodyWidth;
        const surfZ = (lx) => 0.3 * Math.sqrt(Math.max(0.22, 1 - Math.pow(lx / (0.56 * CFG.bodyWidth), 2))) + 0.14;
        const eyeR = size * 0.032 * CFG.eyeScale * pose.eyeScale;
        [-spanX, spanX].forEach((lx) => {
          const p = projFace(lx, 0.018, surfZ(lx), pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
          if (!p.visible) return;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angleRad); ctx.scale(p.scaleX, p.scaleY);
          if (pose.happyArc > 0.45) {
            const th = Math.min(1, (pose.happyArc - 0.45) / 0.35);
            ctx.strokeStyle = CFG.eyeColor; ctx.globalAlpha = (0.9 + 0.1 * th) * eyeAppear; ctx.lineWidth = Math.max(1.6, size * 0.012); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(-eyeR * 1.02, eyeR * 0.25); ctx.quadraticCurveTo(0, eyeR * (0.25 - 0.72 - 0.18 * th), eyeR * 1.02, eyeR * 0.25); ctx.stroke();
          } else if (pose.eyeOpenY < 0.22) {
            ctx.strokeStyle = CFG.eyeColor; ctx.globalAlpha = 0.92 * eyeAppear;
            ctx.lineWidth = Math.max(1.4, size * 0.011); ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(-eyeR * 0.94, -eyeR * 0.1); ctx.quadraticCurveTo(0, eyeR * 0.62, eyeR * 0.94, -eyeR * 0.1); ctx.stroke();
          } else {
            ctx.fillStyle = CFG.eyeColor; ctx.globalAlpha = eyeAppear; ctx.beginPath(); ctx.ellipse(0, 0, eyeR, Math.max(1, eyeR * pose.eyeOpenY), 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        });
      }

      if (CFG.showMascotDetails && pose.mouthAppear > 0.02) {
        const mp = projFace(0, -0.135, 0.48, pose.yaw, pose.pitch, pose.roll, pose.headOffsetX, pose.headOffsetY, size);
        if (mp.visible) {
          ctx.save(); ctx.translate(mp.x, mp.y); ctx.rotate(mp.angleRad); ctx.scale(mp.scaleX, mp.scaleY);
          const mw = size * 0.036; ctx.globalAlpha = pose.mouthAppear;
          if (pose.mouthCheer > 0.55) {
            const oa = (pose.mouthCheer - 0.55) / 0.45;
            ctx.fillStyle = CFG.accentColor; ctx.beginPath(); ctx.ellipse(0, mw * 0.25, mw * (0.72 + oa * 0.35), mw * (0.24 + oa * 0.52), 0, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.strokeStyle = CFG.eyeColor; ctx.lineWidth = Math.max(1.2, size * 0.011); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(-mw, 0); ctx.quadraticCurveTo(-mw * 0.5, mw * 0.52, 0, 0); ctx.quadraticCurveTo(mw * 0.5, mw * 0.52, mw, 0); ctx.stroke();
          }
          ctx.restore();
        }
      }

      sparkles.setAttribute('opacity', pose.sparkleOpacity.toFixed(3));
      sparkles.setAttribute('transform', 'translate(120 120) scale(' + pose.sparkleScale.toFixed(3) + ') rotate(' + pose.sparkleRotationDeg.toFixed(2) + ') translate(-120 -120)');
    }

    let startMs = performance.now(), skipAt = null, finished = false, rafId = 0;
    const reduced = isReducedMotion();

    function notifyDone() {
      if (finished) return;
      finished = true;
      document.body.classList.add('done');
      try { if (window.engine && window.engine.intro && typeof window.engine.intro.done === 'function') window.engine.intro.done(); } catch {}
      try { if (window.engine && typeof window.engine.send === 'function') window.engine.send('intro.done'); } catch {}
    }

    function tick(now) {
      const elapsed = (now - startMs) * 0.001;
      const pose = evaluatePose(elapsed, reduced, skipAt);
      renderPose(pose);
      if (pose.done) { notifyDone(); return; }
      rafId = requestAnimationFrame(tick);
    }

    function startPlayback() {
      cancelAnimationFrame(rafId);
      finished = false;
      skipAt = null;
      document.body.classList.remove('done');
      if (frozenT !== null) {
        renderPose(evaluatePose(frozenT, reduced, null));
        return;
      }
      startMs = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    stage.addEventListener('click', () => {
      if (frozenT !== null || finished || skipAt !== null) return;
      skipAt = (performance.now() - startMs) * 0.001;
    });

    if (againBtn) againBtn.addEventListener('click', startPlayback);

    try { if (window.engine && typeof window.engine.ready === 'function') window.engine.ready(); } catch {}
    startPlayback();
  })();
  </script>
</body>
</html>
`;
}
