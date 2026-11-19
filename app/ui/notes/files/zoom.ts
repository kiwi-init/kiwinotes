// O zoom de todo arquivo (T21238, spec #21198): a pinça do trackpad, centrada nos dedos, e o ⌘+, ⌘− e ⌘0. As contas
// ficam aqui, sem DOM; o gancho que liga os eventos é o `useViewerZoom.ts`.
//
// A pinça chega de dois jeitos. No app, o WKWebView do Electrobun não liga a ampliação dele (`allowsMagnification`), e
// o WebKit entrega a pinça à página como `gesturestart`/`gesturechange`/`gestureend`, com a escala acumulada. Nos
// outros navegadores (e no WebKit headless dos testes), ela vem como uma rolagem com o `ctrlKey`.

export interface Point {
  x: number;
  y: number;
}

export interface Scroll {
  left: number;
  top: number;
}

/** Os degraus do ⌘+ e do ⌘−, como os do Safari. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;

export function clampZoom(z: number, min: number, max: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(max, Math.max(min, z));
}

/**
 * O fator de uma rolagem com ctrl (a pinça fora do app): o `deltaY` negativo abre os dedos. Exponencial, para que ir e
 * voltar o mesmo tanto dê o zoom de antes.
 */
export function pinchFactor(deltaY: number): number {
  return Math.exp(-deltaY / 100);
}

/** O próximo degrau acima (`1`) ou abaixo (`-1`), dentro dos limites. */
export function stepZoom(scale: number, direction: 1 | -1, min: number = ZOOM_STEPS[0], max: number = ZOOM_STEPS.at(-1)!): number {
  const steps = ZOOM_STEPS.filter((z) => z >= min - 1e-9 && z <= max + 1e-9);
  const next = direction === 1 ? steps.find((z) => z > scale + 0.001) : [...steps].reverse().find((z) => z < scale - 0.001);
  return clampZoom(next ?? (direction === 1 ? max : min), min, max);
}

export type ZoomCommand = "in" | "out" | "reset";

/** O ⌘+, o ⌘− e o ⌘0, com ou sem shift, pela tecla ou pelo lugar dela (o teclado ABNT2 também tem o `=` ali). */
export function zoomCommand(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ZoomCommand | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return "reset";
  return null;
}

/**
 * A rolagem que deixa parado o ponto `at` (na área visível, em px da tela) quando o zoom vai de `from` a `to`. `pad` é
 * a margem da área que não cresce com o zoom (o `padding` do lugar que rola).
 */
export function anchorScroll(scroll: Scroll, at: Point, from: number, to: number, pad: Point = { x: 0, y: 0 }): Scroll {
  const k = to / from;
  return {
    left: Math.max(0, (scroll.left + at.x - pad.x) * k + pad.x - at.x),
    top: Math.max(0, (scroll.top + at.y - pad.y) * k + pad.y - at.y),
  };
}

/**
 * O zoom de cada arquivo enquanto o app está aberto (o spec pede por arquivo, e não salvo). `null`: o padrão do
 * visualizador (ajustado à janela, ou 100%).
 */
const remembered = new Map<string, number>();

export function recallZoom(path: string): number | null {
  return remembered.get(path) ?? null;
}

export function rememberZoom(path: string, zoom: number | null): void {
  if (zoom === null) remembered.delete(path);
  else remembered.set(path, zoom);
}

/** Só para os testes. */
export function forgetZooms(): void {
  remembered.clear();
}
