// A forma da gota, desenhada quadro a quadro (spec #17725, Gota 2, T18948). Sem filtro: para cada `t` da ida (0 → 1),
// um caminho SVG com o que estiver na tela naquele quadro. A volta é o mesmo caminho, com `t` de 1 a 0: o botão vira
// uma lágrima do tamanho dele, anda, toca a pílula, abre o pescoço e é sugado.
//
// Os tempos, na ordem do desenho de referência (a barra deitada: a gota sai pelo lado da pílula de abas):
// 1. barriga: a ponta inteira da pílula estufa, larga e rasa, e vai fundando;
// 2. pescoço: os ombros entram, a barriga vira um pescoço e a cabeça cresce até quase a altura dos botões;
// 3. solta: o pescoço parte. Na beira fica um cone, que volta para a pílula; entre os dois, um respingo pequeno;
// 4. corre: a gota, uma lágrima com a ponta para trás, estica no sentido do movimento;
// 5. chega: amassa no retângulo dos botões e assenta com uma mola.
// O volume fica quase o mesmo do começo ao fim: a gota não nasce bolinha para inchar no fim (#19016).
//
// Coordenadas locais: `u` é a distância para fora da beira da pílula (o lado `end` vai para a direita, o `start` para a
// esquerda) e `v` é a altura a partir do meio da pílula. A forma fica atrás da pílula: o que estiver em `u < 0` some
// atrás dela, e o anel da pílula fica visível na junção, como a linha da caixa na referência.

import type { GooRect, GooSide } from "./goo.ts";

/** Os tempos da ida, em frações de `t`. A coreografia (T18949) ajusta estes números e a duração. */
export const GOO_BEATS = {
  /** Até aqui, a barriga. */
  belly: 0.16,
  /** Até aqui, o pescoço; aqui ele parte. */
  pinch: 0.42,
  /** Até aqui, o cone volta para a pílula e o respingo some. */
  settle: 0.6,
  /** Aqui a gota chega aos botões; dali ao fim, amassa e assenta. */
  arrive: 0.82,
} as const;

export type GooBeats = { belly: number; pinch: number; settle: number; arrive: number };

export interface GooGeom {
  side: GooSide;
  /** A pílula de abas, na barra. */
  tabs: GooRect;
  /** Os botões deste lado, na barra: onde a gota termina. */
  target: GooRect;
  /** O raio dos cantos dos botões (o `--r-ctl`). */
  radius?: number;
  /** Na volta (`t` de 1 a 0): sem respingo, que só existe na ida, como na referência (#19075). */
  back?: boolean;
}

/** As partes de um quadro, cada uma um caminho SVG (vazio quando não está na tela): a gota presa à pílula ou solta
 *  (`head`, a que vira os botões), o cone que fica na beira depois de soltar (`edge`) e o respingo (`speck`). */
export interface GooParts {
  head: string;
  edge: string;
  speck: string;
}

const NONE: GooParts = { head: "", edge: "", speck: "" };
const K = 0.5523; // o ponto de controle de um quarto de elipse

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (s: number) => 1 - (1 - s) ** 3;
const smooth = (s: number) => s * s * (3 - 2 * s);
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

/** As medidas da gota: `h` é a altura da pílula, `th` a dos botões (32 px os dois, no Hub). */
export function gooSizes(h: number, th = h) {
  const head = Math.min(h, th) * 0.44;
  return {
    /** Meia altura da barriga na beira: quase a ponta inteira da pílula. */
    base: (h / 2) * 0.95,
    /** Meia altura da gota solta: perto da dos botões. */
    head,
    /** Da beira ao centro da gota, quando o pescoço parte. */
    reach: head * 1.3 + h * 0.55,
    /** O raio do respingo. */
    speck: Math.max(1.5, h * 0.07),
    /** Meia largura do pescoço mais fino: o pescoço fica acima dos 2 px do traço, e o anel não some no escuro. */
    neck: 1.6,
  };
}

/** O caminho SVG da gota inteira no quadro `t` (0 a 1), na barra. */
export function gooDropPath(t: number, g: GooGeom, beats: GooBeats = GOO_BEATS): string {
  const p = gooDropParts(t, g, beats);
  return p.edge + p.speck + p.head;
}

/** As partes da gota no quadro `t` (0 a 1), na barra. */
export function gooDropParts(t: number, g: GooGeom, beats: GooBeats = GOO_BEATS): GooParts {
  t = clamp(t);
  if (t <= 0) return NONE;
  const radius = g.radius ?? 10;
  if (t >= 1) return { ...NONE, head: roundRect(g.target.x + g.target.w / 2, g.target.y + g.target.h / 2, g.target.w, g.target.h, radius) };
  const dir = g.side === "end" ? 1 : -1;
  const x0 = g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x;
  const cy = g.tabs.y + g.tabs.h / 2;
  const { base: B, head: HB, reach, speck, neck: NECK } = gooSizes(g.tabs.h, g.target.h);
  const P = (u: number, v: number) => `${n2(x0 + dir * u)},${n2(cy + v)}`;
  // O arco que anda no sentido do relógio na tela, para a direita; espelhado, ao contrário.
  const sweep = dir > 0 ? 1 : 0;

  // Os ombros saem da ponta redonda da pílula pela tangente dela: a barriga parece a própria ponta estufando.
  const rp = g.tabs.h / 2;
  const shoulder = (b: number) => {
    const ua = -(rp - Math.sqrt(Math.max(0, rp * rp - b * b)));
    const len = Math.hypot(b, ua + rp) || 1;
    return { ua, tu: b / len, tv: (ua + rp) / len };
  };

  // A gota solta: cada ponta (a frente, `+u`, e a de trás) tem os cantos de raio `rx`/`ry` e fecha redonda (`point` 0)
  // ou numa ponta de lágrima (1): afilada mas convexa, a curva chega nela ainda inclinada, sem bico côncavo.
  type End = { rx: number; ry: number; point: number };
  const blob = (cu: number, cv: number, af: number, ab: number, b: number, fe: End, be: End) => {
    const frx = Math.max(0.5, Math.min(fe.rx, af + ab));
    const fry = Math.max(0.5, Math.min(fe.ry, b));
    const brx = Math.max(0.5, Math.min(be.rx, af + ab - frx));
    const bry = Math.max(0.5, Math.min(be.ry, b));
    const uf = cu + af;
    const ub = cu - ab;
    const f2u = lerp(uf, uf - frx * 0.12, fe.point);
    const f2v = lerp(b - fry * (1 - K), b - fry * 0.62, fe.point);
    const b2u = lerp(ub, ub + brx * 0.12, be.point);
    const b2v = lerp(b - bry * (1 - K), b - bry * 0.62, be.point);
    return (
      `M${P(uf - frx, cv - b)}C${P(uf - frx * (1 - K), cv - b)} ${P(f2u, cv - f2v)} ${P(uf, cv - b + fry)}` +
      `L${P(uf, cv + b - fry)}C${P(f2u, cv + f2v)} ${P(uf - frx * (1 - K), cv + b)} ${P(uf - frx, cv + b)}` +
      `L${P(ub + brx, cv + b)}C${P(ub + brx * (1 - K), cv + b)} ${P(b2u, cv + b2v)} ${P(ub, cv + b - bry)}` +
      `L${P(ub, cv - b + bry)}C${P(b2u, cv - b2v)} ${P(ub + brx * (1 - K), cv - b)} ${P(ub + brx, cv - b)}Z`
    );
  };

  // 1. A barriga: a ponta inteira estufa, larga e rasa, e vai fundando, com o fundo redondo.
  const dBelly = g.tabs.h * 0.6;
  if (t < beats.belly) {
    const s = easeOut(span(t, 0, beats.belly));
    const d = dBelly * s;
    const { ua, tu, tv } = shoulder(B);
    const k = (d - ua) * 0.55;
    const head =
      `M${P(ua, -B)}C${P(ua + tu * k, -B + tv * k)} ${P(d, -B * 0.85)} ${P(d, 0)}` +
      `C${P(d, B * 0.85)} ${P(ua + tu * k, B - tv * k)} ${P(ua, B)}Z`;
    return { ...NONE, head };
  }

  // 2. O pescoço: a cabeça se afasta, cresce até a altura da gota solta e se alonga numa lágrima; os ombros entram e o
  // pescoço afina até o mínimo.
  const ry1 = HB;
  const rx1 = HB * 1.3;
  if (t < beats.pinch) {
    const s = span(t, beats.belly, beats.pinch);
    const ry = lerp(B * 0.88, ry1, smooth(s));
    const rx = lerp(B * 0.88, rx1, smooth(s));
    const cu = lerp(dBelly - B * 0.88, reach, smooth(s));
    const neck = lerp(ry * 0.85, NECK, smooth(s));
    const b = lerp(B, B * 0.62, s);
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

  // 3 a 5. Solta: o fio parte onde estava o pescoço (`bp`).
  const parts: GooParts = { ...NONE };
  const bp = reach - rx1 * Math.sqrt(1 - (NECK / ry1) ** 2);
  const tu = dir > 0 ? g.target.x + g.target.w / 2 - x0 : x0 - (g.target.x + g.target.w / 2);
  const tv = g.target.y + g.target.h / 2 - cy;
  // A gota solta é sempre lágrima (#19093): a ponta que vai na frente é um semicírculo da altura dela, e só a cauda
  // afina para trás. Na ida a frente redonda vai para os botões; na volta, para a pílula (a cauda fica nos botões).
  // Estica no máximo ~1.6:1 e não fica mais baixa que ~80% dos botões.
  const bT = Math.min(HB, g.target.h * 0.45);
  const d = 0.25 * bT; // o quanto a cauda passa da metade, na chegada (comprimento total 2.5 bT)

  let head: { cu: number; cv: number; af: number; ab: number; b: number; fe: End; be: End };
  if (t < beats.arrive) {
    // Corre: da lágrima que soltou até a chegada. A cauda estica mais no meio do caminho, onde vai mais rápido.
    const r = span(t, beats.pinch, beats.arrive);
    const m = smooth(r);
    const speed = Math.sin(Math.PI * r);
    const b = lerp(ry1, bT, m) * (1 - 0.05 * speed);
    // A frente vira semicírculo logo depois de soltar (a elipse do pescoço arredonda no primeiro quinto da corrida).
    const round = lerp(rx1, b, smooth(span(r, 0, 0.2)));
    const tail = lerp(reach - bp - 1, bT * 1.5, m) + 0.55 * bT * speed;
    // Na volta (`r` de 1 a 0), a ponta redonda vai na frente, para a pílula; só perto dela (`r` < 0.3) a gota vira
    // e a ponta afilada encosta na pílula, onde o pescoço se forma.
    const sw = g.back ? smooth(span(r, 0, 0.3)) : 0;
    const af = lerp(round, tail, sw);
    const ab = lerp(tail, round, sw);
    const cu = lerp(reach, tu + (ab - af) / 2, m);
    head = {
      cu, cv: lerp(0, tv, m), af, ab, b,
      fe: { rx: af, ry: b, point: sw }, be: { rx: ab, ry: b, point: 1 - sw },
    };
  } else {
    // Chega: a lágrima amassa no retângulo dos botões, passa um pouco do ponto e assenta (uma mola).
    const q = span(t, beats.arrive, 1);
    const f = Math.cos(2.4 * Math.PI * q) * (1 - q) ** 2;
    // Passa do ponto pouco (a mola, -0.12): passar muito da largura dos botões deixa o anel por fora deles.
    const w = g.target.w + (2 * (bT + d) - g.target.w) * Math.max(f, -0.12);
    const h = g.target.h + (2 * bT - g.target.h) * Math.max(f, -0.25);
    const sd = g.back ? -d : d;
    const af = w / 2 - sd * f;
    const ab = w / 2 + sd * f;
    const c = smooth(Math.min(1, q * 2.5));
    const rr = Math.min(radius, w / 2, h / 2);
    const pt = 1 - c;
    head = {
      cu: tu + (ab - af) / 2, cv: tv, af, ab, b: h / 2,
      fe: { rx: lerp(af, rr, c), ry: lerp(h / 2, rr, c), point: g.back ? pt : 0 },
      be: { rx: lerp(ab, rr, c), ry: lerp(h / 2, rr, c), point: g.back ? 0 : pt },
    };
  }
  parts.head = blob(head.cu, head.cv, head.af, head.ab, head.b, head.fe, head.be);

  const st = span(t, beats.pinch, beats.settle);
  if (st < 1) {
    // O cone da beira: pontudo logo depois de partir, arredonda e afunda na pílula.
    const tip = (bp - 1) * (1 - easeOut(st));
    const sh = B * 0.62;
    const { ua, tu: su, tv: sv } = shoulder(sh);
    const k = Math.max(1, tip - ua) * 0.45;
    const w = lerp(NECK, sh * 0.6, smooth(st));
    parts.edge =
      `M${P(ua, -sh)}C${P(ua + su * k, -sh + sv * k)} ${P(tip, -w)} ${P(tip, 0)}` +
      `C${P(tip, w)} ${P(ua + su * k, sh - sv * k)} ${P(ua, sh)}Z`;
    // O respingo: no meio da folga entre o cone e a ponta da gota, cresce e some.
    const tail = head.cu - head.ab;
    const rs = Math.min(speck * Math.sin(Math.PI * Math.min(1, st * 1.25)), (tail - tip) / 2 - 0.4);
    if (rs > 0.2 && !g.back) {
      const c = (tip + tail) / 2;
      parts.speck = `M${P(c - rs, 0)}A${n2(rs)} ${n2(rs)} 0 1 0 ${P(c + rs, 0)}A${n2(rs)} ${n2(rs)} 0 1 0 ${P(c - rs, 0)}Z`;
    }
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
