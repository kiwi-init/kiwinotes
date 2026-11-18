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

  // A gota solta: a frente com cantos de raio `fr`, atrás cantos `br`, que fecham em ponta (`point` 1) ou redondos (0).
  const blob = (cu: number, cv: number, af: number, ab: number, b: number, fr: [number, number], br: [number, number], point: number) => {
    const frx = Math.max(0.5, Math.min(fr[0], af + ab));
    const fry = Math.max(0.5, Math.min(fr[1], b));
    const brx = Math.max(0.5, Math.min(br[0], af + ab - frx));
    const bry = Math.max(0.5, Math.min(br[1], b));
    const uf = cu + af;
    const ub = cu - ab;
    // A ponta da lágrima é afilada mas convexa: a curva chega nela ainda inclinada, sem bico côncavo.
    const c2u = lerp(ub, ub + brx * 0.12, point);
    const c2v = lerp(b - bry * (1 - K), b - bry * 0.62, point);
    return (
      `M${P(uf - frx, cv - b)}A${n2(frx)} ${n2(fry)} 0 0 ${sweep} ${P(uf, cv - b + fry)}` +
      `L${P(uf, cv + b - fry)}A${n2(frx)} ${n2(fry)} 0 0 ${sweep} ${P(uf - frx, cv + b)}` +
      `L${P(ub + brx, cv + b)}C${P(ub + brx * (1 - K), cv + b)} ${P(c2u, cv + c2v)} ${P(ub, cv + b - bry)}` +
      `L${P(ub, cv - b + bry)}C${P(c2u, cv - c2v)} ${P(ub + brx * (1 - K), cv - b)} ${P(ub + brx, cv - b)}Z`
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
  // O tamanho na chegada: comprida no sentido do movimento, um pouco mais baixa que os botões.
  const aT = Math.max(g.target.w * 0.56, HB * 1.4);
  const bT = Math.min(HB, g.target.h * 0.43);

  let head: { cu: number; cv: number; af: number; ab: number; b: number; fr: [number, number]; br: [number, number]; point: number };
  if (t < beats.arrive) {
    // Corre: da lágrima que soltou até a chegada. Estica mais no meio do caminho, onde vai mais rápido.
    const r = span(t, beats.pinch, beats.arrive);
    const m = smooth(r);
    const speed = Math.sin(Math.PI * r);
    const af = lerp(rx1, aT * 0.9, m) * (1 + 0.12 * speed);
    const ab = lerp(reach - bp - 1, aT * 1.1, m) * (1 + 0.3 * speed);
    const b = lerp(ry1, bT, m) * (1 - 0.1 * speed);
    // O centro: da soltura até que a caixa da gota fique no meio dos botões.
    const cu = lerp(reach, tu + (ab - af) / 2, m);
    head = { cu, cv: lerp(0, tv, m), af, ab, b, fr: [af, b], br: [ab, b], point: lerp(1, 0.35, m) };
  } else {
    // Chega: amassa no retângulo dos botões, passa um pouco do ponto e assenta (uma mola).
    const q = span(t, beats.arrive, 1);
    const f = Math.cos(2.4 * Math.PI * q) * (1 - q) ** 2;
    const w = g.target.w + (2 * aT - g.target.w) * f;
    const h = g.target.h + (2 * bT - g.target.h) * Math.max(f, -0.25);
    const af = w / 2 - 0.1 * aT * f;
    const ab = w / 2 + 0.1 * aT * f;
    const c = smooth(Math.min(1, q * 2.5));
    const rr = Math.min(radius, w / 2, h / 2);
    head = {
      cu: tu + (ab - af) / 2, cv: tv, af, ab, b: h / 2,
      fr: [lerp(af, rr, c), lerp(h / 2, rr, c)], br: [lerp(ab, rr, c), lerp(h / 2, rr, c)], point: 0.35 * (1 - c),
    };
  }
  parts.head = blob(head.cu, head.cv, head.af, head.ab, head.b, head.fr, head.br, head.point);

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
