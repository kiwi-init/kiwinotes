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

/**
 * O que fica embaixo dos dedos. Num elemento que cresce: `u` e `v` são a fração da largura e da altura dele. Num texto
 * que quebra de novo com o zoom (a nota): a letra, e quanto o ponto fica dela, em px de 100%.
 */
type Hold = { el: HTMLElement; u: number; v: number } | TextHold;

/**
 * A letra embaixo dos dedos. O editor da nota redesenha os parágrafos quando o zoom muda o que cabe na tela: o texto
 * some e volta noutro elemento. Por isso a letra também vai pelo bloco dela (a tag, o texto inteiro e onde nele), para
 * ser achada de novo.
 */
interface TextHold {
  node: Node;
  offset: number;
  unit: Point;
  block: { tag: string; text: string; index: number };
}

/** O bloco do texto (o parágrafo, a linha): o primeiro ancestral que não é `inline`. */
function blockOf(node: Node): HTMLElement | null {
  let e = node.parentElement;
  while (e?.parentElement && getComputedStyle(e).display.startsWith("inline")) e = e.parentElement;
  return e;
}

/** A letra de novo, num texto redesenhado: o bloco com o mesmo texto mais perto de `y`, e a letra pela posição nele. */
function findAgain(el: HTMLElement, h: TextHold, y: number): boolean {
  let best: { e: Element; d: number } | null = null;
  for (const e of el.querySelectorAll(h.block.tag)) {
    if (e.textContent !== h.block.text) continue;
    const r = e.getBoundingClientRect();
    const d = Math.max(r.top - y, 0, y - r.bottom);
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return false;
  const walk = document.createTreeWalker(best.e, NodeFilter.SHOW_TEXT);
  let left = h.block.index;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const length = n.textContent?.length ?? 0;
    if (left < length) {
      h.node = n;
      h.offset = left;
      return true;
    }
    left -= length;
  }
  return false;
}

/** A caixa da letra `offset` do texto `node` na tela. */
function letterBox(node: Node, offset: number): DOMRect | null {
  const length = node.textContent?.length ?? 0;
  if (!length) return null;
  const at = Math.min(offset, length - 1);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + 1);
  const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
  return box.width || box.height ? box : null;
}

/** A letra embaixo do ponto (em px da janela), se ela está dentro de `el`. */
function letterAt(el: HTMLElement, x: number, y: number): { node: Node; offset: number; box: DOMRect; block: TextHold["block"] } | null {
  const range = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || !node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null;
  const box = letterBox(node, range.startOffset);
  // Longe da letra (o ponto no espaço do fim de uma linha, ou entre os parágrafos): fica a conta pelo elemento.
  if (!box || y < box.top - box.height || y > box.bottom + box.height) return null;
  const block = blockOf(node);
  if (!block) return null;
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(node, range.startOffset);
  return { node, offset: range.startOffset, box, block: { tag: block.tagName, text: block.textContent ?? "", index: before.toString().length } };
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
   * O texto quebra de novo com o zoom (a nota, com a coluna que cresce até a janela e depois reflui): o ponto fica preso
   * na letra embaixo dos dedos, e não na fração do `anchor`, que muda de altura de outro jeito. Fora de um texto, vale o
   * `anchor`.
   */
  anchorText?: boolean;
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
export function useViewerZoom({ path, target, scale, set, min, max, pad, anchor, anchorText, onApplied, enabled = true }: ViewerZoom) {
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
  /** Os quadros depois do zoom em que a letra embaixo dos dedos é posta de volta (o texto ainda se mede). */
  const settle = useRef(0);
  useEffect(() => () => cancelAnimationFrame(settle.current), []);

  const middle = useCallback((): Point => {
    const el = target.current;
    return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 };
  }, [target]);

  /** O elemento do `anchor` embaixo do ponto (ou o mais perto dele), e onde o ponto cai nele. */
  const hold = (el: HTMLElement, sel: string | undefined, at: Point, from: number): Hold | undefined => {
    const now = performance.now();
    const h = held.current;
    const near = h && now - h.t < 400 && Math.abs(h.at.x - at.x) < 2 && Math.abs(h.at.y - at.y) < 2;
    // O elemento de antes, ou o que o substituiu (as páginas do docx, T21151); a letra de antes, ou a mesma no bloco novo.
    const same = !h || !near ? false : "el" in h ? (sel ? again(el, sel, h.el) : h.el.isConnected ? h.el : undefined) : h.node.isConnected || findAgain(el, h, el.getBoundingClientRect().top + at.y);
    if (h && same) {
      if ("el" in h && same instanceof HTMLElement) h.el = same;
      h.t = now;
      return h;
    }
    const box = el.getBoundingClientRect();
    const x = box.left + at.x;
    const y = box.top + at.y;
    const letter = anchorText ? letterAt(el, x, y) : null;
    if (letter) {
      const next = { node: letter.node, offset: letter.offset, block: letter.block, unit: { x: (x - letter.box.left) / from, y: (y - letter.box.top) / from }, at, t: now };
      held.current = next;
      return next;
    }
    if (!sel) return undefined;
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
        pending.current = { at, from, to, scroll, on: anchor || anchorText ? hold(el, anchor, at, from) : undefined };
      }
      rememberZoom(file, to);
      apply(to);
    },
    [middle, target, anchor, anchorText],
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
    const on = p.on;
    cancelAnimationFrame(settle.current);
    // Onde o ponto do elemento (ou da letra) foi parar, e a rolagem que o põe de volta embaixo dos dedos.
    const place = (): boolean => {
      if (!on) return false;
      const box = el.getBoundingClientRect();
      if (!("el" in on) && !on.node.isConnected && !findAgain(el, on, box.top + p.at.y)) return false;
      if ("el" in on) {
        // As páginas do docx são desenhadas de novo na escala nova (T21151): a mesma, pelo `data-page-index`.
        const now = anchor ? again(el, anchor, on.el) : on.el.isConnected ? on.el : undefined;
        if (!now) return false;
        on.el = now;
      }
      const r = "el" in on ? on.el.getBoundingClientRect() : letterBox(on.node, on.offset);
      if (!r) return false;
      const [x, y] = "el" in on ? [r.left + on.u * r.width, r.top + on.v * r.height] : [r.left + on.unit.x * p.to, r.top + on.unit.y * p.to];
      el.scrollLeft += x - (box.left + p.at.x);
      el.scrollTop += y - (box.top + p.at.y);
      return true;
    };
    if (place()) {
      wrote.current = null;
      // O texto: o editor ainda mede e redesenha nos próximos quadros (a altura dos parágrafos que quebram de novo), e o
      // que está acima da letra muda de altura. Nesses quadros, a letra volta para baixo dos dedos.
      if (on && !("el" in on)) {
        let n = 0;
        const step = () => {
          place();
          if (++n < 4) settle.current = requestAnimationFrame(step);
        };
        settle.current = requestAnimationFrame(step);
      }
      return;
    }
    const to = anchorScroll(p.scroll, p.at, p.from, p.to, pad);
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
    wrote.current = { want: to, got: { left: el.scrollLeft, top: el.scrollTop } };
  }, [scale, target, pad?.x, pad?.y, onApplied, anchor]);

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

/**
 * O elemento do `anchor` depois do zoom. Quem desenha de novo na escala nova (as páginas do docx, T21151) troca o
 * elemento: aí vale o novo com o mesmo `data-page-index`. Sem ele, nenhum (o ponto é medido de novo).
 */
function again(root: HTMLElement, sel: string, old: HTMLElement): HTMLElement | undefined {
  if (old.isConnected) return old;
  const key = old.dataset.pageIndex;
  if (key === undefined) return undefined;
  return [...root.querySelectorAll<HTMLElement>(sel)].find((e) => e.dataset.pageIndex === key);
}
