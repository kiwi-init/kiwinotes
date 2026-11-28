// Os pontos de um caminho SVG da gota (M, C, A, L, H, V, Z, como o goo-shape e o goo-spring escrevem), com as curvas e os
// arcos amostrados: para os testes medirem a forma sem navegador (T32464; a mesma conta do goo-shape.test.ts).

export type Pt = [number, number];

export function points(d: string): { pts: Pt[]; subpaths: number } {
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
      const [c1, c2, p1]: Pt[] = [[num(), num()], [num(), num()], [num(), num()]];
      const p0 = cur;
      for (let k = 1; k <= 16; k++) {
        const u = k / 16;
        const m = 1 - u;
        const f = (i: 0 | 1) => m * m * m * p0[i] + 3 * m * m * u * c1[i] + 3 * m * u * u * c2[i] + u * u * u * p1[i];
        pts.push([f(0), f(1)]);
      }
      cur = p1;
    } else if (cmd === "A") {
      const [rx0, ry0, , large, sweep, x, y] = [num(), num(), num(), num(), num(), num(), num()];
      pts.push(...arc(cur, [x, y], rx0, ry0, large === 1, sweep === 1));
      cur = [x, y];
    }
  }
  return { pts, subpaths };
}

/** O arco SVG sem rotação, amostrado (a conversão de pontas para centro da especificação do SVG). */
export function arc(p0: Pt, p1: Pt, rx: number, ry: number, large: boolean, sweep: boolean): Pt[] {
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

export function box(d: string) {
  const { pts } = points(d);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

