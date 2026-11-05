// T4363, spec #4357: a árvore abre no hover do botão do caminho, no topo, logo abaixo dele. Hover nunca rouba foco do
// editor; o clique no caminho e o teclado continuam dando acesso à busca e à árvore.
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import "./tree-popover.css";

const LAYERS = ".kn-menu, .kn-palette-scrim, .kn-toast";

export function TreePopover({ open, onOpenChange, anchor, busy, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** O botão do caminho; pode chegar depois, quando a barra do hub monta o portal. */
  anchor: HTMLElement | null;
  /** Menu, renomear e mover mantêm a árvore aberta enquanto a pessoa trabalha. */
  busy: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const overAnchor = useRef(false);
  const overPanel = useRef(false);
  const dragging = useRef(false);
  const focusRequested = useRef(false);
  // O hover abriu: o primeiro clique confirma em vez de fechar, e o seguinte fecha.
  const hoverOpened = useRef(false);
  // O Esc devolve o foco ao caminho: esse foco não pode reabrir a árvore que acabou de fechar.
  const restoring = useRef(false);
  const wasBusy = useRef(busy);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef({ open, busy, onOpenChange });
  state.current = { open, busy, onOpenChange };
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const held = () => overAnchor.current || overPanel.current || dragging.current || state.current.busy ||
    Boolean(panel.current?.contains(document.activeElement));
  const leave = () => {
    cancel();
    if (held() || !state.current.open) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
    const value = panel.current ? getComputedStyle(panel.current).getPropertyValue("--hover-out-delay").trim() : "";
    const number = parseFloat(value);
    const delay = reduced ? 0 : Number.isFinite(number) ? number * (value.endsWith("ms") ? 1 : 1000) : 80;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!held()) state.current.onOpenChange(false);
    }, delay);
  };

  // A árvore sai de baixo do botão e não da borda esquerda: a posição vem dele, medida no painel das notas.
  useLayoutEffect(() => {
    const root = panel.current;
    const button = anchor;
    const host = root?.closest<HTMLElement>(".kn-notes");
    if (!root || !button || !host) return;
    const place = () => {
      const b = button.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const width = root.offsetWidth || 300;
      const left = Math.max(12, Math.min(b.left - h.left, h.width - width - 12));
      root.style.left = `${Math.round(left)}px`;
      root.style.top = `${Math.round(Math.max(6, b.bottom - h.top + 6))}px`;
    };
    place();
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => {
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [anchor]);

  useEffect(() => {
    if (!open) {
      cancel();
      overAnchor.current = false;
      overPanel.current = false;
      focusRequested.current = false;
      hoverOpened.current = false;
      // A nota pode fechar a árvore ao abrir. Não deixe foco em conteúdo inerte.
      if (panel.current?.contains(document.activeElement)) {
        restoring.current = true;
        anchor?.focus();
      }
    } else if (focusRequested.current || document.activeElement === anchor) {
      focusRequested.current = false;
      panel.current?.querySelector<HTMLInputElement>(".kn-side-search")?.focus();
    }
  }, [open, anchor]);
  useEffect(() => {
    const ended = wasBusy.current && !busy;
    wasBusy.current = busy;
    // No Safari, escolher uma ação do menu pode deixar foco no body e o
    // ponteiro fora do painel. A operação veio da árvore: devolva foco à busca
    // antes de rearmar o fechamento, sem interferir em um clique no editor.
    if (ended && state.current.open && document.activeElement === document.body) {
      panel.current?.querySelector<HTMLInputElement>(".kn-side-search")?.focus({ preventScroll: true });
    }
    if (!busy) leave();
  }, [busy]);
  useEffect(() => {
    const button = anchor;
    if (!button) return;
    const enter = () => {
      overAnchor.current = true;
      if (!state.current.open) hoverOpened.current = true;
      cancel();
      state.current.onOpenChange(true);
    };
    // O clique abre e fecha. Safari não foca botões com clique de mouse, então o pedido explícito de abrir manda o
    // foco para a busca; o hover nunca faz isso. Se o hover já abriu, o clique confirma e não fecha na cara.
    const clicked = () => {
      if (state.current.open && hoverOpened.current) {
        hoverOpened.current = false;
        cancel();
        panel.current?.querySelector<HTMLInputElement>(".kn-side-search")?.focus();
        return;
      }
      focusRequested.current = true;
      cancel();
      state.current.onOpenChange(!state.current.open);
    };
    const exit = () => {
      overAnchor.current = false;
      leave();
    };
    // O Tab abre a árvore; o foco devolvido pelo Esc não.
    const focused = () => {
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      if (!button.matches(":focus-visible")) return;
      cancel();
      state.current.onOpenChange(true);
    };
    const down = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || panel.current?.contains(target) || anchor?.contains(target) || target.closest(LAYERS)) return;
      cancel();
      state.current.onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (!state.current.open || event.key !== "Escape" || event.defaultPrevented || document.querySelector(LAYERS)) return;
      event.preventDefault();
      cancel();
      state.current.onOpenChange(false);
      restoring.current = true;
      anchor?.focus();
    };
    button.addEventListener("mouseenter", enter);
    button.addEventListener("mouseleave", exit);
    button.addEventListener("focus", focused);
    button.addEventListener("click", clicked);
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      cancel();
      button.removeEventListener("mouseenter", enter);
      button.removeEventListener("mouseleave", exit);
      button.removeEventListener("focus", focused);
      button.removeEventListener("click", clicked);
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [anchor]);

  return (
    <div
      ref={panel}
      className="kn-pop kn-tree-pop kn-tree-hover"
      role="dialog"
      aria-label="Pastas e notas"
      data-open={open || undefined}
      inert={!open}
      aria-hidden={!open}
      onMouseEnter={() => { overPanel.current = true; cancel(); state.current.onOpenChange(true); }}
      onMouseLeave={() => { overPanel.current = false; leave(); }}
      onFocusCapture={() => { cancel(); state.current.onOpenChange(true); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) queueMicrotask(leave);
      }}
      onDragEnter={() => { cancel(); state.current.onOpenChange(true); }}
      onDragStartCapture={() => { dragging.current = true; cancel(); }}
      onDragEndCapture={() => { dragging.current = false; leave(); }}
      onDropCapture={() => { dragging.current = false; leave(); }}
    >
      {children}
    </div>
  );
}
