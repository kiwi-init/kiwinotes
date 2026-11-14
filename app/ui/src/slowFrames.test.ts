import { describe, expect, test } from "bun:test";

import { SlowFrames, WATCH_MS } from "./slowFrames.ts";

/** Quadros a cada `step` ms de `from` até `to`, devolvendo os avisos. */
function run(s: SlowFrames, from: number, to: number, step: number, stall?: { at: number; ms: number }) {
  const out: number[] = [];
  for (let t = from + step; t <= to; t += step) {
    if (stall && t > stall.at && t - step <= stall.at) t += stall.ms;
    const r = s.frame(t);
    if (r.report !== null) out.push(r.report);
    if (!r.more) break;
  }
  return out;
}

describe("SlowFrames (spec #12918)", () => {
  test("smooth frames after a click report nothing", () => {
    const s = new SlowFrames();
    expect(s.input(0)).toBe(true);
    expect(run(s, 0, WATCH_MS + 50, 16)).toEqual([]);
  });

  test("a stalled frame after a click reports the worst gap once, when the window closes", () => {
    const s = new SlowFrames();
    s.input(0);
    expect(run(s, 0, WATCH_MS + 500, 16, { at: 100, ms: 800 })).toEqual([816]);
  });

  test("the first frame late after the click counts (the click's own work)", () => {
    const s = new SlowFrames();
    s.input(0);
    expect(s.frame(350).more).toBe(true);
    expect(run(s, 350, WATCH_MS + 400, 16)).toEqual([350]);
  });

  test("a click while watching extends the window without restarting the loop", () => {
    const s = new SlowFrames();
    expect(s.input(0)).toBe(true);
    s.frame(16);
    expect(s.input(500)).toBe(false);
    expect(s.frame(1100).more).toBe(true);
  });

  test("a hidden window or sleep (a huge gap) is not a stall, and reports are spaced", () => {
    const s = new SlowFrames();
    s.input(0);
    expect(run(s, 0, WATCH_MS + 50, 16, { at: 100, ms: 60_000 })).toEqual([]);
    const t = 100_000;
    s.input(t);
    expect(run(s, t, t + WATCH_MS + 300, 16, { at: t + 50, ms: 300 })).toEqual([316]);
    const t2 = t + 1500;
    s.input(t2);
    expect(run(s, t2, t2 + WATCH_MS + 300, 16, { at: t2 + 50, ms: 300 })).toEqual([]);
  });
});
