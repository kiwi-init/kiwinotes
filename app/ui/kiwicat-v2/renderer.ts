// Portado de docs/design/kiwicat-v2/intro/src (o kiwiRenderer.ts e o script do build), T14851, spec #14766.
// Mudanças: a forma do corpo virou opção (FogShape), com o padrão do gato do agente; o desenho da intro é o do build;
// o `dispose()` solta o programa e o contexto (T14885); o gato do app divide um só por janela (`ui/kiwicat/cat.ts`).
//
// O renderizador comum do KiwiCat novo: a névoa (um shader de SDF por raymarching, no WebGL2) e o rosto Flat-3D (as
// orelhas, os olhos e a boca num canvas 2D). A intro usa agora; o gato do agente (o spec do agente) vai usar o mesmo.
// Nada da intro fica fixo aqui: o que é dela entra pelas opções (`INTRO_SHAPE`, a config, a pose).

/** A forma do corpo. O padrão (`CAT_SHAPE`) é o shader do gato do pacote `agente/`; a intro usa o `INTRO_SHAPE`. */
export interface FogShape {
  /** A menor escala do corpo: a intro começa num ponto (0,04); o gato nunca fica menor que 0,70. */
  minScale: number;
  /** Onde a tinta do corpo acaba (o fim do `smoothstep` do alfa). */
  featherEdge: number;
  /** Em escala pequena, o corpo vira uma bola e a névoa e a borda encolhem junto (a condensação da intro). */
  smallMorph: boolean;
}
export const CAT_SHAPE: FogShape = { minScale: 0.7, featherEdge: -0.068, smallMorph: false };
export const INTRO_SHAPE: FogShape = { minScale: 0.04, featherEdge: -0.048, smallMorph: true };

/** As cores e as proporções que o desenho lê. */
export interface KiwiLook {
  bodyColor: string;
  accentColor: string;
  eyeColor: string;
  prismStops: readonly [string, string, string] | readonly string[];
  mistBaseColor: string;
  prismSpread: number;
  bodyWidth: number;
  earScale: number;
  eyeScale: number;
  eyeSpacing: number;
  showMascotDetails: boolean;
  /** O estilo da aura no shader (0 = a borda suave, o da intro e o padrão). */
  auraStyleIndex?: number;
  /** A névoa de fundo em volta do corpo. */
  showMist?: boolean;
  /** O tema claro. */
  isLight?: boolean;
  /** Os passos do raymarching (30, como no pacote). */
  steps?: number;
}

/** O que a névoa e o rosto leem da pose. */
export interface KiwiPose {
  mistPhase: number; yaw: number; pitch: number; roll: number;
  headOffsetX: number; headOffsetY: number; lagX: number; lagY: number;
  softness: number; auraIntensity: number; orbitAngle: number; wavePhase: number;
  bodyScale: number; tailStretch: number; liquidAmp: number;
  earAppear: number; eyeAppear: number; mouthAppear: number; earPerkL: number; earPerkR: number;
  eyeOpenY: number; eyeScale: number; mouthCheer: number; happyArc: number;
  /** A voz (0 a 1): acende a aura. A intro passa `happyArc * 0.35`, como o build. */
  audio?: number;
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
// A forma (FogShape): a escala mínima, a borda da tinta e a forma em escala pequena (0 no gato, 1 na intro).
uniform float uMinScale, uFeatherEdge, uSmallMorph;

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
  float bScale = clamp(uBodyScale, uMinScale, 1.26);
  float tStretch = clamp(uTailStretch, 0.0, 0.65);
  vec3 orbCenter = vec3(uLagOffset.x * 0.12, -0.075 + uLagOffset.y * 0.08, -0.06);
  float dUniform = length(pBase - orbCenter) - 0.43 * bScale;
  float dOrb = (length((pBase - orbCenter) / vec3(0.46 * uBodyWidth * bScale, 0.42 * bScale, 0.43 * bScale)) - 1.0) * 0.40 * bScale;
  float dLobe1 = (length((pBase - vec3(uLagOffset.x * 0.65, -0.17 - 0.055 * tStretch + uLagOffset.y * 0.28, -0.14)) / vec3(0.42 * uBodyWidth * mix(1.0, bScale, uSmallMorph) * (0.78 + 0.30 * bScale), (0.26 + 0.06 * tStretch) * bScale, 0.35 * bScale)) - 1.0) * 0.31 * bScale;
  float dLobe2 = (length((pBase - vec3(uLagOffset.x * 1.05, -0.24 - 0.085 * tStretch + uLagOffset.y * 0.42, -0.22)) / vec3(0.29 * uBodyWidth * mix(1.0, bScale, uSmallMorph) * (0.74 + 0.30 * bScale), (0.19 + 0.065 * tStretch) * bScale, 0.26 * bScale)) - 1.0) * 0.24 * bScale;
  float dLobe3 = (length((pBase - vec3(-uLagOffset.x * 0.35, 0.01, -0.26)) / vec3(0.39 * uBodyWidth * bScale, 0.27 * bScale, 0.30 * bScale)) - 1.0) * 0.28 * bScale;
  float sminK = max(0.03, 0.24 * bScale);
  float dCat = smin(dOrb, dLobe1, sminK);
  dCat = smin(dCat, dLobe2, sminK);
  if (uShowMist > 0.5) dCat = smin(dCat, dLobe3, sminK);
  float bodyMorph = mix(1.0, smoothstep(0.32, 0.85, bScale), uSmallMorph);
  float dMass = mix(dUniform, dCat, bodyMorph);
  float fbmSwirl = fbm3(pBase * 2.15 + vec3(-uLagOffset.x * 0.85, -uTime * 0.52, uTime * 0.18)) - 0.5;
  float liquidWave = 0.55 * sin(pBase.y * 3.6 - uTime * 2.1 + pBase.x * 1.9) + 0.45 * cos(pBase.x * 3.2 + uTime * 1.65 - pBase.y * 2.2);
  float lowerWeight = smoothstep(0.32, -0.40, pBase.y);
  float outerRimWeight = smoothstep(-0.18, 0.05, dMass);
  float wholeBodyMix = 0.52 + 0.48 * max(lowerWeight, outerRimWeight);
  float dispScale = smoothstep(0.06, 0.45, bScale);
  float disp = (fbmSwirl * 0.82 + liquidWave * 0.18) * (0.050 + 0.115 * uSoftness + 0.082 * uLiquidAmp) * wholeBodyMix * mix(1.0, 0.35 + 0.65 * dispScale, uSmallMorph);
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
  float bodyFeather = (0.115 + 0.185 * uSoftness + 0.085 * uMistDiffusion) * mix(1.0, 0.08 + 0.92 * smoothstep(0.04, 0.52, uBodyScale), uSmallMorph);
  float inkAlpha = pow(smoothstep(bodyFeather, uFeatherEdge, minD), 1.38);
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

const UNIFORMS = ['uResolution','uTime','uAudio','uYaw','uPitch','uRoll','uHeadOffset','uLagOffset','uBodyWidth','uSoftness','uAuraIntensity','uMistDiffusion','uPrismSpread','uAuraStyle','uShowMist','uOrbitPhase','uWavePhase','uIsLight','uBodyScale','uTailStretch','uLiquidAmp','uSteps','uBodyColor','uPrismStart','uPrismMid','uPrismEnd','uMistColor','uMinScale','uFeatherEdge','uSmallMorph'] as const;
const hexToRgb = (h: string): [number, number, number] => { const n = parseInt(h.replace('#', ''), 16); return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255]; };

/**
 * A névoa: um canvas WebGL2 fora da tela, desenhado num quadrado de `gpx` px. Sem WebGL2 (ou se o shader não
 * compila), `draw` devolve `null` e quem chama segue sem a névoa, como no pacote.
 */
export class FogRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private failed = false;

  constructor(private readonly shape: FogShape = CAT_SHAPE) {}

  private init(): boolean {
    if (this.failed) return false;
    if (this.gl && !this.gl.isContextLost() && this.prog) return true;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
      if (!gl) { this.failed = true; return false; }
      const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, VERTEX_SHADER_SRC); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, FRAGMENT_SHADER_SRC); gl.compileShader(fs);
      const prog = gl.createProgram()!; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.failed = true; return false; }
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(prog, n);
      this.canvas = canvas; this.gl = gl; this.prog = prog;
      return true;
    } catch { this.failed = true; return false; }
  }

  /**
   * Solta o programa, o VAO e o contexto WebGL2 (T14885). Depois do `dispose`, o `draw` devolve `null`. O WebKit só
   * libera a vaga do contexto no GC; por isso o gato do app divide um renderizador por janela, em vez de abrir um por gato.
   */
  dispose(): void {
    const gl = this.gl;
    this.failed = true;
    if (gl && !gl.isContextLost()) {
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.prog) {
        for (const sh of gl.getAttachedShaders(this.prog) ?? []) { gl.detachShader(this.prog, sh); gl.deleteShader(sh); }
        gl.deleteProgram(this.prog);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; }
    this.gl = null; this.prog = null; this.vao = null; this.canvas = null; this.u = {};
  }

  /** Desenha a pose e devolve o canvas (para um `drawImage`), ou `null` sem WebGL2. */
  draw(pose: KiwiPose, look: KiwiLook, gpx: number): HTMLCanvasElement | null {
    if (!this.init()) return null;
    const gl = this.gl!, u = this.u, glCanvas = this.canvas!, CFG = look, shape = this.shape;
    if (glCanvas.width !== gpx || glCanvas.height !== gpx) { glCanvas.width = gpx; glCanvas.height = gpx; }

    gl.viewport(0, 0, gpx, gpx); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    const bc = hexToRgb(CFG.bodyColor), p1 = hexToRgb(CFG.prismStops[0]), p2 = hexToRgb(CFG.prismStops[1]), p3 = hexToRgb(CFG.prismStops[2]), mc = hexToRgb(CFG.mistBaseColor);
    gl.uniform2f(u.uResolution, gpx, gpx); gl.uniform1f(u.uTime, pose.mistPhase); gl.uniform1f(u.uAudio, pose.audio ?? 0);
    gl.uniform1f(u.uYaw, pose.yaw); gl.uniform1f(u.uPitch, pose.pitch); gl.uniform1f(u.uRoll, pose.roll);
    gl.uniform2f(u.uHeadOffset, pose.headOffsetX, pose.headOffsetY); gl.uniform2f(u.uLagOffset, pose.lagX, pose.lagY);
    gl.uniform1f(u.uBodyWidth, CFG.bodyWidth); gl.uniform1f(u.uSoftness, pose.softness);
    gl.uniform1f(u.uAuraIntensity, pose.auraIntensity / 100); gl.uniform1f(u.uMistDiffusion, CFG.prismSpread / 100);
    gl.uniform1f(u.uPrismSpread, CFG.prismSpread / 100); gl.uniform1i(u.uAuraStyle, CFG.auraStyleIndex ?? 0);
    gl.uniform1f(u.uShowMist, CFG.showMist ? 1 : 0); gl.uniform1f(u.uOrbitPhase, pose.orbitAngle); gl.uniform1f(u.uWavePhase, pose.wavePhase);
    gl.uniform1f(u.uIsLight, CFG.isLight ? 1 : 0); gl.uniform1f(u.uBodyScale, pose.bodyScale); gl.uniform1f(u.uTailStretch, pose.tailStretch);
    gl.uniform1f(u.uLiquidAmp, pose.liquidAmp); gl.uniform1i(u.uSteps, CFG.steps ?? 30);
    gl.uniform3f(u.uBodyColor, bc[0], bc[1], bc[2]); gl.uniform3f(u.uPrismStart, p1[0], p1[1], p1[2]);
    gl.uniform3f(u.uPrismMid, p2[0], p2[1], p2[2]); gl.uniform3f(u.uPrismEnd, p3[0], p3[1], p3[2]); gl.uniform3f(u.uMistColor, mc[0], mc[1], mc[2]);
    gl.uniform1f(u.uMinScale, shape.minScale); gl.uniform1f(u.uFeatherEdge, shape.featherEdge); gl.uniform1f(u.uSmallMorph, shape.smallMorph ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return glCanvas;
  }
}

interface Pt { x: number; y: number; z?: number }

function rot3D(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): [number, number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
}
function projPt(lx: number, ly: number, lz: number, yaw: number, pitch: number, roll: number, ox: number, oy: number, size: number): Required<Pt> {
  const [rx, ry, rz] = rot3D(lx, ly, lz, yaw, pitch, roll);
  const dz = Math.max(0.5, 3.1 - rz);
  return { x: (0.5 + 0.5 * (((rx + ox) * 2.45) / dz)) * size, y: (0.5 - 0.5 * (((ry + oy) * 2.45) / dz)) * size, z: rz };
}
function projFace(lx: number, ly: number, lz: number, yaw: number, pitch: number, roll: number, ox: number, oy: number, size: number) {
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

/**
 * O rosto Flat-3D no `ctx` (já limpo, num quadrado de `size` px lógicos): as orelhas (cada uma num `earCanvas` à
 * parte, para o esmaecer da base), os olhos e a boca.
 */
export function drawFace(ctx: CanvasRenderingContext2D, earCanvas: HTMLCanvasElement, pose: KiwiPose, CFG: KiwiLook, size: number, dpr: number): void {
  const px = Math.round(size * dpr);
  const earAppear = pose.earAppear;
  if (earAppear > 0.02) {
    if (earCanvas.width !== px || earCanvas.height !== px) { earCanvas.width = px; earCanvas.height = px; }
    const eCtx = earCanvas.getContext('2d')!;
    const es = CFG.earScale * (0.82 + 0.18 * earAppear);
    const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    ctx.save(); ctx.globalAlpha = earAppear;
    ([[-1, pose.earPerkL], [1, pose.earPerkR]] as const).forEach(([side, perk]) => {
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
    const surfZ = (lx: number) => 0.3 * Math.sqrt(Math.max(0.22, 1 - Math.pow(lx / (0.56 * CFG.bodyWidth), 2))) + 0.14;
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
}
