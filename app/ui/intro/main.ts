// Portado de docs/design/kiwicat-v2/intro/src/exportStandaloneHtml.ts (o script do build, no modo app), T14851,
// spec #14766. Mudanças: a névoa e o rosto vêm do renderizador comum (../kiwicat-v2/renderer.ts) e a pose da
// timeline tipada; o fim chama o `intro.done` do AppEngine; o Movimento da Aparência também vem do engine. Desde o
// T16769 (spec #16759), o fim é outro: sem a janela de mentira do pacote, a moldura vazia cresce até o lugar do hub.
//
// A janela `intro`: o KiwiCat condensa da névoa, ganha orelhas, olhos e aurora, sorri e some. Aí a moldura vazia
// cresce até o retângulo em que o hub vai aparecer (`intro.layout`), com os cantos e a cor de fundo dele, e o hub
// aparece ali, por cima. No fim (o último frame, o clique para pular ou a versão de 1,5 s do movimento reduzido, que
// não cresce), o main mostra o hub e fecha esta janela. `?t=2.4` congela o frame daquele instante (para os prints), e
// `?layout=` (o JSON do `intro.layout`) faz o papel do main nos testes headless.

import type {} from "../src/api.ts";
import type { IntroLayout } from "../../src/shared/intro-layout.ts";
import { startAppearance } from "../src/styles/appearance.ts";
import { startLocale, t } from "../src/i18n.ts";
import { drawFace, FogRenderer, INTRO_SHAPE } from "../kiwicat-v2/renderer.ts";
import { evaluateIntroPose, KIWI_INTRO_CONFIG as CFG, type IntroPose } from "../kiwicat-v2/timeline.ts";

const params = new URLSearchParams(location.search);
const frozenParam = params.get("t");
const frozenT = frozenParam !== null && !Number.isNaN(Number(frozenParam)) ? Math.max(0, Number(frozenParam)) : null;

const $ = <T extends Element>(id: string) => document.getElementById(id) as T | null;
const stage = $<HTMLElement>("stage")!;
const catWrap = $<HTMLElement>("cat-wrap")!;
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

/** Onde o hub vai aparecer, nas coordenadas desta janela: do main (`intro.layout`) ou do `?layout=` dos testes. */
let layout: IntroLayout | null = layoutFrom(params.get("layout"));

function layoutFrom(raw: string | null | unknown): IntroLayout | null {
  try {
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as IntroLayout | null;
    const nums = (...n: unknown[]) => n.every((x) => typeof x === "number" && Number.isFinite(x));
    if (!v || !v.target || !v.center || !v.box) return null;
    const { target: t, center: c, box: b } = v;
    return nums(t.x, t.y, t.width, t.height, c.x, c.y, b.width, b.height, v.radius) ? v : null;
  } catch {
    return null;
  }
}

function renderPose(pose: IntroPose): void {
  // O gato tem o tamanho que tinha na caixa de 720×480, mesmo com a janela maior (ela agora cobre o hub).
  const box = layout?.box ?? { width: innerWidth, height: innerHeight };
  const size = Math.max(180, Math.round(Math.min(box.width * 0.76, box.height * 0.76, 320)));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const px = Math.round(size * dpr);

  // Depois que o gato sai, a moldura vazia cresce do quadrado do meio até o retângulo do hub. No movimento reduzido,
  // ou sem o retângulo, ela não cresce: esmaece no lugar.
  const target = reduced ? null : layout?.target ?? null;
  const exp = target ? pose.windowExpand : 0;
  const cx0 = layout?.center.x ?? innerWidth / 2;
  const cy0 = layout?.center.y ?? innerHeight / 2;
  const w = target ? size + (target.width - size) * exp : size;
  const h = target ? size + (target.height - size) * exp : size;
  const cx = target ? cx0 + (target.x + target.width / 2 - cx0) * exp : cx0;
  const cy = target ? cy0 + (target.y + target.height / 2 - cy0) * exp : cy0;
  const r0 = size * 0.24;
  const r = target ? r0 + (layout!.radius - r0) * exp : r0;
  // A cor: do fundo do gato ao fundo do hub (o --bg do tema), enquanto a moldura vira a janela.
  const fill = target ? pose.windowChromeOpacity : 0;
  const fade = target ? 1 : 1 - pose.windowChromeOpacity;

  stage.style.left = (cx - w / 2).toFixed(1) + "px";
  stage.style.top = (cy - h / 2).toFixed(1) + "px";
  stage.style.width = w.toFixed(1) + "px";
  stage.style.height = h.toFixed(1) + "px";
  stage.style.borderRadius = r.toFixed(1) + "px";
  stage.style.opacity = (pose.stageOpacity * fade).toFixed(3);
  stage.style.transform = "scale(" + pose.stageScale.toFixed(4) + ")";
  stage.style.background = fill > 0 ? `color-mix(in srgb, var(--bg, #090A0E) ${(fill * 100).toFixed(1)}%, #090A0E)` : "";
  stage.style.setProperty("--ring", (0.08 * (1 - fill)).toFixed(3));

  catWrap.style.width = size + "px";
  catWrap.style.height = size + "px";
  catWrap.style.opacity = pose.mascotOpacity.toFixed(3);

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
// O tema do app (o --bg do hub), para a moldura terminar na cor dele.
void startAppearance();
// A língua do app (spec #28171): o rótulo do palco para o VoiceOver. A cópia local já vale na hora; o engine confirma.
stage.setAttribute("aria-label", t("intro.aria"));
void startLocale().then(() => stage.setAttribute("aria-label", t("intro.aria")));

if (frozenT !== null) {
  renderPose(evaluateIntroPose(frozenT, reduced, null));
} else {
  // No app, pergunta antes ao engine pelo Movimento e pelo lugar do hub (no máximo 300 ms: a intro nunca espera mais
  // que isso; sem o lugar, a moldura não cresce).
  const asks: Promise<unknown>[] = [];
  if (engine?.has("settings.get")) {
    asks.push(engine.invoke("settings.get", {}).then(
      (s) => { if ((s as { appearance?: { motion?: string } } | null)?.appearance?.motion === "reduced") reduced = true; },
      () => {},
    ));
  }
  if (engine?.has("intro.layout")) {
    asks.push(engine.invoke("intro.layout", {}).then((l) => { layout = layoutFrom(l) ?? layout; }, () => {}));
  }
  const prefs = asks.length ? Promise.race([Promise.all(asks), new Promise((r) => setTimeout(r, 300))]) : Promise.resolve();
  renderPose(evaluateIntroPose(0, reduced, null));
  void prefs.then(() => {
    playing = true;
    startMs = performance.now();
    requestAnimationFrame(tick);
  });
}
