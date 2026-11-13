// T8959: one public module; independent vector gestures over the frozen B1 fog.
import { createKiwiFog, type FogOptions } from "./index";
import { GestureMachine, seededRandom, type CatFrame } from "./gestures";
import { createVectorLayer } from "./vectors";
import type { FogInputs, FogState } from "./state";
import type { SymbolBackground } from "./symbols";
export interface CatOptions extends FogOptions {
  random?: () => number;
  sleepSeconds?: () => number;
  /** Legacy option accepted for existing hosts; symbols no longer use a backing. */
  outline?: boolean;
  /** Host background, independent of fog colour and gesture inputs. */
  background?: SymbolBackground;
}
export interface CatStats {
  faceUpdates: number; quietPlans: number; hidden: boolean; reduced: boolean;
  activeIntervals: Array<{ state: FogState; seconds: number }>;
}
export async function createKiwiCat(root: HTMLElement, options: CatOptions) {
  const width = options.width ?? 640, height = options.height ?? 800;
  let elapsed = 0, previousStamp = performance.now(), disposed = false;
  let frameId = 0, timerId = 0, previousFrame = -Infinity;
  let requestedReduced = options.inputs?.parado ?? false;
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const stats: CatStats = { faceUpdates: 0, quietPlans: 0, hidden: document.hidden,
    reduced: requestedReduced || media.matches, activeIntervals: [] };
  const machine = new GestureMachine({ ...options.inputs, parado: stats.reduced }, {
    clock: () => elapsed, random: options.random ?? seededRandom((options.seed ?? 17) + 101),
    sleepSeconds: options.sleepSeconds,
  });
  const fogRoot = document.createElement("div"); root.replaceChildren(fogRoot);
  root.style.cssText = `position:relative;width:${width}px;height:${height}px;isolation:isolate`;
  fogRoot.style.cssText = "position:relative;z-index:1";
  const vectors = createVectorLayer(root, width, height, options.background);
  (root.lastElementChild as HTMLElement).style.zIndex = "2";
  if (vectors.apply(machine.sample())) stats.faceUpdates++;
  const fog = await createKiwiFog(fogRoot, { ...options, eyes: "hidden",
    inputs: { ...options.inputs, estado: machine.visualState, parado: stats.reduced } });
  previousStamp = performance.now();
  let fogState = machine.visualState;
  function advance(stamp = performance.now()) {
    if (options.mode !== "capture" && !stats.hidden) elapsed += Math.max(0, (stamp - previousStamp) / 1000);
    previousStamp = stamp;
  }
  function quiet() { return machine.visualState === "repouso" || machine.visualState === "dormindo"; }
  function cancel() {
    if (frameId) cancelAnimationFrame(frameId);
    if (timerId) clearTimeout(timerId);
    frameId = timerId = 0;
    vectors.stop();
  }
  function syncFog(frame: CatFrame) {
    if (fogState !== frame.state) { fogState = frame.state; fog.update({ estado: frame.state }); }
  }
  function paint(frame: CatFrame) {
    if (disposed || stats.hidden) return;
    if (vectors.apply(frame)) stats.faceUpdates++;
  }
  function freezeIfSlow() {
    if (!fog.stats.slow || stats.reduced) return;
    stats.reduced = true; machine.update({ parado: true }); fog.update({ parado: true });
    cancel(); paint(machine.project(elapsed));
  }
  function schedule() {
    if (disposed || stats.hidden || options.mode === "capture") return;
    if (stats.reduced) {
      // Reduzir movimento (#434): sem quadros nem gestos, mas o estado segue (o pronto volta ao repouso, o gato dorme).
      // Um timer só até a próxima troca de estado, que já entra no quadro parado.
      const boundary = machine.nextBoundary();
      if (!Number.isFinite(boundary)) return;
      timerId = window.setTimeout(() => {
        timerId = 0; advance();
        const frame = machine.sample(); syncFog(frame); paint(frame); schedule();
      }, Math.ceil(Math.max(0, boundary - elapsed) * 1000) + 1);
      return;
    }
    if (!quiet()) { frameId = requestAnimationFrame(active); return; }
    const boundary = machine.nextWake();
    if (!Number.isFinite(boundary)) return;
    const duration = Math.max(0, boundary - elapsed);
    if (machine.moving && duration > 0) {
      const count = Math.max(2, Math.floor(duration * 30) + 1);
      // Projection is read-only: no future RNG draws or scheduler events.
      const frames = Array.from({ length: count }, (_, i) => machine.project(elapsed + duration * i / (count - 1)));
      vectors.animate(frames, duration); stats.quietPlans++;
    }
    timerId = window.setTimeout(() => {
      timerId = 0; advance();
      const frame = machine.sample(); syncFog(frame); paint(frame); schedule();
    }, Math.ceil(duration * 1000) + 1);
  }
  function active(stamp: number) {
    frameId = 0;
    if (disposed || stats.hidden || stats.reduced) return;
    advance(stamp); const frame = machine.sample(); syncFog(frame); freezeIfSlow();
    if (stats.reduced) return;
    paint(frame);
    if ((options.instrument ?? options.mode === "measure") && !quiet() && previousFrame !== -Infinity) {
      stats.activeIntervals.push({ state: frame.state, seconds: elapsed - previousFrame });
      if (stats.activeIntervals.length > 10000) stats.activeIntervals.shift();
    }
    previousFrame = quiet() ? -Infinity : elapsed;
    schedule();
  }
  function restart() { cancel(); paint(machine.project(elapsed)); previousFrame = -Infinity; schedule(); }
  function visibility(hidden: boolean) {
    if (hidden === stats.hidden) return;
    advance(); stats.hidden = hidden; fog.visibility(hidden); cancel();
    if (!hidden) {
      previousStamp = performance.now(); machine.resume(elapsed);
      const frame = machine.sample(); syncFog(frame); restart();
    }
  }
  const onVisibility = () => visibility(document.hidden);
  function reducedChanged() {
    advance(); const reduced = requestedReduced || media.matches || fog.stats.slow;
    stats.reduced = reduced; const frame = machine.update({ parado: reduced });
    fog.update({ parado: reduced, estado: frame.state }); fogState = frame.state; restart();
  }
  const onReduced = () => reducedChanged();
  document.addEventListener("visibilitychange", onVisibility);
  media.addEventListener("change", onReduced);
  schedule();
  return {
    stats, fogStats: fog.stats,
    setBackground(value: SymbolBackground) { if (!disposed) vectors.setBackground(value); },
    get visualState() { return machine.visualState; },
    get frame() { return machine.project(elapsed); },
    update(input: Partial<FogInputs>) {
      if (disposed) return;
      advance();
      const wasReduced = stats.reduced;
      if (input.parado !== undefined) requestedReduced = input.parado;
      stats.reduced = requestedReduced || media.matches || fog.stats.slow;
      const frame = machine.update({ ...input, parado: stats.reduced });
      const fogInput = { ...input, estado: frame.state };
      if (wasReduced !== stats.reduced || input.parado !== undefined) fogInput.parado = stats.reduced;
      fog.seek(elapsed); fog.update(fogInput); fogState = frame.state;
      restart();
    },
    capture(seconds: number) {
      if (disposed || stats.hidden || options.mode !== "capture" || !Number.isFinite(seconds)) return;
      elapsed = Math.max(elapsed, seconds); fog.seek(elapsed);
      const frame = machine.sample(); syncFog(frame); fog.capture(elapsed); paint(frame);
    },
    visibility,
    observeCadence(seconds: number) { fog.observeCadence(seconds); freezeIfSlow(); },
    async dispose() {
      if (disposed) return;
      disposed = true; cancel();
      document.removeEventListener("visibilitychange", onVisibility);
      media.removeEventListener("change", onReduced);
      vectors.dispose(); await fog.dispose(); root.replaceChildren();
    },
  };
}
