// T3826, spec #3816: a árvore abre sobre a nota. Hover nunca rouba foco do editor;
// o clique no caminho e o teclado continuam dando acesso à busca e à árvore.
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import "./hover-sidebar.css";

const LAYERS = ".kn-menu, .kn-palette-scrim, .kn-toast";

export function HoverSidebar({ open, onOpenChange, anchor, busy, children }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  anchor: RefObject<HTMLElement | null>;
  /** Menu, renomear e mover mantêm a árvore aberta enquanto a pessoa trabalha. */
  busy: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pointer = useRef(false);
  const dragging = useRef(false);
  const focusRequested = useRef(false);
  const wasBusy = useRef(busy);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef({ open, busy, onOpenChange });
  state.current = { open, busy, onOpenChange };
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const held = () => pointer.current || dragging.current || state.current.busy ||
    Boolean(root.current?.contains(document.activeElement));
  const leave = () => {
    cancel();
    if (held() || !state.current.open) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
    const value = root.current ? getComputedStyle(root.current).getPropertyValue("--hover-out-delay").trim() : "";
    const number = parseFloat(value);
    const delay = reduced ? 0 : Number.isFinite(number) ? number * (value.endsWith("ms") ? 1 : 1000) : 80;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!held()) state.current.onOpenChange(false);
    }, delay);
  };

  useEffect(() => {
    if (!open) {
      cancel();
      pointer.current = false;
      focusRequested.current = false;
      // A nota pode fechar a árvore ao abrir. Não deixe foco em conteúdo inerte.
      if (panel.current?.contains(document.activeElement)) anchor.current?.focus();
    } else if (focusRequested.current || document.activeElement === anchor.current) {
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
    // Safari não foca botões com clique de mouse. O pedido explícito de abrir
    // precisa focar a busca mesmo assim; hover, por outro lado, nunca faz isso.
    const clicked = () => { focusRequested.current = true; };
    const button = anchor.current;
    button?.addEventListener("click", clicked);
    const down = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || root.current?.contains(target) || anchor.current?.contains(target) || target.closest(LAYERS)) return;
      cancel();
      state.current.onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (!state.current.open || event.key !== "Escape" || event.defaultPrevented || document.querySelector(LAYERS)) return;
      event.preventDefault();
      cancel();
      state.current.onOpenChange(false);
      anchor.current?.focus();
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      cancel();
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
      button?.removeEventListener("click", clicked);
    };
  }, [anchor]);

  return (
    <div
      ref={root}
      className="kn-hover-sidebar"
      data-open={open || undefined}
      onMouseEnter={() => { pointer.current = true; cancel(); state.current.onOpenChange(true); }}
      onMouseLeave={() => { pointer.current = false; leave(); }}
      onFocusCapture={() => { cancel(); state.current.onOpenChange(true); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) queueMicrotask(leave);
      }}
      onDragEnter={() => { cancel(); state.current.onOpenChange(true); }}
      onDragStartCapture={() => { dragging.current = true; cancel(); }}
      onDragEndCapture={() => { dragging.current = false; leave(); }}
      onDropCapture={() => { dragging.current = false; leave(); }}
    >
      <button
        type="button"
        className="kn-side-edge"
        aria-label="Abrir pastas e notas"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => {
          focusRequested.current = true;
          state.current.onOpenChange(true);
          if (state.current.open) panel.current?.querySelector<HTMLInputElement>(".kn-side-search")?.focus();
        }}
      ><span aria-hidden="true" /></button>
      <div id={id} ref={panel} className="kn-pop kn-tree-pop" role="dialog" aria-label="Pastas e notas" inert={!open} aria-hidden={!open}>
        {children}
      </div>
    </div>
  );
}
