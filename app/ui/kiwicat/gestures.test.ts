import { expect, test } from "bun:test";
import { GestureMachine, seededRandom, type GestureEvent } from "./gestures";
import { STATES } from "./state";
function machine(state: typeof STATES[number] = "repouso", random = seededRandom(71)) {
  let time = 0;
  const events: GestureEvent[] = [];
  const cat = new GestureMachine({ estado: state }, { clock: () => time, random, onEvent: e => events.push(e) });
  return { cat, events, at(t: number) { time = t; return cat.sample(); }, update(input: Parameters<GestureMachine["update"]>[0], t = time) { time = t; return cat.update(input); } };
}
test("gesture draws are independent of 30/60/120Hz sampling", () => {
  const runs = [30, 60, 120].map(hz => {
    const m = machine();
    for (let frame = 0; frame <= 40 * hz; frame++) m.at(frame / hz);
    return { events: m.events, frame: m.at(40) };
  });
  expect(runs[0]).toEqual(runs[1]); expect(runs[1]).toEqual(runs[2]);
});
test("each blink/look samples its phases once, in the approved ranges", () => {
  const m = machine(); m.at(220);
  const blinks = m.events.filter(e => e.kind.startsWith("piscar"));
  expect(blinks.length).toBeGreaterThan(15);
  for (const b of blinks) {
    expect(b.values[0]).toBeGreaterThanOrEqual(.24); expect(b.values[0]).toBeLessThanOrEqual(.32);
    expect(b.values[1]).toBeGreaterThanOrEqual(.06); expect(b.values[1]).toBeLessThanOrEqual(.1);
    expect(b.values[2]).toBeGreaterThanOrEqual(.3); expect(b.values[2]).toBeLessThanOrEqual(.44);
  }
  for (let i = 1; i < blinks.length; i++) {
    const a = blinks[i - 1]!, b = blinks[i]!;
    const gap = b.at - a.at - a.values.reduce((x, y) => x + y, 0);
    if (b.kind === "piscar_duplo") {
      expect(a.kind).toBe("piscar_lento"); expect(gap).toBeGreaterThanOrEqual(.12 - 1e-10); expect(gap).toBeLessThanOrEqual(.22 + 1e-10);
    } else { expect(gap).toBeGreaterThanOrEqual(4.5 - 1e-10); expect(gap).toBeLessThanOrEqual(9 + 1e-10); }
  }
  for (const e of m.events.filter(e => e.kind === "olhar_lateral")) {
    expect(Math.abs(e.values[0]!)).toBeGreaterThanOrEqual(18); expect(Math.abs(e.values[0]!)).toBeLessThanOrEqual(30);
  }
});
test("sleep is one adjustable draw per inactivity episode; repeated idle does not restart blink", () => {
  let now = 0, calls = 0;
  const m = new GestureMachine({}, { clock: () => now, random: seededRandom(7), sleepSeconds: () => { calls++; return 250; } });
  expect(calls).toBe(1); expect(m.sample(249.99).state).toBe("repouso"); expect(m.sample(250).state).toBe("dormindo");
  m.update({ estado: "repouso" }, 251); expect(calls).toBe(2);
  expect(m.sample(500).state).toBe("repouso"); expect(m.sample(501).state).toBe("dormindo");
  now = 502; m.update({ estado: "erro" }); expect(m.visualState).toBe("erro");
  expect(m.sample(1000).state).toBe("erro");
});
test("only sleep and ready auto-switch; repeating ready never replays satisfaction", () => {
  const m = machine("pronto");
  expect(m.at(.7).eyes.happy).toBe(1);
  expect(m.at(1.1).state).toBe("repouso");
  m.update({ estado: "pronto" }, 1.2); expect(m.cat.visualState).toBe("repouso");
  for (const state of ["acordou", "ouvindo", "thinking", "agindo", "erro"] as const) {
    const n = machine(state); expect(n.at(120).state).toBe(state);
  }
});
test("awake only delays listening until 320ms; latest request and error interrupt", () => {
  const m = machine("acordou"); m.update({ estado: "ouvindo", voz: 1 }, .1);
  expect(m.at(.319).state).toBe("acordou"); expect(m.at(.32).state).toBe("ouvindo");
  const n = machine("acordou"); n.update({ estado: "ouvindo" }, .1); n.update({ estado: "erro" }, .2);
  expect(n.at(.32).state).toBe("erro");
  n.update({ estado: "agindo" }, .4); expect(n.at(.41).state).toBe("agindo");
});
test("interrupted eye transitions start at the displayed pose, never neutral", () => {
  const m = machine("repouso"); m.update({ estado: "erro" }, 1); const before = m.at(1.11).eyes;
  const after = m.update({ estado: "thinking" }, 1.11).eyes; expect(after).toEqual(before);
  expect(m.at(1.35).eyes.opening).toBeCloseTo(.58, 10);
});
test("numeric silence has one wave; null/absent removes every wave immediately", () => {
  const m = machine("ouvindo");
  expect(m.at(0).waves).toEqual([0, 0, 0]);
  expect(m.update({ voz: 0 }, .1).waves).toEqual([.35, 0, 0]);
  m.update({ voz: 1 }, .2); expect(m.at(.5).waves[2]).toBe(1);
  expect(m.update({ voz: null }, .5).waves).toEqual([0, 0, 0]);
  m.update({ voz: NaN }, .6); expect(m.at(.7).waves).toEqual([.35, 0, 0]);
  expect(m.update({ voz: undefined }, .7).waves).toEqual([0, 0, 0]);
});
test("voice attack/release is elapsed time, and threshold cross-fades are continuous", () => {
  const m = machine("ouvindo"); m.update({ voz: 1 }, 0);
  const first = m.at(.06); expect(first.waves[1]).toBeGreaterThan(0); expect(first.waves[1]).toBeLessThan(1);
  m.at(.4); m.update({ voz: 0 }, .4); expect(m.at(.45).waves[2]).toBeGreaterThan(0);
  expect(m.at(2).waves.slice(1)).toEqual([0, 0]);
});
test("reduced motion holds one exact pose, ignores voice level and freezes schedules", () => {
  // O pronto é o único com troca de estado antes dos 100 s (volta ao repouso): ele tem o teste dele, abaixo (#434).
  for (const state of STATES.filter(s => s !== "pronto")) {
    const m = machine(state); const a = m.update({ parado: true, voz: 0 }, .1);
    const b = m.at(100); expect(b.state).toBe(state); expect(b.eyes).toEqual(a.eyes);
    expect(b.symbolAlpha).toBe(a.symbolAlpha); expect(b.progress).toBe(a.progress);
    expect(m.update({ voz: 1 }, 100).waves).toEqual(a.waves);
    expect(m.update({ voz: null }, 100).waves).toEqual([0, 0, 0]);
  }
});
test("reducing motion resolves a deferred listening state without waiting", () => {
  const m = machine("acordou"); m.update({ estado: "ouvindo", voz: null }, .1);
  expect(m.update({ parado: true }, .12).state).toBe("ouvindo");
  const n = machine("acordou"); expect(n.update({ estado: "ouvindo", parado: true }, .1).state).toBe("ouvindo");
});
test("leaving reduced motion preserves its pose and never replays old surprise", () => {
  const m = machine("acordou"); const fixed = m.update({ parado: true }, .1);
  m.at(20); const resumed = m.update({ parado: false }, 20);
  expect(resumed.eyes).toEqual(fixed.eyes);
  expect(m.at(20.24).eyes.size).toBe(1); expect(m.at(20.3).symbolAlpha).toBe(0);
  // Parado, o pronto já voltou ao repouso no tempo dele (#434); sair do parado não traz o pronto de volta.
  const n = machine("pronto"); n.update({ parado: true }, .1); n.at(20); n.update({ parado: false }, 20);
  expect(n.at(20.24).state).toBe("repouso");
});
test("reduced motion stops the animation, not the state machine: ready returns to rest and the cat sleeps (#434)", () => {
  const m = machine("pronto"); const still = m.update({ parado: true }, .1);
  // O pronto fica parado e inteiro até o tempo dele, e volta ao repouso direto no quadro parado.
  const before = m.at(1.09); expect(before.state).toBe("pronto"); expect(before.eyes).toEqual(still.eyes);
  const rest = m.at(1.11); expect(rest.state).toBe("repouso");
  expect(m.at(5).eyes).toEqual(rest.eyes);
  // O sono no tempo de sempre (4 a 6 min), também parado.
  expect(m.at(1.1 + 239).state).toBe("repouso");
  expect(m.at(1.1 + 361).state).toBe("dormindo");
  // Nada de gesto com o Reduzir movimento: nem piscar nem olhar para o lado, só as trocas de estado.
  const gestures = m.events.filter(e => e.at > .1 && /piscar|olhar|ciclo/.test(e.kind));
  expect(gestures).toEqual([]);
});
test("projecting compositor keyframes never consumes randomness or events", () => {
  let draws = 0; const random = seededRandom(8);
  const m = machine("repouso", () => { draws++; return random(); }); const count = draws;
  for (let t = 0; t < 4; t += .01) m.cat.project(t);
  expect(draws).toBe(count);
});
test("idle interaction resets only sleep, while colour preserves all gesture deadlines", () => {
  const m = machine(); const wake = m.cat.nextBoundary();
  m.update({ estado: "repouso" }, 1); expect(m.cat.nextBoundary()).toBe(wake);
  m.update({ cor: "claude" }, 2); expect(m.cat.nextBoundary()).toBe(wake);
});
test("an existing lateral look freezes during blink closure", () => {
  let checked = false;
  for (let seed = 1; seed <= 8 && !checked; seed++) {
    const m = machine("repouso", seededRandom(seed)); let seen = 0;
    for (let t = 0; t < 80 && !checked; t += 1 / 60) {
      m.at(t);
      const fresh = m.events.slice(seen); seen = m.events.length;
      const blink = fresh.find(e => e.kind.startsWith("piscar"));
      if (!blink) continue;
      const look = m.events.findLast(e => e.kind === "olhar_lateral" && e.at < blink.at);
      if (!look || look.at + look.values.slice(1).reduce((a, b) => a + b, 0) < blink.at) continue;
      const x = m.cat.project(blink.at).eyes.x;
      expect(m.at(blink.at + blink.values[0]! / 2).eyes.x).toBeCloseTo(x, 10);
      expect(m.at(blink.at + blink.values[0]! + blink.values[1]! / 2).eyes.x).toBeCloseTo(x, 10);
      checked = true;
    }
  }
  expect(checked).toBe(true);
});
test.each([21, 20, 19])("a double blink preserves a lateral look without a jump (seed %i)", seed => {
  const events: GestureEvent[] = [];
  const cat = new GestureMachine({ estado: "repouso" }, {
    clock: () => 0, random: seededRandom(seed), earRandom: seededRandom(2), sleepSeconds: () => 1e9,
    onEvent: event => events.push(event),
  });
  let previous = cat.sample(0).eyes.x, largestStep = 0, seen = events.length;
  const overlaps: Array<{ before: number; start: number; closing: number; arc: number }> = [];
  // Pin the new ear stream too: this fixture retains the original eye seeds
  // and actually exercises the double-blink/gaze overlap with ear exclusion.
  for (let tick = 1; tick <= 600 * 240; tick++) {
    const time = tick / 240, due = cat.nextBoundary();
    const before = due <= time ? cat.project(due - 1e-12).eyes.x : 0;
    const frame = cat.sample(time);
    largestStep = Math.max(largestStep, Math.abs(frame.eyes.x - previous));
    previous = frame.eyes.x;
    const double = events.slice(seen).find(event => event.kind === "piscar_duplo");
    seen = events.length;
    const first = double && events.findLast(event => event.kind === "piscar_lento" && event.at < double.at);
    const look = double && events.findLast(event => event.kind === "olhar_lateral" && event.at < double.at);
    if (double && first && look && look.at < first.at && Math.abs(before) > 1) {
      overlaps.push({
        before,
        start: cat.project(double.at).eyes.x,
        closing: cat.project(double.at + double.values[0]! / 2).eyes.x,
        arc: cat.project(double.at + double.values[0]! + double.values[1]! / 2).eyes.x,
      });
    }
  }
  expect(overlaps.length).toBeGreaterThan(0);
  for (const overlap of overlaps) {
    expect(overlap.start).toBeCloseTo(overlap.before, 8);
    expect(overlap.closing).toBeCloseTo(overlap.before, 8);
    expect(overlap.arc).toBeCloseTo(overlap.before, 8);
  }
  expect(largestStep).toBeLessThanOrEqual(3);
});
test("capture ending during a symbol fade removes waves on that same frame", () => {
  const m = machine("ouvindo"); m.update({ voz: 1 }, 0); m.at(.4);
  expect(m.update({ estado: "thinking", voz: null }, .4).waves).toEqual([0, 0, 0]);
});
test("a departing symbol freezes at its displayed drawing and opacity", () => {
  const m = machine("erro"); const before = m.at(.18);
  const after = m.update({ estado: "thinking" }, .18);
  expect(after.symbol).toBe(before.symbol); expect(after.progress).toBe(before.progress);
  expect(after.symbolAlpha).toBe(before.symbolAlpha); expect(after.jitter).toEqual(before.jitter);
  const halfway = m.at(.22); expect(halfway.progress).toBe(before.progress);
  expect(halfway.symbolAlpha).toBeLessThan(before.symbolAlpha);
  expect(m.at(.27).symbol).toBe("thinking");
});
test("quiet wake boundaries separate motion from stationary holds", () => {
  const m = machine("repouso", () => .5);
  // Start the first blink exactly on its scheduled boundary.
  const due = m.cat.nextBoundary(); m.at(due);
  const b = m.events.findLast(e => e.kind === "piscar_lento")!;
  expect(b).toBeDefined();
  expect(m.cat.nextWake()).toBeCloseTo(b.at + b.values[0]!, 10);
  m.at(b.at + b.values[0]!);
  expect(m.cat.nextWake()).toBeCloseTo(b.at + b.values[0]! + b.values[1]!, 10);
});
test("resuming the error freezes its complete drawing until the first fade finishes", () => {
  const m = machine("erro"); m.update({ parado: true }, .1); m.at(20);
  expect(m.update({ parado: false }, 20).progress).toBe(1);
  expect(m.at(20.1).progress).toBe(1); expect(m.at(20.23).symbolAlpha).toBeLessThan(.1);
  expect(m.at(20.24).symbolAlpha).toBeCloseTo(0, 8);
});

// The approved reduced-motion listening pose is the three white arcs, not numeric silence.
test("fixed listening uses the approved high-voice pose only while capturing", () => {
  const m = machine("ouvindo");
  expect(m.update({ parado: true, voz: .8 }, 0).waves).toEqual([1, 1, 1]);
  expect(m.update({ voz: null }, 10).waves).toEqual([0, 0, 0]);
});

test("listening bands contain one, two or three approved arcs", () => {
  for (const [voice, count] of [[0, 1], [.5, 2], [1, 3]]) {
    const m = machine("ouvindo"); m.update({ voz: voice }, 0);
    const waves = m.at(1).waves;
    expect(waves).toHaveLength(3);
    expect(waves.filter(alpha => alpha > 0)).toHaveLength(count);
  }
});
