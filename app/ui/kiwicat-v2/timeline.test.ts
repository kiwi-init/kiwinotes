import { describe, expect, test } from "bun:test";
import { evaluateIntroPose as pacote } from "../../../docs/design/kiwicat-v2/intro/src/kiwiIntroTimeline";
import { evaluateIntroPose, INTRO_DURATION, INTRO_PHASES, REDUCED_DURATION } from "./timeline";

// O meio de cada fase.
const MEIO = INTRO_PHASES.map((f) => (f.start + f.end) / 2);

describe("evaluateIntroPose: as 6 fases", () => {
  test("as fases cobrem a intro inteira, sem buraco", () => {
    expect(INTRO_PHASES.length).toBe(6);
    expect(INTRO_PHASES[0].start).toBe(0);
    expect(INTRO_PHASES.at(-1)!.end).toBe(INTRO_DURATION);
    for (let i = 1; i < INTRO_PHASES.length; i++) expect<number>(INTRO_PHASES[i].start).toBe(INTRO_PHASES[i - 1].end);
    MEIO.forEach((t, i) => expect(t > INTRO_PHASES[i].start && t < INTRO_PHASES[i].end).toBe(true));
  });

  test("cada fase faz o que diz", () => {
    const [condensa, orelhas, aurora, feliz, some, janela] = MEIO.map((t) => evaluateIntroPose(t, false));
    expect(condensa.bodyScale).toBeLessThan(0.7); // a névoa ainda condensa
    expect(condensa.earAppear).toBe(0);
    expect(orelhas.earAppear).toBeGreaterThan(0);
    expect(aurora.auraIntensity).toBeGreaterThan(orelhas.auraIntensity);
    expect(feliz.happyArc).toBeGreaterThan(0.5);
    expect(some.mascotOpacity).toBeLessThan(feliz.mascotOpacity);
    expect(janela.windowExpand).toBeGreaterThan(0);
    expect([condensa, orelhas, aurora, feliz, some, janela].every((p) => !p.done)).toBe(true);
  });

  test("acaba em 5,35 s", () => {
    expect(evaluateIntroPose(INTRO_DURATION - 0.01, false).done).toBe(false);
    expect(evaluateIntroPose(INTRO_DURATION, false).done).toBe(true);
  });

  test("um clique pula: acaba 0,26 s depois", () => {
    expect(evaluateIntroPose(1.0, false, 1.0).done).toBe(false);
    expect(evaluateIntroPose(1.3, false, 1.0).done).toBe(true);
  });

  test("bate com a timeline do pacote nas 6 fases", () => {
    for (const t of MEIO) {
      const nosso = evaluateIntroPose(t, false) as unknown as Record<string, number | boolean>;
      const dele = pacote(t, false) as unknown as Record<string, number | boolean>;
      for (const k of Object.keys(nosso)) if (k in dele) expect([t, k, nosso[k]]).toEqual([t, k, dele[k]]);
    }
  });
});

describe("evaluateIntroPose: movimento reduzido", () => {
  test("dura 1,5 s e termina", () => {
    expect(evaluateIntroPose(0.5, true).duration).toBe(REDUCED_DURATION);
    expect(evaluateIntroPose(0.5, true).done).toBe(false);
    expect(evaluateIntroPose(REDUCED_DURATION, true).done).toBe(true);
  });

  test("mostra o gato pronto, sem condensar, e abre a janela no fim", () => {
    const p = evaluateIntroPose(0.3, true);
    expect(p.earAppear).toBe(1);
    expect(p.mascotOpacity).toBeGreaterThan(0.9);
    expect(evaluateIntroPose(1.45, true).windowExpand).toBeGreaterThan(0.9);
  });

  test("o clique também pula", () => {
    expect(evaluateIntroPose(0.6, true, 0.3).done).toBe(true);
  });
});
