// O menu de botão direito das Notas (T2469), no B v4: uma camada que flutua, sem borda, com o item ativo em peso de texto.
// Teclado: ↑↓ andam, Enter escolhe, Esc fecha. Fecha também com um clique fora ou com a janela perdendo o foco.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind?: "item"; label: string; hint?: string; onSelect(): void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { kind: "separator" }
  | { kind: "title"; label: string };

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const actionable = items.map((it, i) => ((it.kind ?? "item") === "item" && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);
  const [sel, setSel] = useState(-1);
  const [pos, setPos] = useState({ left: x, top: y });

  // Cabe na janela: abre para cima ou para a esquerda quando não cabe.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const blur = () => onClose();
    addEventListener("mousedown", away, true);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("mousedown", away, true);
      removeEventListener("blur", blur);
    };
  }, [onClose]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it || (it.kind ?? "item") !== "item" || (it as { disabled?: boolean }).disabled) return;
    onClose();
    (it as { onSelect(): void }).onSelect();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const at = actionable.indexOf(sel);
    if (e.key === "ArrowDown") setSel(actionable[(at + 1) % actionable.length] ?? -1);
    else if (e.key === "ArrowUp") setSel(actionable[(at - 1 + actionable.length) % actionable.length] ?? -1);
    else if (e.key === "Enter") choose(sel);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // A coluna do ✓ só existe num menu que tem marca (o da área vazia, com o "Ordenar por").
  const checks = items.some((it) => it.kind !== "separator" && it.kind !== "title" && it.checked !== undefined);
  return (
    <div ref={ref} className="kn-menu" data-checks={checks || undefined} role="menu" tabIndex={-1} style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.kind === "separator") return <div key={i} className="kn-menu-sep" role="separator" />;
        if (it.kind === "title") return <div key={i} className="kn-menu-title">{it.label}</div>;
        return (
          <div
            key={i}
            role={it.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={it.checked}
            aria-disabled={it.disabled || undefined}
            className="kn-menu-item"
            data-active={i === sel || undefined}
            data-danger={it.danger || undefined}
            onMouseMove={() => sel !== i && setSel(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
          >
            {checks ? <span className="kn-menu-check">{it.checked ? "✓" : ""}</span> : null}
            <span className="kn-menu-label">{it.label}</span>
            {it.hint ? <span className="kn-menu-hint">{it.hint}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
