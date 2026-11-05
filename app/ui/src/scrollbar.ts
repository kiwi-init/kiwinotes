// A barra de rolagem fina do app (T4505, spec #4497). O harry achou a barra grossa e chamativa ao rolar. No WebKit, uma
// barra estilizada por `::-webkit-scrollbar` sempre reserva a largura dela, e `overflow: overlay` vira `auto`. Então a
// nativa some (base.css) e cada área que rola ganha, enquanto rola, um polegar fino desenhado por cima do conteúdo, que
// some sozinho logo depois. Nada ocupa espaço do conteúdo. O polegar engrossa no hover e dá para arrastar.

/** Quanto tempo o polegar fica na tela depois do último scroll (ou depois de o mouse sair dele). */
export const SCROLLBAR_IDLE_MS = 700;
/** O menor polegar, em px, para não sumir num conteúdo muito longo. */
export const SCROLLBAR_MIN_THUMB = 24;

/**
 * O polegar num eixo: onde ele começa e quanto mede, em px do trilho. `null` quando o conteúdo cabe (não rola).
 * `scroll` é a posição (scrollTop/scrollLeft), `size` o conteúdo (scrollHeight), `client` a parte visível e `track` o
 * comprimento do trilho na tela (o `client` com o zoom e sem as pontas).
 */
export function thumbBox(
  scroll: number,
  size: number,
  client: number,
  track: number,
  min: number = SCROLLBAR_MIN_THUMB,
): { offset: number; length: number } | null {
  if (!(size > client + 0.5) || !(client > 0) || !(track > 0)) return null;
  const length = Math.min(track, Math.max(Math.min(min, track), (client / size) * track));
  const max = size - client;
  const ratio = Math.min(1, Math.max(0, scroll / max));
  return { offset: ratio * (track - length), length };
}

/** De quanto rolar quando o polegar anda `delta` px no trilho (o arraste). */
export function dragToScroll(delta: number, size: number, client: number, track: number, length: number): number {
  const free = track - length;
  return free > 0 ? (delta / free) * (size - client) : 0;
}

type Axis = "y" | "x";
interface Bar {
  el: HTMLElement;
  y: HTMLDivElement;
  x: HTMLDivElement;
  timer: ReturnType<typeof setTimeout> | null;
  held: number;
}

/** Do polegar até a borda e entre as pontas do trilho, em px. */
const INSET = 2;
/** A área que pega o mouse (o polegar visível fica dentro dela, encostado na borda; base.css). */
const HIT = 12;
const ROLLS = new Set(["auto", "scroll"]);

let layer: HTMLDivElement | null = null;
const bars = new Map<HTMLElement, Bar>();

/** O elemento rola nesse eixo pelo usuário? Um `overflow: hidden` que só o `scrollIntoView` mexe não ganha barra. */
function rolls(el: HTMLElement, axis: Axis): boolean {
  const cs = getComputedStyle(el);
  const scrollable = el === document.scrollingElement || ROLLS.has(axis === "y" ? cs.overflowY : cs.overflowX);
  return scrollable && (axis === "y" ? el.scrollHeight > el.clientHeight + 0.5 : el.scrollWidth > el.clientWidth + 0.5);
}

function place(b: Bar): void {
  const el = b.el;
  if (!el.isConnected) return drop(b);
  const r = el.getBoundingClientRect();
  // O `zoom` do Tamanho do texto (body): o retângulo vem em px da tela, e o clientHeight em px do elemento.
  const zy = el.offsetHeight > 0 ? r.height / el.offsetHeight : 1;
  const zx = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
  const top = r.top + el.clientTop * zy;
  const left = r.left + el.clientLeft * zx;
  const h = el.clientHeight * zy;
  const w = el.clientWidth * zx;
  const both = rolls(el, "y") && rolls(el, "x");
  for (const axis of ["y", "x"] as const) {
    const node = b[axis];
    const box = rolls(el, axis)
      ? axis === "y"
        ? thumbBox(el.scrollTop, el.scrollHeight, el.clientHeight, h - 2 * INSET - (both ? HIT : 0))
        : thumbBox(el.scrollLeft, el.scrollWidth, el.clientWidth, w - 2 * INSET - (both ? HIT : 0))
      : null;
    node.hidden = !box;
    if (!box) continue;
    node.dataset.length = String(box.length);
    if (axis === "y") {
      node.style.cssText = `top:${top + INSET + box.offset}px;left:${left + w - HIT}px;height:${box.length}px`;
    } else {
      node.style.cssText = `left:${left + INSET + box.offset}px;top:${top + h - HIT}px;width:${box.length}px`;
    }
  }
}

function drop(b: Bar): void {
  if (b.timer) clearTimeout(b.timer);
  b.y.remove();
  b.x.remove();
  bars.delete(b.el);
}

function hideLater(b: Bar): void {
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    b.timer = null;
    if (b.held > 0) return;
    b.y.classList.remove("on");
    b.x.classList.remove("on");
  }, SCROLLBAR_IDLE_MS);
}

function makeThumb(b: () => Bar, axis: Axis): HTMLDivElement {
  const node = document.createElement("div");
  node.className = `kn-scrollbar kn-scrollbar-${axis}`;
  node.hidden = true;
  // Sobre o polegar, ele fica: só some quando o mouse sai (e depois do mesmo atraso).
  node.addEventListener("pointerenter", () => {
    b().held++;
  });
  node.addEventListener("pointerleave", () => {
    const bar = b();
    bar.held = Math.max(0, bar.held - 1);
    hideLater(bar);
  });
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const bar = b();
    const el = bar.el;
    const start = axis === "y" ? e.clientY : e.clientX;
    const from = axis === "y" ? el.scrollTop : el.scrollLeft;
    const r = el.getBoundingClientRect();
    const z = axis === "y" ? (el.offsetHeight > 0 ? r.height / el.offsetHeight : 1) : el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
    const track = (axis === "y" ? el.clientHeight : el.clientWidth) * z - 2 * INSET;
    const length = Number(node.dataset.length) || 0;
    const size = axis === "y" ? el.scrollHeight : el.scrollWidth;
    const client = axis === "y" ? el.clientHeight : el.clientWidth;
    node.setPointerCapture(e.pointerId);
    node.classList.add("drag");
    bar.held++;
    const move = (ev: PointerEvent) => {
      const to = from + dragToScroll((axis === "y" ? ev.clientY : ev.clientX) - start, size, client, track, length);
      if (axis === "y") el.scrollTop = to;
      else el.scrollLeft = to;
    };
    const up = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.classList.remove("drag");
      bar.held = Math.max(0, bar.held - 1);
      hideLater(bar);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  });
  return node;
}

function onScroll(e: Event): void {
  const t = e.target;
  const el = t === document ? (document.scrollingElement as HTMLElement | null) : t instanceof HTMLElement ? t : null;
  if (!el || !layer) return;
  let b = bars.get(el);
  if (!b) {
    if (!rolls(el, "y") && !rolls(el, "x")) return;
    const bar: Bar = { el, y: null!, x: null!, timer: null, held: 0 };
    bar.y = makeThumb(() => bar, "y");
    bar.x = makeThumb(() => bar, "x");
    layer.append(bar.y, bar.x);
    bars.set(el, bar);
    b = bar;
  }
  place(b);
  if (!b.y.hidden) b.y.classList.add("on");
  if (!b.x.hidden) b.x.classList.add("on");
  hideLater(b);
}

/**
 * Liga a barra fina na janela. Uma vez por documento, pelo `mount()`. A camada dos polegares fica no `<html>`, fora do
 * `zoom` do body, e cada polegar se posiciona pela tela (fixed).
 */
export function startScrollbars(doc: Document = document): void {
  if (layer || typeof doc === "undefined") return;
  layer = doc.createElement("div");
  layer.className = "kn-scrollbars";
  layer.setAttribute("aria-hidden", "true");
  doc.documentElement.append(layer);
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // A janela mudou de tamanho com um polegar na tela: ele acompanha a borda.
  window.addEventListener("resize", () => {
    for (const b of bars.values()) place(b);
  });
}
