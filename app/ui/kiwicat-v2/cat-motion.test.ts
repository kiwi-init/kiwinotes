import { describe, expect, test } from "bun:test";
import { STATE_TARGETS } from "./cat-config";
import { CatMotion, seededRandom } from "./cat-motion";
import { emoteSvg } from "./cat-emotes";

const run = (m: CatMotion, seconds: number, input: Parameters<CatMotion["step"]>[1]) => {
  let f = m.step(0, input);
  for (let t = 0; t < seconds; t += 1 / 60) f = m.step(1 / 60, input);
  return f;
};

describe("o movimento do gato novo (spec #14813)", () => {
  test("a mesma semente dá os mesmos quadros (a prova lado a lado)", () => {
    const a = new CatMotion("repouso", seededRandom(7)), b = new CatMotion("repouso", seededRandom(7));
    const input = { state: "repouso" as const, emote: "auto" as const, audio: null };
    for (let i = 0; i < 600; i++) expect(a.step(1 / 60, input)).toEqual(b.step(1 / 60, input));
  });

  test("o gato vai ao alvo do estado novo", () => {
    const m = new CatMotion("repouso", seededRandom(1));
    const f = run(m, 6, { state: "dormindo", emote: "auto", audio: null });
    expect(f.eyeOpenY).toBeCloseTo(STATE_TARGETS.dormindo.eyeOpenY, 2);
    expect(f.earPerk).toBeCloseTo(STATE_TARGETS.dormindo.earPerk, 2);
    expect(f.emote).toBe("dormindo");
  });

  test("pisca de tempos em tempos, e a piscada fica de 0 a 1", () => {
    const m = new CatMotion("repouso", seededRandom(3));
    let closed = 0, min = 1, max = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const f = m.step(1 / 60, { state: "repouso", emote: "auto", audio: null });
      min = Math.min(min, f.blinkAmount); max = Math.max(max, f.blinkAmount);
      if (f.blinkAmount > 0.62) closed++;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(closed).toBeGreaterThan(0);
  });

  test("dormindo não pisca", () => {
    const m = new CatMotion("dormindo", seededRandom(3));
    const f = run(m, 20, { state: "dormindo", emote: "auto", audio: null });
    expect(f.blinkAmount).toBeLessThan(0.01);
  });

  test("a voz simulada só no respondendo", () => {
    const quiet = run(new CatMotion("ouvindo", seededRandom(2)), 3, { state: "ouvindo", emote: "auto", audio: null });
    expect(quiet.pose.audio).toBe(0);
    const talking = run(new CatMotion("respondendo", seededRandom(2)), 3, { state: "respondendo", emote: "auto", audio: null });
    expect(talking.pose.audio).toBeGreaterThan(0);
  });

  test("um quadro longo conta como 50 ms, como no pacote", () => {
    const a = new CatMotion("repouso", seededRandom(5)), b = new CatMotion("repouso", seededRandom(5));
    const input = { state: "repouso" as const, emote: "auto" as const, audio: null };
    expect(a.step(2, input)).toEqual(b.step(0.05, input));
  });

  test("o emote escolhido passa na frente do símbolo do estado", () => {
    const f = new CatMotion("repouso", seededRandom(1)).step(0.016, { state: "repouso", emote: "confuso", audio: null });
    expect(f.emote).toBe("confuso");
  });
});

describe("os emotes", () => {
  test("cada emote tem desenho, e o repouso não", () => {
    for (const e of ["ouvindo", "pensando", "dormindo", "alerta", "feliz", "respondendo", "cansado", "confuso", "limite"] as const)
      expect(emoteSvg(e, false).length).toBeGreaterThan(20);
    expect(emoteSvg("repouso", false)).toBe("");
  });

  test("a tinta segue o fundo", () => {
    expect(emoteSvg("alerta", true)).toContain("#0A0B10");
    expect(emoteSvg("alerta", false)).toContain("#FFFFFF");
  });
});
