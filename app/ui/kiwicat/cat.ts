// O gato do agente no hub, no overlay, em Ajustes e no onboarding (T14885, spec #14813). O desenho é o do pacote
// (`docs/design/kiwicat-v2/agente/`): a névoa no renderizador WebGL2 de `ui/kiwicat-v2/renderer.ts` (`CAT_SHAPE`), o rosto
// Flat-3D e os emotes em SVG, nas mesmas camadas do `ByteKiwiCat` (a névoa com a máscara radial; o rosto e os emotes por
// cima). A API é a do gato de antes, para quem o usa não mudar.
//
// - **O estado:** os 8 de hoje entram pelo `update({ estado })` e viram estado + emote pela tabela 1.1 (`catLook`); os
//   tempos (o `pronto` que volta, o sono, o `acordou`) são os do `CatVisual`.
// - **O ritmo:** parado (`repouso`, `dormindo`) a `quietFPS` (18); trabalhando, a cada quadro do navegador, ou a
//   `activeFPS` (o overlay passa 30). Escondido, nada desenha. Parado com a janela fora de foco, ou em foco e sem
//   mouse nem tecla há 20 s, também não: o último quadro fica (o descanso, `pauseUnfocused`, spec #24228). Com reduzir movimento (o do macOS ou o `parado` do app),
//   um quadro só, parado, e um novo a cada troca de estado.
// - **Sem WebGL2** (ou `backend: "none"`), a névoa vira o gradiente do pacote, e o rosto e os emotes seguem iguais.

import { catPalette } from "../../src/shared/kiwicat-colors";
import { CAT_CONFIG, type CatConfig, type KiwiState } from "../kiwicat-v2/cat-config";
import { drawCatFace } from "../kiwicat-v2/cat-face";
import { emoteSvg } from "../kiwicat-v2/cat-emotes";
import { CatMotion, seededRandom, type CatFrame } from "../kiwicat-v2/cat-motion";
import { CAT_SHAPE, FogRenderer, type KiwiLook } from "../kiwicat-v2/renderer";
import { CatVisual, type FogState, SlowGuard } from "./visual";
import type { CatLook } from "../hub/cat-state";

export type { FogState } from "./visual";
export type SymbolBackground = "light" | "dark";

export interface FogInputs {
  estado: FogState;
  /** A voz de 0 a 1 (o Control); `null` sem voz. */
  voz?: number | null;
  /**
   * A fala do gato (T26829): o nível do que a voz dele tocou, de 0 a 1 (o `nivel` do `FalaPlayer`). Com um número, o
   * gato mostra o `respondendo` com a boca e o corpo nesse nível; `null` volta ao estado que ele tem agora (o `estado`
   * segue correndo por baixo: o `pronto`, o erro e o sono).
   */
  fala?: number | null;
  /**
   * A paleta (spec #14963): o id de uma das 5 (`kiwi-neon`…); outra coisa desenha a `prisma-original`. Dela o gato lê os
   * `prismStops` (a névoa e o anel), o `accentColor` (os detalhes) e o `eyeColor` (os olhos); o resto é o `CAT_CONFIG`.
   */
  cor: string;
  parado: boolean;
  /** O `erro` é o limite de uso: o emote vira o `limite`. */
  limite?: boolean;
}

export interface CatOptions {
  /** `capture`: sem relógio, só o `capture(segundos)` desenha (as provas). `measure`: guarda os intervalos. */
  mode?: "runtime" | "capture" | "measure";
  backend?: "auto" | "webgl2" | "none";
  /** A caixa do gato (px). O gato é quadrado: o lado é o menor dos dois, centrado embaixo. */
  width?: number;
  height?: number;
  /** Aceito pelos hosts de antes; o gato novo é sempre recortado. */
  cutout?: boolean;
  /** O ritmo trabalhando (fps); sem ele, o do navegador. */
  activeFPS?: number;
  /** O ritmo parado (fps), 15 a 20 pelo spec. */
  quietFPS?: number;
  /**
   * O descanso (spec #24228): parado (`repouso`, `dormindo`) com a janela fora de foco, ou em foco e sem mouse nem
   * tecla nela há `restAfter` segundos, nada desenha. O último quadro fica, e só a troca de estado (o sono) desenha um
   * novo; o foco, o mouse ou uma tecla na janela o acordam. A 18 fps, dois gatos parados (o hub e os Ajustes) gastavam
   * 16% de CPU no WebKit (o webview e a GPU). O padrão é `true`; o overlay passa `false`, porque o painel dele nunca tem
   * o foco e ele some quando o agente acaba.
   */
  pauseUnfocused?: boolean;
  /** Em foco, quantos segundos sem mouse nem tecla até o descanso (o padrão é `REST_AFTER_S`). */
  restAfter?: number;
  /** A resolução da névoa (0 a 1) sobre a do pacote. */
  densityScale?: number;
  background?: SymbolBackground;
  inputs?: Partial<FogInputs>;
  random?: () => number;
  /** A semente da piscada e do sono (as provas usam a mesma do pacote). */
  seed?: number;
  sleepSeconds?: () => number;
  instrument?: boolean;
  /** Só para a prova "igual ao pacote" (T14899): o estado e o emote do pacote direto, sem passar pela tabela 1.1. */
  look?: CatLook;
}

export interface CatStats {
  /** Quantos quadros saíram. */
  frames: number;
  hidden: boolean;
  reduced: boolean;
  /** Parado e fora de foco: o último quadro, sem desenhar (`pauseUnfocused`). */
  resting: boolean;
  activeIntervals: Array<{ state: FogState; seconds: number }>;
}

export const QUIET_FPS = 18;
/** Em foco e sem ninguém mexer, o gato respira por este tempo antes de descansar (s). */
export const REST_AFTER_S = 20;
/** No descanso, uma troca de estado (o sono, o `pronto` que volta) anima por este tempo e descansa de novo (s). */
export const REST_WAKE_S = 2.5;

/**
 * O `CAT_CONFIG` com as cores da paleta (spec #14963): os `prismStops`, o `accentColor` e o `eyeColor`. A entrada é o id;
 * qualquer outra coisa (um hex, inclusive) desenha a `prisma-original`.
 */
export function catConfigFor(cor: unknown): CatConfig {
  const p = catPalette(cor);
  return { ...CAT_CONFIG, prismStops: p.prismStops, accentColor: p.accentColor, eyeColor: p.eyeColor };
}
/** O passo da conta do movimento (s): o do pacote, a 60 fps. */
const STEP = 1 / 60;

const quietState = (s: KiwiState) => s === "repouso" || s === "dormindo";

/**
 * Um contexto WebGL2 só por janela, para todos os gatos dela (T14885). O WebKit tem um teto de contextos ativos e só
 * libera a vaga de um contexto no GC, mesmo com o `loseContext`: passado o teto, ele derruba o mais antigo, que pode ser
 * o do gato na tela. O `draw` é síncrono e cada gato copia o resultado para o canvas 2D dele, então dividir é seguro.
 * O último gato a sair solta o contexto.
 */
let sharedFog: { renderer: FogRenderer; users: number } | null = null;
function acquireFog(): FogRenderer {
  sharedFog ??= { renderer: new FogRenderer(CAT_SHAPE), users: 0 };
  sharedFog.users++;
  return sharedFog.renderer;
}
function releaseFog() {
  if (!sharedFog || --sharedFog.users > 0) return;
  sharedFog.renderer.dispose();
  sharedFog = null;
}

/** Um nível de 0 a 1; outra coisa (`null`, NaN) é sem som. */
function level(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

export async function createKiwiCat(root: HTMLElement, options: CatOptions) {
  const width = options.width ?? 240, height = options.height ?? 240;
  const size = Math.max(24, Math.min(width, height));
  const quietFPS = options.quietFPS ?? QUIET_FPS;
  const random = options.random ?? seededRandom(options.seed ?? 17);
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const inputs: FogInputs = { estado: "repouso", voz: null, cor: "padrao", parado: false, ...options.inputs };
  let background: SymbolBackground = options.background ?? "light";
  let elapsed = 0, previousStamp = performance.now(), previousFrame = -Infinity, disposed = false;
  let frameId = 0, timerId = 0, lastDraw = -Infinity;
  const guard = new SlowGuard();
  /** O quadro parado: o reduzir movimento, ou a GPU lenta (`SlowGuard`). */
  const stillMode = () => inputs.parado || media.matches || guard.slow;
  const stats: CatStats = { frames: 0, hidden: document.hidden, reduced: stillMode(), resting: false, activeIntervals: [] };
  /** A janela tem o foco, e quando veio o último mouse ou tecla nela (o descanso, `pauseUnfocused`). */
  let focused = document.hasFocus();
  let lastInput = performance.now();
  /** Até quando uma troca de estado anima, mesmo no descanso. */
  let awakeUntil = 0;
  /** A fala do gato (T26829): o look `respondendo` enquanto a voz toca, por cima do estado. */
  const FALANDO: CatLook = { estado: "respondendo", emote: "auto" };
  const falando = () => typeof inputs.fala === "number" && Number.isFinite(inputs.fala);
  const lookNow = (): CatLook => options.look ?? (falando() ? FALANDO : visual.look);
  const visual = new CatVisual(inputs.estado, 0, { random, sleepSeconds: options.sleepSeconds });
  visual.update(inputs.estado, 0, inputs.limite);
  let motion = new CatMotion(lookNow().estado, random);
  let frame: CatFrame = motion.step(0, catInput());

  // As camadas do `ByteKiwiCat`.
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;left:50%;bottom:0;width:${size}px;height:${size}px;transform:translateX(-50%);` +
    "pointer-events:none;user-select:none";
  const fogLayer = document.createElement("div");
  const mask = "radial-gradient(circle at 50% 53%, rgba(0,0,0,1) var(--fog-core, 43%), rgba(0,0,0,0.84) var(--fog-mid, 67%), " +
    "rgba(0,0,0,0.28) var(--fog-mist, 85%), transparent var(--fog-edge, 96%))";
  fogLayer.style.cssText = `position:absolute;inset:0;z-index:1;pointer-events:none;mask-image:${mask};-webkit-mask-image:${mask}`;
  fogLayer.setAttribute("aria-hidden", "true");
  const fogCanvas = document.createElement("canvas");
  const faceLayer = document.createElement("div");
  faceLayer.style.cssText = "position:absolute;inset:0;z-index:10;pointer-events:none";
  const faceCanvas = document.createElement("canvas");
  for (const c of [fogCanvas, faceCanvas]) c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.style.cssText = "position:relative;z-index:10;overflow:visible;display:block;pointer-events:none";
  const emoteGroup = document.createElementNS(svgNS, "g");
  emoteGroup.style.transformOrigin = "120px 120px";
  svg.append(emoteGroup);
  fogLayer.append(fogCanvas);
  faceLayer.append(faceCanvas, svg);
  box.append(fogLayer, faceLayer);
  root.replaceChildren(box);
  root.style.position = root.style.position || "relative";
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.isolation = "isolate";

  const renderer = options.backend === "none" ? null : acquireFog();
  const earCanvas = document.createElement("canvas");
  const fogStats: { backend: "webgl2" | "none"; slow: boolean } = { backend: renderer ? "webgl2" : "none", slow: false };
  let emoteKey = "";

  function catInput() {
    const look = lookNow();
    const voz = falando() ? level(inputs.fala) : level(inputs.voz);
    return { state: look.estado, emote: look.emote, audio: voz };
  }

  /** A config da paleta de agora. Trocar a paleta vale no quadro seguinte. */
  let configFor = "", configNow: CatConfig = CAT_CONFIG;
  function config(): CatConfig {
    if (inputs.cor !== configFor) { configFor = inputs.cor; configNow = catConfigFor(inputs.cor); }
    return configNow;
  }

  function lookFor(): KiwiLook {
    const c = config();
    return {
      bodyColor: c.bodyColor, accentColor: c.accentColor, eyeColor: c.eyeColor, prismStops: c.prismStops,
      mistBaseColor: c.mistBaseColor, prismSpread: c.prismSpread, bodyWidth: c.bodyWidth, earScale: c.earScale,
      eyeScale: c.eyeScale, eyeSpacing: c.eyeSpacing, showMascotDetails: c.showMascotDetails, auraStyleIndex: c.auraStyle,
      showMist: c.showAmbientMist, isLight: background === "light",
    };
  }

  function paint(f: CatFrame) {
    if (disposed || stats.hidden) return;
    stats.frames++;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingPx = Math.round(size * dpr);
    fogLayer.style.opacity = f.fogOpacity.toFixed(3);
    fogLayer.style.setProperty("--fog-core", `${f.fogCore.toFixed(1)}%`);
    fogLayer.style.setProperty("--fog-mid", `${f.fogMid.toFixed(1)}%`);
    fogLayer.style.setProperty("--fog-mist", `${f.fogMist.toFixed(1)}%`);
    fogLayer.style.setProperty("--fog-edge", `${f.fogEdge.toFixed(1)}%`);
    for (const c of [fogCanvas, faceCanvas]) if (c.width !== backingPx || c.height !== backingPx) { c.width = backingPx; c.height = backingPx; }
    const fctx = fogCanvas.getContext("2d");
    if (fctx) {
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.clearRect(0, 0, size, size);
      const gpx = Math.max(96, Math.min(560, Math.round(backingPx * (options.densityScale ?? 1))));
      const gl = renderer?.draw(f.pose, lookFor(), gpx) ?? null;
      if (gl) fctx.drawImage(gl, 0, 0, size, size);
      else {
        // O desenho sem WebGL2 do pacote.
        fogStats.backend = "none";
        const c = config(), p = f.pose;
        const cx = size * (0.5 + p.headOffsetX * 0.4 + p.lagX * 0.15);
        const cy = size * (0.54 - p.headOffsetY * 0.4 - p.lagY * 0.15);
        const r = size * 0.25;
        fctx.save();
        fctx.translate(cx, cy);
        const grad = fctx.createRadialGradient(r * 0.2, r * 0.25, r * 0.25, 0, 0, r * 1.45);
        grad.addColorStop(0, c.bodyColor);
        grad.addColorStop(0.62, c.bodyColor);
        grad.addColorStop(0.82, c.prismStops[2]);
        grad.addColorStop(0.93, c.prismStops[0]);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        fctx.fillStyle = grad;
        fctx.beginPath();
        fctx.arc(0, 0, r * 1.38, 0, Math.PI * 2);
        fctx.fill();
        fctx.restore();
      }
    }
    const ctx = faceCanvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawCatFace(ctx, earCanvas, f, config(), size, dpr);
    }
    const key = `${f.emote}|${background}`;
    if (key !== emoteKey) { emoteKey = key; emoteGroup.innerHTML = CAT_CONFIG.showComicEmotes ? emoteSvg(f.emote, background === "light") : ""; }
    emoteGroup.setAttribute("transform", `translate(${f.emoteX.toFixed(2)}, ${f.emoteY.toFixed(2)}) scale(${f.emoteScale.toFixed(4)})`);
    root.dataset.estado = f.state;
    root.dataset.emote = f.emote;
    root.dataset.falando = String(falando());
  }

  /** O quadro parado do reduzir movimento: o gato já assentado no estado, sem piscar. */
  function still(): CatFrame {
    const m = new CatMotion(lookNow().estado, () => 0.5);
    let f = m.step(0, catInput());
    for (let i = 0; i < 40; i++) f = m.step(0.05, catInput());
    return f;
  }

  /** Leva o relógio até `t` (s), o estado e o movimento juntos, em passos de 60 fps. */
  function advanceTo(t: number) {
    const from = elapsed;
    elapsed = Math.max(elapsed, t);
    visual.sample(elapsed);
    let left = Math.min(elapsed - from, 0.5);
    while (left > 1e-9) {
      const dt = Math.min(STEP, left);
      frame = motion.step(dt, catInput());
      left -= dt;
    }
  }

  function tick(stamp: number) {
    const dt = Math.max(0, (stamp - previousStamp) / 1000);
    previousStamp = stamp;
    advanceTo(elapsed + dt);
  }

  function cancel() {
    if (frameId) cancelAnimationFrame(frameId);
    if (timerId) clearTimeout(timerId);
    frameId = timerId = 0;
  }

  function interval() {
    if (quietState(lookNow().estado)) return 1 / quietFPS;
    return options.activeFPS ? 1 / options.activeFPS : 0;
  }

  function draw(stamp: number) {
    frameId = 0;
    if (disposed || stats.hidden || stats.reduced) return;
    tick(stamp);
    paint(frame);
    lastDraw = elapsed;
    if ((options.instrument ?? options.mode === "measure") && previousFrame !== -Infinity) {
      stats.activeIntervals.push({ state: visual.state, seconds: elapsed - previousFrame });
      if (stats.activeIntervals.length > 10000) stats.activeIntervals.shift();
    }
    previousFrame = elapsed;
    if (quietState(lookNow().estado)) guard.reset();
    else if (guard.observe(elapsed)) { slowed(); return; }
    schedule();
  }

  /** A GPU não deu 24 fps: daqui em diante, um quadro parado por estado. */
  function slowed() {
    fogStats.slow = true;
    stats.reduced = true;
    restart();
  }

  function schedule() {
    if (disposed || stats.hidden || options.mode === "capture") return;
    if (stats.reduced) {
      // Um quadro só; o estado segue no tempo (o `pronto` volta, o gato dorme), e cada troca é um quadro novo.
      const due = visual.nextBoundary();
      if (!Number.isFinite(due)) return;
      timerId = window.setTimeout(() => {
        timerId = 0;
        syncClock();
        visual.sample(elapsed);
        paint(still());
        schedule();
      }, Math.ceil(Math.max(0, due - elapsed) * 1000) + 1);
      return;
    }
    stats.resting = options.pauseUnfocused !== false && quietState(lookNow().estado)
      && performance.now() > awakeUntil
      && (!focused || performance.now() - lastInput > (options.restAfter ?? REST_AFTER_S) * 1000);
    if (stats.resting) {
      // O último quadro fica; a troca de estado que vem sozinha (o sono) anima `REST_WAKE_S` no tempo dela.
      const due = visual.nextBoundary();
      if (!Number.isFinite(due)) return;
      timerId = window.setTimeout(() => {
        timerId = 0;
        awakeUntil = performance.now() + REST_WAKE_S * 1000;
        wake();
      }, Math.ceil(Math.max(0, due - elapsed) * 1000) + 1);
      return;
    }
    const gap = interval();
    if (gap <= 0) { frameId = requestAnimationFrame(draw); return; }
    const wait = Math.max(0, lastDraw + gap - elapsed - (performance.now() - previousStamp) / 1000);
    timerId = window.setTimeout(() => { timerId = 0; frameId = requestAnimationFrame(draw); }, Math.max(0, Math.round(wait * 1000) - 2));
  }

  /** O relógio sem desenhar (o reduzido e as trocas de estado). */
  function syncClock() {
    const now = performance.now();
    if (options.mode !== "capture" && !stats.hidden) {
      const dt = Math.max(0, (now - previousStamp) / 1000);
      if (stats.reduced) { elapsed += dt; visual.sample(elapsed); } else advanceTo(elapsed + dt);
    }
    previousStamp = now;
  }

  function restart() {
    cancel();
    previousFrame = -Infinity;
    guard.reset();
    if (options.mode === "capture") return;
    paint(stats.reduced ? still() : frame);
    lastDraw = elapsed;
    schedule();
  }

  function visibility(hidden: boolean) {
    if (hidden === stats.hidden) return;
    syncClock();
    stats.hidden = hidden;
    cancel();
    if (!hidden) { previousStamp = performance.now(); restart(); }
  }

  function reducedChanged() {
    syncClock();
    stats.reduced = stillMode();
    restart();
  }

  /** Do descanso de volta: o gato respira de novo na hora. Saindo, o laço para sozinho no próximo `schedule`. */
  function wake() {
    if (!stats.resting || stats.hidden || disposed) return;
    syncClock();
    cancel();
    previousStamp = performance.now();
    restart();
  }
  const onFocus = () => { focused = true; lastInput = performance.now(); wake(); };
  const onBlur = () => { focused = false; };
  const onInput = () => { lastInput = performance.now(); wake(); };
  const INPUTS = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  for (const e of INPUTS) window.addEventListener(e, onInput, { passive: true, capture: true });
  const onVisibility = () => visibility(document.hidden);
  const onReduced = () => reducedChanged();
  document.addEventListener("visibilitychange", onVisibility);
  media.addEventListener("change", onReduced);
  previousStamp = performance.now();
  if (options.mode === "capture") paint(frame);
  else restart();

  return {
    stats,
    fogStats,
    setBackground(value: SymbolBackground) {
      if (disposed || value === background) return;
      background = value;
      // Parado (reduzir movimento, a prova, o descanso), o laço não pinta: um quadro agora, na tinta nova.
      if (!stats.hidden && (stats.reduced || stats.resting || options.mode === "capture")) paint(stats.reduced ? still() : frame);
    },
    /** O estado de hoje que o gato mostra agora (dos 8). */
    get visualState(): FogState { return visual.state; },
    /** Se a voz do gato está tocando (T26829). */
    get falando(): boolean { return falando(); },
    get frame(): CatFrame { return frame; },
    update(input: Partial<FogInputs>) {
      if (disposed) return;
      syncClock();
      const before = visual.state, wasReduced = stats.reduced, corBefore = inputs.cor, falaBefore = falando();
      if (input.voz !== undefined) inputs.voz = input.voz;
      if (input.fala !== undefined) inputs.fala = input.fala;
      if (input.cor !== undefined) inputs.cor = input.cor;
      if (input.parado !== undefined) inputs.parado = input.parado;
      if (input.limite !== undefined) inputs.limite = input.limite;
      if (input.estado !== undefined) {
        inputs.estado = input.estado;
        visual.update(input.estado, elapsed, input.limite ?? inputs.limite ?? false);
      }
      stats.reduced = stillMode();
      const lookChanged = before !== visual.state || falaBefore !== falando();
      if (lookChanged) awakeUntil = performance.now() + REST_WAKE_S * 1000;
      if (lookChanged || wasReduced !== stats.reduced) { if (stats.resting) previousStamp = performance.now(); restart(); }
      // A paleta nova: animando, sai no próximo quadro; parado (reduzir movimento, a prova, o descanso), um quadro agora.
      else if (inputs.cor !== corBefore && !stats.hidden && (stats.reduced || stats.resting || options.mode === "capture")) paint(stats.reduced ? still() : frame);
    },
    /** Só no `mode: "capture"`: leva o gato até `seconds` e desenha. */
    capture(seconds: number) {
      if (disposed || stats.hidden || options.mode !== "capture" || !Number.isFinite(seconds)) return;
      if (stats.reduced) { elapsed = Math.max(elapsed, seconds); visual.sample(elapsed); paint(still()); return; }
      while (elapsed < seconds - 1e-9) advanceTo(Math.min(seconds, elapsed + 0.5));
      paint(frame);
    },
    visibility,
    /** Aceito pelos hosts de antes. A guarda da GPU lenta mede o próprio gato ao desenhar (`SlowGuard`), sem o host. */
    observeCadence(_seconds: number) {},
    /** Para as provas: um motor novo com a mesma semente, como o pacote ao montar. */
    reseed(seed: number) { motion = new CatMotion(lookNow().estado, seededRandom(seed)); frame = motion.step(0, catInput()); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      for (const e of INPUTS) window.removeEventListener(e, onInput, { capture: true });
      media.removeEventListener("change", onReduced);
      if (renderer) releaseFog();
      root.replaceChildren();
    },
  };
}
