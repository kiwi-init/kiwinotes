// Portado de docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx (o `drawSeparateFlat3DEars`, a projeção e os olhos e a
// boca do `animate`), T14885, spec #14813. Mudanças: lê o quadro do `CatMotion` no lugar das variáveis do React.
//
// O rosto Flat-3D do gato do agente: as orelhas, os olhos (a piscada e os olhos dos emotes) e a boca. O da intro é o
// `drawFace` do `renderer.ts`, que não tem a piscada nem os emotes.

import type { CatConfig } from "./cat-config";
import type { CatFrame } from "./cat-motion";

const CAM_Z = 3.1;
const FOCAL_LEN = 2.45;

function rotate(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): [number, number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
}

interface View { yaw: number; pitch: number; roll: number; ox: number; oy: number; size: number }

function project(lx: number, ly: number, lz: number, v: View) {
  const [rx, ry, rz] = rotate(lx, ly, lz, v.yaw, v.pitch, v.roll);
  const dz = Math.max(0.5, CAM_Z - rz);
  return {
    x: (0.5 + 0.5 * (((rx + v.ox) * FOCAL_LEN) / dz)) * v.size,
    y: (0.5 - 0.5 * (((ry + v.oy) * FOCAL_LEN) / dz)) * v.size,
    z: rz,
  };
}

function projectFace(lx: number, ly: number, lz: number, v: View) {
  const pt = project(lx, ly, lz, v);
  const nLen = Math.hypot(lx, ly, lz) || 1;
  const [nx, ny, nz] = rotate(lx / nLen, ly / nLen, lz / nLen, v.yaw, v.pitch, v.roll);
  const [tx, ty] = rotate(1, 0, 0, v.yaw, v.pitch, v.roll);
  const depthScale = (CAM_Z - 0.45) / Math.max(0.5, CAM_Z - pt.z);
  const facing = Math.max(0.32, nz);
  return {
    x: pt.x,
    y: pt.y,
    scaleX: Math.max(0.4, Math.sqrt(Math.max(0.1, 1 - nx * nx * 0.62))) * depthScale * (0.88 + 0.12 * facing),
    scaleY: Math.max(0.45, Math.sqrt(Math.max(0.1, 1 - ny * ny * 0.52))) * depthScale,
    angleRad: Math.atan2(-ty, tx),
    visible: nz > -0.15,
  };
}

function drawEars(ctx: CanvasRenderingContext2D, earCanvas: HTMLCanvasElement, v: View, dpr: number, c: CatConfig, earPerk: number) {
  const size = v.size, backingPx = Math.round(size * dpr);
  if (earCanvas.width !== backingPx || earCanvas.height !== backingPx) {
    earCanvas.width = backingPx;
    earCanvas.height = backingPx;
  }
  const eCtx = earCanvas.getContext("2d");
  if (!eCtx) return;
  const earH = c.earStyle === "alongadas" ? 0.43 : c.earStyle === "compactas" ? 0.21 : c.earStyle === "arredondadas" ? 0.28 : 0.34;
  const tipRound = c.earStyle === "arredondadas" ? 0.34 : c.earStyle === "compactas" ? 0.27 : c.earStyle === "alongadas" ? 0.17 : 0.22;
  const w = c.bodyWidth, earScale = c.earScale;
  const lift = earPerk * 0.055;
  const tipY = 0.36 + earH * earScale + lift;
  const spreadX = 0.5 * w + (earScale - 1) * 0.07;
  const p = (lx: number, ly: number, lz: number) => project(lx, ly, lz, v);
  const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  for (const side of [-1, 1] as const) {
    const pOuterBase = p(side * 0.45 * w, 0.13, 0.03);
    const pOuterCtrl = p(side * (0.49 * w + (earScale - 1) * 0.04), 0.3 + earH * earScale * 0.4, -0.01);
    const pTip = p(side * spreadX, tipY, -0.04);
    const pInnerCtrl = p(side * 0.29 * w, 0.36 + earH * earScale * 0.34 + lift * 0.45, 0.06);
    const pInnerBase = p(side * 0.135 * w, 0.295 + lift * 0.2, 0.12);
    const pRootMid = p(side * 0.3 * w, 0.21, 0.1);
    const inOuter = lerpPt(pTip, pOuterCtrl, tipRound);
    const inInner = lerpPt(pTip, pInnerCtrl, tipRound);

    eCtx.save();
    eCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    eCtx.clearRect(0, 0, size, size);
    eCtx.globalCompositeOperation = "source-over";
    eCtx.beginPath();
    eCtx.moveTo(pOuterBase.x, pOuterBase.y);
    eCtx.quadraticCurveTo(pOuterCtrl.x, pOuterCtrl.y, inOuter.x, inOuter.y);
    eCtx.quadraticCurveTo(pTip.x, pTip.y, inInner.x, inInner.y);
    eCtx.quadraticCurveTo(pInnerCtrl.x, pInnerCtrl.y, pInnerBase.x, pInnerBase.y);
    eCtx.quadraticCurveTo(pRootMid.x, pRootMid.y, pOuterBase.x, pOuterBase.y);
    eCtx.closePath();
    eCtx.fillStyle = c.bodyColor;
    eCtx.shadowColor = c.bodyColor;
    eCtx.shadowBlur = Math.max(2.0, size * 0.014);
    eCtx.fill();
    eCtx.shadowBlur = 0;
    const pFadeStart = p(side * 0.3 * w, 0.32, 0.1);
    const pFadeEnd = p(side * 0.3 * w, 0.1, 0.12);
    eCtx.globalCompositeOperation = "destination-in";
    const fade = eCtx.createLinearGradient(pFadeStart.x, pFadeStart.y, pFadeEnd.x, pFadeEnd.y);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.58, "rgba(255,255,255,0.88)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    eCtx.fillStyle = fade;
    eCtx.fillRect(0, 0, size, size);
    eCtx.restore();
    ctx.drawImage(earCanvas, 0, 0, size, size);
  }
}

/** O rosto no `ctx` (já com `setTransform(dpr…)` e limpo), num quadrado de `size` px lógicos. */
export function drawCatFace(ctx: CanvasRenderingContext2D, earCanvas: HTMLCanvasElement, f: CatFrame, c: CatConfig, size: number, dpr: number): void {
  const pose = f.pose, s = f.state, emote = f.emote, audio = pose.audio ?? 0;
  const v: View = { yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll, ox: pose.headOffsetX, oy: pose.headOffsetY, size };
  drawEars(ctx, earCanvas, v, dpr, c, f.earPerk);

  const expFactor = c.eyeExpressiveness / 100;
  const eyeSpanX = 0.195 * c.eyeSpacing * c.bodyWidth;
  const eyeLocalY = 0.018 + f.gazeY * 0.02 * expFactor;
  const gazeShiftX = f.gazeX * 0.024 * expFactor;
  const surfaceZ = (lx: number, ly: number) => {
    const nx = lx / (0.56 * c.bodyWidth);
    const ny = (ly - 0.018) / 0.46;
    return 0.3 * Math.sqrt(Math.max(0.22, 1 - nx * nx - ny * ny)) + 0.14;
  };
  const lx = -eyeSpanX + gazeShiftX, rx = eyeSpanX + gazeShiftX;
  const left = projectFace(lx, eyeLocalY, surfaceZ(lx, eyeLocalY), v);
  const right = projectFace(rx, eyeLocalY, surfaceZ(rx, eyeLocalY), v);

  const baseEyeR = size * 0.032 * c.eyeScale * f.eyeScale;
  const openY = Math.max(0.08, f.eyeOpenY * (1 - f.blinkAmount * 0.92));
  const styleScaleX = c.eyeStyle === "ovalados" ? 0.82 : c.eyeStyle === "minimalistas" ? 0.72 : 1.0;
  const styleScaleY = c.eyeStyle === "ovalados" ? 1.18 : c.eyeStyle === "minimalistas" ? 0.72 : 1.0;
  const isHalfLid = c.showComicEmotes && (emote === "cansado" || emote === "pensando");
  const isAsymmetric = c.showComicEmotes && emote === "confuso";
  const alertScale = c.showComicEmotes && emote === "alerta" ? 1.22 : 1.0;
  const scanClosed = s === "dormindo" || emote === "dormindo" || f.blinkAmount > 0.62;
  const happyArc = (emote === "feliz" && c.showComicEmotes) ||
    (s === "respondendo" && emote !== "cansado" && emote !== "confuso" && emote !== "alerta" && emote !== "limite" && audio > 0.42 && expFactor > 0.35);

  const drawEye = (proj: ReturnType<typeof projectFace>, asym: number) => {
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
      ctx.lineCap = "round";
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
  drawEye(left, 1.0);
  drawEye(right, isAsymmetric ? 0.44 : 1.0);

  if (!c.showMascotDetails) return;
  const mouth = projectFace(0, -0.135, 0.48, v);
  if (!mouth.visible) return;
  ctx.save();
  ctx.translate(mouth.x, mouth.y);
  ctx.rotate(mouth.angleRad);
  ctx.scale(mouth.scaleX, mouth.scaleY);
  const mw = size * 0.036;
  if (s === "respondendo" && audio > 0.14) {
    ctx.fillStyle = c.accentColor;
    ctx.beginPath();
    ctx.ellipse(0, mw * 0.25, mw * (0.85 + audio * 0.65), mw * (0.28 + audio * 0.95), 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = c.eyeColor;
    ctx.lineWidth = Math.max(1.2, size * 0.011);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-mw, 0);
    ctx.quadraticCurveTo(-mw * 0.5, mw * 0.52, 0, 0);
    ctx.quadraticCurveTo(mw * 0.5, mw * 0.52, mw, 0);
    ctx.stroke();
  }
  ctx.restore();
}
