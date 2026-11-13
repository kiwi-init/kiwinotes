// T8959: vector forms ported from this repository's approved estados/montar.py.
// No raster symbols, new motifs, glow or agent-coloured strokes.
import type { CatFrame } from "./gestures";
import type { FogState } from "./state";
type Point = [number, number];
type Style = Record<string, string>;
type Styled = HTMLElement | SVGElement;
const TAU = Math.PI * 2;
const fmt = (n: number) => Number(n.toFixed(5)).toString();
const points = (n: number, fn: (u: number) => Point) => Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
const path = (p: Point[], close = true) => p.length ? "M" + p.map(v => v.map(fmt).join(",")).join("L") + (close ? "Z" : "") : "";
function transform([x, y]: Point, kind: string): Point {
  if (kind === "alert" || kind === "sleep") {
    const dx = x - 1710, dy = y - 700, a = Math.PI / 15;
    x = 1710 + dx * Math.cos(a) - dy * Math.sin(a); y = 700 + dx * Math.sin(a) + dy * Math.cos(a);
  }
  x = kind === "thought" ? 1560 + (x - 1560) * 1.12 : x > 1024 ? 1545 + (x - 1545) * 1.18 - 45 : 400 + (x - 400) * 1.18 + 25;
  return [x, 850 + (y - 850) * 1.15 + 35];
}
function polygon(p: Point[], kind: string, rounds = 0) {
  for (let pass = 0; pass < rounds; pass++) p = p.flatMap((a, i): Point[] => {
    const b = p[(i + 1) % p.length]!;
    return [[a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]];
  });
  return path(p.map(p => transform(p, kind)));
}
const disc = (x: number, y: number, r: number, kind: string) => polygon(points(90, u => [x + r * Math.cos(u * TAU), y + r * (1 + .04 * Math.sin(u * TAU * 3)) * Math.sin(u * TAU)]), kind);
function ribbon(p: Point[], widths: number[], kind: string) {
  if (p.length < 2) return "";
  const a: Point[] = [], b: Point[] = [];
  for (let i = 0; i < p.length; i++) {
    const before = p[Math.max(0, i - 1)]!, after = p[Math.min(p.length - 1, i + 1)]!, q = p[i]!;
    const dx = after[0] - before[0], dy = after[1] - before[1], length = Math.max(.001, Math.hypot(dx, dy)), half = widths[i]! / 2;
    a.push([q[0] - dy / length * half, q[1] + dx / length * half]);
    b.push([q[0] + dy / length * half, q[1] - dx / length * half]);
  }
  const first = p[0]!, last = p[p.length - 1]!;
  // The approved brush unions each ribbon quad; even-odd filling an entire
  // self-crossing outline would cut new holes in the error scribble.
  return p.slice(1).map((_, i) => polygon([a[i]!, a[i + 1]!, b[i + 1]!, b[i]!], kind)).join("") +
    disc(...first, widths[0]! / 2, kind) + disc(...last, widths[widths.length - 1]! / 2, kind);
}
const dash = (x: number, y: number, length: number, dy: number, kind: string) => ribbon(points(50, t => [x + t * length, y + dy * t + 3 * Math.sin(t * Math.PI)]), points(50, t => [4 + 36 * (1 - t) ** .65, 0]).map(p => p[0]), kind);
const bezier = (p: Point[]) => points(80, t => [0, 1].map(i => (1 - t) ** 3 * p[0]![i]! + 3 * (1 - t) ** 2 * t * p[1]![i]! + 3 * (1 - t) * t ** 2 * p[2]![i]! + t ** 3 * p[3]![i]!) as Point);
const drop = (x: number, y: number) => polygon([...bezier([[x, y - 65], [x - 10, y - 45], [x - 66, y + 24], [x - 38, y + 51]]), ...bezier([[x - 38, y + 51], [x + 43, y + 98], [x + 72, y + 12], [x, y - 65]])], "work");
const star = (x: number, y: number, r: number) => polygon([[x, y - r], [x + 13, y - 14], [x + r, y + 3], [x + 13, y + 16], [x - 2, y + r], [x - 14, y + 15], [x - r, y - 2], [x - 15, y - 15]], "spark", 2);
interface Sprite { state: FogState; element: HTMLDivElement; pivot: Point; part?: number }
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 2048 2560" style="display:block;overflow:visible" fill="white" aria-hidden="true">${body}</svg>`;
const white = (d: string, hole = false) => `<path d="${d}" fill-rule="${hole ? "evenodd" : "nonzero"}"/>`;
export function createVectorLayer(root: HTMLElement, width: number, height: number, backdrop = false) {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible";
  root.append(layer);
  if (backdrop) {
    layer.className = "kn-cat-backdrop";
    const style = document.createElement("style");
    style.textContent = ".kn-cat-backdrop svg { fill:black !important; stroke:black !important; stroke-width:18px; stroke-linejoin:round } .kn-cat-backdrop svg * { fill:black !important; stroke:black !important; paint-order:stroke fill }";
    layer.append(style);
  }
  const eyeNodes = [
    { cx: 802.823, cy: 1279.323, r: 68.251 },
    { cx: 1243.342, cy: 1279.308, r: 67.94 },
  ].filter(() => !backdrop).map(e => {
    const outer = document.createElement("div");
    outer.style.cssText = `position:absolute;left:${e.cx / 2048 * 100}%;top:${e.cy / 2560 * 100}%;width:${e.r * 2 / 2048 * 100}%;height:${e.r * 2 / 2560 * 100}%;transform-origin:center;will-change:transform`;
    const disk = document.createElement("div"), happy = document.createElement("div"), asleep = document.createElement("div");
    for (const node of [disk, happy, asleep]) { node.style.cssText = "position:absolute;inset:0;transform-origin:center;will-change:transform,opacity"; outer.append(node); }
    const wrap = (body: string) => `<svg viewBox="-1 -1 2 2" width="100%" height="100%" style="display:block;overflow:visible" aria-hidden="true">${body}</svg>`;
    disk.innerHTML = wrap('<circle r="1" fill="white"/>');
    const arc = (start: number, end: number) => path(points(64, u => { const a = (start + (end - start) * u) * Math.PI / 180; return [Math.cos(a), .1 + .55 * Math.sin(a)]; }), false);
    happy.innerHTML = wrap(`<path d="${arc(190, 350)}" stroke="white" stroke-width="${34 / e.r}" stroke-linecap="round" fill="none"/>`);
    asleep.innerHTML = wrap(`<path d="${arc(10, 170)}" stroke="white" stroke-width="${34 / e.r}" stroke-linecap="round" fill="none"/>`);
    layer.append(outer);
    return { outer, disk, happy, asleep };
  });
  const sprites: Sprite[] = [];
  function sprite(state: FogState, body: string, pivot: Point, part?: number) {
    const element = document.createElement("div");
    element.dataset.symbol = state;
    if (part !== undefined) element.dataset.part = String(part);
    element.style.cssText = `position:absolute;inset:0;transform-origin:${pivot[0] / 2048 * 100}% ${pivot[1] / 2560 * 100}%;opacity:0`;
    element.innerHTML = svg(body); layer.append(element);
    // Rasterize only the motif bounds, rather than one full canvas per symbol.
    // A local pivot preserves the exact approved position and scaling.
    const graphic = element.querySelector<SVGSVGElement>("svg")!;
    const box = graphic.getBBox();
    // The animated error path starts empty; reserve its full source envelope.
    const bounds = state === "erro" ? { x: 1500, y: 450, width: 500, height: 400 } : box;
    const pad = backdrop ? 14 : 4;
    const x = bounds.x - pad, y = bounds.y - pad, w = bounds.width + pad * 2, h = bounds.height + pad * 2;
    graphic.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    element.style.inset = "auto";
    Object.assign(element.style, { left: `${x / 2048 * 100}%`, top: `${y / 2560 * 100}%`,
      width: `${w / 2048 * 100}%`, height: `${h / 2560 * 100}%`,
      transformOrigin: `${(pivot[0] - x) / w * 100}% ${(pivot[1] - y) / h * 100}%` });
    sprites.push({ state, element, pivot, part }); return element;
  }
  const alert = polygon([[1661, 480], [1758, 470], [1735, 634], [1694, 644]], "alert", 2) + disc(1714, 693, 28, "alert") + dash(1822, 598, 65, -35, "alert") + dash(1822, 666, 67, 20, "alert");
  sprite("acordou", white(alert), [1740, 640]);
  const zs = [[1640, 730, 105], [1800, 530, 150]].map(([x, y, z]) => {
    const u = z! / 2;
    return polygon([[x! - u, y! - u], [x! + u + 7, y! - u - 6], [x! + u + 1, y! - u + 35], [x! - u + 42, y! + u - 31], [x! + u + 8, y! + u - 30], [x! + u, y! + u + 6], [x! - u - 6, y! + u], [x! - u + 1, y! + u - 30], [x! + u - 43, y! - u + 33], [x! - u + 2, y! - u + 37]], "sleep", 1);
  }).join("");
  sprite("dormindo", white(zs), [1740, 680]);
  for (let j = 1; j <= 3; j++) {
    const r = 45 + j * 48, ps = points(100, u => { const t = -.96 + u * 1.92; return [1590 + r * Math.cos(t), 930 + r * Math.sin(t)]; });
    const widths = points(100, u => [3 + 38 * Math.sin(u * Math.PI) ** .7, 0]).map(p => p[0]);
    sprite("ouvindo", white(ribbon(ps, widths, "sound")), [1760, 970], j - 1);
  }
  const cloud = (rx: number, ry: number) => polygon(points(200, u => { const t = u * TAU, ripple = 1 + .095 * Math.cos(7 * t + .2); return [1765 + rx * ripple * Math.cos(t), 575 + ry * ripple * Math.sin(t)]; }), "thought");
  const thought = sprite("thinking", white(cloud(190, 123) + cloud(153, 86), true) + white(disc(1590, 751, 23, "thought") + disc(1558, 807, 14, "thought")) + [0, 1, 2].map(j => `<g data-dot="${j}">${white(disc(1665 + j * 95, 575, 23, "thought"))}</g>`).join(""), [1770, 590]);
  const dots = [...thought.querySelectorAll<SVGGElement>("[data-dot]")];
  sprite("agindo", white(drop(1680, 820)), [1660, 890], 0);
  sprite("agindo", white(drop(1810, 1010)), [1810, 1100], 1);
  sprite("agindo", white([0, 1, 2].map(j => dash(240 - j * 20, 1030 + j * 90, 135, -8 + j * 6, "work")).join("")), [280, 1170], 2);
  for (const [x, y, r] of [[350, 1050, 64], [1710, 780, 76], [1790, 1210, 49]]) sprite("pronto", white(star(x!, y!, r!)), transform([x!, y!], "spark"));
  const scribble = points(240, u => { const t = u * 7 * Math.PI; return [1740 + 110 * Math.cos(t) + 3 * Math.sin(t * 7), 650 + 60 * Math.sin(t) + 28 * Math.sin(t * 1.65) + 3 * Math.cos(t * 9)]; });
  const scribbleWidths = points(240, u => [21 + 13 * (1 + Math.sin(u * 7 * Math.PI * 1.3)) / 2, 0]).map(p => p[0]);
  const error = sprite("erro", '<path data-scribble=""/>', [1740, 655]);
  const errorPath = error.querySelector<SVGPathElement>("[data-scribble]")!;
  const scribbleCache = new Map<number, string>();
  let lastProgress = -1;
  const animations: Animation[] = [];
  let cache = new WeakMap<Styled, string>();
  function styles(frame: CatFrame) {
    const result = new Map<Styled, Style>(), e = frame.eyes;
    eyeNodes.forEach((nodes, i) => {
      const scale = e.size * (i ? e.rightSize : 1);
      result.set(nodes.outer, { transform: `translate(-50%,-50%) translate(${fmt(e.x * width / 2048)}px,${fmt(e.y * height / 2560)}px) scale(${fmt(scale)})` });
      result.set(nodes.disk, { transform: `scaleY(${fmt(e.blink)})`, clipPath: `inset(${fmt((1 - e.opening) * 100)}% 0 0 0)`, opacity: fmt((1 - Math.max(e.happy, e.asleep)) * (e.blink > .035 ? 1 : 0)) });
      result.set(nodes.happy, { opacity: fmt(Math.max(e.happy, Math.min(1, Math.max(0, (.5 - e.blink) / .3)))) });
      result.set(nodes.asleep, { opacity: fmt(e.asleep) });
    });
    for (const s of sprites) {
      if (s.state !== frame.symbol) { result.set(s.element, { opacity: "0", transform: "none" }); continue; }
      let alpha = frame.symbolAlpha, y = frame.symbolY, x = 0;
      if (s.state === "ouvindo") alpha *= frame.waves[s.part!]!;
      if (s.state === "agindo") {
        const phase = (frame.work + frame.workOffsets[s.part!]!) % 1;
        alpha *= 1 - Math.max(0, (phase - .8) / .2);
        if (s.part === 2) x += phase * 30; else y += phase * 24;
      }
      if (s.state === "erro") { x += frame.jitter[0]; y += frame.jitter[1]; }
      // Same approved motifs, enlarged independently around their local pivots.
      const emphasis = s.state === "thinking" ? 1.18 : 1.3;
      const shiftX = s.state === "thinking" ? -45 : s.state === "ouvindo" ? -25 : 0;
      const shiftY = s.state === "thinking" ? -60 : 0;
      result.set(s.element, { opacity: fmt(alpha), transform: `translate(${fmt((x + shiftX) * width / 2048)}px,${fmt((y + shiftY) * height / 2560)}px) scale(${fmt(frame.symbolScale * emphasis)})` });
    }
    dots.forEach((node, i) => result.set(node, { opacity: frame.symbol === "thinking" ? fmt(frame.dots[i]!) : "1" }));
    return result;
  }
  function apply(frame: CatFrame) {
    let changed = false;
    for (const [element, values] of styles(frame)) {
      const key = JSON.stringify(values);
      if (cache.get(element) !== key) { Object.assign(element.style, values); cache.set(element, key); changed = true; }
    }
    if (frame.symbol === "erro" && frame.progress !== lastProgress) {
      const count = Math.max(2, Math.ceil(frame.progress * scribble.length));
      if (!scribbleCache.has(count)) scribbleCache.set(count, ribbon(scribble.slice(0, count), scribbleWidths.slice(0, count), "confusion"));
      errorPath.setAttribute("d", frame.progress <= 0 ? "" : scribbleCache.get(count)!); lastProgress = frame.progress;
      changed = true;
    }
    return changed;
  }
  function stop() {
    if (!animations.length) return;
    animations.splice(0).forEach(a => {
      try { a.commitStyles(); }
      catch { /* Hidden or detached targets cannot commit; cancellation is enough. */ }
      finally { a.cancel(); }
    });
    cache = new WeakMap();
  }
  return {
    apply,
    stop,
    /** Quiet gestures use cached transform/opacity layers, not a shader RAF. */
    animate(frames: CatFrame[], duration: number) {
      stop(); apply(frames[0]!);
      if (duration <= 0 || frames.length < 2) return;
      const all = frames.map(styles);
      for (const [element, first] of all[0]!) {
        // Declaring even a constant clip-path in a transform animation can
        // prevent compositor acceleration. Keep unchanged properties inline.
        const changing = Object.keys(first).filter(p => all.some(map => map.get(element)![p] !== first[p]));
        if (!changing.length) continue;
        const keys = all.map((map, i) => ({ ...Object.fromEntries(changing.map(p => [p, map.get(element)![p]!])), offset: i / (all.length - 1), easing: "steps(1,end)" }));
        animations.push(element.animate(keys, { duration: duration * 1000, fill: "forwards" }));
      }
    },
    dispose() { stop(); layer.remove(); },
  };
}
