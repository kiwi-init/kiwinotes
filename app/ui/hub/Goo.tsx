// A camada da gota na barra do Hub (spec #17725): atrás das abas e dos botões das seções, uma gota de cada lado.
// Quando a seção põe os botões dela na barra, a gota daquele lado brota da pílula, se solta e vira os botões; quando
// tira, a gota faz o caminho de volta. Na cor e na borda da pílula (`--float`, o anel e o realce do `--shadow-float`).
//
// Desde a Gota 2 (T18948) a forma é desenhada, sem filtro: a cada quadro, um caminho SVG de `goo-shape.ts`. O relógio
// é a animação CSS de um `.kn-goo-drop` invisível por lado (`kn-goo-in-*`/`kn-goo-out-*`, no `goo.css`): o quadro lê o
// progresso dela, e o `animationend` anda a fase (`goo.ts`). Parar a animação (`pause`, `currentTime`) para a gota no
// quadro. Com "reduzir movimento", não há gota: os botões só aparecem e somem com um fade.
//
// O compositor (#231, medida em #23816): o WKWebView dá o rAF a ~60 Hz mesmo na tela de 120 Hz, e na corrida a cabeça
// andava ~35 px por quadro. A cabeça mora numa camada própria por lado (`.kn-goo-run`), que anda pelo ponto do
// `gooHeadAnchor` numa animação WAAPI de `transform`: o Core Animation a toca na taxa da tela, fora da thread principal,
// e ela segue lisa mesmo com a página presa. O caminho dela é desenhado relativo a esse ponto, no rAF, e só muda de
// forma (a cauda, a mola), não de lugar. A animação segue o relógio: começa junto e para junto (o `pause` dos roteiros).
// Um quadro longo (a seção nova montando, ~50 ms) fora da corrida segura o relógio pelo tempo perdido: a gota não pula
// a barriga (era de 0% a 12% num quadro só). Na corrida não segura: o compositor não parou.
//
// Os botões na volta (T18949): a seção tira os botões da barra de uma vez (o React desmonta), e a gota que voltava sem
// eles era o "rastro preto" no escuro. Uma cópia dos últimos botões (`.kn-goo-ghost`) fica na camada e anda com a
// cabeça da gota (o mesmo centro e a mesma escala, quadro a quadro), esmaecendo conforme a cabeça encolhe: um objeto
// só, o botão que vira gota. É só desenho: `inert`, sem clique, fora do leitor de tela.

import "./goo.css";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { GOO_FALLBACK_MS, type GooPhase, type GooRect, type GooSide, gooOnAnimationEnd, gooOnButtons, gooRect, gooVars, gooWatchDiff } from "./goo.ts";
import { GOO_BEATS, GOO_HOLD_MS, type GooGeom, type GooParts, gooDropParts, gooHeadAnchor, roundRect } from "./goo-shape.ts";

const SIDES: GooSide[] = ["start", "end"];
/** As partes da camada de baixo; a cabeça vai na camada da corrida. */
const PARTS = ["edge", "speck"] as const;
const FRAME_MS = 1000 / 60;
/** Quantos pontos do caminho da cabeça a animação do compositor leva (o erro entre eles fica abaixo de 0,5 px). */
const RUN_KEYS = 48;
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
    const radius = () => parseFloat(getComputedStyle(el).getPropertyValue("--r-ctl")) || 10;
    // O raio, lido na medida e não a cada quadro.
    let rad = radius();
    const rects: { tabs: GooRect | null } & Partial<Record<GooSide, GooRect>> = { tabs: null };
    const base = el.querySelector<SVGPathElement>(".kn-goo-base");
    const measure = () => {
      rad = radius();
      const t = gooRect(tabs, bar);
      if (t) {
        rects.tabs = t;
        write(gooVars("tabs", t));
        // A pílula embaixo da pílula: o anel dela soma com o do `--shadow-float`, como na gota (o tom da main, #19034).
        base?.setAttribute("d", roundRect(t.x + t.w / 2, t.y + t.h / 2, t.w, t.h, rad));
      }
      for (const side of SIDES) {
        const slot = slots[side];
        // Sem botões, o lado guarda o último retângulo: é dali que a gota volta.
        const r = slot && contentRect(slot, bar);
        if (r) (rects[side] = r, write(gooVars(side, r)));
        place(side);
        // A barra mudou no meio da corrida: a animação refeita para os lugares novos, no mesmo tempo do relógio.
        if (runs[side]) startRun(side);
      }
    };

    // O desenho: um quadro por `requestAnimationFrame` enquanto algum lado anda (`entering`/`leaving`).
    const paths = Object.fromEntries(
      SIDES.map((side) => [side, {
        parts: Object.fromEntries(PARTS.map((p) => [p, el.querySelector<SVGPathElement>(`.kn-goo-path[data-side="${side}"][data-part="${p}"]`)])),
        whole: Array.from(el.querySelectorAll<SVGPathElement>(`.kn-goo-whole[data-side="${side}"]`)),
        head: el.querySelector<SVGPathElement>(`.kn-goo-path[data-side="${side}"][data-part="head"]`),
        headWhole: Array.from(el.querySelectorAll<SVGPathElement>(`.kn-goo-whole-head[data-side="${side}"]`)),
        run: el.querySelector<HTMLElement>(`.kn-goo-run[data-side="${side}"]`),
        at: el.querySelector<SVGGElement>(`.kn-goo-run[data-side="${side}"] .kn-goo-run-at`),
        svg: el.querySelector<SVGSVGElement>(`.kn-goo-run[data-side="${side}"] svg`),
      }]),
    ) as Record<GooSide, {
      parts: Record<(typeof PARTS)[number], SVGPathElement | null>; whole: SVGPathElement[];
      head: SVGPathElement | null; headWhole: SVGPathElement[];
      run: HTMLElement | null; at: SVGGElement | null; svg: SVGSVGElement | null;
    }>;
    const ghosts: Partial<Record<GooSide, HTMLElement>> = {};
    const clockOf = (side: GooSide) =>
      el.querySelector<HTMLElement>(`.kn-goo-drop[data-side="${side}"]`)?.getAnimations()[0] ?? null;
    const geom = (side: GooSide): GooGeom | null => {
      const target = rects[side];
      return rects.tabs && target ? { side, tabs: rects.tabs, target, radius: rad, back: phases.current[side] === "leaving" } : null;
    };

    // A camada da corrida: a caixa dela fica em volta do ponto da soltura (o `gooHeadAnchor` em 0), onde a cabeça está
    // sempre, relativa ao ponto; o `transform` a leva até o ponto do quadro.
    const origin: Partial<Record<GooSide, { x: number; y: number }>> = {};
    const runs: Partial<Record<GooSide, Animation>> = {};
    const offset = (side: GooSide, g: GooGeom, t: number) => {
      const o = origin[side]!;
      const a = gooHeadAnchor(t, g);
      return { x: a.x - o.x, y: a.y - o.y };
    };
    const place = (side: GooSide) => {
      const g = geom(side);
      const { run, svg } = paths[side];
      if (!g || !run || !svg) return;
      const o = gooHeadAnchor(0, g);
      origin[side] = o;
      // Metade da caixa: a metade dos botões (a mola passa ~12% dela) e a gota presa à pílula, com folga para o anel.
      const hw = Math.ceil(Math.max(g.target.w * 0.62, g.tabs.h * 2) + 8);
      const hh = Math.ceil(Math.max(g.target.h, g.tabs.h) + 8);
      Object.assign(run.style, { left: `${o.x - hw}px`, top: `${o.y - hh}px`, width: `${hw * 2}px`, height: `${hh * 2}px` });
      // O SVG fica na origem da barra (as coordenadas do `goo-shape.ts`), visto pela caixa.
      Object.assign(svg.style, { left: `${hw - o.x}px`, top: `${hh - o.y}px` });
    };
    /** A animação da corrida de um lado: o `transform` do ponto, quadro a quadro do relógio. */
    const startRun = (side: GooSide) => {
      stopRun(side);
      const g = geom(side);
      const clock = clockOf(side);
      const run = paths[side].run;
      if (!g || !clock || !run || !origin[side]) return;
      const back = phases.current[side] === "leaving";
      const keys = Array.from({ length: RUN_KEYS + 1 }, (_, i) => {
        const p = i / RUN_KEYS;
        const d = offset(side, g, back ? 1 - p : p);
        return { offset: p, transform: `translate(${d.x}px, ${d.y}px)` };
      });
      const a = run.animate(keys, { duration: Number(clock.effect?.getComputedTiming().duration ?? 0), easing: "linear", fill: "both" });
      a.pause();
      runs[side] = a;
      syncRun(side);
    };
    const stopRun = (side: GooSide) => {
      runs[side]?.cancel();
      delete runs[side];
    };
    /** A corrida no tempo do relógio: o mesmo início, ou parada no mesmo ponto quando o relógio para. */
    const syncRun = (side: GooSide) => {
      const a = runs[side];
      const clock = clockOf(side);
      if (!a || !clock) return;
      if (clock.playState === "running" && clock.startTime !== null) {
        if (a.playState !== "running") a.play();
        if (a.startTime !== clock.startTime) a.startTime = clock.startTime;
      } else {
        if (a.playState !== "paused") a.pause();
        if (a.currentTime !== clock.currentTime) a.currentTime = clock.currentTime;
      }
    };
    /** Um quadro longo fora da corrida: o relógio (e os botões, que andam com ele) recua o tempo perdido. */
    const hold = (side: GooSide, debt: number) => {
      const t = progress(side);
      if (t > GOO_BEATS.pinch && t < GOO_BEATS.arrive) return;
      const slot = slots[side];
      const anims = [clockOf(side), ...Array.from(slot?.children ?? []).flatMap((c) => c.getAnimations())];
      for (const a of anims) {
        if (a && a.playState === "running" && a.startTime !== null) a.startTime = Number(a.startTime) + debt;
      }
    };
    /** O `t` do lado agora (0 a 1 na ida; na volta, de 1 a 0). */
    const progress = (side: GooSide) => {
      const ph = phases.current[side];
      const p = Number(clockOf(side)?.effect?.getComputedTiming().progress ?? 0);
      return ph === "entering" ? p : ph === "leaving" ? 1 - p : ph === "shown" ? 1 : 0;
    };

    const draw = (side: GooSide) => {
      const ph = phases.current[side];
      const target = rects[side];
      const g = geom(side);
      let parts: GooParts = { head: "", edge: "", speck: "" };
      let t = 1;
      if ((ph === "entering" || ph === "leaving") && g) {
        t = progress(side);
        parts = gooDropParts(t, g);
      } else if (ph === "shown" && g) {
        parts = gooDropParts(1, g);
      }
      for (const k of PARTS) paths[side].parts[k]?.setAttribute("d", parts[k]);
      const low = parts.edge + parts.speck;
      for (const w of paths[side].whole) w.setAttribute("d", low);
      // A cabeça, relativa ao ponto deste quadro; a camada já está nele (a animação, ou o lugar parado).
      const { head, headWhole, at, run } = paths[side];
      head?.setAttribute("d", parts.head);
      for (const w of headWhole) w.setAttribute("d", parts.head);
      if (g && origin[side] && at && run) {
        const d = offset(side, g, t);
        at.setAttribute("transform", `translate(${-d.x} ${-d.y})`);
        // Com a animação, ela leva a camada; sem ela (parada), o lugar fica no estilo.
        if (runs[side]) syncRun(side);
        else run.style.transform = `translate(${d.x}px, ${d.y}px)`;
      }
      const gh = ghosts[side];
      if (gh && target) followHead(gh, parts.head ? head : null, target, t);
    };
    // A cópia vai no centro da cabeça, com uma escala só (o texto não deforma), por dentro dela. Some enquanto a gota
    // desamassa, da mola até a lágrima (de `t` 1 até a chegada, `GOO_BEATS.arrive`): na corrida só há a gota, e a cópia
    // não cobre o anel dela.
    const followHead = (g: HTMLElement, head: SVGPathElement | null, r: GooRect, t: number) => {
      const b = head?.getBBox();
      if (!b || !b.width || !b.height) return void (g.style.opacity = "0");
      const sx = b.width / r.w;
      const sy = b.height / r.h;
      const dx = b.x + b.width / 2 - (r.x + r.w / 2);
      const dy = b.y + b.height / 2 - (r.y + r.h / 2);
      g.style.transform = `translate(${dx}px, ${dy}px) scale(${Math.min(1, sx, sy)})`;
      const fade = Math.min(1, Math.max(0, (t - GOO_BEATS.arrive) / (1 - GOO_BEATS.arrive)));
      g.style.opacity = String(fade);
    };
    let frame = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      frame = 0;
      const gap = lastTick ? now - lastTick : 0;
      lastTick = now;
      if (gap > GOO_HOLD_MS) {
        for (const side of SIDES) if (runs[side]) hold(side, gap - FRAME_MS);
      }
      for (const side of SIDES) draw(side);
      if (SIDES.some((s) => phases.current[s] === "entering" || phases.current[s] === "leaving")) frame = requestAnimationFrame(tick);
      else lastTick = 0;
    };
    const loop = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    // A cópia dos botões que saíram, por lado. Sai quando o lado deixa a volta (fim, ou reentrou).
    const removed: Partial<Record<GooSide, Element[]>> = {};
    const dropGhost = (side: GooSide) => {
      ghosts[side]?.remove();
      delete ghosts[side];
    };
    const spawnGhost = (side: GooSide) => {
      dropGhost(side);
      const nodes = removed[side] ?? [];
      delete removed[side];
      const r = rects[side];
      const slot = slots[side];
      if (!nodes.length || !r || !slot || reducedMotion()) return;
      const g = document.createElement("div");
      g.className = "kn-goo-ghost";
      g.dataset.side = side;
      g.inert = true;
      g.setAttribute("aria-hidden", "true");
      Object.assign(g.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, gap: getComputedStyle(slot).gap });
      for (const n of nodes) {
        const c = n.cloneNode(true) as Element;
        for (const e of [c, ...Array.from(c.querySelectorAll("[id]"))]) e.removeAttribute("id");
        g.append(c);
      }
      ghosts[side] = g;
      el.append(g);
    };

    const show = (side: GooSide, phase: GooPhase) => {
      if (phase === "leaving") spawnGhost(side);
      else dropGhost(side);
      phases.current[side] = phase;
      el.dataset[side] = phase;
      const drop = el.querySelector<HTMLElement>(`.kn-goo-drop[data-side="${side}"]`);
      if (drop) drop.dataset.phase = phase;
      const slot = slots[side];
      if (slot) slot.dataset.goo = phase;
      if ((phase === "entering" || phase === "leaving") && !reducedMotion()) startRun(side);
      else stopRun(side);
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
      const mo = new MutationObserver((records) => {
        // Os botões que saíram: viram a cópia se o lado entrar na volta agora.
        const gone = records.flatMap((r) => Array.from(r.removedNodes)).filter((n): n is Element => n instanceof Element);
        removed[side] = gone.length ? gone : undefined;
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
      for (const side of SIDES) (clearTimeout(timers.current[side]), dropGhost(side), stopRun(side));
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
          {SIDES.map((side) => (
            <clipPath key={side} id={`${id}-clip-head-${side}`}>
              <path className="kn-goo-whole-head" data-side={side} />
            </clipPath>
          ))}
        </defs>
        <path className="kn-goo-path kn-goo-base" />
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
      {/* A cabeça de cada lado, na camada da corrida: o mesmo desenho, com o realce cortado por ela. */}
      {SIDES.map((side) => (
        <div key={side} className="kn-goo-run" data-side={side}>
          <svg className="kn-goo-run-draw" focusable="false">
            <g className="kn-goo-run-at">
              <path className="kn-goo-path" data-side={side} data-part="head" />
              <g className="kn-goo-highlight" clipPath={`url(#${id}-clip-head-${side})`}>
                <path className="kn-goo-whole-head kn-goo-hl-band" data-side={side} />
                <path className="kn-goo-whole-head kn-goo-hl-cover" data-side={side} transform="translate(0 1)" />
              </g>
            </g>
          </svg>
        </div>
      ))}
      {/* Os relógios da ida e da volta, um por lado: invisíveis, só a animação CSS. */}
      {SIDES.map((side) => (
        <span key={side} className="kn-goo-drop" data-side={side} data-phase="hidden" />
      ))}
    </div>
  );
}
