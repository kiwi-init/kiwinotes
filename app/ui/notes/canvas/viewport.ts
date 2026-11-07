// A vista do quadro branco (T6600): onde o mundo do `.canvas` cai na tela. `tela = mundo × zoom + (tx, ty)`.

import type { Box, Point } from "../../../src/shared/json-canvas.ts";

export interface Viewport {
  tx: number;
  ty: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** O ponto do mundo sob um ponto da tela (relativo ao quadro). */
export function toWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.tx) / v.zoom, y: (p.y - v.ty) / v.zoom };
}

/** O zoom vezes `factor`, com o ponto da tela `at` parado (o do mouse, ou o meio do quadro). */
export function zoomAt(v: Viewport, at: Point, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const w = toWorld(v, at);
  return { zoom, tx: at.x - w.x * zoom, ty: at.y - w.y * zoom };
}

/** Anda com o quadro (o arrastar do fundo, a rolagem do trackpad). */
export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy };
}

/**
 * A vista que mostra `bounds` inteiro num quadro de `width` × `height`, com `pad` de margem, sem passar de 100% (um
 * quadro pequeno não fica gigante). Sem nada para mostrar, a origem no meio, a 100%.
 */
export function fit(bounds: Box | null, width: number, height: number, pad = 80): Viewport {
  if (!bounds || width <= 0 || height <= 0) return { zoom: 1, tx: width / 2, ty: height / 2 };
  const zoom = clampZoom(Math.min((width - 2 * pad) / Math.max(bounds.width, 1), (height - 2 * pad) / Math.max(bounds.height, 1), 1));
  return {
    zoom,
    tx: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    ty: height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/** O fator de zoom de uma rolagem com ⌘ (ou do gesto de pinça, que chega como rolagem com ctrl). */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  const speed = pinch ? 0.01 : 0.002;
  return Math.exp(-Math.max(-100, Math.min(100, deltaY)) * speed);
}
