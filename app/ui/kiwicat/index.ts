import { RenderTarget, WebGPURenderer } from "three/webgpu";
import {
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  TextureLoader,
  NoColorSpace,
  LinearSRGBColorSpace,
  NoToneMapping,
  LinearFilter,
  UnsignedByteType,
  HalfFloatType,
} from "three";
import referenceUrl from "./assets/reference.webp";
import protectionUrl from "./assets/material-mask.webp";
import {
  FogDynamics,
  DrawingPolicy,
  type FogInputs,
  type FogFrame,
} from "./state";
import { densityMaterial, fogMaterial } from "./shader";
export type { FogInputs, FogState } from "./state";
export interface FogOptions {
  mode: "capture" | "measure";
  backend?: "auto" | "webgl2" | "none";
  width?: number;
  height?: number;
  seed?: number;
  idleFPS?: number;
  densityScale?: 1 | 0.5 | 0.25;
  inputs?: Partial<FogInputs>;
}
export interface FogStats {
  backend: string;
  draws: number;
  hidden: boolean;
  reduced: boolean;
  slow: boolean;
  intervals: number[];
  fallbackReason?: string;
}
export async function createKiwiFog(root: HTMLElement, options: FogOptions) {
  const width = options.width ?? 640,
    height = options.height ?? 800,
    seed = options.seed ?? 1;
  const state = new FogDynamics(options.inputs, seed),
    policy = new DrawingPolicy(options.idleFPS);
  const stats: FogStats = {
    backend: "static",
    draws: 0,
    hidden: false,
    reduced: false,
    slow: false,
    intervals: [],
  };
  const image = document.createElement("img");
  image.src = referenceUrl;
  image.alt = "Kiwi-cat";
  image.width = width;
  image.height = height;
  root.replaceChildren(image);
  root.style.width = width + "px";
  root.style.height = height + "px";
  if (options.backend === "none") {
    stats.fallbackReason = "GPU disabled by demo test";
    return staticHandle();
  }
  const gpu = (
    navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  const gpuAvailable =
    options.backend !== "webgl2" && gpu
      ? await gpu.requestAdapter().catch(() => null)
      : null;
  const glAvailable = !gpuAvailable
    ? document.createElement("canvas").getContext("webgl2")
    : true;
  if (!gpuAvailable && !glAvailable) {
    stats.fallbackReason = "WebGPU and WebGL2 unavailable";
    return staticHandle();
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let renderer: WebGPURenderer | undefined;
  let textures: Array<{ dispose(): void }> = [];
  let scene: Scene | undefined,
    camera: OrthographicCamera | undefined,
    mesh: Mesh | undefined,
    material: ReturnType<typeof fogMaterial> | undefined;
  let densityTarget: RenderTarget | undefined,
    densityScene: Scene | undefined,
    densityMesh: Mesh | undefined,
    density: ReturnType<typeof densityMaterial> | undefined;
  let frameId = 0,
    timerId = 0,
    lastTick: number | undefined,
    lastDraw = -Infinity,
    nextCapture = 0,
    nextDraw = 0,
    elapsed = 0,
    boostUntil = 0,
    disposed = false;
  let requestedReduced = options.inputs?.parado ?? false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const render = (frame: FogFrame) => {
    if (
      !renderer ||
      !scene ||
      !camera ||
      !material ||
      disposed ||
      policy.hidden
    )
      return;
    if (density && densityScene && densityTarget) {
      density.apply(frame);
      renderer.setRenderTarget(densityTarget);
      renderer.render(densityScene, camera);
      renderer.setRenderTarget(null);
    }
    material.apply(frame);
    renderer.render(scene, camera);
    // three0.187 starts an internal RAF in render(), even in on-demand mode;
    // setAnimationLoop(null) removes its callback but does not stop that RAF.
    // The exact pin and integration checks guard this narrow private adapter.
    const animation = (renderer as unknown as { _animation?: { stop(): void } })
      ._animation;
    if (!animation)
      throw new Error("three animation adapter changed; review the pin");
    animation.stop();
    stats.draws++;
  };
  function drawAt(seconds: number) {
    elapsed = seconds;
    render(state.sample(seconds));
  }
  function advance(stamp = performance.now()) {
    if (options.mode === "measure" && lastTick !== undefined)
      elapsed += Math.max(0, (stamp - lastTick) / 1000);
    lastTick = stamp;
  }
  function idle() {
    return (
      state.inputs.estado === "repouso" || state.inputs.estado === "dormindo"
    );
  }
  function cancel() {
    if (frameId) cancelAnimationFrame(frameId);
    if (timerId) clearTimeout(timerId);
    frameId = 0;
    timerId = 0;
    lastTick = undefined;
    policy.resetCadence();
  }
  function schedule() {
    if (!policy.continuous || disposed) return;
    if (idle() && elapsed >= boostUntil)
      timerId = window.setTimeout(
        () => {
          timerId = 0;
          frameId = requestAnimationFrame(loop);
        },
        Math.max(0, (nextDraw - elapsed) * 1000 - 5),
      );
    else frameId = requestAnimationFrame(loop);
  }
  function loop(t: number) {
    frameId = 0;
    if (!policy.continuous || disposed) return;
    advance(t);
    const interval = policy.interval(state.inputs.estado, elapsed < boostUntil);
    if (!idle() || elapsed >= nextDraw - 0.002) {
      if (lastDraw > 0) {
        stats.intervals.push(elapsed - lastDraw);
        if (stats.intervals.length > 10000) stats.intervals.shift();
      }
      render(state.sample(elapsed));
      lastDraw = elapsed;
      nextDraw += interval;
      if (nextDraw <= elapsed) nextDraw = elapsed + interval;
      // Intentional quiet-fog cadence is not evidence of a GPU failing 24fps.
      if (!idle()) policy.observe(elapsed);
      stats.slow = policy.slow;
    }
    schedule();
  }
  function resume() {
    if (
      options.mode === "measure" &&
      policy.continuous &&
      !frameId &&
      !timerId &&
      !disposed
    ) {
      lastTick = performance.now();
      nextDraw = elapsed;
      frameId = requestAnimationFrame(loop);
    }
  }
  function visibility(hidden: boolean) {
    advance();
    policy.hidden = hidden;
    stats.hidden = hidden;
    cancel();
    if (!hidden) {
      lastDraw = -Infinity;
      drawAt(elapsed);
      resume();
    }
  }
  const onVisibility = () => visibility(document.hidden);
  function setReduced(value: boolean) {
    policy.reduced = value || requestedReduced;
    stats.reduced = policy.reduced;
    state.update({ parado: policy.reduced }, elapsed);
    cancel();
    drawAt(elapsed);
    resume();
  }
  const onReduced = () => setReduced(reduced.matches);
  try {
    renderer = new WebGPURenderer({
      canvas,
      alpha: false,
      antialias: false,
      forceWebGL: options.backend === "webgl2",
      outputBufferType: UnsignedByteType,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    await renderer.init();
    stats.backend = (
      renderer.backend as unknown as { isWebGPUBackend?: boolean }
    ).isWebGPUBackend
      ? "webgpu"
      : "webgl2";
    const [reference, protection] = await Promise.all(
      [referenceUrl, protectionUrl].map((url) =>
        new TextureLoader().loadAsync(url),
      ),
    );
    textures = [reference!, protection!];
    for (const tex of [reference!, protection!]) {
      tex.colorSpace = NoColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
    }
    const scale = options.densityScale ?? 1;
    densityTarget = new RenderTarget(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        type: HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      },
    );
    densityTarget.texture.colorSpace = NoColorSpace;
    density = densityMaterial(seed);
    densityScene = new Scene();
    densityMesh = new Mesh(new PlaneGeometry(2, 2), density.material);
    densityMesh.frustumCulled = false;
    densityScene.add(densityMesh);
    material = fogMaterial(reference!, protection!, densityTarget.texture);
    scene = new Scene();
    camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mesh = new Mesh(new PlaneGeometry(2, 2), material.material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    renderer.setRenderTarget(densityTarget);
    await renderer.compileAsync(densityScene, camera);
    renderer.setRenderTarget(null);
    await renderer.compileAsync(scene, camera);
    root.replaceChildren(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onReduced);
    policy.hidden = document.hidden;
    policy.reduced = reduced.matches || requestedReduced;
    stats.hidden = policy.hidden;
    stats.reduced = policy.reduced;
    if (policy.reduced) state.update({ parado: true }, elapsed);
    drawAt(0);
    nextCapture = policy.interval(state.inputs.estado);
    resume();
  } catch (error) {
    stats.backend = "static";
    stats.fallbackReason = String(error);
    cancel();
    densityMesh?.geometry.dispose();
    density?.material.dispose();
    densityTarget?.dispose();
    mesh?.geometry.dispose();
    material?.material.dispose();
    textures.forEach((texture) => texture.dispose());
    await renderer?.dispose();
    renderer = undefined;
    root.replaceChildren(image);
    return staticHandle();
  }
  return {
    stats,
    canvas,
    update(inputs: Partial<FogInputs>) {
      if (options.mode === "measure") advance();
      const previous = { ...state.inputs };
      if (inputs.parado !== undefined) requestedReduced = inputs.parado;
      state.update(
        { ...inputs, parado: requestedReduced || reduced.matches },
        elapsed,
      );
      if (
        state.inputs.estado !== previous.estado ||
        state.inputs.cor !== previous.cor
      ) {
        boostUntil = elapsed + (state.inputs.cor !== previous.cor ? 0.4 : 0.24);
        lastDraw = -Infinity;
        nextCapture = elapsed;
        cancel();
      }
      if (inputs.parado !== undefined) setReduced(reduced.matches);
      else if (policy.reduced) {
        if (
          state.inputs.estado !== previous.estado ||
          state.inputs.cor !== previous.cor ||
          (typeof state.inputs.voz === "number") !==
            (typeof previous.voz === "number")
        )
          drawAt(elapsed);
      }
      resume();
    },
    capture(seconds: number) {
      if (policy.continuous && seconds >= nextCapture - 0.001) {
        drawAt(seconds);
        lastDraw = seconds;
        nextCapture += policy.interval(
          state.inputs.estado,
          seconds < boostUntil,
        );
        if (nextCapture <= seconds)
          nextCapture =
            seconds +
            policy.interval(state.inputs.estado, seconds < boostUntil);
      }
    },
    visibility,
    observeCadence(seconds: number) {
      policy.observe(seconds);
      stats.slow = policy.slow;
      if (policy.slow) cancel();
    },
    async dispose() {
      disposed = true;
      cancel();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReduced);
      densityMesh?.geometry.dispose();
      density?.material.dispose();
      densityTarget?.dispose();
      mesh?.geometry.dispose();
      material?.material.dispose();
      textures.forEach((texture) => texture.dispose());
      await renderer?.dispose();
      root.replaceChildren();
    },
  };
  function staticHandle() {
    return {
      stats,
      canvas: null,
      update(_inputs: Partial<FogInputs>) {},
      capture(_seconds: number) {},
      visibility(hidden: boolean) {
        stats.hidden = hidden;
      },
      observeCadence(_seconds: number) {},
      async dispose() {
        root.replaceChildren();
      },
    };
  }
}
