// Um popover que sai de um botão da barra de cima (T2502, C · Foco): a árvore de pastas e o "Citada em". Fecha com Esc
// e com um clique fora dele, menos nas camadas que ele mesmo abre por cima (o menu de botão direito, o "Mover para…" e
// o aviso de Desfazer), que vivem fora do popover no DOM.

import { type ReactNode, useEffect, useRef } from "react";

/** O que está por cima do popover e não conta como "clique fora". */
const LAYERS = ".kn-menu, .kn-palette-scrim, .kn-toast";

export function Popover({
  className,
  label,
  anchor,
  onClose,
  children,
}: {
  className?: string;
  label: string;
  /** O botão que abre: clicar nele de novo fecha (quem fecha é o próprio botão). */
  anchor: React.RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || anchor.current?.contains(t) || t.closest(LAYERS)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      // O Esc do menu, do renomear e da busca da árvore é deles; aqui só o que sobrou.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(LAYERS)) return;
      close.current();
      anchor.current?.focus();
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [anchor]);
  return (
    <div ref={ref} className={`kn-pop ${className ?? ""}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
