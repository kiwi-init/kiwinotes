// Portado de docs/design/kiwicat-v2/intro/src/exportStandaloneHtml.ts (o script do build, no modo app), T14851,
// spec #14766. Mudanças: a névoa e o rosto vêm do renderizador comum (../kiwicat-v2/renderer.ts) e a pose da
// timeline tipada; o fim chama o `intro.done` do AppEngine; o Movimento da Aparência também vem do engine.
//
// A janela `intro`: o KiwiCat condensa da névoa, ganha orelhas, olhos e aurora, sorri, some, e o quadro vira a
// janela. No fim (o último frame, o clique para pular ou a versão de 1,5 s do movimento reduzido), o main fecha a
// janela e abre o hub. `?t=2.4` congela o frame daquele instante (para os prints).

import type {} from "../src/api.ts";
import { drawFace, FogRenderer, INTRO_SHAPE } from "../kiwicat-v2/renderer.ts";
import { evaluateIntroPose, KIWI_INTRO_CONFIG as CFG, type IntroPose } from "../kiwicat-v2/timeline.ts";

const params = new URLSearchParams(location.search);
const frozenParam = params.get("t");
const frozenT = frozenParam !== null && !Number.isNaN(Number(frozenParam)) ? Math.max(0, Number(frozenParam)) : null;

const $ = <T extends Element>(id: string) => document.getElementById(id) as T | null;
const stage = $<HTMLElement>("stage")!;
const catWrap = $<HTMLElement>("cat-wrap")!;
const appWin = $<HTMLElement>("app-win");
const awBody = $<HTMLElement>("aw-body");
const fogLayer = $<HTMLElement>("fog-layer")!;
const fogCanvas = $<HTMLCanvasElement>("fog-canvas")!;
const faceCanvas = $<HTMLCanvasElement>("face-canvas")!;
const sparkles = $<SVGGElement>("sparkles")!;
const earCanvas = document.createElement("canvas");
const fog = new FogRenderer(INTRO_SHAPE);

// O "Reduzir movimento" do macOS, ou o Movimento "Reduzido" da Aparência do app: a cópia que as janelas guardam, na
// hora, e o valor do engine antes de a intro começar.
let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
try {
  if (JSON.parse(localStorage.getItem("kn-appearance") || "null")?.motion === "reduced") reduced = true;
} catch {}

function renderPose(pose: IntroPose): void {
  const size = Math.max(180, Math.round(Math.min(innerWidth * 0.76, innerHeight * 0.76, 320)));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const px = Math.round(size * dpr);

  const exp = pose.windowExpand;
  const targetW = Math.min(innerWidth * 0.92, 640);
  const targetH = Math.min(innerHeight * 0.8, 370);
  const w = size + (targetW - size) * exp;
  const h = size + (targetH - size) * exp;
  const r = size * 0.24 + (16 - size * 0.24) * exp;

  stage.style.width = w.toFixed(1) + "px";
  stage.style.height = h.toFixed(1) + "px";
  stage.style.borderRadius = r.toFixed(1) + "px";
  stage.style.opacity = pose.stageOpacity.toFixed(3);
  stage.style.transform = "scale(" + pose.stageScale.toFixed(4) + ")";

  catWrap.style.width = size + "px";
  catWrap.style.height = size + "px";
  catWrap.style.opacity = pose.mascotOpacity.toFixed(3);

  if (appWin) {
    appWin.style.opacity = pose.windowChromeOpacity.toFixed(3);
    if (awBody) {
      awBody.style.opacity = pose.appContentOpacity.toFixed(3);
      awBody.style.transform = "translateY(" + ((1 - pose.appContentOpacity) * 10).toFixed(1) + "px)";
    }
  }

  if (pose.mascotOpacity <= 0.004) return;

  fogLayer.style.opacity = pose.fogOpacity.toFixed(3);
  fogLayer.style.setProperty("--fog-core", pose.fogCore.toFixed(1) + "%");
  fogLayer.style.setProperty("--fog-mid", pose.fogMid.toFixed(1) + "%");
  fogLayer.style.setProperty("--fog-mist", pose.fogMist.toFixed(1) + "%");
  fogLayer.style.setProperty("--fog-edge", pose.fogEdge.toFixed(1) + "%");

  if (fogCanvas.width !== px || fogCanvas.height !== px) { fogCanvas.width = px; fogCanvas.height = px; }
  const fCtx = fogCanvas.getContext("2d")!;
  fCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fCtx.clearRect(0, 0, size, size);
  const gl = fog.draw({ ...pose, audio: pose.happyArc * 0.35 }, CFG, Math.max(96, Math.min(560, px)));
  if (gl) fCtx.drawImage(gl, 0, 0, size, size);

  if (faceCanvas.width !== px || faceCanvas.height !== px) { faceCanvas.width = px; faceCanvas.height = px; }
  const ctx = faceCanvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drawFace(ctx, earCanvas, pose, CFG, size, dpr);

  sparkles.setAttribute("opacity", pose.sparkleOpacity.toFixed(3));
  sparkles.setAttribute("transform", "translate(120 120) scale(" + pose.sparkleScale.toFixed(3) + ") rotate(" + pose.sparkleRotationDeg.toFixed(2) + ") translate(-120 -120)");
}

let startMs = performance.now();
let skipAt: number | null = null;
let finished = false;
let playing = false;

// O fim: uma vez só, do último frame, do clique ou da versão reduzida.
function notifyDone(): void {
  if (finished) return;
  finished = true;
  document.body.classList.add("done");
  window.engine?.invoke("intro.done", {}).catch(() => {});
}

function tick(now: number): void {
  const pose = evaluateIntroPose((now - startMs) * 0.001, reduced, skipAt);
  renderPose(pose);
  if (pose.done) { notifyDone(); return; }
  requestAnimationFrame(tick);
}

stage.addEventListener("click", () => {
  if (frozenT !== null || finished || skipAt !== null || !playing) return;
  skipAt = (performance.now() - startMs) * 0.001;
});

// No app: a UI subiu (o AppEngine conta o boot como bom; sem isso, em 5 s ele volta para a UI anterior).
const engine = window.engine;
engine?.ready();

if (frozenT !== null) {
  renderPose(evaluateIntroPose(frozenT, reduced, null));
} else {
  // No app, pergunta antes ao engine pelo Movimento (no máximo 300 ms: a intro nunca espera mais que isso).
  const prefs = engine?.has("settings.get")
    ? Promise.race([
        engine.invoke("settings.get", {}).then(
          (s) => { if ((s as { appearance?: { motion?: string } } | null)?.appearance?.motion === "reduced") reduced = true; },
          () => {},
        ),
        new Promise((r) => setTimeout(r, 300)),
      ])
    : Promise.resolve();
  renderPose(evaluateIntroPose(0, reduced, null));
  void prefs.then(() => {
    playing = true;
    startMs = performance.now();
    requestAnimationFrame(tick);
  });
}
