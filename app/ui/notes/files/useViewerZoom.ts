// O gancho do zoom de todo arquivo (T21238, spec #21198): liga a pinça (os eventos de gesto do WebKit e a rolagem com
// ctrl) e o ⌘+, ⌘− e ⌘0 a um visualizador, e mantém parado o ponto embaixo dos dedos. As contas estão em `zoom.ts`.

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { anchorScroll, clampZoom, pinchFactor, type Point, rememberZoom, type Scroll, stepZoom, zoomCommand } from "./zoom.ts";

/** O `GestureEvent` do WebKit (só no Safari e no WKWebView): a escala desde o começo do gesto e onde estão os dedos. */
interface GestureLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** Um ponto preso num elemento que cresce: `u` e `v` são a fração da largura e da altura dele. */
interface Hold {
  el: HTMLElement;
  u: number;
  v: number;
}

export interface ViewerZoom {
  /** O arquivo: o zoom fica guardado por ele enquanto o app está aberto. */
  path: string;
  /** O lugar que rola, onde a pinça cai e onde o ponto embaixo dos dedos fica parado. */
  target: RefObject<HTMLElement | null>;
  /** A escala que está na tela agora (com o ajuste à janela já resolvido). */
  scale: number;
  /** Muda o zoom. `null`: volta ao padrão do visualizador (o ajuste à janela, ou 100%). */
  set(zoom: number | null): void;
  min: number;
  max: number;
  /** A margem do lugar que rola que não cresce com o zoom (o `padding`). */
  pad?: Point;
  /**
   * O que cresce com o zoom (a folha do pdf, a imagem), num seletor dentro do `target`. Com ele, o ponto embaixo dos
   * dedos é medido nesse elemento, antes e depois: vale com o conteúdo centrado, com a sobra dos lados e com a troca de
   * centrado para o canto. Sem ele, a conta usa o `pad`.
   */
  anchor?: string;
  /**
   * Quando o zoom muda o tamanho de outra forma (a letra do CodeMirror): quem mede de novo e deixa parado o ponto `at`.
   * Devolve `true` se já cuidou da rolagem.
   */
  onApplied?(change: { at: Point; from: number; to: number; scroll: Scroll }): boolean | void;
  /** Desligado, nada escuta (o visualizador ainda carregando). */
  enabled?: boolean;
}

/**
 * Liga o zoom. Devolve `zoomBy(factor, at)`, para os botões dos visualizadores darem o mesmo zoom que a pinça (o `at`
 * no meio da área, sem ele).
 */
export function useViewerZoom({ path, target, scale, set, min, max, pad, anchor, onApplied, enabled = true }: ViewerZoom) {
  const live = useRef({ scale, set, min, max, path });
  live.current = { scale, set, min, max, path };
  /** O zoom pedido que ainda não chegou à tela, com o ponto que fica parado. */
  const pending = useRef<{ at: Point; from: number; to: number; scroll: Scroll; on?: Hold } | null>(null);
  /** O elemento embaixo dos dedos e onde nele (em fração), guardado durante a pinça: os passos não somam erro. */
  const held = useRef<(Hold & { at: Point; t: number }) | null>(null);
  /** Os fatores da pinça juntados num quadro: um render por quadro, e não um por evento. */
  const frame = useRef<{ id: number; factor: number; at: Point } | null>(null);
  /**
   * A rolagem que o zoom pediu e a que o navegador deixou (ele arredonda). Na pinça, um passo atrás do outro: o próximo
   * parte da pedida, senão o arredondamento soma e o ponto escorrega de baixo dos dedos.
   */
  const wrote = useRef<{ want: Scroll; got: Scroll } | null>(null);

  const middle = useCallback((): Point => {
    const el = target.current;
    return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 };
  }, [target]);

  /** O elemento do `anchor` embaixo do ponto (ou o mais perto dele), e onde o ponto cai nele. */
  const hold = (el: HTMLElement, sel: string, at: Point): Hold | undefined => {
    const now = performance.now();
    const h = held.current;
    if (h && now - h.t < 400 && Math.abs(h.at.x - at.x) < 2 && Math.abs(h.at.y - at.y) < 2 && h.el.isConnected) {
      h.t = now;
      return h;
    }
    const box = el.getBoundingClientRect();
    const x = box.left + at.x;
    const y = box.top + at.y;
    let best: HTMLElement | undefined;
    let dist = Infinity;
    for (const c of el.querySelectorAll<HTMLElement>(sel)) {
      const r = c.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d < dist) [best, dist] = [c, d];
      if (d === 0) break;
    }
    if (!best) return undefined;
    const r = best.getBoundingClientRect();
    const next = { el: best, u: r.width ? (x - r.left) / r.width : 0.5, v: r.height ? (y - r.top) / r.height : 0.5, at, t: now };
    held.current = next;
    return next;
  };

  const zoomTo = useCallback(
    (next: number | null, at: Point = middle()) => {
      const el = target.current;
      const { scale: from, set: apply, min: lo, max: hi, path: file } = live.current;
      const to = next === null ? null : clampZoom(next, lo, hi);
      if (el && to !== null && Math.abs(to - from) > 1e-4) {
        const w = wrote.current;
        const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
        const scroll = { left: el.scrollLeft, top: el.scrollTop };
        // Só o arredondamento: a rolagem que o navegador cortou (no começo ou no fim) fica como está.
        if (w && near(scroll.left, w.got.left) && Math.abs(w.want.left - w.got.left) < 1) scroll.left = w.want.left;
        if (w && near(scroll.top, w.got.top) && Math.abs(w.want.top - w.got.top) < 1) scroll.top = w.want.top;
        pending.current = { at, from, to, scroll, on: anchor ? hold(el, anchor, at) : undefined };
      }
      rememberZoom(file, to);
      apply(to);
    },
    [middle, target, anchor],
  );

  const zoomBy = useCallback((factor: number, at?: Point) => zoomTo(live.current.scale * factor, at), [zoomTo]);

  // O ponto embaixo dos dedos fica parado: depois de a escala nova chegar à tela, a rolagem acompanha.
  useLayoutEffect(() => {
    const p = pending.current;
    const el = target.current;
    if (!p || !el) return;
    if (Math.abs(scale - p.to) > 1e-4) return;
    pending.current = null;
    if (onApplied?.(p)) return;
    if (p.on) {
      // Onde o ponto do elemento foi parar, e a rolagem que o põe de volta embaixo dos dedos.
      const box = el.getBoundingClientRect();
      const r = p.on.el.getBoundingClientRect();
      el.scrollLeft += r.left + p.on.u * r.width - (box.left + p.at.x);
      el.scrollTop += r.top + p.on.v * r.height - (box.top + p.at.y);
      wrote.current = null;
      return;
    }
    const to = anchorScroll(p.scroll, p.at, p.from, p.to, pad);
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
    wrote.current = { want: to, got: { left: el.scrollLeft, top: el.scrollTop } };
  }, [scale, target, pad?.x, pad?.y, onApplied]);

  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const queue = (factor: number, at: Point) => {
      if (frame.current) {
        frame.current.factor *= factor;
        frame.current.at = at;
        return;
      }
      const f = { id: 0, factor, at };
      f.id = requestAnimationFrame(() => {
        frame.current = null;
        zoomBy(f.factor, f.at);
      });
      frame.current = f;
    };

    // A pinça no app: o WebKit dá a escala desde o começo do gesto.
    let last = 1;
    let gesture = false;
    const start = (e: Event) => {
      e.preventDefault();
      held.current = null;
      gesture = true;
      last = 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLike;
      if (!g.scale || !Number.isFinite(g.scale)) return;
      queue(g.scale / last, local(g));
      last = g.scale;
    };
    const end = (e: Event) => {
      e.preventDefault();
      gesture = false;
    };
    // A pinça fora do app: uma rolagem com ctrl. Durante um gesto do WebKit, ela não conta duas vezes.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (gesture) return;
      queue(pinchFactor(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY), local(e));
    };
    el.addEventListener("gesturestart", start);
    el.addEventListener("gesturechange", change);
    el.addEventListener("gestureend", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", start);
      el.removeEventListener("gesturechange", change);
      el.removeEventListener("gestureend", end);
      el.removeEventListener("wheel", wheel);
      if (frame.current) cancelAnimationFrame(frame.current.id);
      frame.current = null;
    };
  }, [target, enabled, zoomBy]);

  // O ⌘+, o ⌘− e o ⌘0. Só um arquivo fica aberto por vez, então a janela inteira escuta.
  useEffect(() => {
    if (!enabled) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const command = zoomCommand(e);
      if (!command) return;
      e.preventDefault();
      const { scale: now, min: lo, max: hi } = live.current;
      held.current = null;
      if (command === "reset") zoomTo(null);
      else zoomTo(stepZoom(now, command === "in" ? 1 : -1, lo, hi));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [enabled, zoomTo]);

  return { zoomBy, zoomTo };
}
