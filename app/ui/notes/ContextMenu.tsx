// Shared by the tree and the editor. Submenus stay on screen; keyboard arrows traverse each level.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Action = { label: string; hint?: string; danger?: boolean; disabled?: boolean; checked?: boolean };
export type MenuItem =
  | (Action & { kind?: "item"; onSelect(): void })
  | (Action & { kind: "submenu"; items: MenuItem[] })
  | { kind: "separator" }
  | { kind: "title"; label: string };

export function ContextMenu({ x, y, items, onClose, onRestoreFocus }: {
  x: number; y: number; items: MenuItem[]; onClose(): void; onRestoreFocus?(): void;
}) {
  const owner = useId();
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if ((e.target as Element).closest?.("[data-menu-owner]")?.getAttribute("data-menu-owner") !== owner) onClose();
    };
    addEventListener("mousedown", away, true);
    addEventListener("blur", onClose);
    return () => { removeEventListener("mousedown", away, true); removeEventListener("blur", onClose); };
  }, [owner, onClose]);
  return <MenuPanel {...{ x, y, items, owner, onClose }} autoFocus onBack={() => { onClose(); onRestoreFocus?.(); }} />;
}

function MenuPanel({ x, y, parentLeft, items, owner, onClose, onBack, autoFocus, label }: {
  x: number; y: number; parentLeft?: number; items: MenuItem[]; owner: string; onClose(): void;
  onBack(): void; autoFocus?: boolean; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const actionable = items.flatMap((it, i) => it.kind !== "separator" && it.kind !== "title" && !it.disabled ? [i] : []);
  const [sel, setSel] = useState(-1);
  const [child, setChild] = useState<{ index: number; x: number; y: number; left: number; focus: boolean } | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    // offset sizes ignore the pop-in scale; max-content keeps width stable when clamping changes left.
    const r = { width: ref.current!.offsetWidth, height: ref.current!.offsetHeight };
    const left = parentLeft !== undefined && x + r.width > innerWidth - 8 ? parentLeft - r.width + 4 : x;
    setPos({ left: Math.max(8, Math.min(left, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
    if (autoFocus) { ref.current!.focus(); if (parentLeft !== undefined) setSel(actionable[0] ?? -1); }
  }, [x, y, parentLeft, autoFocus]);

  const open = (i: number, focus: boolean) => {
    const it = items[i], row = rows.current.get(i);
    if (!it || it.kind !== "submenu" || it.disabled || !row) return;
    const r = row.getBoundingClientRect();
    setChild({ index: i, x: r.right - 4, y: r.top - 5, left: r.left, focus });
  };
  const choose = (i: number) => {
    const it = items[i];
    if (!it || it.kind === "separator" || it.kind === "title" || it.disabled) return;
    if (it.kind === "submenu") return open(i, true);
    onClose(); it.onSelect();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const at = actionable.indexOf(sel);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSel(actionable[at < 0 ? (delta > 0 ? 0 : actionable.length - 1) : (at + delta + actionable.length) % actionable.length] ?? -1); setChild(null);
    } else if (e.key === "Home") { setSel(actionable[0] ?? -1); setChild(null); }
    else if (e.key === "End") { setSel(actionable.at(-1) ?? -1); setChild(null); }
    else if (e.key === "ArrowRight") open(sel, true);
    else if (e.key === "ArrowLeft" || e.key === "Escape") onBack();
    else if (e.key === "Enter" || e.key === " ") choose(sel);
    else if (e.key === "Tab") { onClose(); e.stopPropagation(); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const checks = items.some((it) => it.kind !== "separator" && it.kind !== "title" && it.checked !== undefined);
  const branch = child && items[child.index];
  return <>
    <div ref={ref} className="kn-menu" data-menu-owner={owner} data-checks={checks || undefined} role="menu" aria-label={label} tabIndex={-1}
      style={pos} onScroll={() => setChild(null)} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.kind === "separator") return <div key={i} className="kn-menu-sep" role="separator" />;
        if (it.kind === "title") return <div key={i} className="kn-menu-title">{it.label}</div>;
        return <div key={i} ref={(el) => { if (el) rows.current.set(i, el); else rows.current.delete(i); }}
          role={it.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={it.checked} aria-disabled={it.disabled || undefined}
          aria-haspopup={it.kind === "submenu" ? "menu" : undefined} aria-expanded={it.kind === "submenu" ? child?.index === i : undefined}
          className="kn-menu-item" data-active={i === sel || undefined} data-danger={it.danger || undefined}
          onMouseMove={() => { if (sel !== i) { setSel(i); setChild(null); } if (it.kind === "submenu" && child?.index !== i) open(i, false); }}
          onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
          {checks ? <span className="kn-menu-check">{it.checked ? "✓" : ""}</span> : null}
          <span className="kn-menu-label">{it.label}</span>
          {it.hint ? <span className="kn-menu-hint">{it.hint}</span> : null}
          {it.kind === "submenu" ? <span className="kn-menu-arrow" aria-hidden>›</span> : null}
        </div>;
      })}
    </div>
    {child && branch?.kind === "submenu" ? createPortal(<MenuPanel key={child.index} x={child.x} y={child.y} parentLeft={child.left}
      items={branch.items} owner={owner} label={branch.label} autoFocus={child.focus} onClose={onClose}
      onBack={() => { setChild(null); ref.current?.focus(); }} />, document.body) : null}
  </>;
}
