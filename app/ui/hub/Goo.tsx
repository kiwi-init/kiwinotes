// A camada da gota na barra do Hub (spec #17725): atrás das abas e dos botões das seções, uma gota de cada lado.
// Quando a seção põe os botões dela na barra, a gota daquele lado brota da pílula, se solta e vira os botões; quando
// tira, a gota faz o caminho de volta. Na cor e na borda da pílula (`--float`, o anel e o realce do `--shadow-float`).
//
// A gota por mola (spec #32446, T32465): sem relógio linear e sem fases da forma. A gota tem um estado (lugar e
// velocidade, `goo-spring.ts`) e uma mola a leva ao alvo: os botões, ou a pílula. No clique, o caminho inteiro até o
// repouso sai de uma vez (`gooPlan`, um estado por quadro de `GOO_PLAN_HZ`), e um relógio WAAPI por lado (`.kn-goo-clock`, sem
// nada na tela) dura o caminho: o quadro desenha o estado do `currentTime` dele, e o fim dele anda a fase. Parar o
// relógio (`pause`, `currentTime`) para a gota no quadro. Trocar de aba no meio só troca o alvo: o caminho novo sai do
// estado daquele instante, com a velocidade que ele tem, e o relógio novo começa em 0. Com "reduzir movimento", não há
// gota: os botões só aparecem e somem com um fade.
//
// A largada (spec #32446): a seção nova monta no mesmo quadro do clique, e esse quadro é longo (~50 ms). O caminho
// sai no 1º quadro que chega no tempo depois dele, e o relógio começa nesse quadro. Até lá, o `.kn-goo-clock` leva
// `data-waiting`, a gota fica onde está (ou segue o caminho de antes, numa troca no meio) e os botões novos ficam
// escondidos. Assim a barriga não pula quadros, sem "segurar o relógio".
//
// O compositor (#231, medida em #23816): o WKWebView dá o rAF a ~60 Hz mesmo na tela de 120 Hz. A cabeça mora numa
// camada própria por lado (`.kn-goo-run`), que anda pelo centro dela (`gooAnchor`) numa animação WAAPI de `transform`
// com um quadro-chave por estado do caminho: o Core Animation a toca na taxa da tela, fora da thread principal, e ela
// segue lisa mesmo com a página presa. O caminho dela é desenhado relativo a esse ponto, no rAF, e só muda de forma
// (a cauda, a mola), não de lugar. A animação segue o relógio: começa junto e para junto (o `pause` dos roteiros).
// Numa troca no meio, ela é refeita do estado daquele instante, como o caminho.
//
// Os botões na ida nascem de dentro da gota: uma animação WAAPI por botão (`id` `kn-goo-buttons-in`), com a opacidade
// do `gooButtons` em cada estado do caminho, no tempo do relógio. Na volta (T18949), a seção tira os botões da barra de
// uma vez (o React desmonta), e a gota que voltava sem eles era o "rastro preto" no escuro. Uma cópia dos últimos
// botões (`.kn-goo-ghost`) fica na camada e anda com a cabeça da gota (o mesmo centro e a mesma escala, quadro a
// quadro), esmaecendo pelo `gooButtons`: um objeto só, o botão que vira gota. É só desenho: `inert`, sem clique, fora
// do leitor de tela.

import "./goo.css";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { GOO_FALLBACK_MS, type GooPhase, type GooRect, type GooSide, gooOnAnimationEnd, gooOnButtons, gooRect, gooVars, gooWatchDiff } from "./goo.ts";
import { type GooGeom, type GooParts, roundRect } from "./goo-shape.ts";
import { type GooDrop, type GooPlan, gooAnchor, gooAt, gooButtons, gooParts, gooPlan, gooPlanMs, gooRest, gooRunProgress } from "./goo-spring.ts";

const SIDES: GooSide[] = ["start", "end"];
/** As partes da camada de baixo; a cabeça vai na camada da corrida. */
const PARTS = ["edge", "speck"] as const;
/** O fade dos botões com "reduzir movimento" (o `--fast`, com folga). */
const REDUCED_MS = 220;
/** A cópia dos botões some quando a gota anda o primeiro décimo da volta (o `gooRunProgress` cai de 1 a 0,9). */
const GHOST_FROM = 0.9;
/** O nome das animações dos botões na ida (os roteiros param as da gota por ele). */
const BUTTONS_ID = "kn-goo-buttons-in";
/** A largada espera um quadro pintado no tempo (até um quadro e meio de 60 Hz desde o anterior: um de 30 ms ainda
 *  era a seção montando, e o seguinte levou 58 ms)... */
const LAUNCH_GAP_MS = 24;
/** ...e, numa máquina que não dá quadro no tempo, larga assim mesmo depois disto. */
const LAUNCH_MAX_MS = 300;
const NONE: GooParts = { head: "", edge: "", speck: "" };

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

/** Uma animação no tempo do relógio: o mesmo início, ou parada no mesmo ponto quando o relógio para. */
function follow(a: Animation, clock: Animation) {
  if (clock.playState === "running" && clock.startTime !== null) {
    if (a.playState !== "running") a.play();
    if (a.startTime !== clock.startTime) a.startTime = clock.startTime;
  } else {
    if (a.playState !== "paused") a.pause();
    if (a.currentTime !== clock.currentTime) a.currentTime = clock.currentTime;
  }
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
        if (plans[side]) startRun(side);
        // Parada atrás dos botões, a gota não tem quadro que a redesenhe: sem isto, o caminho das Notas que encolhia
        // deixava a gota velha à direita, e o que crescia mostrava o degrau dela no meio da borda do botão (T26097, #26087).
        else draw(side);
      }
    };

    const paths = Object.fromEntries(
      SIDES.map((side) => [side, {
        parts: Object.fromEntries(PARTS.map((p) => [p, el.querySelector<SVGPathElement>(`.kn-goo-path[data-side="${side}"][data-part="${p}"]`)])),
        whole: Array.from(el.querySelectorAll<SVGPathElement>(`.kn-goo-whole[data-side="${side}"]`)),
        head: el.querySelector<SVGPathElement>(`.kn-goo-path[data-side="${side}"][data-part="head"]`),
        headWhole: Array.from(el.querySelectorAll<SVGPathElement>(`.kn-goo-whole-head[data-side="${side}"]`)),
        run: el.querySelector<HTMLElement>(`.kn-goo-run[data-side="${side}"]`),
        at: el.querySelector<SVGGElement>(`.kn-goo-run[data-side="${side}"] .kn-goo-run-at`),
        svg: el.querySelector<SVGSVGElement>(`.kn-goo-run[data-side="${side}"] svg`),
        drop: el.querySelector<HTMLElement>(`.kn-goo-clock[data-side="${side}"]`),
      }]),
    ) as Record<GooSide, {
      parts: Record<(typeof PARTS)[number], SVGPathElement | null>; whole: SVGPathElement[];
      head: SVGPathElement | null; headWhole: SVGPathElement[];
      run: HTMLElement | null; at: SVGGElement | null; svg: SVGSVGElement | null; drop: HTMLElement | null;
    }>;
    const ghosts: Partial<Record<GooSide, HTMLElement>> = {};
    const geom = (side: GooSide): GooGeom | null => {
      const target = rects[side];
      return rects.tabs && target ? { side, tabs: rects.tabs, target, radius: rad } : null;
    };

    // O estado de cada lado: o alvo (`want`: tem botões?), o caminho andando (`plans`) e o relógio dele (`clocks`). Sem
    // caminho, a gota está parada no alvo de antes (`still`).
    const want: Record<GooSide, boolean> = { start: false, end: false };
    const still: Record<GooSide, boolean> = { start: false, end: false };
    const plans: Partial<Record<GooSide, GooPlan>> = {};
    const clocks: Partial<Record<GooSide, Animation>> = {};
    /** Os lados esperando a largada: quando a troca veio e quantos quadros passaram desde ela. */
    const waits: Partial<Record<GooSide, { at: number; frames: number }>> = {};
    /** O estado do lado agora: o do caminho no `currentTime` do relógio, ou o repouso. */
    const stateNow = (side: GooSide, g: GooGeom): GooDrop => {
      const plan = plans[side];
      const clock = clocks[side];
      return plan && clock ? gooAt(plan, Number(clock.currentTime ?? 0)) : gooRest(still[side], g);
    };

    // A camada da corrida: a caixa dela fica em volta do centro da gota na beira da pílula, onde a cabeça está sempre,
    // relativa ao ponto; o `transform` a leva até o ponto do quadro.
    const origin: Partial<Record<GooSide, { x: number; y: number }>> = {};
    const runs: Partial<Record<GooSide, Animation>> = {};
    const offset = (side: GooSide, g: GooGeom, s: GooDrop) => {
      const o = origin[side]!;
      const a = gooAnchor(g, s);
      return { x: a.x - o.x, y: a.y - o.y };
    };
    const place = (side: GooSide) => {
      const g = geom(side);
      const { run, svg } = paths[side];
      if (!g || !run || !svg) return;
      const o = gooAnchor(g, gooRest(false, g));
      origin[side] = o;
      // Metade da caixa: a metade dos botões (a mola passa um pouco dela) e a gota presa à pílula, com folga para o anel.
      const hw = Math.ceil(Math.max(g.target.w * 0.62, g.tabs.h * 2) + 8);
      const hh = Math.ceil(Math.max(g.target.h, g.tabs.h) + 8);
      Object.assign(run.style, { left: `${o.x - hw}px`, top: `${o.y - hh}px`, width: `${hw * 2}px`, height: `${hh * 2}px` });
      // O SVG fica na origem da barra (as coordenadas do `goo-shape.ts`), visto pela caixa.
      Object.assign(svg.style, { left: `${hw - o.x}px`, top: `${hh - o.y}px` });
    };
    /** A animação da corrida de um lado: o `transform` do centro, um quadro-chave por estado do caminho. */
    const startRun = (side: GooSide) => {
      stopRun(side);
      const g = geom(side);
      const plan = plans[side];
      const clock = clocks[side];
      const run = paths[side].run;
      if (!g || !plan || !clock || !run || !origin[side]) return;
      const last = plan.states.length - 1;
      const keys = plan.states.map((s, i) => {
        const d = offset(side, g, s);
        return { offset: i / last, transform: `translate(${d.x}px, ${d.y}px)` };
      });
      const a = run.animate(keys, { duration: gooPlanMs(plan), easing: "linear", fill: "both" });
      a.pause();
      runs[side] = a;
      follow(a, clock);
    };
    /** O ponto da camada no tempo do relógio, como a animação da corrida o põe (linear entre dois estados). */
    const runOffset = (side: GooSide, g: GooGeom) => {
      const plan = plans[side];
      const clock = clocks[side];
      if (!plan || !clock || !runs[side]) return null;
      const last = plan.states.length - 1;
      const i = Math.min(last, Math.max(0, (Number(clock.currentTime ?? 0) * last) / gooPlanMs(plan)));
      const lo = Math.floor(i);
      const a = offset(side, g, plan.states[lo]!);
      const b = offset(side, g, plan.states[Math.min(last, lo + 1)]!);
      const f = i - lo;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    const stopRun = (side: GooSide) => {
      runs[side]?.cancel();
      delete runs[side];
    };
    /** Os botões nascendo de dentro da gota: a opacidade de cada estado do caminho, no tempo do relógio. */
    const startButtons = (side: GooSide) => {
      stopButtons(side);
      const g = geom(side);
      const plan = plans[side];
      const clock = clocks[side];
      const slot = slots[side];
      if (!g || !plan || !clock || !slot || !want[side]) return;
      const last = plan.states.length - 1;
      // Um quadro-chave a cada dois estados (60 Hz) basta para uma opacidade.
      const keys = plan.states.flatMap((s, i) => {
        if (i % 2 && i !== last) return [];
        const o = i === last ? 1 : gooButtons(g, s);
        return [{ offset: i / last, opacity: o, transform: o >= 1 ? "none" : `scale(${0.96 + 0.04 * o})` }];
      });
      for (const child of Array.from(slot.children)) {
        const a = child.animate(keys, { id: BUTTONS_ID, duration: gooPlanMs(plan), easing: "linear", fill: "both" });
        a.pause();
        follow(a, clock);
      }
    };
    const buttonAnims = (side: GooSide) =>
      Array.from(slots[side]?.children ?? []).flatMap((c) => c.getAnimations().filter((a) => a.id === BUTTONS_ID));
    const stopButtons = (side: GooSide) => {
      for (const a of buttonAnims(side)) a.cancel();
    };

    const draw = (side: GooSide) => {
      const g = geom(side);
      const s = g ? stateNow(side, g) : null;
      const parts = g && s ? gooParts(g, s) : NONE;
      for (const k of PARTS) paths[side].parts[k]?.setAttribute("d", parts[k]);
      const low = parts.edge + parts.speck;
      for (const w of paths[side].whole) w.setAttribute("d", low);
      // A cabeça, relativa ao ponto deste quadro; a camada já está nele (a animação, ou o lugar parado).
      const { head, headWhole, at, run } = paths[side];
      head?.setAttribute("d", parts.head);
      for (const w of headWhole) w.setAttribute("d", parts.head);
      if (g && s && origin[side] && at && run) {
        // A camada está no ponto do relógio entre dois estados (a animação interpola os quadros-chave), e a forma é a
        // do estado mais perto: o recuo usa o mesmo ponto da camada, e a forma fica no lugar dela na barra.
        const d = runOffset(side, g) ?? offset(side, g, s);
        at.setAttribute("transform", `translate(${-d.x} ${-d.y})`);
        // Com a animação, ela leva a camada; sem ela (parada), o lugar fica no estilo.
        const clock = clocks[side];
        if (runs[side] && clock) follow(runs[side]!, clock);
        else run.style.transform = `translate(${d.x}px, ${d.y}px)`;
        if (clock) for (const a of buttonAnims(side)) follow(a, clock);
      }
      const gh = ghosts[side];
      if (gh && g && s) followHead(gh, parts.head ? head : null, g.target, ghostFade(g, s));
    };
    // A cópia vai no centro da cabeça, com uma escala só (o texto não deforma), por dentro dela. Some no primeiro
    // décimo do caminho, enquanto a pílula desamassa: com o `gooButtons` (até 30%), ela ainda cobria a gota já em
    // lente, e a borda clara da gota se apagava sob os dois contornos (T32466). Na corrida só há a gota.
    const ghostFade = (g: GooGeom, s: GooDrop) => {
      if (s.attached) return 0;
      const f = Math.min(1, Math.max(0, (gooRunProgress(g, s.U) - GHOST_FROM) / (1 - GHOST_FROM)));
      return f * f * (3 - 2 * f);
    };
    const followHead = (g: HTMLElement, head: SVGPathElement | null, r: GooRect, fade: number) => {
      const b = head?.getBBox();
      if (!b || !b.width || !b.height) return void (g.style.opacity = "0");
      const sx = b.width / r.w;
      const sy = b.height / r.h;
      const dx = b.x + b.width / 2 - (r.x + r.w / 2);
      const dy = b.y + b.height / 2 - (r.y + r.h / 2);
      g.style.transform = `translate(${dx}px, ${dy}px) scale(${Math.min(1, sx, sy)})`;
      g.style.opacity = String(fade);
    };
    let frame = 0;
    const moving = () => SIDES.some((s) => phases.current[s] === "entering" || phases.current[s] === "leaving");
    let lastTick = 0;
    const tick = (now: number) => {
      frame = 0;
      // O quadro da troca é longo (a seção nova monta e pinta): a largada é no 1º quadro depois dele que chega no tempo.
      const gap = lastTick ? now - lastTick : Infinity;
      lastTick = now;
      for (const side of SIDES) {
        const w = waits[side];
        if (!w) continue;
        w.frames++;
        if ((w.frames >= 2 && gap <= LAUNCH_GAP_MS) || now - w.at > LAUNCH_MAX_MS) launch(side, now);
      }
      for (const side of SIDES) draw(side);
      if (moving()) frame = requestAnimationFrame(tick);
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

    /** O fim de um lado: a fase anda, se nenhuma troca está esperando a largada. */
    const fallback = (side: GooSide, ms: number) => {
      clearTimeout(timers.current[side]);
      timers.current[side] = setTimeout(() => show(side, gooOnAnimationEnd(phases.current[side])), ms);
    };
    /** O caminho do estado de agora até o alvo, e o relógio dele (no 1º quadro pintado depois da troca). */
    const launch = (side: GooSide, now: number) => {
      delete waits[side];
      const drop = paths[side].drop;
      if (drop) delete drop.dataset.waiting;
      const g = geom(side);
      if (!g || !drop) return show(side, gooOnAnimationEnd(phases.current[side]));
      const plan = gooPlan(g, stateNow(side, g), want[side]);
      clocks[side]?.cancel();
      if (plan.states.length < 2) return show(side, gooOnAnimationEnd(phases.current[side]));
      const ms = gooPlanMs(plan);
      const clock = drop.animate([{ transform: "translateX(0)" }, { transform: "translateX(1px)" }], { duration: ms, easing: "linear", fill: "both" });
      // O início é este quadro: sem isto, o WebKit dava ao relógio o tempo de um quadro longo de antes, e a gota
      // largava com até 60 ms andados (um salto de ~22 px).
      clock.startTime = now;
      plans[side] = plan;
      clocks[side] = clock;
      clock.onfinish = () => {
        // Uma troca esperando a largada sai do fim deste caminho; o relógio fica no último estado (o `fill`).
        if (clocks[side] === clock && waits[side] === undefined) show(side, gooOnAnimationEnd(phases.current[side]));
      };
      startRun(side);
      startButtons(side);
      fallback(side, Math.max(GOO_FALLBACK_MS, ms + 300));
      draw(side);
      loop();
    };
    const settle = (side: GooSide) => {
      delete waits[side];
      clocks[side]?.cancel();
      delete clocks[side];
      delete plans[side];
      stopRun(side);
      stopButtons(side);
      const drop = paths[side].drop;
      if (drop) delete drop.dataset.waiting;
    };

    const show = (side: GooSide, phase: GooPhase) => {
      if (phase === "leaving") spawnGhost(side);
      else dropGhost(side);
      phases.current[side] = phase;
      el.dataset[side] = phase;
      const drop = paths[side].drop;
      if (drop) drop.dataset.phase = phase;
      const slot = slots[side];
      if (slot) slot.dataset.goo = phase;
      clearTimeout(timers.current[side]);
      const going = phase === "entering" || phase === "leaving";
      if (!going) {
        still[side] = phase === "shown";
        settle(side);
      } else if (reducedMotion()) {
        settle(side);
        still[side] = want[side];
        timers.current[side] = setTimeout(() => show(side, gooOnAnimationEnd(phases.current[side])), REDUCED_MS);
      } else {
        // A largada espera o 1º quadro pintado depois da troca (a seção nova monta neste); a reserva cobre a página
        // escondida, sem quadros.
        if (drop) drop.dataset.waiting = "";
        waits[side] = { at: performance.now(), frames: 0 };
        fallback(side, GOO_FALLBACK_MS);
      }
      draw(side);
      loop();
    };
    const update = (side: GooSide, first = false) => {
      const slot = slots[side];
      const has = Boolean(slot && slot.childElementCount > 0);
      if (has) measure();
      const next = gooOnButtons(phases.current[side], has, first);
      want[side] = has;
      if (first || next !== phases.current[side]) show(side, next);
      // Os botões trocaram na ida que já andava (a seção pôs outros): eles entram no mesmo tempo.
      else if (has && phases.current[side] === "entering" && clocks[side] && waits[side] === undefined) startButtons(side);
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

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      for (const mo of mos) mo?.disconnect();
      for (const side of SIDES) (clearTimeout(timers.current[side]), dropGhost(side), settle(side));
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
      {/* Os relógios dos caminhos, um por lado: invisíveis, só a animação WAAPI. */}
      {SIDES.map((side) => (
        <span key={side} className="kn-goo-drop kn-goo-clock" data-side={side} data-phase="hidden" />
      ))}
    </div>
  );
}
