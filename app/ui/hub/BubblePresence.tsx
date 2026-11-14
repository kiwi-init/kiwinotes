// A troca entre os balões do gato (spec #11652): uma passagem contínua. O balão que sai encolhe e esmaece em direção à
// ponta enquanto o novo cresce dela, com mola; a caixa de um mesmo balão muda de tamanho suave quando o texto chega.
// Só `transform` e `opacity`.
//
// - **A troca:** a `itemKey` mudou. O balão de antes fica na tela pelo tempo da saída (180 ms), e o novo entra com 60 ms
//   de atraso, numa mola de 250 ms. Os tempos garantem que nunca há um quadro sem balão nem dois balões cheios.
// - **A saída parte de onde o balão está:** um balão que ainda entrava (no atraso, ou no meio da mola) sai da opacidade e
//   da escala em que está, pela Web Animations, e não do cheio (o CSS trocaria a animação e o mostraria cheio um quadro).
// - **O tamanho:** com a mesma `itemKey`, a caixa que mudou de tamanho parte do tamanho de antes (o FLIP: a casca escala
//   e o conteúdo dela escala ao contrário, para o texto não deformar).
// - **Reduzir movimento** (o da Aparência ou o do macOS): a troca é só um esmaecer de 120 ms, sem escala, e o tamanho muda
//   na hora. O esmaecer é da Web Animations: o `base.css` corta toda animação de CSS com o Reduzir movimento.

import { type ReactNode, useLayoutEffect, useReducer, useRef } from "react";

export const BUBBLE_ENTER_MS = 250;
export const BUBBLE_ENTER_DELAY_MS = 60;
export const BUBBLE_EXIT_MS = 180;
export const BUBBLE_FADE_MS = 120;
export const BUBBLE_RESIZE_MS = 240;
/** A mola: passa um pouco do tamanho final e assenta. */
export const BUBBLE_SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";
/** A saída: acelera, sem mola. */
export const BUBBLE_EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
/** A escala para onde o balão encolhe ao sair (e de onde cresce ao entrar, no CSS). */
export const BUBBLE_FROM_SCALE = 0.82;

interface Item {
  key: string;
  /**
   * A instância: a chave de render. Um balão que volta enquanto saía é um nó novo (com a mesma chave, o React
   * reaproveitaria o nó marcado como saindo, preso na opacidade 0 da saída).
   */
  id: number;
  node: ReactNode;
  leaving: boolean;
}
let instances = 0;

/**
 * As camadas da passagem, puras (testadas no `bun test`): a chave nova entra, a de antes sai, e uma chave igual só
 * troca o conteúdo.
 */
export function nextItems(items: readonly Item[], key: string | null, node: ReactNode): Item[] {
  const current = items.find((i) => !i.leaving);
  if (key === (current?.key ?? null)) return current ? items.map((i) => (i === current ? { ...i, node } : i)) : [...items];
  const out = items.map((i) => (i === current ? { ...i, leaving: true } : i)).filter((i) => !(i.leaving && i.key === key));
  return key === null ? out : [...out, { key, id: ++instances, node, leaving: false }];
}

/** As escalas do FLIP em alguns pontos da curva, para o conteúdo seguir o inverso da casca sem deformar. */
export function flipFrames(sx: number, sy: number, steps = 8): { shell: Keyframe[]; content: Keyframe[] } {
  const shell: Keyframe[] = [];
  const content: Keyframe[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = sx + (1 - sx) * t;
    const y = sy + (1 - sy) * t;
    shell.push({ offset: t, transform: `scale(${x}, ${y})` });
    content.push({ offset: t, transform: `scale(${1 / x}, ${1 / y})` });
  }
  return { shell, content };
}

export function BubblePresence({ itemKey, reduced: appReduced, children }: { itemKey: string | null; reduced: boolean; children: ReactNode }) {
  const reduced = appReduced || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const items = useRef<Item[]>([]);
  const entered = useRef(new Set<number>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  items.current = nextItems(items.current, itemKey, children);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const slots = useRef(new Map<number, HTMLDivElement>());
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  // A caixa do mesmo balão mudou de tamanho (o texto chegando): parte do tamanho de antes (FLIP). Pelo ResizeObserver, que
  // só avisa quando o tamanho muda e não força o layout (ler o tamanho a cada render, com a digitação a cada 18 ms, forçava
  // um layout por quadro).
  const sizes = useRef(new WeakMap<Element, { w: number; h: number }>());
  const observer = useRef<ResizeObserver | null>(null);
  if (!observer.current && typeof ResizeObserver === "function")
    observer.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const slot = e.target as HTMLElement;
        const { width: w, height: h } = e.contentRect;
        const before = sizes.current.get(slot);
        sizes.current.set(slot, { w, h });
        const shell = slot.firstElementChild as HTMLElement | null;
        if (!before || !shell || reducedRef.current || slot.dataset.phase === "exit" || !w || !h) continue;
        if (Math.abs(before.w - w) < 1 && Math.abs(before.h - h) < 1) continue;
        if (typeof shell.animate !== "function") continue;
        const { shell: outer, content } = flipFrames(before.w / w, before.h / h);
        const timing = { duration: BUBBLE_RESIZE_MS, easing: BUBBLE_SPRING };
        shell.animate(outer, timing);
        for (const child of Array.from(shell.children)) (child as HTMLElement).animate(content, timing);
      }
    });
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  /** Um ref por instância, estável (um ref novo a cada render faria o React soltar e prender o nó a cada render). */
  const refs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const slotRef = (id: number) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (el) => {
        if (el) {
          slots.current.set(id, el);
          observer.current?.observe(el);
        } else {
          const old = slots.current.get(id);
          if (old) observer.current?.unobserve(old);
          slots.current.delete(id);
          refs.current.delete(id);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
  };

  // O balão que entra, com o Reduzir movimento: o esmaecer de 120 ms (sem ele, a entrada é a mola do CSS).
  useLayoutEffect(() => {
    for (const item of items.current) {
      if (item.leaving || entered.current.has(item.id)) continue;
      entered.current.add(item.id);
      const el = slots.current.get(item.id);
      if (reduced && el && typeof el.animate === "function")
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BUBBLE_FADE_MS, easing: "ease-out", fill: "backwards" });
    }
  });

  // O balão que sai: a saída parte do estado em que ele está (lido antes de marcar a saída), e ele some no fim dela.
  useLayoutEffect(() => {
    for (const item of items.current) {
      if (!item.leaving || timers.current.has(item.id)) continue;
      const el = slots.current.get(item.id);
      if (el) {
        const cs = getComputedStyle(el);
        const opacity = Number(cs.opacity);
        const transform = cs.transform === "none" ? "none" : cs.transform;
        el.dataset.phase = "exit";
        el.setAttribute("aria-hidden", "true");
        if (typeof el.animate === "function")
          el.animate(
            [
              { opacity, transform },
              { opacity: 0, transform: reduced ? transform : `scale(${BUBBLE_FROM_SCALE})` },
            ],
            { duration: reduced ? BUBBLE_FADE_MS : BUBBLE_EXIT_MS, easing: reduced ? "ease-in" : BUBBLE_EXIT_EASING, fill: "forwards" },
          );
        else el.style.opacity = "0";
      }
      timers.current.set(
        item.id,
        setTimeout(() => {
          timers.current.delete(item.id);
          entered.current.delete(item.id);
          items.current = items.current.filter((i) => i.id !== item.id);
          rerender();
        }, reduced ? BUBBLE_FADE_MS : BUBBLE_EXIT_MS),
      );
    }
  });
  useLayoutEffect(() => () => timers.current.forEach(clearTimeout), []);


  return (
    <>
      {items.current.map((item) => (
        <div
          key={item.id}
          ref={slotRef(item.id)}
          className="kn-bubble-slot"
          // A saída é marcada no efeito acima, depois de ler o estado da entrada (o React não mexe neste atributo).
          data-phase="enter"
          data-reduced={reduced || undefined}
        >
          {item.node}
        </div>
      ))}
    </>
  );
}
