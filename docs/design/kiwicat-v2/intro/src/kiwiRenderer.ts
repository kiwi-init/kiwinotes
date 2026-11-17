import {
  evaluateIntroPose,
  IntroPose,
  KIWI_INTRO_CONFIG,
  KiwiEarStyle,
  KiwiIntroConfig,
} from './kiwiIntroTimeline';

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
    scaleX:
      Math.max(0.4, Math.sqrt(Math.max(0.1, 1 - nx * nx * 0.62))) *
      depthScale *
      (0.88 + 0.12 * facing),
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
  earPerkL: number,
  earPerkR: number,
  bodyColor: string
) {
  if (earCanvas.width !== backingPx || earCanvas.height !== backingPx) {
    earCanvas.width = backingPx;
    earCanvas.height = backingPx;
  }
  const eCtx = earCanvas.getContext('2d');
  if (!eCtx) return;

  const earH =
    earStyle === 'alongadas'
      ? 0.43
      : earStyle === 'compactas'
      ? 0.21
      : earStyle === 'arredondadas'
      ? 0.28
      : 0.34;
  const tipRound =
    earStyle === 'arredondadas'
      ? 0.34
      : earStyle === 'compactas'
      ? 0.27
      : earStyle === 'alongadas'
      ? 0.17
      : 0.22;
  const w = bodyWidth;

  const proj = (lx: number, ly: number, lz: number) =>
    project3DPointToCanvas(lx, ly, lz, yaw, pitch, roll, headOffsetX, headOffsetY, size);

  const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });

  const drawSingleEar = (side: -1 | 1, earPerk: number) => {
    const droop = Math.max(0, -earPerk);
    const awakePerk = Math.max(0, earPerk);
    const lift = awakePerk * 0.062 - droop * 0.095;
    const tipY = 0.36 + earH * earScale + lift;
    const spreadX = 0.5 * w + (earScale - 1) * 0.07 + awakePerk * 0.02 + droop * 0.065;

    const pOuterBase = proj(side * 0.45 * w, 0.13 - droop * 0.02, 0.03);
    const pOuterCtrl = proj(
      side * (0.49 * w + (earScale - 1) * 0.04 + droop * 0.055),
      0.3 + earH * earScale * 0.4 + awakePerk * 0.062 * 0.35 - droop * 0.068,
      -0.01
    );
    const pTip = proj(side * spreadX, tipY, -0.04 + droop * 0.02);
    const pInnerCtrl = proj(
      side * (0.29 * w + droop * 0.04),
      0.36 + earH * earScale * 0.34 + awakePerk * 0.062 * 0.45 - droop * 0.075,
      0.06
    );
    const pInnerBase = proj(side * 0.135 * w, 0.295 + lift * 0.2, 0.12);
    const pRootMid = proj(side * 0.3 * w, 0.21, 0.1);

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

    const pFadeStart = proj(side * 0.3 * w, 0.32, 0.1);
    const pFadeEnd = proj(side * 0.3 * w, 0.1, 0.12);
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

  drawSingleEar(-1, earPerkL);
  drawSingleEar(1, earPerkR);
}

export const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0); }
`;

export const FRAGMENT_SHADER_SRC = `#version 300 es
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
  float bScale = clamp(uBodyScale, 0.04, 1.26);
  float tStretch = clamp(uTailStretch, 0.0, 0.65);
  vec3 orbCenter = vec3(uLagOffset.x * 0.12, -0.075 + uLagOffset.y * 0.08, -0.06);
  float dUniform = length(pBase - orbCenter) - 0.43 * bScale;
  float dOrb = (length((pBase - orbCenter) / vec3(0.46 * uBodyWidth * bScale, 0.42 * bScale, 0.43 * bScale)) - 1.0) * 0.40 * bScale;
  float dLobe1 = (length((pBase - vec3(uLagOffset.x * 0.65, -0.17 - 0.055 * tStretch + uLagOffset.y * 0.28, -0.14)) / vec3(0.42 * uBodyWidth * bScale * (0.78 + 0.30 * bScale), (0.26 + 0.06 * tStretch) * bScale, 0.35 * bScale)) - 1.0) * 0.31 * bScale;
  float dLobe2 = (length((pBase - vec3(uLagOffset.x * 1.05, -0.24 - 0.085 * tStretch + uLagOffset.y * 0.42, -0.22)) / vec3(0.29 * uBodyWidth * bScale * (0.74 + 0.30 * bScale), (0.19 + 0.065 * tStretch) * bScale, 0.26 * bScale)) - 1.0) * 0.24 * bScale;
  float dLobe3 = (length((pBase - vec3(-uLagOffset.x * 0.35, 0.01, -0.26)) / vec3(0.39 * uBodyWidth * bScale, 0.27 * bScale, 0.30 * bScale)) - 1.0) * 0.28 * bScale;
  float sminK = max(0.03, 0.24 * bScale);
  float dCat = smin(dOrb, dLobe1, sminK);
  dCat = smin(dCat, dLobe2, sminK);
  if (uShowMist > 0.5) dCat = smin(dCat, dLobe3, sminK);
  float bodyMorph = smoothstep(0.32, 0.85, bScale);
  float dMass = mix(dUniform, dCat, bodyMorph);
  float fbmSwirl = fbm3(pBase * 2.15 + vec3(-uLagOffset.x * 0.85, -uTime * 0.52, uTime * 0.18)) - 0.5;
  float liquidWave = 0.55 * sin(pBase.y * 3.6 - uTime * 2.1 + pBase.x * 1.9) + 0.45 * cos(pBase.x * 3.2 + uTime * 1.65 - pBase.y * 2.2);
  float lowerWeight = smoothstep(0.32, -0.40, pBase.y);
  float outerRimWeight = smoothstep(-0.18, 0.05, dMass);
  float wholeBodyMix = 0.52 + 0.48 * max(lowerWeight, outerRimWeight);
  float dispScale = smoothstep(0.06, 0.45, bScale);
  float disp = (fbmSwirl * 0.82 + liquidWave * 0.18) * (0.050 + 0.115 * uSoftness + 0.082 * uLiquidAmp) * wholeBodyMix * (0.35 + 0.65 * dispScale);
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
  float bodyFeather = (0.115 + 0.185 * uSoftness + 0.085 * uMistDiffusion) * (0.08 + 0.92 * smoothstep(0.04, 0.52, uBodyScale));
  float inkAlpha = pow(smoothstep(bodyFeather, -0.048, minD), 1.38);
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

export class KiwiIntroWebGLEngine {
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
      canvas.width = 256;
      canvas.height = 256;
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.program = null;
        this.gl = null;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.failed = false;
      });

      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
      });
      if (!gl) {
        this.failed = true;
        return false;
      }
      const vs = gl.createShader(gl.VERTEX_SHADER);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      if (!vs || !fs) {
        this.failed = true;
        return false;
      }
      gl.shaderSource(vs, VERTEX_SHADER_SRC);
      gl.compileShader(vs);
      gl.shaderSource(fs, FRAGMENT_SHADER_SRC);
      gl.compileShader(fs);
      const prog = gl.createProgram();
      if (!prog) {
        this.failed = true;
        return false;
      }
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        this.failed = true;
        return false;
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const names = [
        'uResolution',
        'uTime',
        'uAudio',
        'uYaw',
        'uPitch',
        'uRoll',
        'uHeadOffset',
        'uLagOffset',
        'uBodyWidth',
        'uSoftness',
        'uAuraIntensity',
        'uMistDiffusion',
        'uPrismSpread',
        'uAuraStyle',
        'uShowMist',
        'uOrbitPhase',
        'uWavePhase',
        'uIsLight',
        'uBodyScale',
        'uTailStretch',
        'uLiquidAmp',
        'uSteps',
        'uBodyColor',
        'uPrismStart',
        'uPrismMid',
        'uPrismEnd',
        'uMistColor',
      ];
      for (const n of names) {
        this.uniforms[n] = gl.getUniformLocation(prog, n);
      }
      this.canvas = canvas;
      this.gl = gl;
      this.program = prog;
      this.vao = vao;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    drawSize: number,
    backingPx: number,
    cfg: KiwiIntroConfig,
    pose: IntroPose
  ): boolean {
    if (!this.ensureInit() || !this.gl || !this.canvas || !this.program) return false;
    const gl = this.gl;
    const px = Math.max(96, Math.min(560, Math.round(backingPx)));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    gl.viewport(0, 0, px, px);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const styleInt =
      cfg.auraStyle === 'contorno-sutil'
        ? 1
        : cfg.auraStyle === 'halo-difuso'
        ? 2
        : cfg.auraStyle === 'nuvem-base'
        ? 3
        : 0;
    const bc = hexToRgbVec(cfg.bodyColor);
    const p1 = hexToRgbVec(cfg.prismStops[0]);
    const p2 = hexToRgbVec(cfg.prismStops[1]);
    const p3 = hexToRgbVec(cfg.prismStops[2]);
    const mc = hexToRgbVec(cfg.mistBaseColor);
    const u = this.uniforms;

    gl.uniform2f(u.uResolution, px, px);
    gl.uniform1f(u.uTime, pose.mistPhase);
    gl.uniform1f(u.uAudio, pose.happyArc * 0.35);
    gl.uniform1f(u.uYaw, pose.yaw);
    gl.uniform1f(u.uPitch, pose.pitch);
    gl.uniform1f(u.uRoll, pose.roll);
    gl.uniform2f(u.uHeadOffset, pose.headOffsetX, pose.headOffsetY);
    gl.uniform2f(u.uLagOffset, pose.lagX, pose.lagY);
    gl.uniform1f(u.uBodyWidth, cfg.bodyWidth);
    gl.uniform1f(u.uSoftness, pose.softness);
    gl.uniform1f(u.uAuraIntensity, pose.auraIntensity / 100);
    gl.uniform1f(u.uMistDiffusion, cfg.prismSpread / 100);
    gl.uniform1f(u.uPrismSpread, cfg.prismSpread / 100);
    gl.uniform1i(u.uAuraStyle, styleInt);
    gl.uniform1f(u.uShowMist, cfg.showAmbientMist ? 1.0 : 0.0);
    gl.uniform1f(u.uOrbitPhase, pose.orbitAngle);
    gl.uniform1f(u.uWavePhase, pose.wavePhase);
    gl.uniform1f(u.uIsLight, 0.0);
    gl.uniform1f(u.uBodyScale, pose.bodyScale);
    gl.uniform1f(u.uTailStretch, pose.tailStretch);
    gl.uniform1f(u.uLiquidAmp, pose.liquidAmp);
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

export const sharedIntroWebGLEngine = new KiwiIntroWebGLEngine();

export function renderKiwiIntroFrame(
  fogCanvas: HTMLCanvasElement,
  faceCanvas: HTMLCanvasElement,
  earBufferCanvas: HTMLCanvasElement,
  size: number,
  dpr: number,
  pose: IntroPose,
  cfg: KiwiIntroConfig = KIWI_INTRO_CONFIG
) {
  const backingPx = Math.round(size * dpr);

  // 1. Camada de Névoa Volumétrica WebGL2 + Partículas Coalescentes (com fallback Canvas 2D)
  if (fogCanvas.width !== backingPx || fogCanvas.height !== backingPx) {
    fogCanvas.width = backingPx;
    fogCanvas.height = backingPx;
  }
  const fogCtx = fogCanvas.getContext('2d');
  if (fogCtx) {
    fogCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fogCtx.clearRect(0, 0, size, size);
    const rendered3D = sharedIntroWebGLEngine.render(fogCtx, size, backingPx, cfg, pose);
    if (!rendered3D) {
      const cx = size * (0.5 + pose.headOffsetX * 0.4 + pose.lagX * 0.15);
      const cy = size * (0.54 - pose.headOffsetY * 0.4 - pose.lagY * 0.15);
      const r = size * 0.25 * pose.bodyScale;
      fogCtx.save();
      fogCtx.translate(cx, cy);
      const grad = fogCtx.createRadialGradient(r * 0.2, r * 0.25, r * 0.25, 0, 0, r * 1.45);
      grad.addColorStop(0, cfg.bodyColor);
      grad.addColorStop(0.62, cfg.bodyColor);
      grad.addColorStop(0.82, cfg.prismStops[2]);
      grad.addColorStop(0.93, cfg.prismStops[0]);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = grad;
      fogCtx.beginPath();
      fogCtx.arc(0, 0, r * 1.38, 0, Math.PI * 2);
      fogCtx.fill();
      fogCtx.restore();
    }
  }

  // 2. Camada do Rosto 3D (Orelhas Flat-3D independentes + Olhos piscando + Boquinha)
  if (faceCanvas.width !== backingPx || faceCanvas.height !== backingPx) {
    faceCanvas.width = backingPx;
    faceCanvas.height = backingPx;
  }
  const ctx = faceCanvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Orelhas surgem primeiro, abaixadas dormindo, após o corpo estar visível
  const earAppear = pose.earAppear;
  if (earAppear > 0.02) {
    ctx.save();
    ctx.globalAlpha = earAppear;
    drawSeparateFlat3DEars(
      ctx,
      earBufferCanvas,
      size,
      backingPx,
      dpr,
      pose.yaw,
      pose.pitch,
      pose.roll,
      pose.headOffsetX,
      pose.headOffsetY,
      cfg.bodyWidth,
      cfg.earStyle,
      cfg.earScale * (0.82 + 0.18 * earAppear),
      pose.earPerkL,
      pose.earPerkR,
      cfg.bodyColor
    );
    ctx.restore();
  }

  // Olhos 3D surgem depois das orelhas começarem a levantar
  const eyeAppear = pose.eyeAppear;
  if (eyeAppear > 0.02) {
    const eyeSpanX = 0.195 * cfg.eyeSpacing * cfg.bodyWidth;
    const eyeLocalY = 0.018;
    const computeSurfaceZ = (lx: number, ly: number) => {
      const nx = lx / (0.56 * cfg.bodyWidth);
      const ny = (ly - 0.018) / 0.46;
      return 0.3 * Math.sqrt(Math.max(0.22, 1 - nx * nx - ny * ny)) + 0.14;
    };
    const lx = -eyeSpanX;
    const rxPos = eyeSpanX;
    const leftProj = project3DFacePoint(
      lx,
      eyeLocalY,
      computeSurfaceZ(lx, eyeLocalY),
      pose.yaw,
      pose.pitch,
      pose.roll,
      pose.headOffsetX,
      pose.headOffsetY,
      size
    );
    const rightProj = project3DFacePoint(
      rxPos,
      eyeLocalY,
      computeSurfaceZ(rxPos, eyeLocalY),
      pose.yaw,
      pose.pitch,
      pose.roll,
      pose.headOffsetX,
      pose.headOffsetY,
      size
    );

    const baseEyeR = size * 0.032 * cfg.eyeScale * pose.eyeScale;
    const drawEye = (proj: ReturnType<typeof project3DFacePoint>) => {
      if (!proj.visible) return;
      ctx.save();
      ctx.translate(proj.x, proj.y);
      ctx.rotate(proj.angleRad);
      ctx.scale(proj.scaleX, proj.scaleY);

      if (pose.happyArc > 0.45) {
        const tHappy = Math.min(1, (pose.happyArc - 0.45) / 0.35);
        ctx.strokeStyle = cfg.eyeColor;
        ctx.globalAlpha = (0.9 + 0.1 * tHappy) * eyeAppear;
        ctx.lineWidth = Math.max(1.6, size * 0.012);
        ctx.lineCap = 'round';
        ctx.beginPath();
        const arcW = baseEyeR * 1.02;
        const sweep = -baseEyeR * (0.72 + 0.18 * tHappy);
        const yOff = baseEyeR * 0.25;
        ctx.moveTo(-arcW, yOff);
        ctx.quadraticCurveTo(0, yOff + sweep, arcW, yOff);
        ctx.stroke();
      } else if (pose.eyeOpenY < 0.22) {
        ctx.strokeStyle = cfg.eyeColor;
        ctx.globalAlpha = 0.92 * eyeAppear;
        ctx.lineWidth = Math.max(1.4, size * 0.011);
        ctx.lineCap = 'round';
        ctx.beginPath();
        const arcW = baseEyeR * 0.94;
        const sweep = baseEyeR * 0.72;
        const yOff = -baseEyeR * 0.1;
        ctx.moveTo(-arcW, yOff);
        ctx.quadraticCurveTo(0, yOff + sweep, arcW, yOff);
        ctx.stroke();
      } else {
        ctx.fillStyle = cfg.eyeColor;
        ctx.globalAlpha = eyeAppear;
        ctx.beginPath();
        ctx.ellipse(0, 0, baseEyeR, Math.max(1, baseEyeR * pose.eyeOpenY), 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    drawEye(leftProj);
    drawEye(rightProj);
  }

  // Boquinha :3 / sorriso feliz surge por último, após os olhos despertarem
  if (cfg.showMascotDetails && pose.mouthAppear > 0.02) {
    const mouthProj = project3DFacePoint(
      0,
      -0.135,
      0.48,
      pose.yaw,
      pose.pitch,
      pose.roll,
      pose.headOffsetX,
      pose.headOffsetY,
      size
    );
    if (mouthProj.visible) {
      ctx.save();
      ctx.translate(mouthProj.x, mouthProj.y);
      ctx.rotate(mouthProj.angleRad);
      ctx.scale(mouthProj.scaleX, mouthProj.scaleY);
      const mw = size * 0.036;
      ctx.globalAlpha = pose.mouthAppear;

      if (pose.mouthCheer > 0.55) {
        const openAmt = (pose.mouthCheer - 0.55) / 0.45;
        ctx.fillStyle = cfg.accentColor;
        ctx.beginPath();
        ctx.ellipse(
          0,
          mw * 0.25,
          mw * (0.72 + openAmt * 0.35),
          mw * (0.24 + openAmt * 0.52),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        ctx.strokeStyle = cfg.eyeColor;
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

/**
 * Gera um snapshot PNG determinístico para a Prancha de 6 quadros,
 * aplicando a máscara radial CSS e as faíscas comic diretamente sobre um squircle offscreen.
 */
export function renderIntroSnapshotDataUrl(
  timestamp: number,
  size = 180,
  reducedMotion = false,
  showFrame = true
): string {
  const pose = evaluateIntroPose(timestamp, reducedMotion, null, showFrame);
  const dpr = 2;
  const px = size * dpr;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = px;
  outCanvas.height = px;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return '';

  const fogCanvas = document.createElement('canvas');
  const faceCanvas = document.createElement('canvas');
  const earCanvas = document.createElement('canvas');

  if (pose.mascotOpacity > 0.01) {
    renderKiwiIntroFrame(fogCanvas, faceCanvas, earCanvas, size, dpr, pose, KIWI_INTRO_CONFIG);
  }

  const maskedFog = document.createElement('canvas');
  maskedFog.width = px;
  maskedFog.height = px;
  const mfCtx = maskedFog.getContext('2d');
  if (mfCtx && pose.mascotOpacity > 0.01) {
    mfCtx.drawImage(fogCanvas, 0, 0);
    mfCtx.globalCompositeOperation = 'destination-in';
    const cx = px * 0.5;
    const cy = px * 0.53;
    const maxR = px * 0.5;
    const rad = mfCtx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    rad.addColorStop(0, `rgba(0,0,0,${pose.fogOpacity})`);
    rad.addColorStop(Math.min(0.97, pose.fogCore / 100), `rgba(0,0,0,${pose.fogOpacity})`);
    rad.addColorStop(Math.min(0.98, pose.fogMid / 100), `rgba(0,0,0,${0.84 * pose.fogOpacity})`);
    rad.addColorStop(Math.min(0.99, pose.fogMist / 100), `rgba(0,0,0,${0.28 * pose.fogOpacity})`);
    rad.addColorStop(Math.min(1, pose.fogEdge / 100), 'rgba(0,0,0,0)');
    mfCtx.fillStyle = rad;
    mfCtx.fillRect(0, 0, px, px);
  }

  outCtx.save();
  outCtx.globalAlpha = pose.stageOpacity;

  const exp = showFrame ? pose.windowExpand : 0;
  const boxW = showFrame ? px * (0.78 + (0.94 - 0.78) * exp) : px;
  const boxH = showFrame ? px * (0.78 + (0.56 - 0.78) * exp) : px;
  const boxX = (px - boxW) * 0.5;
  const boxY = (px - boxH) * 0.5;
  const boxR = showFrame ? boxW * 0.24 * (1 - exp) + px * 0.055 * exp : 0;

  if (showFrame) {
    outCtx.save();
    outCtx.beginPath();
    outCtx.roundRect(boxX, boxY, boxW, boxH, boxR);
    outCtx.clip();

    outCtx.fillStyle = KIWI_INTRO_CONFIG.surfaceBg;
    outCtx.fillRect(boxX, boxY, boxW, boxH);
  }

  if (pose.mascotOpacity > 0.01) {
    outCtx.save();
    outCtx.globalAlpha = pose.stageOpacity * pose.mascotOpacity;
    const catSize = showFrame ? px * 0.76 : px;
    const catX = (px - catSize) * 0.5;
    const catY = (px - catSize) * 0.5;
    outCtx.translate(px / 2, px / 2);
    outCtx.scale(pose.stageScale, pose.stageScale);
    outCtx.translate(-px / 2, -px / 2);
    outCtx.drawImage(maskedFog, catX, catY, catSize, catSize);
    outCtx.drawImage(faceCanvas, catX, catY, catSize, catSize);

    if (pose.sparkleOpacity > 0.02) {
      outCtx.save();
      outCtx.globalAlpha = pose.stageOpacity * pose.mascotOpacity * pose.sparkleOpacity;
      outCtx.fillStyle = '#FFFFFF';
      const drawFourPointStar = (sx: number, sy: number, radius: number, alpha = 1) => {
        outCtx.save();
        outCtx.globalAlpha *= alpha;
        const fx = catX + (sx / 240) * catSize;
        const fy = catY + (sy / 240) * catSize;
        outCtx.translate(fx, fy);
        outCtx.rotate((pose.sparkleRotationDeg * Math.PI) / 180);
        const s = (catSize / 240) * pose.sparkleScale;
        outCtx.scale(s, s);
        const inner = radius * 0.24;
        outCtx.beginPath();
        outCtx.moveTo(0, -radius);
        outCtx.lineTo(inner, -inner);
        outCtx.lineTo(radius, 0);
        outCtx.lineTo(inner, inner);
        outCtx.lineTo(0, radius);
        outCtx.lineTo(-inner, inner);
        outCtx.lineTo(-radius, 0);
        outCtx.lineTo(-inner, -inner);
        outCtx.closePath();
        outCtx.fill();
        outCtx.restore();
      };
      drawFourPointStar(52, 105, 9.5, 1);
      drawFourPointStar(190, 75, 9.5, 1);
      drawFourPointStar(196, 126, 6, 0.85);
      outCtx.restore();
    }
    outCtx.restore();
  }

  // Janela & caixinhas de exemplo na prancha
  if (showFrame && pose.windowChromeOpacity > 0.02) {
    outCtx.save();
    outCtx.globalAlpha = pose.stageOpacity * pose.windowChromeOpacity;
    const barH = boxH * 0.14;
    outCtx.fillStyle = 'rgba(255,255,255,0.03)';
    outCtx.fillRect(boxX, boxY, boxW, barH);
    outCtx.fillStyle = 'rgba(255,255,255,0.08)';
    outCtx.fillRect(boxX, boxY + barH, boxW, 1);
    const dotY = boxY + barH * 0.5;
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((col, i) => {
      outCtx.fillStyle = col;
      outCtx.beginPath();
      outCtx.arc(boxX + px * 0.055 + i * px * 0.032, dotY, px * 0.009, 0, Math.PI * 2);
      outCtx.fill();
    });

    if (pose.appContentOpacity > 0.02) {
      outCtx.globalAlpha = pose.stageOpacity * pose.appContentOpacity;
      const bodyX = boxX;
      const bodyY = boxY + barH + 1;
      const bodyH = boxH - barH - 1;
      const sideW = boxW * 0.24;
      outCtx.fillStyle = 'rgba(255,255,255,0.02)';
      outCtx.fillRect(bodyX, bodyY, sideW, bodyH);
      outCtx.fillStyle = 'rgba(255,255,255,0.06)';
      outCtx.fillRect(bodyX + sideW, bodyY, 1, bodyH);

      // Barrinhas da sidebar
      outCtx.fillStyle = 'rgba(34,211,238,0.22)';
      outCtx.beginPath();
      outCtx.roundRect(bodyX + sideW * 0.14, bodyY + bodyH * 0.1, sideW * 0.72, bodyH * 0.1, 3);
      outCtx.fill();
      outCtx.fillStyle = 'rgba(255,255,255,0.11)';
      [0.28, 0.4, 0.52].forEach((yy) => {
        outCtx.fillRect(bodyX + sideW * 0.14, bodyY + bodyH * yy, sideW * 0.65, bodyH * 0.045);
      });

      // Caixinhas principais
      const mainX = bodyX + sideW + boxW * 0.045;
      const mainW = boxW - sideW - boxW * 0.09;
      outCtx.fillStyle = 'rgba(255,255,255,0.16)';
      outCtx.fillRect(mainX, bodyY + bodyH * 0.12, mainW * 0.42, bodyH * 0.065);
      const cardW = (mainW - boxW * 0.04) / 3;
      ['rgba(34,211,238,0.14)', 'rgba(99,102,241,0.14)', 'rgba(236,72,153,0.14)'].forEach((bg, idx) => {
        const cx = mainX + idx * (cardW + boxW * 0.02);
        outCtx.fillStyle = 'rgba(255,255,255,0.04)';
        outCtx.beginPath();
        outCtx.roundRect(cx, bodyY + bodyH * 0.28, cardW, bodyH * 0.26, 4);
        outCtx.fill();
        outCtx.fillStyle = bg;
        outCtx.beginPath();
        outCtx.roundRect(cx + cardW * 0.14, bodyY + bodyH * 0.32, cardW * 0.26, cardW * 0.26, 2);
        outCtx.fill();
      });
      outCtx.fillStyle = 'rgba(255,255,255,0.03)';
      outCtx.beginPath();
      outCtx.roundRect(mainX, bodyY + bodyH * 0.61, mainW, bodyH * 0.28, 4);
      outCtx.fill();
    }
    outCtx.restore();
  }

  if (showFrame) {
    outCtx.restore();
    // Borda sutil externa da moldura/janela na prancha
    outCtx.save();
    outCtx.globalAlpha = pose.stageOpacity;
    outCtx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    outCtx.lineWidth = 2;
    outCtx.beginPath();
    outCtx.roundRect(boxX, boxY, boxW, boxH, boxR);
    outCtx.stroke();
    outCtx.restore();
  }

  outCtx.restore();
  return outCanvas.toDataURL('image/png');
}
