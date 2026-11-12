import { test, expect } from "bun:test";
import {
  DrawingPolicy,
  FogDynamics,
  palette,
  voiceEnvelope,
  voiceLevel,
  STATES,
} from "./state";
test("attack/release use elapsed time rather than frame count", () => {
  expect(voiceEnvelope(0, 1, 0.06)).toBeCloseTo(0.63212056, 6);
  expect(voiceEnvelope(1, 0, 0.28)).toBeCloseTo(0.36787944, 6);
  const sample = (fps: number) => {
    let y = 0;
    for (let i = 0; i < fps; i++) y = voiceEnvelope(y, 1, 1 / fps);
    return y;
  };
  expect(sample(30)).toBeCloseTo(sample(120), 10);
  expect(voiceLevel(null)).toBe(0);
  expect(voiceLevel(undefined)).toBe(0);
  expect(voiceLevel(NaN)).toBe(0);
  expect(voiceLevel(0.04)).toBe(0);
});
test("dark custom colours retain the approved luminance floor", () => {
  for (const colour of ["#000000", "#030409", "#ff0088", "claude", "codex"]) {
    const rgb = palette(colour),
      y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    expect(y).toBeGreaterThanOrEqual(0.28 - 1e-10);
  }
});
test("colour interruption starts from the colour currently displayed", () => {
  const model = new FogDynamics({ cor: "claude" });
  model.sample(0);
  model.update({ cor: "codex" }, 0);
  const middle = model.sample(0.2);
  model.update({ cor: "#63d997" }, 0.2);
  expect(model.sample(0.2).tint).toEqual(middle.tint);
  model
    .sample(0.6)
    .tint.forEach((v, i) => expect(v).toBeCloseTo(palette("#63d997")[i]!, 12));
});
test("state interruption preserves exposure and continuous flow phase", () => {
  const model = new FogDynamics({ estado: "ouvindo", voz: 1 });
  model.sample(0);
  const before = model.sample(0.18);
  model.update({ estado: "erro" }, 0.18);
  const after = model.sample(0.18);
  expect(after.exposure).toBe(before.exposure);
  expect(after.flow).toBe(before.flow);
  expect(model.sample(2).exposure).toBe(0.5);
});
test("missing microphone clears the envelope; numeric silence does not mean missing", () => {
  const model = new FogDynamics({ estado: "ouvindo", voz: 1 });
  model.sample(0);
  expect(model.sample(0.18).exposure).toBeGreaterThan(1.2);
  model.update({ voz: null }, 0.18);
  expect(model.sample(0.18).exposure).toBe(0.66);
  const missing = new FogDynamics({
    estado: "ouvindo",
    parado: true,
    voz: null,
  });
  const silent = new FogDynamics({ estado: "ouvindo", parado: true, voz: 0 });
  expect(missing.sample(100).exposure).toBe(0.66);
  expect(silent.sample(100).exposure).toBe(0.8);
});
test("all fixed frames stop the noise clock, including after updates", () => {
  for (const estado of STATES) {
    const model = new FogDynamics({ estado, parado: true });
    const a = model.sample(1),
      b = model.sample(100);
    expect(a).toEqual(b);
    expect(a.time).toBe(0);
    expect(a.flow).toBe(0);
  }
});
test("drawing policy has idle cap, hidden/reduced pause, sustained slow fallback", () => {
  const policy = new DrawingPolicy();
  expect(policy.interval("repouso")).toBe(1 / 3);
  expect(policy.interval("repouso", true)).toBe(1 / 30);
  expect(policy.interval("thinking")).toBe(1 / 60);
  policy.hidden = true;
  expect(policy.continuous).toBe(false);
  policy.hidden = false;
  policy.reduced = true;
  expect(policy.continuous).toBe(false);
  policy.reduced = false;
  for (let i = 0; i < 61; i++) policy.observe(i / 20);
  expect(policy.slow).toBe(true);
  expect(policy.continuous).toBe(false);
});

test("fixed awake/error frames use the settled exposure from the roteiro", () => {
  expect(
    new FogDynamics({ estado: "acordou", parado: true }).sample(0).exposure,
  ).toBeCloseTo(1.02, 10);
  expect(
    new FogDynamics({ estado: "erro", parado: true }).sample(0).exposure,
  ).toBe(0.5);
});

test("B1 covers active states and eases from the current activity on interruption", () => {
  for (const estado of [
    "acordou",
    "ouvindo",
    "thinking",
    "agindo",
    "pronto",
    "erro",
  ] as const)
    expect(new FogDynamics({ estado }).sample(0).activity).toBe(1);
  for (const estado of ["repouso", "dormindo"] as const)
    expect(new FogDynamics({ estado }).sample(0).activity).toBe(0);
  const model = new FogDynamics();
  model.sample(0);
  model.update({ estado: "ouvindo" }, 1);
  expect(model.sample(1).activity).toBe(0);
  const middle = model.sample(1.12).activity;
  expect(middle).toBeCloseTo(0.5, 10);
  model.update({ estado: "dormindo" }, 1.12);
  expect(model.sample(1.12).activity).toBe(middle);
  expect(model.sample(1.36).activity).toBe(0);
});

test("long advection stays soft and its phase remains continuous after long idle", () => {
  const active = new FogDynamics({ estado: "ouvindo" });
  const approved = active.sample(8);
  expect(approved.radialFlow).toBe(approved.flow);
  const hour = active.sample(3600);
  expect(hour.activeFlow).toBeGreaterThan(200);
  expect(hour.radialFlow).toBeLessThan(2);
  expect(6.4 - 2 * hour.radialFlow).toBeGreaterThan(2.4);
  const idle = new FogDynamics();
  const before = idle.sample(3600);
  idle.update({ estado: "ouvindo" }, 3600);
  expect(idle.sample(3600).phase).toBe(before.phase);
  expect(idle.sample(3600.12).phase - before.phase).toBeLessThan(0.1);
});
