// A pílula das abas (T4380, spec #4375): a mola não passa do alvo, não sai da faixa e não recomeça no meio.

import { describe, expect, test } from "bun:test";

import { type Box, type PillState, pillMove, settled, stepPill } from "./pill.ts";

// As abas do hub como o WebKit mede (Notas, Reuniões, Ditado, Configurações, Sobre).
const TABS: Box[] = [{ x: 2, w: 60 }, { x: 64, w: 120 }, { x: 186, w: 65 }, { x: 253, w: 114 }, { x: 369, w: 61 }];
const BOUNDS = { lo: 2, hi: 430 };
const at = (b: Box): PillState => ({ ...b, vx: 0, vw: 0 });

/** Roda a mola a 60 fps por `ms`, devolvendo os frames. */
function run(s: PillState, to: Box, ms: number, dt = 1 / 60): PillState[] {
  const out: PillState[] = [];
  for (let t = 0; t < ms; t += dt * 1000) out.push((s = stepPill(s, to, dt, BOUNDS)));
  return out;
}

describe("a mola da pílula", () => {
  test("de Notas ao Sobre e de volta: chega sem passar do alvo, e nunca sai da faixa", () => {
    for (const [from, to] of [[TABS[0]!, TABS[4]!], [TABS[4]!, TABS[0]!], [TABS[1]!, TABS[2]!]] as const) {
      const frames = run(at(from), to, 600);
      const dir = Math.sign(to.x - from.x);
      for (const f of frames) {
        expect(dir * (f.x - to.x)).toBeLessThanOrEqual(0.001); // nunca além do alvo
        expect(f.x).toBeGreaterThanOrEqual(BOUNDS.lo);
        expect(f.x + f.w).toBeLessThanOrEqual(BOUNDS.hi + 0.001);
      }
      expect(settled(frames.at(-1)!, to)).toBe(true);
    }
  });

  test("um alvo novo no meio do caminho continua de onde a pílula está: sem salto nem volta ao começo", () => {
    let s = at(TABS[0]!);
    const frames: PillState[] = [];
    // O mouse varrendo rápido: um alvo novo a cada 2 frames.
    for (const to of [TABS[1]!, TABS[2]!, TABS[3]!, TABS[4]!, TABS[3]!, TABS[2]!]) {
      for (let k = 0; k < 2; k++) frames.push((s = stepPill(s, to, 1 / 60, BOUNDS)));
    }
    frames.push(...run(s, TABS[2]!, 500));
    const dx = frames.slice(1).map((f, i) => f.x - frames[i]!.x);
    // A velocidade é contínua: de um frame para o outro, o passo muda pouco (sem recomeçar nem dar tranco). Antes,
    // com as transições CSS reiniciando, a pílula andava até 188 px num frame do headless (#4375).
    const dDx = dx.slice(1).map((d, i) => Math.abs(d - dx[i]!));
    expect(Math.max(...dDx)).toBeLessThan(25);
    expect(Math.max(...dx.map(Math.abs))).toBeLessThan(70);
    for (const f of frames) expect(f.x + f.w).toBeLessThanOrEqual(BOUNDS.hi + 0.001);
  });

  test("a velocidade herdada empurrando para fora: a faixa segura", () => {
    const s = stepPill({ x: 360, w: 61, vx: 4000, vw: 0 }, TABS[4]!, 1 / 30, BOUNDS);
    expect(s.x + s.w).toBeLessThanOrEqual(BOUNDS.hi + 0.001);
    expect(s.vx).toBe(0);
  });

  test("estável com frame lento (30 fps do headless, ou um engasgo de 50 ms)", () => {
    const frames = run(at(TABS[0]!), TABS[4]!, 600, 0.05);
    for (const f of frames) expect(Number.isFinite(f.x) && f.x <= TABS[4]!.x + 0.001).toBe(true);
  });
});

describe("como a pílula vai ao alvo", () => {
  const base = { first: false, reduced: false, resized: false, leftStrip: false };
  test("direto na primeira medida, no Reduzir movimento e numa mudança de tamanho", () => {
    expect(pillMove({ ...base, first: true, from: TABS[0]!, to: TABS[4]! })).toBe("snap");
    expect(pillMove({ ...base, reduced: true, from: TABS[0]!, to: TABS[4]! })).toBe("snap");
    expect(pillMove({ ...base, resized: true, from: TABS[0]!, to: TABS[4]! })).toBe("snap");
  });
  test("o mouse saiu da faixa e a ativa está longe: some e reaparece; perto, desliza", () => {
    expect(pillMove({ ...base, leftStrip: true, from: TABS[4]!, to: TABS[0]! })).toBe("fade");
    expect(pillMove({ ...base, leftStrip: true, from: TABS[1]!, to: TABS[0]! })).toBe("glide");
  });
  test("entre abas, com o mouse ou o teclado: desliza", () => {
    expect(pillMove({ ...base, from: TABS[0]!, to: TABS[4]! })).toBe("glide");
  });
});
