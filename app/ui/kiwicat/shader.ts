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
  exp,
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
  protectEyes = true,
  cutout?: Texture,
  backing = 0.5,
  edgeBand = 0.08,
  /** "band": a faixa reta de antes do spec #9573, só para as provas compararem. */
  edgeShape: "rounded" | "band" = "rounded",
) {
  const arcGain = uniform(1),
    alive = uniform(0),
    exposure = uniform(1),
    side = uniform(0),
    upper = uniform(0),
    volume = uniform(1),
    custom = uniform(0),
    tint = uniform(new Vector3(1, 1, 1)),
    /** T11696: 1 sobre uma superfície clara (o tema claro do app), 0 sobre a escura. Só vale no recorte. */
    surface = uniform(0);
  const material = new MeshBasicNodeMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.fragmentNode = Fn(() => {
    const st = uv(),
      calibrated = texture(reference, st).rgb,
      coverage = texture(protection, st),
      solid = protectEyes ? coverage.r : float(0),
      foreground = coverage.g,
      arcCoverage = coverage.b.mul(alive),
      neutral = vec3(min(min(calibrated.r, calibrated.g), calibrated.b)),
      base = mix(calibrated, neutral, arcCoverage);
    // Separate the calibrated chromatic emission from the neutral light.
    // Its gain stays <=1; brighter fog can fill the tip centers instead of
    // leaving a frozen colored rim around a dark hole. Screen composition
    // has no negative/overflowing channels and keeps the calibrated hue.
    const emission = calibrated.sub(base).div(max(vec3(1).sub(base), 0.001));
    const luminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
    const high = max(max(base.r, base.g), base.b),
      low = min(min(base.r, base.g), base.b);
    const chroma = high.sub(low).div(max(high, 0.001));
    const protectArc = smoothstep(0.28, 0.55, chroma).mul(float(1).sub(alive));
    // A monotone dark pedestal, independent of raster layer boundaries.
    // Freezing the source-layer matte created a dark rim during dimming.
    const hardExcess = max(luminance.sub(12 / 255), 0);
    // Smooth dark pedestal: no derivative kink at 12/255 to reveal a thin
    // contour at high exposure. Quiet states retain their original transfer.
    const softExcess = luminance.sub(
      float(12 / 255).mul(float(1).sub(exp(luminance.mul(-255 / 12)))),
    );
    const fogMask = mix(hardExcess, softExcess, alive).div(
      max(luminance, 0.001),
    );
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
      custom
        .mul(float(1).sub(protectArc))
        .mul(float(1).sub(foreground))
        .mul(float(1).sub(arcCoverage)),
    );
    const effectiveGain = max(
      0.5,
      weight.mul(mix(mix(gain, 1, foreground), gain, alive)).mul(volume),
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
      .mul(float(1).sub(arcCoverage))
      .mul(support)
      .mul(float(1).sub(foreground))
      .mul(vec3(tint));
    const lit = fog.add(wisp.mul(float(1).sub(protectArc)));
    const limited = min(lit, vec3(1));
    const layered = limited.add(
      vec3(1).sub(limited).mul(emission).mul(arcGain),
    );
    const color = mix(mix(lit, layered, alive), calibrated, solid);
    if (!cutout) return vec4(color, 1);
    // Canvas uses premultiplied alpha. RGB is the approved light over black;
    // coverage reveals the background without erasing the opaque dark coat.
    const alphaHigh = max(max(color.r, color.g), color.b);
    const cutoutCoverage = texture(cutout, st);
    // Remove only weak emission. Preserve the original coat/arc material even
    // when dark; eyes and symbols live on their independent vector layer.
    const protectedMaterial = smoothstep(.05, .2, max(max(coverage.g, coverage.b), cutoutCoverage.r));
    const alphaSupport = max(smoothstep(16 / 255, 32 / 255, alphaHigh), protectedMaterial);
    // Numa superfície clara (T11696, o fundo branco do harry, #11675), luz somada ao branco some: a névoa fica pálida e
    // a faixa do aro, rala e deformada. Ali a luz vira tinta, com a forma do preto:
    // - longe do corpo, a névoa (neutra ou tingida) na cor do agente, com a opacidade da intensidade dela; as cores do
    //   agente têm contraste de 2:1 no branco (#9349);
    // - junto do corpo (o campo "perto do casaco", canal B da máscara), a luz como no preto, opaca: o escuro macio em
    //   volta do corpo e das orelhas fica escuro, sem franja branca;
    // - a faixa do aro nas próprias cores (ciano, azul, lilás), sem brilhar: a cor dela na força cheia, opaca onde é
    //   forte e esmaecendo na borda.
    // Sem a base escura leve. Na superfície escura (`surface` 0), nada muda.
    const peak = max(max(color.r, color.g), color.b);
    const lightChroma = peak.sub(min(min(color.r, color.g), color.b)).div(max(peak, 0.001));
    const tintPeak = vec3(tint).div(max(max(max(tint.x, tint.y), tint.z), 0.001));
    // Só a faixa forte; a borda fraca dela segue a névoa.
    const arcInk = coverage.b.mul(smoothstep(0.15, 0.45, lightChroma)).mul(smoothstep(0.08, 0.5, peak));
    const arcA = min(peak.mul(1.8), 1);
    const arcRGB = color.div(max(peak, 0.001)).mul(arcA);
    const near = smoothstep(0.02, 0.35, cutoutCoverage.b);
    const fogA = min(peak.mul(1.25), 1);
    const farRGB = mix(tintPeak.mul(fogA), arcRGB, arcInk);
    const farA = mix(fogA, arcA, arcInk);
    // Junto do corpo, a faixa vai por cima do escuro (sem buraco nem contorno na ponta dela).
    const bandRGB = mix(color, arcRGB.add(color.mul(float(1).sub(arcA))), arcInk);
    const bandA = float(1);
    const inkRGB = mix(mix(farRGB, bandRGB, near), color, cutoutCoverage.r);
    const inkA = mix(farA, bandA, near);
    const onLight = surface.mul(float(1).sub(solid));
    // Junto do corpo, a luz fraca também conta (no preto ela é o escuro macio em volta dele).
    const lightSupport = mix(alphaSupport, max(alphaSupport, near), onLight);
    const lightRGB = mix(color, inkRGB, onLight).mul(lightSupport);
    const darkAlpha = max(max(max(lightRGB.r, lightRGB.g), lightRGB.b), pow(cutoutCoverage.g, backing * 2));
    const lightAlpha = mix(darkAlpha, max(inkA.mul(lightSupport), max(max(lightRGB.r, lightRGB.g), lightRGB.b)), onLight);
    const alpha = max(cutoutCoverage.r, lightAlpha);
    // Only left/right/bottom carry visible reference light. The top is <=1/255.
    const band = smoothstep(0, edgeBand, st.x).mul(smoothstep(0, edgeBand, float(1).sub(st.x))).mul(smoothstep(0, edgeBand * 0.8, st.y));
    // A queda arredondada (spec #9573, a elipse escolhida pelo lead no #11568): perto da borda a luz cai até zero numa
    // elipse em volta do gato, e não numa faixa reta, para os lados da névoa não ficarem retos. Ela só diminui a luz
    // (fica sempre abaixo da faixa); o corpo e o aro seguem pela faixa de antes, onde o material os protege.
    const q = st.sub(0.5).mul(2);
    const rounded = float(1).sub(smoothstep(0.82, 1, q.x.mul(q.x).add(q.y.mul(q.y)).sqrt()));
    const edge = edgeShape === "band" ? band : max(min(rounded, band), band.mul(protectedMaterial));
    const coat = cutoutCoverage.r;
    const lightFade = max(coat, edge);
    const finalRGB = lightRGB.mul(lightFade);
    const topSupport = smoothstep(0, edgeBand * .8, float(1).sub(st.y));
    const alphaFloor = max(max(finalRGB.r, finalRGB.g), finalRGB.b);
    return vec4(finalRGB, max(max(coat, alphaFloor), alpha.mul(edge).mul(topSupport)));
  })();
  return {
    material,
    /** A superfície atrás do gato recortado (T11696): clara (o tema claro) ou escura. */
    setSurface(light: boolean) {
      surface.value = light ? 1 : 0;
    },
    apply(frame: FogFrame) {
      alive.value = frame.activity;
      arcGain.value = Math.max(
        0.5,
        Math.min(
          1,
          frame.exposure *
            (1 - Math.abs(frame.side) - Math.abs(frame.upper)) *
            frame.volume,
        ),
      );
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
export function densityMaterial(seed: number) {
  const flow = uniform(0),
    activeFlow = uniform(0),
    radialFlow = uniform(0),
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
        .sub(st.x.sub(0.5).mul(radialFlow).mul(2))
        .sub(drift.mul(activity).mul(1.4)),
      st.y
        .mul(8)
        .sub(activeFlow.mul(1.8))
        .sub(push.mul(activity).mul(st.y.sub(0.5)).mul(3)),
      clock.add((seed % 997) / 53),
    );
    const warp = vec3(
      noise3(p.mul(0.67).add(vec3(3, 7, 2))),
      noise3(p.mul(0.71).add(vec3(13, 1, 11))),
      float(0),
    ).sub(vec3(0.5, 0.5, 0));
    // Large, low-contrast volumes: no density threshold outlines, no fine
    // octaves or strong warp that can turn the field into marbled filaments.
    // The advected coordinates above are identical in both texture studies.
    const scale = 0.7;
    const distortion = 0.12;
    const density = fbm(
      mix(
        p.add(warp.mul(0.85)),
        p.mul(scale).add(warp.mul(distortion)),
        activity,
      ),
    );
    const gain = mix(
      float(1),
      float(1).add(density.sub(0.5).mul(float(0.6).add(activity.mul(1)))),
      smoothstep(0, 2, time),
    );
    const wisps = density
      .mul(activity)
      .mul(0.05)
      .mul(smoothstep(0, 2, time));
    return vec4(gain, wisps, 0, 1);
  })();
  return {
    material,
    apply(frame: FogFrame) {
      activity.value = frame.activity;
      push.value = Math.max(0, frame.volume - 1) * 5;
      drift.value = frame.side;
      flow.value = frame.phase;
      activeFlow.value = frame.activeFlow;
      radialFlow.value = frame.radialFlow;
      time.value = frame.time;
    },
  };
}
