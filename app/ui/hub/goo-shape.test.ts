// A forma da gota quadro a quadro (T18948): os tempos do desenho de referência, o espelho dos dois lados, o fim nos
// botões e nenhum salto entre quadros vizinhos.
import { describe, expect, test } from "bun:test";

import type { GooRect } from "./goo.ts";
import { GOO_BEATS, type GooGeom, gooDropParts, gooDropPath, gooSizes, roundRect } from "./goo-shape.ts";

type Pt = [number, number];

/** Os pontos de um caminho (M, C, A, L, H, V, Z, como o goo-shape escreve): os das curvas pelo polígono de controle, os
 *  arcos amostrados pelo centro. Dá a caixa e o número de pedaços (subcaminhos). */
function points(d: string): { pts: Pt[]; subpaths: number } {
  const tok = d.match(/[MCALHVZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = [0, 0];
  let cmd = "";
  let subpaths = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Z]/.test(tok[i]!)) cmd = tok[i++]!;
    if (cmd === "Z") continue;
    if (cmd === "M") (cur = [num(), num()], pts.push(cur), subpaths++);
    else if (cmd === "L") (cur = [num(), num()], pts.push(cur));
    else if (cmd === "H") (cur = [num(), cur[1]], pts.push(cur));
    else if (cmd === "V") (cur = [cur[0], num()], pts.push(cur));
    else if (cmd === "C") {
      for (let k = 0; k < 3; k++) pts.push([num(), num()]);
      cur = pts.at(-1)!;
    } else if (cmd === "A") {
      const [rx0, ry0, , large, sweep, x, y] = [num(), num(), num(), num(), num(), num(), num()];
      pts.push(...arc(cur, [x, y], rx0, ry0, large === 1, sweep === 1));
      cur = [x, y];
    }
  }
  return { pts, subpaths };
}

/** O arco SVG sem rotação, amostrado (a conversão de pontas para centro da especificação do SVG). */
function arc(p0: Pt, p1: Pt, rx: number, ry: number, large: boolean, sweep: boolean): Pt[] {
  const x1p = (p0[0] - p1[0]) / 2;
  const y1p = (p0[1] - p1[1]) / 2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) (rx *= Math.sqrt(lam), ry *= Math.sqrt(lam));
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cxp + (p0[0] + p1[0]) / 2;
  const cy = cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const a0 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let da = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && da > 0) da -= 2 * Math.PI;
  if (sweep && da < 0) da += 2 * Math.PI;
  return Array.from({ length: 33 }, (_, k) => [cx + rx * Math.cos(a0 + (da * k) / 32), cy + ry * Math.sin(a0 + (da * k) / 32)] as Pt);
}

function box(d: string) {
  const { pts } = points(d);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

// Uma barra de exemplo: a pílula de abas no meio e um grupo de botões de cada lado, à mesma distância dela.
const tabs: GooRect = { x: 400, y: 10, w: 200, h: 32 };
const end: GooGeom = { side: "end", tabs, target: { x: 700, y: 10, w: 64, h: 32 }, radius: 10 };
const start: GooGeom = { side: "start", tabs, target: { x: 236, y: 10, w: 64, h: 32 }, radius: 10 };
const right = tabs.x + tabs.w;
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("os tempos da referência", () => {
  test("parada, não há gota", () => {
    expect(gooDropParts(0, end)).toEqual({ head: "", edge: "", speck: "" });
    expect(gooDropPath(-1, end)).toBe("");
  });

  test("barriga e pescoço: uma forma só, presa à pílula, que cresce para fora", () => {
    let reach = 0;
    for (const t of steps(40).filter((t) => t > 0 && t < GOO_BEATS.pinch)) {
      const p = gooDropParts(t, end);
      expect(p.edge + p.speck).toBe("");
      expect(points(p.head).subpaths).toBe(1);
      const b = box(p.head)!;
      // Os ombros começam atrás da pílula (escondidos por ela)...
      expect(b.l).toBeLessThan(right);
      // ...e a ponta só vai para fora.
      expect(b.r).toBeGreaterThanOrEqual(reach - 0.01);
      reach = b.r;
    }
    expect(reach - right).toBeGreaterThan(tabs.h * 0.9);
  });

  test("a barriga começa rasa e larga: mais alta do que funda", () => {
    const b = box(gooDropParts(GOO_BEATS.belly * 0.3, end).head)!;
    expect(b.b - b.t).toBeGreaterThan(2 * (b.r - right));
  });

  test("solta: a gota longe da pílula, o cone na beira e o respingo entre os dois", () => {
    const p = gooDropParts(GOO_BEATS.pinch + 0.02, end);
    const head = box(p.head)!;
    const edge = box(p.edge)!;
    const speck = box(p.speck)!;
    expect(head.l).toBeGreaterThan(right);
    expect(edge.l).toBeLessThan(right);
    expect(speck.l).toBeGreaterThan(edge.r);
    expect(speck.r).toBeLessThan(head.l);
    // O respingo é pequeno perto da gota.
    expect(speck.r - speck.l).toBeLessThan((head.b - head.t) / 3);
  });

  test("na volta, sem respingo: ele só existe na ida", () => {
    for (const t of steps(100)) expect(gooDropParts(t, { ...end, back: true }).speck).toBe("");
    expect(gooDropParts(GOO_BEATS.pinch + 0.02, { ...end, back: true }).edge).not.toBe("");
  });

  test("depois de assentar, a beira está reta de novo e o respingo sumiu", () => {
    for (const t of [GOO_BEATS.settle + 0.01, GOO_BEATS.arrive, 0.95, 1]) {
      const p = gooDropParts(t, end);
      expect(p.edge).toBe("");
      expect(p.speck).toBe("");
    }
  });

  test("no fim, a gota é exatamente o retângulo dos botões", () => {
    expect(gooDropParts(1, end).head).toBe(roundRect(732, 26, 64, 32, 10));
    expect(gooDropParts(1, start).head).toBe(roundRect(268, 26, 64, 32, 10));
  });
});

describe("o volume e o movimento (#19016)", () => {
  const h = (d: string) => (box(d)!.b - box(d)!.t);
  const w = (d: string) => (box(d)!.r - box(d)!.l);

  test("a barriga já toma a ponta inteira da pílula", () => {
    expect(h(gooDropParts(GOO_BEATS.belly - 0.01, end).head)).toBeGreaterThanOrEqual(tabs.h * 0.9);
  });

  test("a gota solta já tem quase a altura dos botões: não nasce bolinha", () => {
    for (const t of [GOO_BEATS.pinch + 0.005, (GOO_BEATS.pinch + GOO_BEATS.arrive) / 2, GOO_BEATS.arrive]) {
      expect(h(gooDropParts(t, end).head)).toBeGreaterThanOrEqual(end.target.h * 0.75);
    }
  });

  test("no caminho, a gota é mais comprida que alta, e mais no meio, onde vai mais rápido", () => {
    const ratio = (t: number) => w(gooDropParts(t, end).head) / h(gooDropParts(t, end).head);
    const mid = (GOO_BEATS.pinch + GOO_BEATS.arrive) / 2;
    for (const t of steps(20).map((s) => GOO_BEATS.pinch + 0.005 + s * (GOO_BEATS.arrive - GOO_BEATS.pinch - 0.01))) {
      expect(ratio(t)).toBeGreaterThan(1.2);
    }
    expect(ratio(mid)).toBeGreaterThan(ratio(GOO_BEATS.pinch + 0.01));
  });

  test("na chegada, amassa: passa da largura dos botões e volta", () => {
    expect(w(gooDropParts(GOO_BEATS.arrive + 0.005, end).head)).toBeGreaterThan(end.target.w);
    const widths = steps(40).map((s) => w(gooDropParts(GOO_BEATS.arrive + s * (0.999 - GOO_BEATS.arrive), end).head));
    expect(Math.min(...widths)).toBeLessThan(end.target.w);
    expect(Math.abs(widths.at(-1)! - end.target.w)).toBeLessThan(1);
  });

  test("o pescoço mais fino fica mais largo que o traço de 2 px (não some no escuro)", () => {
    expect(2 * gooSizes(32).neck).toBeGreaterThan(2);
  });
});

describe("o desenho", () => {
  test("os dois lados são o espelho um do outro", () => {
    const mirror = (x: number) => 2 * (tabs.x + tabs.w / 2) - x;
    for (const t of steps(20)) {
      const a = points(gooDropPath(t, start)).pts.map(([x, y]) => `${mirror(x).toFixed(1)},${y.toFixed(1)}`).sort();
      const b = points(gooDropPath(t, end)).pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).sort();
      // Os arcos são amostrados a partir de pontas diferentes; a caixa basta.
      const ba = box(a.map((p) => `M${p}`).join("") || "M0,0")!;
      const bb = box(b.map((p) => `M${p}`).join("") || "M0,0")!;
      for (const k of ["l", "r", "t", "b"] as const) expect(Math.abs(ba[k] - bb[k])).toBeLessThan(0.2);
    }
  });

  test("nenhum salto entre quadros vizinhos (a cada 1%)", () => {
    // A forma inteira de um quadro para o outro, inclusive quando a gota se solta (a presa vira o cone + a solta). Só
    // quando uma parte some (o cone volta para dentro da pílula, o respingo acaba), cada parte que fica com ela mesma.
    const KEYS = ["head", "edge", "speck"] as const;
    const diff = (x: ReturnType<typeof box>, y: ReturnType<typeof box>) =>
      x && y ? Math.max(Math.abs(x.l - y.l), Math.abs(x.r - y.r), Math.abs(x.t - y.t), Math.abs(x.b - y.b)) : 0;
    let worst = 0;
    for (const t of steps(100).filter((t) => t > 0.01)) {
      const a = gooDropParts(t - 0.01, end);
      const b = gooDropParts(t, end);
      const lost = KEYS.some((k) => a[k] && !b[k]);
      const step = lost
        ? Math.max(...KEYS.map((k) => diff(box(a[k]), box(b[k]))))
        : diff(box(a.edge + a.speck + a.head), box(b.edge + b.speck + b.head));
      worst = Math.max(worst, step);
    }
    expect(worst).toBeLessThan(8);
  });

  test("o cone some já recolhido, rente à beira da pílula", () => {
    const e = box(gooDropParts(GOO_BEATS.settle - 0.005, end).edge)!;
    expect(e.r).toBeLessThan(right + 0.5);
  });

  test("nada sai da altura da barra (a gota não cobre o que está embaixo)", () => {
    for (const t of steps(50)) {
      const b = box(gooDropPath(t, end));
      if (!b) continue;
      expect(b.t).toBeGreaterThanOrEqual(tabs.y - 1);
      expect(b.b).toBeLessThanOrEqual(tabs.y + tabs.h + 1);
    }
  });

  test("tempos ajustáveis: a coreografia muda os números e a forma acompanha", () => {
    const beats = { belly: 0.1, pinch: 0.3, settle: 0.5, arrive: 0.8 };
    expect(gooDropParts(0.32, end, beats).edge).not.toBe("");
    expect(gooDropParts(0.32, end).edge).toBe("");
  });
});
