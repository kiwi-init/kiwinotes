// T10437: fixed approved symbol curves; eyes and gesture timing unchanged.
import type { CatFrame } from "./gestures";
import type { FogState } from "./state";
import { SYMBOL_SHAPES, type SymbolBackground } from "./symbols";
type Point = [number, number];
type Style = Record<string, string>;
type Styled = HTMLElement | SVGElement;
const fmt = (n: number) => Number(n.toFixed(5)).toString();
const points = (n: number, fn: (u: number) => Point) => Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
const path = (p: Point[], close = true) => p.length ? "M" + p.map(v => v.map(fmt).join(",")).join("L") + (close ? "Z" : "") : "";
interface Sprite { state: FogState; element: HTMLDivElement; part?: number }
export function createVectorLayer(root: HTMLElement, width: number, height: number, background: SymbolBackground = "dark") {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible";
  root.append(layer);
  function setBackground(value: SymbolBackground) {
    layer.style.color = value === "light" ? "#17171c" : "#fff";
    layer.style.setProperty("--kn-symbol-hole", value === "light" ? "#fff" : "#111113");
  }
  setBackground(background);
  const eyeNodes = [
    { cx: 802.823, cy: 1279.323, r: 68.251 },
    { cx: 1243.342, cy: 1279.308, r: 67.94 },
  ].map(e => {
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
  for (const shape of SYMBOL_SHAPES) {
    const [left, top, size] = shape.box, scale = size / 100;
    const pivot = [left + shape.pivot[0] * scale, top + shape.pivot[1] * scale];
    const element = document.createElement("div");
    element.dataset.symbol = shape.state;
    if (shape.part !== undefined) element.dataset.part = String(shape.part);
    element.style.cssText = "position:absolute;inset:0;opacity:0";
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 2048 2560" style="display:block;overflow:visible" fill="currentColor" aria-hidden="true"><g transform="translate(${left} ${top}) scale(${scale})">${shape.body}</g></svg>`;
    layer.append(element);
    const graphic = element.querySelector<SVGSVGElement>("svg")!, box = graphic.getBBox();
    // getBBox excludes stroke. Reserve the full 11-unit Z stroke and AA fringe.
    const pad = 48, x = box.x - pad, y = box.y - pad, w = box.width + pad * 2, h = box.height + pad * 2;
    graphic.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    element.style.inset = "auto";
    Object.assign(element.style, { left: `${x / 2048 * 100}%`, top: `${y / 2560 * 100}%`,
      width: `${w / 2048 * 100}%`, height: `${h / 2560 * 100}%`,
      transformOrigin: `${(pivot[0]! - x) / w * 100}% ${(pivot[1]! - y) / h * 100}%` });
    sprites.push({ state: shape.state, element, part: shape.part });
  }
  const dots = [...layer.querySelectorAll<SVGElement>("[data-dot]")];
  const errorPath = layer.querySelector<SVGPathElement>("[data-scribble]")!;
  const errorLength = errorPath.getTotalLength();
  errorPath.style.strokeDasharray = `${errorLength} ${errorLength}`;
  errorPath.style.strokeDashoffset = String(errorLength);
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
      result.set(s.element, { opacity: fmt(alpha), transform: `translate(${fmt(x * width / 2048)}px,${fmt(y * height / 2560)}px) scale(${fmt(frame.symbolScale)})` });
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
      errorPath.style.strokeDashoffset = fmt(errorLength * (1 - frame.progress));
      lastProgress = frame.progress;
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
    setBackground,
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
