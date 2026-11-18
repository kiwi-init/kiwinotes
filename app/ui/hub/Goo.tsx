// A camada da gota na barra do Hub (spec #17725): atrás das abas e dos botões das seções, uma gota de cada lado.
// Quando a seção põe os botões dela na barra, a gota daquele lado brota da pílula, se solta e vira os botões; quando
// tira, a gota faz o caminho de volta. Na cor e na borda da pílula (`--float`, o anel e o realce do `--shadow-float`).
//
// Desde a Gota 2 (T18948) a forma é desenhada, sem filtro: a cada quadro, um caminho SVG de `goo-shape.ts`. O relógio
// é a animação CSS de um `.kn-goo-drop` invisível por lado (`kn-goo-in-*`/`kn-goo-out-*`, no `goo.css`): o quadro lê o
// progresso dela, e o `animationend` anda a fase (`goo.ts`). Parar a animação (`pause`, `currentTime`) para a gota no
// quadro. Com "reduzir movimento", não há gota: os botões só aparecem e somem com um fade.

import "./goo.css";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { GOO_FALLBACK_MS, type GooPhase, type GooRect, type GooSide, gooOnAnimationEnd, gooOnButtons, gooRect, gooVars, gooWatchDiff } from "./goo.ts";
import { type GooParts, gooDropParts } from "./goo-shape.ts";

const SIDES: GooSide[] = ["start", "end"];
const PARTS: (keyof GooParts)[] = ["edge", "speck", "head"];
/** O fade dos botões com "reduzir movimento" (o `--fast`, com folga). */
const REDUCED_MS = 220;

const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/** O retângulo dos botões de um lado: a soma dos filhos do slot (o slot em si ocupa a coluna inteira da barra). */
function contentRect(slot: HTMLElement, bar: HTMLElement) {
  let box: { l: number; t: number; r: number; b: number } | null = null;
  for (const child of Array.from(slot.children)) {
    const r = gooRect(child as HTMLElement, bar);
    if (!r) continue;
    box = box
      ? { l: Math.min(box.l, r.x), t: Math.min(box.t, r.y), r: Math.max(box.r, r.x + r.w), b: Math.max(box.b, r.y + r.h) }
      : { l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h };
  }
  return box ? { x: box.l, y: box.t, w: box.r - box.l, h: box.b - box.t } : null;
}

/** `bar` é a `.kn-hub-top`; as abas (`.kn-tabs`) estão nela. `start` e `end`, os dois lados onde as seções põem botões. */
export function GooLayer({ bar, start, end }: { bar: HTMLElement | null; start: HTMLElement | null; end: HTMLElement | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const phases = useRef<Record<GooSide, GooPhase>>({ start: "hidden", end: "hidden" });
  const timers = useRef<Partial<Record<GooSide, ReturnType<typeof setTimeout>>>>({});
  const id = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const el = layer.current;
    const tabs = bar?.querySelector<HTMLElement>(".kn-tabs");
    if (!el || !bar || !tabs) return;
    const slots: Record<GooSide, HTMLElement | null> = { start, end };

    const write = (vars: Record<string, string>) => {
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    };
    const rects: { tabs: GooRect | null } & Partial<Record<GooSide, GooRect>> = { tabs: null };
    const measure = () => {
      const t = gooRect(tabs, bar);
      if (t) (rects.tabs = t, write(gooVars("tabs", t)));
      for (const side of SIDES) {
        const slot = slots[side];
        // Sem botões, o lado guarda o último retângulo: é dali que a gota volta.
        const r = slot && contentRect(slot, bar);
        if (r) (rects[side] = r, write(gooVars(side, r)));
      }
    };

    // O desenho: um quadro por `requestAnimationFrame` enquanto algum lado anda (`entering`/`leaving`).
    const paths = Object.fromEntries(
      SIDES.map((side) => [side, {
        parts: Object.fromEntries(PARTS.map((p) => [p, el.querySelector<SVGPathElement>(`.kn-goo-path[data-side="${side}"][data-part="${p}"]`)])),
        whole: Array.from(el.querySelectorAll<SVGPathElement>(`.kn-goo-whole[data-side="${side}"]`)),
      }]),
    ) as Record<GooSide, { parts: Record<keyof GooParts, SVGPathElement | null>; whole: SVGPathElement[] }>;
    const radius = () => parseFloat(getComputedStyle(el).getPropertyValue("--r-ctl")) || 10;
    const draw = (side: GooSide) => {
      const ph = phases.current[side];
      const target = rects[side];
      let parts: GooParts = { head: "", edge: "", speck: "" };
      if ((ph === "entering" || ph === "leaving") && rects.tabs && target) {
        const clock = el.querySelector<HTMLElement>(`.kn-goo-drop[data-side="${side}"]`);
        const timing = clock?.getAnimations()[0]?.effect?.getComputedTiming();
        const p = Number(timing?.progress ?? 0);
        parts = gooDropParts(ph === "entering" ? p : 1 - p, { side, tabs: rects.tabs, target, radius: radius() });
      }
      for (const k of PARTS) paths[side].parts[k]?.setAttribute("d", parts[k]);
      const all = parts.edge + parts.speck + parts.head;
      for (const w of paths[side].whole) w.setAttribute("d", all);
    };
    let frame = 0;
    const tick = () => {
      frame = 0;
      for (const side of SIDES) draw(side);
      if (SIDES.some((s) => phases.current[s] === "entering" || phases.current[s] === "leaving")) frame = requestAnimationFrame(tick);
    };
    const loop = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const show = (side: GooSide, phase: GooPhase) => {
      phases.current[side] = phase;
      el.dataset[side] = phase;
      const drop = el.querySelector<HTMLElement>(`.kn-goo-drop[data-side="${side}"]`);
      if (drop) drop.dataset.phase = phase;
      const slot = slots[side];
      if (slot) slot.dataset.goo = phase;
      draw(side);
      loop();
      clearTimeout(timers.current[side]);
      if (phase === "entering" || phase === "leaving") {
        timers.current[side] = setTimeout(() => show(side, gooOnAnimationEnd(phases.current[side])), reducedMotion() ? REDUCED_MS : GOO_FALLBACK_MS);
      }
    };
    const update = (side: GooSide, first = false) => {
      const slot = slots[side];
      const has = Boolean(slot && slot.childElementCount > 0);
      if (has) measure();
      const next = gooOnButtons(phases.current[side], has, first);
      if (first || next !== phases.current[side]) show(side, next);
    };

    measure();
    for (const side of SIDES) update(side, true);

    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    ro.observe(tabs);
    const watched = new Set<Element>();
    const watchChildren = () => {
      const { add, drop } = gooWatchDiff(watched, [start, end].flatMap((slot) => Array.from(slot?.children ?? [])));
      for (const c of drop) (watched.delete(c), ro.unobserve(c));
      for (const c of add) (watched.add(c), ro.observe(c));
    };
    watchChildren();
    const mos = SIDES.map((side) => {
      const slot = slots[side];
      if (!slot) return null;
      const mo = new MutationObserver(() => {
        watchChildren();
        update(side);
      });
      mo.observe(slot, { childList: true });
      return mo;
    });

    const onEnd = (e: AnimationEvent) => {
      const side = (e.target as HTMLElement).dataset?.side as GooSide | undefined;
      if (!side || !(e.target as HTMLElement).classList.contains("kn-goo-drop")) return;
      show(side, gooOnAnimationEnd(phases.current[side]));
    };
    el.addEventListener("animationend", onEnd);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      for (const mo of mos) mo?.disconnect();
      el.removeEventListener("animationend", onEnd);
      for (const side of SIDES) clearTimeout(timers.current[side]);
    };
  }, [bar, start, end]);

  useEffect(() => () => {
    for (const side of SIDES) clearTimeout(timers.current[side]);
  }, []);

  return (
    <div className="kn-goo" ref={layer} aria-hidden="true" data-start="hidden" data-end="hidden">
      <svg className="kn-goo-draw" focusable="false">
        <defs>
          {SIDES.map((side) => (
            <clipPath key={side} id={`${id}-clip-${side}`}>
              <path className="kn-goo-whole" data-side={side} />
            </clipPath>
          ))}
        </defs>
        {SIDES.map((side) => (
          <g key={side} className="kn-goo-side" data-side={side}>
            {PARTS.map((part) => (
              <path key={part} className="kn-goo-path" data-side={side} data-part={part} />
            ))}
            {/* O realce de 1 px em cima, o `inset 0 1px 0 var(--line)` da pílula no escuro: a forma pintada no tom do
                realce e, 1 px abaixo, a forma de novo na cor dela, os dois cortados pela própria forma. */}
            <g className="kn-goo-highlight" clipPath={`url(#${id}-clip-${side})`}>
              <path className="kn-goo-whole kn-goo-hl-band" data-side={side} />
              <path className="kn-goo-whole kn-goo-hl-cover" data-side={side} transform="translate(0 1)" />
            </g>
          </g>
        ))}
      </svg>
      {/* Os relógios da ida e da volta, um por lado: invisíveis, só a animação CSS. */}
      {SIDES.map((side) => (
        <span key={side} className="kn-goo-drop" data-side={side} data-phase="hidden" />
      ))}
    </div>
  );
}
