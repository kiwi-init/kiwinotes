// A gota da barra por mola (spec #32446, T32464). Sem relógio e sem fases: cada lado tem um ESTADO (onde a gota está e
// a que velocidade), uma mola a puxa para o alvo (os botões, ou a pílula) e a forma sai do estado, não do tempo.
//
// - Presa à pílula, ela escorre: anda devagar, e a resistência some conforme o pescoço afina. Quando ele parte, a mola
//   a leva até os botões, passa um pouco do ponto e assenta. A velocidade nunca volta a zero no meio.
// - Cresce no caminho: o tamanho vai da lágrima ao retângulo dos botões conforme o LUGAR, e estica com a VELOCIDADE.
// - Trocar de aba no meio só troca o alvo: a gota segue de onde está, com a velocidade que tem.
// - A mola afrouxa na janela larga (o tempo acompanha a distância), e entra aos poucos nos primeiros ~90 ms depois de
//   trocar de alvo, sem coice. Na volta, a pílula suga a gota no fim.
//
// O caminho inteiro é conhecido no clique (`gooPlan`): ele vira os quadros da animação de `transform` da cabeça no
// compositor (#231), e o desenho da forma lê o mesmo plano pelo tempo (`gooAt`). Os números vêm do lab que o harry
// escolheu (#32457), a função `mola`; a forma solta é lágrima, não lente (#19093): a frente redonda com a altura cheia,
// só a cauda afina.
//
// Coordenadas: as do `goo-shape.ts`. `U` é o avanço da gota para fora da beira da pílula, em px.

import { type GooGeom, type GooParts, gooSizes, roundRect } from "./goo-shape.ts";

export interface GooDrop {
  /** O avanço da gota para fora da beira da pílula, em px (0 = dentro da pílula). */
  U: number;
  /** A velocidade de `U`, em px/ms (negativa na volta). */
  v: number;
  /** Presa à pílula (barriga e pescoço) ou solta. */
  attached: boolean;
  /** A ponta do cone que fica na beira depois de soltar, em px (0 = sem cone). */
  tip: number;
  /** Os ms desde a última troca de alvo: a mola entra aos poucos por eles. */
  since: number;
}

/** O passo da simulação, em ms. */
const STEP_MS = 1;
/** A taxa dos quadros do plano: a do compositor nas telas ProMotion. */
export const GOO_PLAN_HZ = 120;
/** O teto do plano: se a mola não assentar (um número ruim), o plano acaba no repouso do alvo e nunca cresce sem fim. */
export const GOO_PLAN_MAX_MS = 1500;
/** Os ms em que a força da mola entra depois de trocar de alvo. */
const RAMP_MS = 90;
/** A meia-vida do cone da beira depois de soltar, em ms. */
const TIP_MS = 32;

const K = 0.5523; // o ponto de controle de um quarto de elipse
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const span = (t: number, a: number, b: number) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
const smooth = (s: number) => s * s * (3 - 2 * s);
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();
const NONE: GooParts = { head: "", edge: "", speck: "" };

/** Os marcos do caminho, em `U`: o fim da barriga (`Ub`), a soltura (`Up`) e a chegada aos botões (`Ut`). */
export function gooMarks(g: GooGeom) {
  const { base: B, head: HB, reach, neck } = gooSizes(g.tabs.h, g.target.h);
  const x0 = g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x;
  const tu = g.side === "end" ? g.target.x + g.target.w / 2 - x0 : x0 - (g.target.x + g.target.w / 2);
  // Do lugar (`U`) ao centro da gota: a cabeça presa fica `off` atrás da frente da barriga.
  const off = B * 0.88;
  // Onde o fio parte: a ponta do cone que fica na beira.
  const bp = reach - HB * 1.3 * Math.sqrt(Math.max(0, 1 - (neck / HB) ** 2));
  const Up = reach + off;
  // Botões colados na pílula (ou mais perto que a soltura): a chegada fica logo depois dela, e a conta nunca divide por 0.
  const Ut = Math.max(tu + off, Up + 1);
  return { Ub: g.tabs.h * 0.6, Up, Ut, off, tip0: Math.max(0, bp - 1), bp };
}

/** O quanto da corrida já foi: 0 na soltura, 1 nos botões. */
export const gooRunProgress = (g: GooGeom, U: number) => {
  const m = gooMarks(g);
  return clamp((U - m.Up) / (m.Ut - m.Up));
};

/** O repouso de um lado: nos botões (`has`) ou dentro da pílula. */
export function gooRest(has: boolean, g: GooGeom): GooDrop {
  return has ? { U: gooMarks(g).Ut, v: 0, attached: false, tip: 0, since: 0 } : { U: 0, v: 0, attached: true, tip: 0, since: 0 };
}

/** O estado chegou e assentou no alvo. */
export function gooAtRest(g: GooGeom, s: GooDrop, has: boolean): boolean {
  const r = gooRest(has, g);
  return s.U === r.U && s.v === 0 && s.attached === r.attached && s.tip === 0;
}

/** A frequência da mola (rad/ms): mais frouxa quanto mais longe estão os botões, para o pico de velocidade não dobrar. */
const omega = (Ut: number) => 0.0165 * clamp(Math.sqrt(280 / Math.max(1, Ut)), 0.7, 1.2);

/** Um passo de `h` ms (≤ 1) da mola, no lugar. */
function sub(g: GooGeom, m: ReturnType<typeof gooMarks>, s: GooDrop, has: boolean, h: number) {
  const w0 = omega(m.Ut);
  const goal = has ? m.Ut : -6;
  const near = s.attached ? clamp(s.U / m.Up) : 1;
  s.since += h;
  const ramp = smooth(clamp(s.since / RAMP_MS));
  let k = w0 * w0 * (0.15 + 0.85 * ramp);
  let c = 2 * (has ? 0.78 : 1) * w0;
  // Presa e saindo: o líquido resiste, e a resistência some conforme o pescoço afina.
  if (s.attached && has) c += 0.3 * (1 - near ** 1.5);
  // Presa e voltando: a pílula suga.
  if (s.attached && !has) (k *= 1 + 4 * (1 - near), c = 2 * Math.sqrt(k));
  const a = k * (goal - s.U) - c * s.v;
  s.v += a * h;
  s.U += s.v * h;
  if (s.attached && s.U >= m.Up) (s.attached = false, s.tip = m.tip0);
  else if (!s.attached && s.U <= m.Up && s.v < 0) s.attached = true;
  if (!s.attached) {
    // Na volta, o cone cresce de novo perto da pílula: é onde o pescoço vai se formar.
    const p = gooRunProgress(g, s.U);
    const want = s.v < 0 ? m.tip0 * clamp(1 - p / 0.22) : 0;
    s.tip = Math.max(want, s.tip * Math.exp(-h / TIP_MS));
  } else s.tip = 0;
  if (has && !s.attached && Math.abs(s.U - m.Ut) < 0.15 && Math.abs(s.v) < 0.004) Object.assign(s, gooRest(true, g));
  if (!has && s.U <= 0.3) Object.assign(s, gooRest(false, g));
}

/** O estado depois de `dt` ms com o alvo `has` (os botões, ou a pílula). Não muda `s`. */
export function gooStep(g: GooGeom, s: GooDrop, has: boolean, dt: number): GooDrop {
  const m = gooMarks(g);
  const next = { ...s };
  for (let left = dt; left > 1e-9 && !gooAtRest(g, next, has); left -= STEP_MS) sub(g, m, next, has, Math.min(STEP_MS, left));
  return next;
}

/**
 * O caminho do estado `s` até o repouso no alvo `has`, um estado por quadro de `hz` (o primeiro é `s`, com `since` 0: a
 * mola recomeça a entrar). Acaba no repouso; se a mola não assentar em `GOO_PLAN_MAX_MS`, o último é o repouso mesmo assim.
 */
export function gooPlan(g: GooGeom, s: GooDrop, has: boolean, hz = GOO_PLAN_HZ): GooDrop[] {
  const dt = 1000 / hz;
  let at: GooDrop = { ...s, since: 0 };
  const plan = [at];
  const max = Math.ceil(GOO_PLAN_MAX_MS / dt);
  while (!gooAtRest(g, at, has)) {
    if (plan.length >= max) {
      plan.push(gooRest(has, g));
      break;
    }
    at = gooStep(g, at, has, dt);
    plan.push(at);
  }
  return plan;
}

/** O estado do plano no tempo `ms` desde o começo dele, preso nas pontas (um quadro além do fim é o último). */
export function gooAt(plan: readonly GooDrop[], ms: number, hz = GOO_PLAN_HZ): GooDrop {
  const i = Math.round((ms * hz) / 1000);
  return plan[Math.min(plan.length - 1, Math.max(0, Number.isFinite(i) ? i : 0))]!;
}

/** A duração do plano, em ms: a da animação de `transform` da cabeça no compositor. */
export const gooPlanMs = (plan: readonly GooDrop[], hz = GOO_PLAN_HZ) => ((plan.length - 1) * 1000) / hz;

/** A opacidade dos botões: entram no último trecho da corrida, depois de a gota soltar. */
export function gooButtons(g: GooGeom, s: GooDrop): number {
  return s.attached ? 0 : smooth(span(gooRunProgress(g, s.U), 0.7, 1));
}

/** O centro da gota na barra: o ponto que a cabeça segue no compositor (a forma é desenhada relativa a ele). */
export function gooAnchor(g: GooGeom, s: GooDrop): { x: number; y: number } {
  const m = gooMarks(g);
  const dir = g.side === "end" ? 1 : -1;
  const x0 = g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x;
  const cy = g.tabs.y + g.tabs.h / 2;
  const tv = g.target.y + g.target.h / 2 - cy;
  // Presa, a cabeça fica na soltura (a barriga e o pescoço são desenhados na thread principal, perto da pílula).
  const cu = s.attached ? m.Up - m.off : s.U - m.off;
  const e = s.attached ? 0 : smooth(gooRunProgress(g, s.U));
  return { x: x0 + dir * cu, y: cy + tv * e };
}

/** As partes da gota no estado `s`, na barra: a mesma forma do `goo-shape.ts`, desenhada pelo lugar e pela velocidade. */
export function gooParts(g: GooGeom, s: GooDrop): GooParts {
  const m = gooMarks(g);
  const radius = g.radius ?? 10;
  if (!s.attached && s.U === m.Ut && s.v === 0 && s.tip === 0) {
    return { ...NONE, head: roundRect(g.target.x + g.target.w / 2, g.target.y + g.target.h / 2, g.target.w, g.target.h, radius) };
  }
  const { base: B, head: HB, reach, speck, neck: NECK } = gooSizes(g.tabs.h, g.target.h);
  const dir = g.side === "end" ? 1 : -1;
  const x0 = g.side === "end" ? g.tabs.x + g.tabs.w : g.tabs.x;
  const cy = g.tabs.y + g.tabs.h / 2;
  const P = (u: number, v: number) => `${n2(x0 + dir * u)},${n2(cy + v)}`;
  const sweep = dir > 0 ? 1 : 0;
  // Os ombros saem da ponta redonda da pílula pela tangente dela: a barriga parece a própria ponta estufando.
  const rp = g.tabs.h / 2;
  const shoulder = (b: number) => {
    const ua = -(rp - Math.sqrt(Math.max(0, rp * rp - b * b)));
    const len = Math.hypot(b, ua + rp) || 1;
    return { ua, tu: b / len, tv: (ua + rp) / len };
  };
  const ry1 = HB;
  const rx1 = HB * 1.3;

  if (s.attached) {
    if (s.U <= 0.3) return NONE;
    // 1. A barriga: a ponta inteira estufa, larga e rasa, e vai fundando, com o fundo redondo.
    if (s.U <= m.Ub) {
      const d = s.U;
      const { ua, tu, tv } = shoulder(B);
      const k = (d - ua) * 0.55;
      return { ...NONE, head:
        `M${P(ua, -B)}C${P(ua + tu * k, -B + tv * k)} ${P(d, -B * 0.85)} ${P(d, 0)}` +
        `C${P(d, B * 0.85)} ${P(ua + tu * k, B - tv * k)} ${P(ua, B)}Z` };
    }
    // 2. O pescoço: a cabeça se afasta e cresce até a altura da gota solta; os ombros entram e o pescoço afina.
    const q = span(s.U, m.Ub, m.Up);
    const ry = lerp(B * 0.88, ry1, q);
    const rx = lerp(B * 0.88, rx1, q);
    const cu = s.U - m.off;
    const neck = lerp(ry * 0.85, NECK, q);
    const b = lerp(B, B * 0.62, q);
    const { ua, tu, tv } = shoulder(b);
    const un = cu - rx * Math.sqrt(Math.max(0, 1 - (neck / ry) ** 2));
    const k = Math.max(1, un - ua) * 0.45;
    return { ...NONE, head:
      `M${P(ua, -b)}C${P(ua + tu * k, -b + tv * k)} ${P(un - k * 0.8, -neck)} ${P(un, -neck)}` +
      `A${n2(rx)} ${n2(ry)} 0 1 ${sweep} ${P(un, neck)}` +
      `C${P(un - k * 0.8, neck)} ${P(ua + tu * k, b - tv * k)} ${P(ua, b)}Z` };
  }

  // 3. Solta: uma lágrima (#19093). A ponta que vai na frente é redonda, da altura da gota; só a cauda afina e estica com a
  // velocidade. A altura chega logo à dos botões; o comprimento cresce no último trecho, até o retângulo deles.
  const p = gooRunProgress(g, s.U);
  const tw = g.target.w;
  const th = g.target.h;
  // A velocidade entra aos poucos depois de soltar: na soltura a forma é a mesma do pescoço, sem salto.
  const fast = clamp(Math.abs(s.v) / 2) * smooth(span(p, 0, 0.15));
  const k = 1 + 0.45 * fast;
  const grow = smooth(span(p, 0, 0.45));
  // A meia altura: da cabeça presa à dos botões, um pouco mais baixa quanto mais rápido (o líquido estica).
  const b = Math.max(ry1 * 0.8, lerp(ry1, th / 2, grow) / k ** 0.25);
  // A chegada: a lágrima vira o retângulo dos botões. Antes disto, a frente é sempre um semicírculo.
  const c = smooth(span(p, 0.45, 1));
  const round = lerp(rx1, b, smooth(span(p, 0, 0.2)));
  const tail0 = reach - m.bp - 1;
  const tail = lerp(tail0, 1.5 * b, smooth(span(p, 0, 0.3))) * k;
  const lf = lerp(round, tw / 2, c);
  const lr = lerp(tail, tw / 2, c);
  // A cauda fica para trás do movimento; perto da pílula, a ponta fina é sempre a do lado dela (onde o pescoço abre).
  const o = lerp(1, clamp(s.v / 0.25, -1, 1), smooth(span(p, 0, 0.3)));
  const w = (o + 1) / 2;
  const af = lerp(lr, lf, w);
  const ab = lerp(lf, lr, w);
  const rr = Math.min(radius, tw / 2, th / 2);
  const corner = smooth(span(p, 0.75, 1));
  const cu = s.U - m.off;
  const tv = g.target.y + th / 2 - cy;
  const cv = tv * smooth(p);
  type End = { rx: number; ry: number; point: number };
  const fe: End = { rx: lerp(af, rr, corner), ry: lerp(b, rr, corner), point: Math.max(0, -o) * (1 - c) };
  const be: End = { rx: lerp(ab, rr, corner), ry: lerp(b, rr, corner), point: Math.max(0, o) * (1 - c) };
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
  const parts: GooParts = { ...NONE };
  parts.head =
    `M${P(uf - frx, cv - b)}C${P(uf - frx * (1 - K), cv - b)} ${P(f2u, cv - f2v)} ${P(uf, cv - b + fry)}` +
    `L${P(uf, cv + b - fry)}C${P(f2u, cv + f2v)} ${P(uf - frx * (1 - K), cv + b)} ${P(uf - frx, cv + b)}` +
    `L${P(ub + brx, cv + b)}C${P(ub + brx * (1 - K), cv + b)} ${P(b2u, cv + b2v)} ${P(ub, cv + b - bry)}` +
    `L${P(ub, cv - b + bry)}C${P(b2u, cv - b2v)} ${P(ub + brx * (1 - K), cv - b)} ${P(ub + brx, cv - b)}Z`;

  // 4. O cone da beira: pontudo logo depois de partir, arredonda e afunda na pílula; entre ele e a gota, o respingo (só na ida).
  if (s.tip > 0.3 && m.tip0 > 0) {
    const st = clamp(1 - s.tip / m.tip0);
    const sh = B * 0.62;
    const { ua, tu: su, tv: sv } = shoulder(sh);
    const kk = Math.max(1, s.tip - ua) * 0.45;
    const wd = lerp(NECK, sh * 0.6, smooth(st));
    parts.edge =
      `M${P(ua, -sh)}C${P(ua + su * kk, -sh + sv * kk)} ${P(s.tip, -wd)} ${P(s.tip, 0)}` +
      `C${P(s.tip, wd)} ${P(ua + su * kk, sh - sv * kk)} ${P(ua, sh)}Z`;
    const rs = Math.min(speck * Math.sin(Math.PI * Math.min(1, st * 1.25)), (ub - s.tip) / 2 - 0.4);
    if (rs > 0.2 && s.v > 0) {
      const cc = (s.tip + ub) / 2;
      parts.speck = `M${P(cc - rs, 0)}A${n2(rs)} ${n2(rs)} 0 1 0 ${P(cc + rs, 0)}A${n2(rs)} ${n2(rs)} 0 1 0 ${P(cc - rs, 0)}Z`;
    }
  }
  return parts;
}
