// Original TSL graph for T8487. One fixed screen-space material, no particles,
// image-blur filters, moving blurred shapes, or copied Channels code.
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  uv,
  mix,
  smoothstep,
  max,
  pow,
  normalize,
  min,
  dot,
  fract,
  floor,
} from "three/tsl";
import { Vector3, type Texture } from "three";
import type { FogFrame } from "./state";

const hash3 = Fn(([point]: any[]) => {
  const q = fract(vec3(point).mul(0.1031)).toVar();
  q.addAssign(dot(q, q.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
});
const noise3 = Fn(([point]: any[]) => {
  const cell = floor(vec3(point)),
    f = fract(vec3(point)),
    u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const h = (x: number, y: number, z: number) => {
    const corner = cell.add(vec3(x, y, z));
    const gradient = normalize(
      vec3(
        hash3(corner),
        hash3(corner.add(vec3(19.1, 7.7, 3.2))),
        hash3(corner.add(vec3(5.3, 29.4, 11.8))),
      )
        .mul(2)
        .sub(1)
        .add(0.00001),
    );
    return dot(gradient, f.sub(vec3(x, y, z)));
  };
  // Gradient noise avoids flat value-noise cells becoming luminous curtains.
  return float(0.5).add(
    mix(
      mix(
        mix(h(0, 0, 0), h(1, 0, 0), u.x),
        mix(h(0, 1, 0), h(1, 1, 0), u.x),
        u.y,
      ),
      mix(
        mix(h(0, 0, 1), h(1, 0, 1), u.x),
        mix(h(0, 1, 1), h(1, 1, 1), u.x),
        u.y,
      ),
      u.z,
    ).mul(1.4),
  );
});
const fbm = Fn(([point]: any[]) => {
  const rotate = (v: any) =>
    vec3(
      dot(v, vec3(0.36, -0.48, 0.8)),
      dot(v, vec3(0.8, 0.6, 0)),
      dot(v, vec3(-0.48, 0.64, 0.6)),
    );
  // Orthonormal rotation at every octave prevents a common axis-aligned
  // lattice from surviving the domain warp as straight bands/curtains.
  const p = rotate(vec3(point)).toVar(),
    sum = float(0).toVar();
  let amplitude = 0.72;
  for (let i = 0; i < 2; i++) {
    sum.addAssign(noise3(p).mul(amplitude));
    p.assign(
      rotate(p)
        .mul(1.97)
        .add(vec3(7.1, 13.7, 4.3)),
    );
    amplitude *= 0.28 / 0.72;
  }
  return sum;
});
export function fogMaterial(
  reference: Texture,
  protection: Texture,
  densityTexture: Texture,
) {
  const alive = uniform(0),
    exposure = uniform(1),
    side = uniform(0),
    upper = uniform(0),
    volume = uniform(1),
    custom = uniform(0),
    tint = uniform(new Vector3(1, 1, 1));
  const material = new MeshBasicNodeMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.fragmentNode = Fn(() => {
    const st = uv(),
      base = texture(reference, st).rgb,
      coverage = texture(protection, st),
      solid = coverage.r,
      foreground = coverage.g;
    const luminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
    const high = max(max(base.r, base.g), base.b),
      low = min(min(base.r, base.g), base.b);
    const chroma = high.sub(low).div(max(high, 0.001));
    const protectArc = smoothstep(0.28, 0.55, chroma);
    // A monotone dark pedestal, independent of raster layer boundaries.
    // Freezing the source-layer matte created a dark rim during dimming.
    const fogMask = max(luminance.sub(12 / 255), 0).div(max(luminance, 0.001));
    const field = texture(densityTexture, st);
    const gain = field.r;
    const weight = max(
      0.5,
      exposure.mul(
        float(1)
          .add(side.mul(st.x.sub(0.5).mul(2)))
          .add(upper.mul(st.y.sub(0.5).mul(2))),
      ),
    );
    const tinted = mix(
      base,
      luminance.mul(vec3(tint)),
      custom.mul(float(1).sub(protectArc)).mul(float(1).sub(foreground)),
    );
    const effectiveGain = max(
      0.5,
      weight.mul(mix(gain, 1, foreground)).mul(volume),
    );
    const cappedGain = mix(effectiveGain, min(1, effectiveGain), protectArc);
    const light = tinted.mul(cappedGain);
    const fog = mix(base, light, fogMask);
    // Arc and adjacent neutral light share exactly the same gain; separate
    // exposure curves introduced a ring where chroma crossed the selector.
    // Procedural wisps brighten the existing smooth light support, including
    // its faint outer tail. The reference raster never moves or gets blurred.
    const support = pow(max(luminance.sub(12 / 255), 0), 0.8);
    const wisp = field.g
      .mul(alive)
      .mul(support)
      .mul(float(1).sub(foreground))
      .mul(vec3(tint));
    return vec4(
      mix(fog.add(wisp.mul(float(1).sub(protectArc))), base, solid),
      1,
    );
  })();
  return {
    material,
    apply(frame: FogFrame) {
      alive.value =
        frame.state === "ouvindo" || frame.state === "thinking" ? 1 : 0;
      exposure.value = frame.exposure;
      side.value = frame.side;
      upper.value = frame.upper;
      volume.value = frame.volume;
      custom.value = frame.custom;
      const encode = (v: number) =>
        v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      const rgb = frame.tint.map(encode);
      const y = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      tint.value.set(rgb[0]! / y, rgb[1]! / y, rgb[2]! / y);
    },
  };
}

// Only the smooth scalar field is rendered at reduced resolution. The approved
// reference, eyes, material mask and arc are composed at the output resolution.
export function densityMaterial(seed: number, variant: "A" | "B" = "A") {
  const flow = uniform(0),
    time = uniform(0),
    activity = uniform(0),
    push = uniform(0),
    drift = uniform(0);
  const material = new MeshBasicNodeMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.fragmentNode = Fn(() => {
    const st = uv();
    // A continuous third spatial dimension advances through the noise volume.
    // Domain warping changes density within the anchored calibration light;
    // it does not translate/filter the raster or repeat a baked clip.
    const clock = flow;
    const p = vec3(
      st.x
        .mul(6.4)
        .sub(st.x.sub(0.5).mul(clock).mul(activity).mul(2))
        .sub(drift.mul(activity).mul(1.4)),
      st.y
        .mul(8)
        .sub(clock.mul(activity).mul(1.8))
        .sub(push.mul(activity).mul(st.y.sub(0.5)).mul(3)),
      clock.mul(float(1).add(activity.mul(2))).add((seed % 997) / 53),
    );
    const warp = vec3(
      noise3(p.mul(0.67).add(vec3(3, 7, 2))),
      noise3(p.mul(0.71).add(vec3(13, 1, 11))),
      float(0),
    ).sub(vec3(0.5, 0.5, 0));
    const density = fbm(p.add(warp.mul(float(0.85).add(activity.mul(0.1)))));
    const gain = mix(
      float(1),
      float(1).add(density.sub(0.5).mul(float(0.6).add(activity.mul(1.6)))),
      smoothstep(0, 2, time),
    );
    const wisps = smoothstep(0.38, 0.72, density)
      .mul(activity)
      .mul(0.2)
      .mul(smoothstep(0, 2, time));
    return vec4(gain, wisps, 0, 1);
  })();
  return {
    material,
    apply(frame: FogFrame) {
      activity.value =
        variant === "B" &&
        (frame.state === "ouvindo" || frame.state === "thinking")
          ? 1
          : 0;
      push.value = Math.max(0, frame.volume - 1) * 5;
      drift.value = frame.side;
      flow.value = frame.flow;
      time.value = frame.time;
    },
  };
}
