// Test-only material harness: sweep the full exposure range without changing
// the four production inputs or introducing a renderer test hook.
import { WebGPURenderer, RenderTarget } from "three/webgpu";
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
import { densityMaterial, fogMaterial } from "./shader";
import { FogDynamics, type FogState } from "./state";
import referenceUrl from "./assets/reference.webp";
import protectionUrl from "./assets/material-mask.webp";
const renderer = new WebGPURenderer({
  antialias: false,
  outputBufferType: UnsignedByteType,
});
renderer.setSize(640, 800);
renderer.setPixelRatio(1);
renderer.outputColorSpace = LinearSRGBColorSpace;
renderer.toneMapping = NoToneMapping;
await renderer.init();
const [reference, protection] = await Promise.all(
  [referenceUrl, protectionUrl].map((url) =>
    new TextureLoader().loadAsync(url),
  ),
);
for (const texture of [reference!, protection!]) {
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
}
const target = new RenderTarget(640, 800, {
  type: HalfFloatType,
  depthBuffer: false,
});
const query = new URLSearchParams(location.search);
const field = densityMaterial(17, query.get("variant") === "B" ? "B" : "A"),
  composite = fogMaterial(reference!, protection!, target.texture);
const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1),
  fieldScene = new Scene(),
  scene = new Scene();
fieldScene.add(new Mesh(new PlaneGeometry(2, 2), field.material));
scene.add(new Mesh(new PlaneGeometry(2, 2), composite.material));
document.getElementById("fog")!.replaceChildren(renderer.domElement);
const dynamics = new FogDynamics(
  { estado: (query.get("state") ?? "repouso") as FogState },
  17,
);
Object.assign(window, {
  sweep(exposure: number, time = 0) {
    const frame = {
      ...dynamics.sample(time),
      exposure,
      side: 0,
      upper: 0,
      volume: 1,
    };
    field.apply(frame);
    composite.apply(frame);
    renderer.setRenderTarget(target);
    renderer.render(fieldScene, camera);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    (renderer as any)._animation.stop();
  },
  kiwiFogReady: true,
});
(window as any).sweep(1);
