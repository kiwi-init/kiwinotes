// A camada da gota na barra do Hub (spec #17725, T18646): atrás das abas e dos botões das seções, uma forma "gooey"
// (desfoque + limiar no alfa, um filtro SVG local) feita da pílula de abas e de uma gota de cada lado. Quando a seção
// põe os botões dela na barra, a gota daquele lado brota da pílula, se solta e vira os botões; quando tira, a gota
// volta pingando para a pílula. Na cor e no vidro da barra (`--float`, a borda em `--border`), nunca azul.
//
// Este arquivo mede e manda as fases (`goo.ts`); o movimento da ida e da volta (os @keyframes) mora no `goo.css`
// (T18647). Com "reduzir movimento", não há gota: os botões só aparecem e somem com um fade.

import "./goo.css";

import { useEffect, useLayoutEffect, useRef } from "react";

import { GOO_FALLBACK_MS, type GooPhase, type GooSide, gooOnAnimationEnd, gooOnButtons, gooRect, gooVars } from "./goo.ts";

const SIDES: GooSide[] = ["start", "end"];
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

  useLayoutEffect(() => {
    const el = layer.current;
    const tabs = bar?.querySelector<HTMLElement>(".kn-tabs");
    if (!el || !bar || !tabs) return;
    const slots: Record<GooSide, HTMLElement | null> = { start, end };

    const write = (vars: Record<string, string>) => {
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    };
    const measure = () => {
      const t = gooRect(tabs, bar);
      if (t) write(gooVars("tabs", t));
      for (const side of SIDES) {
        const slot = slots[side];
        // Sem botões, o lado guarda o último retângulo: é dali que a gota volta.
        const r = slot && contentRect(slot, bar);
        if (r) write(gooVars(side, r));
      }
    };
    const show = (side: GooSide, phase: GooPhase) => {
      phases.current[side] = phase;
      el.dataset[side] = phase;
      const drop = el.querySelector<HTMLElement>(`.kn-goo-drop[data-side="${side}"]`);
      if (drop) drop.dataset.phase = phase;
      const slot = slots[side];
      if (slot) slot.dataset.goo = phase;
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
      for (const slot of [start, end]) for (const c of Array.from(slot?.children ?? [])) if (!watched.has(c)) (watched.add(c), ro.observe(c));
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
      <svg className="kn-goo-defs" width="0" height="0" focusable="false">
        <filter id="kn-goo" x="-20%" y="-60%" width="140%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          {/* O limiar no alfa junta o que o desfoque encostou: a pílula e a gota viram uma forma só. */}
          <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
          {/* A borda de 1 px da barra (o anel do --shadow-float) em volta da forma inteira. */}
          <feMorphology in="goo" operator="dilate" radius="1" result="grown" />
          <feFlood className="kn-goo-edge" result="edgeColor" />
          <feComposite in="edgeColor" in2="grown" operator="in" result="edge" />
          <feMerge>
            <feMergeNode in="edge" />
            <feMergeNode in="goo" />
          </feMerge>
        </filter>
      </svg>
      <div className="kn-goo-shapes">
        <span className="kn-goo-base" />
        {SIDES.map((side) => (
          <span key={side} className="kn-goo-drop" data-side={side} data-phase="hidden" />
        ))}
      </div>
    </div>
  );
}
