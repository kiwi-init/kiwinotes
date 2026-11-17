// O fim da intro vira a janela do hub (T16769, spec #16759): as contas, sem Electrobun, para os testes e a CLI.
//
// O main sabe onde o hub vai abrir (o lugar salvo, ou o padrão no meio da área útil) antes de a intro tocar. A janela
// da intro cobre o quadro de sempre, no meio da tela, e esse retângulo, e a página recebe os dois nas coordenadas
// dela (`intro.layout`): o quadrado do gato começa no meio, como antes, e a moldura vazia cresce até o retângulo do hub.

/** Um retângulo de tela, como o `frame` das janelas: o canto de cima à esquerda e o tamanho do conteúdo. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** O que a página da intro recebe (`intro.layout`), nas coordenadas da janela dela. */
export interface IntroLayout {
  /** Onde o hub vai aparecer: a moldura cresce até aqui. */
  target: Rect;
  /** O raio dos cantos da janela do hub: a moldura termina com ele. */
  radius: number;
  /** O meio da área útil, onde o gato nasce (o mesmo lugar de antes). */
  center: { x: number; y: number };
  /** A caixa de antes (720×480): o gato tem o tamanho que tinha nela. */
  box: { width: number; height: number };
}

/** Os cantos de uma janela com a barra de título do macOS (o hub tem a `hiddenInset`). */
export const HUB_CORNER_RADIUS = 16;
/** A folga em volta da moldura, para a sombra dela não ser cortada pela borda da janela da intro. */
export const INTRO_SHADOW_PAD = 64;
/** O hub nunca abre menor que isso, nem com um arquivo salvo estragado. */
export const HUB_MIN = { width: 640, height: 420 };

/** O padrão: o tamanho do hub (cabendo na área), no meio dela. */
export function defaultHubFrame(area: Rect, size: { width: number; height: number }): Rect {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

/**
 * Põe o lugar salvo numa tela que existe: se ele já cabe numa área útil, fica; senão vai para a área com que ele mais
 * se cruza (ou a primeira), encolhendo para caber. Assim o hub nunca abre fora da tela, depois de tirar um monitor.
 */
export function clampToAreas(frame: Rect, areas: Rect[]): Rect {
  if (areas.length === 0 || areas.some((a) => contains(a, frame))) return frame;
  let best = areas[0]!;
  let bestOverlap = -1;
  for (const a of areas) {
    const o = overlap(a, frame);
    if (o > bestOverlap) [best, bestOverlap] = [a, o];
  }
  const width = Math.min(frame.width, best.width);
  const height = Math.min(frame.height, best.height);
  return {
    x: clamp(frame.x, best.x, best.x + best.width - width),
    y: clamp(frame.y, best.y, best.y + best.height - height),
    width,
    height,
  };
}

/** Lê o lugar salvo do hub (o `hub-frame.json`): um retângulo de números, não menor que o mínimo; senão `null`. */
export function parseHubFrame(text: string | null): Rect | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<Rect> | null;
    if (!v || typeof v !== "object") return null;
    const { x, y, width, height } = v;
    if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if (width! < HUB_MIN.width || height! < HUB_MIN.height) return null;
    return { x: Math.round(x!), y: Math.round(y!), width: Math.round(width!), height: Math.round(height!) };
  } catch {
    return null;
  }
}

/** Onde o hub abre: o lugar salvo, posto numa tela que existe, ou o padrão no meio da área útil principal. */
export function hubFrame(saved: Rect | null, primary: Rect, areas: Rect[], size: { width: number; height: number }): Rect {
  return saved ? clampToAreas(saved, areas.length ? areas : [primary]) : defaultHubFrame(primary, size);
}

/**
 * A janela da intro e o que a página recebe. A caixa de sempre (`box`, no meio da área útil principal) unida ao
 * retângulo do hub, com a folga da sombra, dentro da área útil. Sem o hub, ou com ele fora da área principal (noutro
 * monitor), fica a caixa de antes e `layout` é `null`: a moldura não cresce.
 */
export function introWindow(
  area: Rect,
  box: { width: number; height: number },
  hub: Rect | null,
  radius = HUB_CORNER_RADIUS,
): { frame: Rect; layout: IntroLayout | null } {
  const start = defaultHubFrame(area, box);
  if (!hub || !contains(area, hub)) return { frame: start, layout: null };
  const left = Math.max(area.x, Math.min(start.x, hub.x) - INTRO_SHADOW_PAD);
  const top = Math.max(area.y, Math.min(start.y, hub.y) - INTRO_SHADOW_PAD);
  const right = Math.min(area.x + area.width, Math.max(start.x + start.width, hub.x + hub.width) + INTRO_SHADOW_PAD);
  const bottom = Math.min(area.y + area.height, Math.max(start.y + start.height, hub.y + hub.height) + INTRO_SHADOW_PAD);
  const frame = { x: left, y: top, width: right - left, height: bottom - top };
  return {
    frame,
    layout: {
      target: { x: hub.x - left, y: hub.y - top, width: hub.width, height: hub.height },
      radius,
      center: { x: area.x + area.width / 2 - left, y: area.y + area.height / 2 - top },
      box: { width: start.width, height: start.height },
    },
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
