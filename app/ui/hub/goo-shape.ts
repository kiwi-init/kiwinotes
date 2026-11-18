// A forma da gota, desenhada quadro a quadro (spec #17725, Gota 2, T18948). Sem filtro: para cada `t` da ida (0 → 1),
// um caminho SVG com o que estiver na tela naquele quadro. A volta é o mesmo caminho, com `t` de 1 a 0.
//
// Os tempos, na ordem do desenho de referência (a barra deitada: a gota sai pelo lado da pílula de abas):
// 1. barriga: a beira da pílula estufa, larga e rasa, e vai fundando;
// 2. pescoço: os ombros entram, a barriga vira um pescoço e a cabeça vira uma lágrima; o pescoço afina até 1 px;
// 3. solta: o pescoço parte. Na beira fica um cone, que arredonda e volta a ficar reto; entre os dois fica um
//    respingo pequeno, que some; a cabeça perde a ponta e fica redonda;
// 4. corre: a cabeça vai até o lugar dos botões e vira o retângulo arredondado deles.
//
// Coordenadas locais: `u` é a distância para fora da beira da pílula (o lado `end` vai para a direita, o `start` para a
// esquerda) e `v` é a altura a partir do meio da pílula. A forma fica atrás da pílula: o que estiver em `u < 0` some
// atrás dela, e o anel da pílula fica visível na junção, como a linha da caixa na referência.

import type { GooRect, GooSide } from "./goo.ts";

/** Os tempos da ida, em frações de `t`. A coreografia (T18949) ajusta estes números e a duração. */
export const GOO_BEATS = {
  /** Até aqui, a barriga. */
  belly: 0.2,
  /** Até aqui, o pescoço; aqui ele parte. */
  pinch: 0.46,
  /** Até aqui, o cone da beira volta a ficar reto, o respingo some e a cabeça perde a ponta. */
  settle: 0.68,
} as const;

export type GooBeats = { belly: number; pinch: number; settle: number };

export interface GooGeom {
  side: GooSide;
  /** A pílula de abas, na barra. */
  tabs: GooRect;
  /** Os botões deste lado, na barra: onde a gota termina. */
  target: GooRect;
  /** O raio dos cantos dos botões (o `--r-ctl`). */
  radius?: number;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (s: number) => 1 - (1 - s) ** 3;
const easeInOut = (s: number) => (s < 0.5 ? 4 * s ** 3 : 1 - (-2 * s + 2) ** 3 / 2);
const smooth = (s: number) => s * s * (3 - 2 * s);
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

/** As medidas da gota, tiradas da altura da pílula (32 px no Hub). */
export function gooSizes(h: number) {
  return {
    /** O raio da cabeça. */
    head: h * 0.3,
    /** Meia altura da base da barriga, na beira. */
    base: h * 0.38,
    /** O comprimento do pescoço, da beira ao centro da cabeça, quando parte. */
    reach: h * 0.85,
    /** O raio do respingo. */
    speck: Math.max(1.5, h * 0.06),
  };
}

/** As partes de um quadro, cada uma um caminho SVG (vazio quando não está na tela): a gota presa à pílula ou solta
 *  (`head`, a que vira os botões), o cone que fica na beira depois de soltar (`edge`) e o respingo (`speck`). */
export interface GooParts {
  head: string;
  edge: string;
  speck: string;
}

const NONE: GooParts = { head: "", edge: "", speck: "" };

/** O caminho SVG da gota inteira no quadro `t` (0 a 1), na barra. */
export function gooDropPath(t: number, g: GooGeom, beats: GooBeats = GOO_BEATS): string {
  const p = gooDropParts(t, g, beats);
  return p.edge + p.speck + p.head;
}

/** As partes da gota no quadro `t` (0 a 1), na barra. */
export function gooDropParts(t: number, g: GooGeom, beats: GooBeats = GOO_BEATS): GooParts {
  t = clamp(t);
  if (t <= 0) return NONE;
  const dir = g.side === "end" ? 1 : -1;
  const x0 = g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x;
  const cy = g.tabs.y + g.tabs.h / 2;
  const { head: R, base: B, reach, speck } = gooSizes(g.tabs.h);
  const P = (u: number, v: number) => `${n2(x0 + dir * u)},${n2(cy + v)}`;
  // O arco do lado de fora da cabeça: horário na tela para a direita, anti-horário espelhado.
  const sweep = dir > 0 ? 1 : 0;

  // Os ombros saem da ponta redonda da pílula pela tangente dela: a barriga parece a própria ponta estufando.
  const rp = g.tabs.h / 2;
  const shoulder = (b: number) => {
    const ua = -(rp - Math.sqrt(Math.max(0, rp * rp - b * b)));
    const len = Math.hypot(b, ua + rp) || 1;
    // A tangente, de cima para fora: anda em `u` e desce para o meio.
    return { ua, tu: b / len, tv: (ua + rp) / len };
  };

  // 1. A barriga: a ponta estufa, larga e rasa, e vai fundando, com o fundo redondo.
  if (t < beats.belly) {
    const s = easeOut(span(t, 0, beats.belly));
    const d = R * 1.2 * s;
    const b = B;
    const { ua, tu, tv } = shoulder(b);
    // O fundo é largo (os pontos de controle perto dos ombros): uma barriga, não uma ponta.
    const k = (d - ua) * 0.55;
    const head =
      `M${P(ua, -b)}C${P(ua + tu * k, -b + tv * k)} ${P(d, -b * 0.85)} ${P(d, 0)}` +
      `C${P(d, b * 0.85)} ${P(ua + tu * k, b - tv * k)} ${P(ua, b)}Z`;
    return { ...NONE, head };
  }

  // 2. O pescoço: a cabeça se afasta e se alonga numa lágrima, os ombros entram e o pescoço afina até 1 px.
  if (t < beats.pinch) {
    const s = span(t, beats.belly, beats.pinch);
    const rx = R * lerp(1, 1.18, s);
    const ry = R * lerp(1, 0.94, s);
    const cu = lerp(R * 1.2 - rx, reach, easeInOut(s));
    const neck = lerp(ry * 0.8, 0.5, smooth(s));
    const b = lerp(B, B * 0.78, s);
    const { ua, tu, tv } = shoulder(b);
    // O ponto onde o pescoço encontra a cabeça, em cima da elipse.
    const un = cu - rx * Math.sqrt(1 - (neck / ry) ** 2);
    const k = Math.max(1, un - ua) * 0.45;
    const head =
      `M${P(ua, -b)}C${P(ua + tu * k, -b + tv * k)} ${P(un - k * 0.8, -neck)} ${P(un, -neck)}` +
      `A${n2(rx)} ${n2(ry)} 0 1 ${sweep} ${P(un, neck)}` +
      `C${P(un - k * 0.8, neck)} ${P(ua + tu * k, b - tv * k)} ${P(ua, b)}Z`;
    return { ...NONE, head };
  }

  // 3 e 4. Solta: o fio parte onde estava o pescoço (`bp`). Na beira fica o cone, que volta para a pílula; no ponto
  // do corte, o respingo, que aparece com a folga e some; a cabeça, com a ponta virada para o corte, corre e vira os
  // botões. A cabeça na hora de soltar tem a frente onde a lágrima do pescoço tinha (o raio maior, 1.18).
  const parts: GooParts = { ...NONE };
  const st = span(t, beats.pinch, beats.settle);
  const e = easeOut(st);
  const bp = reach - R * 1.18;
  if (st < 1) {
    // O cone da beira: pontudo logo depois de partir, arredonda e afunda na pílula.
    const tip = (bp - 1) * (1 - e);
    const sh = B * 0.78;
    const { ua, tu, tv } = shoulder(sh);
    const k = Math.max(1, tip - ua) * 0.45;
    const w = lerp(0, sh * 0.6, smooth(st));
    parts.edge =
      `M${P(ua, -sh)}C${P(ua + tu * k, -sh + tv * k)} ${P(tip, -w)} ${P(tip, 0)}` +
      `C${P(tip, w)} ${P(ua + tu * k, sh - tv * k)} ${P(ua, sh)}Z`;
    // O respingo: cresce com a folga entre o cone e a gota e encolhe até sumir.
    const r = speck * Math.sin(Math.PI * Math.min(1, st * 1.25));
    if (r > 0.2) {
      const su = bp + R * 0.25 * st;
      parts.speck = `M${P(su - r, 0)}A${n2(r)} ${n2(r)} 0 1 0 ${P(su + r, 0)}A${n2(r)} ${n2(r)} 0 1 0 ${P(su - r, 0)}Z`;
    }
  }

  // A cabeça: corre do ponto onde soltou até o meio dos botões.
  const run = easeInOut(span(t, beats.pinch, 1));
  const tu = dir > 0 ? g.target.x + g.target.w / 2 - x0 : x0 - (g.target.x + g.target.w / 2);
  const tv = g.target.y + g.target.h / 2 - cy;
  const c0 = reach + R * 0.18;
  const cu = lerp(c0, tu, run);
  const cv = lerp(0, tv, run);
  // A ponta começa logo depois do corte e encolhe até a cabeça ficar redonda.
  const tail0 = c0 - R - (bp + 1);
  const tail = tail0 * (1 - e);
  if (tail > 0.3) {
    const tp = cu - R - tail;
    const q = 1 - tail / Math.max(tail0, 0.01);
    parts.head =
      `M${P(tp, cv)}C${P(tp + tail * 0.3, cv - R * 0.4 * (0.3 + q))} ${P(cu - R * 0.55, cv - R)} ${P(cu, cv - R)}` +
      `A${n2(R)} ${n2(R)} 0 0 ${sweep} ${P(cu + R, cv)}A${n2(R)} ${n2(R)} 0 0 ${sweep} ${P(cu, cv + R)}` +
      `C${P(cu - R * 0.55, cv + R)} ${P(tp + tail * 0.3, cv + R * 0.4 * (0.3 + q))} ${P(tp, cv)}Z`;
  } else {
    // Redonda, e no fim o retângulo arredondado dos botões.
    const m = smooth(span(run, 0.5, 1));
    parts.head = roundRect(x0 + dir * cu, cy + cv, lerp(2 * R, g.target.w, m), lerp(2 * R, g.target.h, m), lerp(R, g.radius ?? 10, m));
  }
  return parts;
}

/** Um retângulo arredondado pelo centro (com `w = h = 2r`, um círculo). */
export function roundRect(cx: number, cy: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  const l = cx - w / 2;
  const top = cy - h / 2;
  const R = n2(r);
  return (
    `M${n2(l + r)},${n2(top)}H${n2(l + w - r)}A${R} ${R} 0 0 1 ${n2(l + w)},${n2(top + r)}` +
    `V${n2(top + h - r)}A${R} ${R} 0 0 1 ${n2(l + w - r)},${n2(top + h)}` +
    `H${n2(l + r)}A${R} ${R} 0 0 1 ${n2(l)},${n2(top + h - r)}` +
    `V${n2(top + r)}A${R} ${R} 0 0 1 ${n2(l + r)},${n2(top)}Z`
  );
}
