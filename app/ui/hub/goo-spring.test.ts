// A gota por mola (spec #32446, T32464): a forma pelo estado (barriga, pescoço, soltura, chegada), a lágrima no meio do
// caminho, a ida e a volta quadro a quadro sem parada e com saltos menores que os da main, a troca no meio sem
// teleporte e o plano sempre finito.
import { describe, expect, test } from "bun:test";

import type { GooRect } from "./goo.ts";
import { type GooGeom, gooDropPath, gooSizes, roundRect } from "./goo-shape.ts";
import {
  GOO_PLAN_HZ,
  GOO_PLAN_MAX_MS,
  type GooDrop,
  gooAnchor,
  gooAt,
  gooAtRest,
  gooButtons,
  gooMarks,
  gooParts,
  gooPlan,
  gooPlanMs,
  gooRest,
  gooRunProgress,
  gooStep,
} from "./goo-spring.ts";
import { box, points } from "./goo-test-path.ts";

/** Uma barra do Hub de exemplo, na janela de `W` px: a pílula no meio, 130 px de botões à esquerda e 90 à direita. */
function bar(W: number, side: "start" | "end"): GooGeom {
  const tabs: GooRect = { x: Math.round(W / 2 - 245), y: 10, w: 490, h: 32 };
  const target: GooRect = side === "end" ? { x: W - 16 - 90, y: 10, w: 90, h: 32 } : { x: 16, y: 10, w: 130, h: 32 };
  return { side, tabs, target, radius: 10 };
}
const BARS = [1000, 1600].flatMap((W) => (["end", "start"] as const).map((side) => ({ W, side, g: bar(W, side) })));
const g1000 = bar(1000, "end");

const edgeX = (g: GooGeom) => (g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x);
/** O quanto a forma vai para longe da pílula (px): a "frente" da gota. */
function reach(g: GooGeom, d: string): number {
  const xs = points(d).pts.map((p) => p[0]);
  if (!xs.length) return 0;
  return g.side === "end" ? Math.max(...xs) - edgeX(g) : edgeX(g) - Math.min(...xs);
}
const whole = (g: GooGeom, s: GooDrop) => {
  const p = gooParts(g, s);
  return p.edge + p.speck + p.head;
};
/** O avanço da frente a cada quadro. */
const deltas = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);
/** O maior salto de velocidade entre dois quadros vizinhos. */
const maxJump = (xs: number[]) => {
  const v = deltas(xs);
  return Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i]!)));
};
/** A ida e a volta a 60 Hz, quadro a quadro: a frente em cada um. */
const ida = (g: GooGeom) => gooPlan(g, gooRest(false, g), true, 60);
const volta = (g: GooGeom) => gooPlan(g, gooRest(true, g), false, 60);
/** A main, com o mesmo número de quadros de 60 Hz dos 500 ms da ida e dos 400 ms da volta. */
const mainIda = (g: GooGeom) => Array.from({ length: 31 }, (_, i) => reach(g, gooDropPath(i / 30, g)));
const mainVolta = (g: GooGeom) => Array.from({ length: 25 }, (_, i) => reach(g, gooDropPath(1 - i / 24, { ...g, back: true })));

describe("gooParts pelo estado", () => {
  test("o repouso: nos botões é o retângulo deles; na pílula, nada", () => {
    const g = g1000;
    const r = g.target;
    expect(gooParts(g, gooRest(true, g))).toEqual({ head: roundRect(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, 10), edge: "", speck: "" });
    expect(gooParts(g, gooRest(false, g))).toEqual({ head: "", edge: "", speck: "" });
    expect(gooAtRest(g, gooRest(true, g), true)).toBe(true);
    expect(gooAtRest(g, gooRest(false, g), false)).toBe(true);
    expect(gooAtRest(g, gooRest(false, g), true)).toBe(false);
    expect(gooButtons(g, gooRest(true, g))).toBe(1);
    expect(gooButtons(g, gooRest(false, g))).toBe(0);
  });

  test("a barriga: presa, a ponta da pílula estufa até `U`, com a altura quase inteira da pílula", () => {
    for (const { g } of BARS) {
      const m = gooMarks(g);
      for (const U of [2, m.Ub / 2, m.Ub]) {
        const d = gooParts(g, { U, v: 0.05, attached: true, tip: 0, since: 50 }).head;
        expect(points(d).subpaths).toBe(1);
        expect(reach(g, d)).toBeCloseTo(U, 0);
        const b = box(d);
        expect(b.b - b.t).toBeGreaterThan(g.tabs.h * 0.9);
      }
    }
  });

  test("o pescoço: a cabeça se afasta, cresce até a altura da gota solta e a ligação afina até o mínimo", () => {
    for (const { g } of BARS) {
      const m = gooMarks(g);
      const { head: HB, neck } = gooSizes(g.tabs.h, g.target.h);
      const d = gooParts(g, { U: m.Up - 0.01, v: 0.05, attached: true, tip: 0, since: 120 }).head;
      expect(d).toContain("A");
      // A ligação mais fina: a coluna de pontos com a menor altura, entre a pílula e a cabeça.
      const cy = g.tabs.y + g.tabs.h / 2;
      expect(d).toContain(`,${Math.round((cy - neck) * 100) / 100}`);
      expect(d).toContain(`,${Math.round((cy + neck) * 100) / 100}`);
      const b = box(d);
      expect((b.b - b.t) / 2).toBeCloseTo(HB, 0);
    }
  });

  test("a soltura: ao passar do pescoço a gota solta, o cone fica na beira e o respingo aparece só na ida", () => {
    for (const { g } of BARS) {
      const m = gooMarks(g);
      const go = ida(g);
      const i = go.findIndex((s) => !s.attached);
      expect(i).toBeGreaterThan(0);
      expect(go[i - 1]!.attached).toBe(true);
      expect(gooParts(g, go[i]!).edge).not.toBe("");
      expect(go[i]!.tip).toBeGreaterThan(0);
      expect(go[i]!.tip).toBeLessThanOrEqual(m.tip0);
      expect(go.some((s) => gooParts(g, s).speck !== "")).toBe(true);
      expect(volta(g).some((s) => gooParts(g, s).speck !== "")).toBe(false);
      // O cone volta para a pílula antes da chegada.
      expect(go.at(-1)!.tip).toBe(0);
    }
  });

  test("a chegada: passa um pouco do ponto, assenta nos botões e os botões entram no fim da corrida", () => {
    for (const { g } of BARS) {
      const m = gooMarks(g);
      const go = ida(g);
      const max = Math.max(...go.map((s) => s.U));
      expect(max).toBeGreaterThan(m.Ut);
      expect(max - m.Ut).toBeLessThan((m.Ut - m.Up) * 0.1);
      expect(gooAtRest(g, go.at(-1)!, true)).toBe(true);
      expect(gooAnchor(g, go.at(-1)!)).toEqual({ x: g.target.x + g.target.w / 2, y: g.target.y + g.target.h / 2 });
      const ops = go.map((s) => gooButtons(g, s));
      expect(ops.every((o, i) => i === 0 || !go[i]!.attached || o >= 0)).toBe(true);
      expect(go.filter((s) => s.attached).every((s) => gooButtons(g, s) === 0)).toBe(true);
      expect(gooButtons(g, go.at(-1)!)).toBe(1);
    }
  });

  test("no meio do caminho é lágrima, não lente: altura cheia, frente redonda, só a cauda afina", () => {
    for (const { g } of BARS) {
      const m = gooMarks(g);
      for (const p of [0.25, 0.4]) {
        for (const v of [0.3, -0.3]) {
          const U = m.Up + p * (m.Ut - m.Up);
          const d = gooParts(g, { U, v, attached: false, tip: 0, since: 200 }).head;
          const b = box(d);
          const h = b.b - b.t;
          const w = b.r - b.l;
          expect(h).toBeGreaterThan(g.target.h * 0.8);
          // Uma lente dos botões largos passava de 3:1; a lágrima fica perto de 2:1.
          expect(w / h).toBeLessThan(2.3);
          // A frente (o lado do movimento) é a ponta mais alta: redonda, com a altura cheia a ~1/4 do comprimento dela.
          const pts = points(d).pts;
          const toward = (v > 0) === (g.side === "end");
          const front = toward ? b.r - w / 4 : b.l + w / 4;
          const back = toward ? b.l + w / 4 : b.r - w / 4;
          const tall = (x: number) => {
            const col = pts.filter((q) => Math.abs(q[0] - x) < 3).map((q) => q[1]);
            return Math.max(...col) - Math.min(...col);
          };
          expect(tall(front)).toBeGreaterThan(tall(back));
          expect(tall(front)).toBeGreaterThan(h * 0.85);
        }
      }
    }
  });
});

describe("a ida e a volta quadro a quadro (60 Hz)", () => {
  for (const { W, side, g } of BARS) {
    test(`${W} px, lado ${side}: sem parada entre a largada e a chegada, e o maior salto abaixo do da main`, () => {
      const m = gooMarks(g);
      // Ida: da largada (o primeiro quadro em que a frente anda 1 px) à chegada (o primeiro estado nos botões).
      const go = ida(g);
      const fi = go.map((s) => reach(g, whole(g, s)));
      const vi = deltas(fi);
      const start = vi.findIndex((d) => d >= 1);
      const arrive = go.findIndex((s) => s.U >= m.Ut);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(arrive).toBeGreaterThan(start);
      // Os quadros antes da largada são o começo da mola (abaixo de 1 px), e sobem sem voltar.
      for (let i = 1; i < start; i++) expect(vi[i]!).toBeGreaterThanOrEqual(vi[i - 1]!);
      for (let i = start; i < arrive; i++) expect(vi[i]!).toBeGreaterThanOrEqual(1);
      expect(maxJump(fi)).toBeLessThan(maxJump(mainIda(g)));
      // Volta: anda para a pílula do primeiro quadro ao último antes de sumir (o último é a pílula engolindo o resto).
      const back = volta(g);
      const fv = back.map((s) => reach(g, whole(g, s)));
      const vv = deltas(fv);
      for (let i = 1; i < vv.length - 1; i++) expect(vv[i]!).toBeLessThanOrEqual(-1);
      expect(maxJump(fv)).toBeLessThan(maxJump(mainVolta(g)));
      expect(gooAtRest(g, back.at(-1)!, false)).toBe(true);
    });
  }

  test("no fim da volta a pílula suga: a gota entra nela com embalo, sem se arrastar até sumir", () => {
    for (const { g } of BARS) {
      const back = gooPlan(g, gooRest(true, g), false);
      const last = back.at(-2)!;
      expect(last.attached).toBe(true);
      // Sem a sucção ela chegava a 0,07 px/ms (pouco mais de 1 px por quadro de 60 Hz).
      expect(Math.abs(last.v)).toBeGreaterThan(0.1);
    }
  });

  test("o tempo acompanha a distância: na janela de 1600 px o pico de velocidade não dobra", () => {
    for (const side of ["end", "start"] as const) {
      const peak = (W: number) => Math.max(...deltas(ida(bar(W, side)).map((s) => reach(bar(W, side), whole(bar(W, side), s)))));
      const dist = (W: number) => gooMarks(bar(W, side)).Ut;
      expect(dist(1600) / dist(1000)).toBeGreaterThan(2);
      expect(peak(1600) / peak(1000)).toBeLessThan(2);
    }
  });

  test("a cabeça no compositor (`gooAnchor`) anda sem salto, também na soltura", () => {
    for (const { g } of BARS) {
      for (const plan of [gooPlan(g, gooRest(false, g), true), gooPlan(g, gooRest(true, g), false)]) {
        const xs = plan.map((s) => gooAnchor(g, s).x);
        const v = deltas(xs).map(Math.abs);
        const i = plan.findIndex((s, k) => k > 0 && s.attached !== plan[k - 1]!.attached);
        expect(i).toBeGreaterThan(0);
        // Na troca presa ↔ solta, a cabeça anda menos que o quadro mais rápido do caminho.
        expect(v[i - 1]!).toBeLessThanOrEqual(Math.max(...v));
        expect(Math.abs(gooAnchor(g, { ...plan[i]!, attached: true }).x - gooAnchor(g, { ...plan[i]!, attached: false }).x)).toBeLessThan(
          Math.abs(plan[i]!.U - gooMarks(g).Up) + 0.5,
        );
      }
    }
  });
});

describe("trocar no meio só troca o alvo", () => {
  for (const { W, side, g } of BARS) {
    test(`${W} px, lado ${side}: no meio da ida e da volta, a gota segue de onde está, sem teleporte`, () => {
      for (const [from, to] of [[false, true], [true, false]] as const) {
        const first = gooPlan(g, gooRest(from, g), to, 60);
        const normal = Math.max(...deltas(first.map((s) => reach(g, whole(g, s)))).map(Math.abs));
        for (const at of [0.2, 0.4, 0.6]) {
          const i = Math.round(first.length * at);
          const second = gooPlan(g, first[i]!, from, 60);
          // O 1º estado do plano novo é o do instante da troca (só a mola recomeça a entrar).
          expect({ ...second[0]!, since: 0 }).toEqual({ ...first[i]!, since: 0 });
          expect(second[0]!.since).toBe(0);
          const jump = Math.abs(reach(g, whole(g, second[1]!)) - reach(g, whole(g, first[i]!)));
          expect(jump).toBeLessThanOrEqual(normal);
          expect(gooAtRest(g, second.at(-1)!, from)).toBe(true);
        }
      }
    });
  }
});

describe("o plano é sempre finito", () => {
  const cap = Math.ceil(GOO_PLAN_MAX_MS / (1000 / GOO_PLAN_HZ)) + 1;

  test("acaba no repouso; a duração e o estado por tempo, presos nas pontas", () => {
    const plan = gooPlan(g1000, gooRest(false, g1000), true);
    expect(plan.length).toBeLessThanOrEqual(cap);
    expect(gooAtRest(g1000, plan.at(-1)!, true)).toBe(true);
    expect(gooPlanMs(plan)).toBeCloseTo(((plan.length - 1) * 1000) / GOO_PLAN_HZ);
    expect(gooAt(plan, -50)).toBe(plan[0]!);
    expect(gooAt(plan, 1e9)).toBe(plan.at(-1)!);
    expect(gooAt(plan, Number.NaN)).toBe(plan[0]!);
    expect(gooAt(plan, gooPlanMs(plan) / 2)).toBe(plan[Math.round((plan.length - 1) / 2)]!);
  });

  test("uma mola que não assenta (um número ruim no estado) acaba no teto, no repouso do alvo", () => {
    for (const has of [true, false]) {
      const plan = gooPlan(g1000, { U: Number.NaN, v: 0, attached: false, tip: 0, since: 0 }, has);
      expect(plan.length).toBeLessThanOrEqual(cap);
      expect(gooAtRest(g1000, plan.at(-1)!, has)).toBe(true);
    }
  });

  test("um `g` extremo, um `dt` enorme e o alvo trocando a cada quadro terminam", () => {
    const tabs: GooRect = { x: 400, y: 10, w: 200, h: 32 };
    const weird: GooGeom[] = [
      { side: "end", tabs, target: { x: 600, y: 10, w: 0, h: 32 } },
      { side: "end", tabs, target: { x: 600, y: 10, w: 1, h: 1 } },
      { side: "start", tabs, target: { x: 399, y: 10, w: 2, h: 32 } },
      { side: "end", tabs, target: { x: 50_000, y: 10, w: 64, h: 32 } },
      { side: "end", tabs: { ...tabs, h: 2 }, target: { x: 700, y: 10, w: 64, h: 2 } },
    ];
    for (const g of weird) {
      for (const has of [true, false]) {
        const plan = gooPlan(g, gooRest(!has, g), has);
        expect(plan.length).toBeLessThanOrEqual(cap);
        expect(gooAtRest(g, plan.at(-1)!, has)).toBe(true);
        for (const s of plan) for (const v of [s.U, s.v, s.tip]) expect(Number.isFinite(v)).toBe(true);
        for (const s of plan.filter((_, i) => i % 7 === 0)) {
          const parts = gooParts(g, s);
          expect(`${parts.head}${parts.edge}${parts.speck}`).not.toMatch(/NaN|Infinity/);
        }
      }
      expect(gooAtRest(g, gooStep(g, gooRest(false, g), true, 1e6), true)).toBe(true);
      // O alvo trocando a cada quadro: cada plano novo sai do 2º estado do anterior, e cada um termina.
      let s = gooRest(false, g);
      for (let k = 0; k < 60; k++) {
        const plan = gooPlan(g, s, k % 2 === 0);
        expect(plan.length).toBeLessThanOrEqual(cap);
        s = plan[Math.min(1, plan.length - 1)]!;
      }
      for (const v of [s.U, s.v, s.tip]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("o progresso da corrida fica entre 0 e 1", () => {
    const m = gooMarks(g1000);
    expect(gooRunProgress(g1000, 0)).toBe(0);
    expect(gooRunProgress(g1000, m.Up)).toBe(0);
    expect(gooRunProgress(g1000, m.Ut)).toBe(1);
    expect(gooRunProgress(g1000, m.Ut * 3)).toBe(1);
  });
});
