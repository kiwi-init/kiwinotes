// A pílula das abas do hub (T4380, spec #4375): uma mola só, criticamente amortecida, para a posição e a largura.
//
// Antes, cada troca de alvo reiniciava duas transições CSS (`transform` e `width`) com a curva de overshoot do
// hover: no mouse rápido a pílula passava da aba da ponta, voltava, e numa troca longa atravessava a faixa num tranco
// (até 188 px num frame). Aqui o movimento parte da posição e da velocidade de agora (nunca recomeça do zero), chega
// sem passar do alvo, e a pílula nunca sai da faixa das abas.

export interface Box {
  x: number;
  w: number;
}

export interface PillState extends Box {
  vx: number;
  vw: number;
}

/** A rigidez da mola (1/s): ~99% do caminho em 6,6/ω, uns 0,22 s, o `--hover-dur` dos tokens. */
export const PILL_OMEGA = 30;

/** Um eixo da mola criticamente amortecida, pela solução exata: estável com qualquer `dt`. */
function axis(p: number, v: number, target: number, dt: number, omega: number): [number, number] {
  const d = p - target;
  const c = v + omega * d;
  const e = Math.exp(-omega * dt);
  return [target + (d + c * dt) * e, (v - omega * c * dt) * e];
}

/**
 * Um passo de `dt` segundos em direção ao alvo, preso dentro da faixa `[lo, hi]` (o começo da primeira aba e o fim
 * da última): a velocidade herdada de um alvo anterior pode empurrar a pílula além do novo, e a faixa segura.
 */
export function stepPill(s: PillState, target: Box, dt: number, bounds: { lo: number; hi: number }, omega = PILL_OMEGA): PillState {
  let [x, vx] = axis(s.x, s.vx, target.x, dt, omega);
  let [w, vw] = axis(s.w, s.vw, target.w, dt, omega);
  if (w < 0) [w, vw] = [0, 0];
  if (x < bounds.lo) [x, vx] = [bounds.lo, 0];
  if (x + w > bounds.hi) {
    x = Math.max(bounds.lo, bounds.hi - w);
    vx = 0;
  }
  return { x, w, vx, vw };
}

/** Chegou: perto do alvo e quase parada (meio pixel, 5 px/s). */
export function settled(s: PillState, target: Box): boolean {
  return Math.abs(s.x - target.x) < 0.5 && Math.abs(s.w - target.w) < 0.5 && Math.abs(s.vx) < 5 && Math.abs(s.vw) < 5;
}

/**
 * Como a pílula vai ao alvo novo: direto (a primeira medida, uma mudança de tamanho, o "Reduzir movimento"), deslizando
 * (de uma aba para outra), ou sumindo onde está e aparecendo no alvo (o mouse saiu da faixa e a ativa está longe:
 * atravessar as abas do meio era o tranco do #4375).
 */
export function pillMove(o: { first: boolean; reduced: boolean; resized: boolean; leftStrip: boolean; from: Box; to: Box }): "snap" | "glide" | "fade" {
  if (o.first || o.reduced || o.resized) return "snap";
  if (o.leftStrip && Math.abs(o.from.x - o.to.x) > Math.max(o.from.w, o.to.w)) return "fade";
  return "glide";
}
