import { describe, expect, test } from "bun:test";

import { dripProblem, dropShape, hasNeck } from "./goo-profile.ts";

// Perfis inventados, coluna a coluna a partir da pílula (i = 0 encostado nela).
const bulge = [12, 11, 9, 6, 3, 0, 0, 0];
const neck = [10, 6, 3, 3, 8, 16, 20, 18, 10, 0];
const loose = [4, 2, 0, 0, 0, 14, 20, 16, 0];
const slidingPill = [0, 0, 0, 0, 24, 24, 24, 24, 24, 0];
const thickBridge = [20, 18, 18, 20, 24, 24, 24, 0];

describe("dropShape", () => {
  test("a barriga encostada na pílula não tem pescoço", () => {
    const s = dropShape(bulge);
    expect(s.kind).toBe("attached");
    expect(hasNeck(s)).toBe(false);
  });

  test("a gota presa por uma ligação fina tem pescoço", () => {
    expect(dropShape(neck)).toEqual({ kind: "attached", body: 20, neck: 3 });
    expect(hasNeck(dropShape(neck))).toBe(true);
  });

  test("um vão entre a pílula e a gota é a gota solta, com o respingo ainda perto da pílula", () => {
    expect(dropShape(loose)).toEqual({ kind: "detached", body: 20, neck: 0 });
  });

  test("uma ponte grossa não é pescoço", () => {
    expect(hasNeck(dropShape(thickBridge))).toBe(false);
  });

  test("nada fora da pílula", () => {
    expect(dropShape([0, 1, 0, 0]).kind).toBe("none");
    expect(dropShape([]).kind).toBe("none");
  });
});

describe("dripProblem", () => {
  test("a ida da referência passa: barriga, pescoço, solta", () => {
    expect(dripProblem([bulge, neck, loose].map((c) => dropShape(c)))).toBeNull();
  });

  test("uma pílula deslizando, sem pescoço, não passa", () => {
    const p = dripProblem([bulge, thickBridge, slidingPill].map((c) => dropShape(c)));
    expect(p).toContain("pescoço");
    expect(p).not.toContain("solta");
  });

  test("sem gota solta não passa", () => {
    expect(dripProblem([bulge, neck].map((c) => dropShape(c)))).toContain("solta");
  });
});
