// "Mover para…" (T2469): a lista de pastas, com um filtro, como o ⌘K. Enter move; Esc fecha.

import { useState } from "react";

import { fold } from "./palette.ts";

export function FolderPicker({ title, folders, onPick, onClose }: { title: string; folders: string[]; onPick(folder: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const all = ["", ...folders];
  const items = all.filter((f) => words.every((w) => fold(f || "raiz do vault").includes(w)));
  const pick = (f: string | undefined) => f !== undefined && onPick(f);
  return (
    <div className="kn-palette-scrim" onMouseDown={onClose}>
      <div className="kn-palette" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="kn-palette-q"
          autoFocus
          placeholder={title}
          aria-label={title}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(items.length - 1, s + 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            else if (e.key === "Enter") pick(items[sel]);
            else if (e.key === "Escape") onClose();
            else return;
            e.preventDefault();
          }}
        />
        <div className="kn-palette-list" role="listbox">
          {items.map((f, i) => (
            <div
              key={f || "/"}
              className="kn-palette-it"
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => sel !== i && setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(f);
              }}
            >
              <span className="kn-palette-title">{f ? f.replace(/\//g, " / ") : "Raiz do vault"}</span>
            </div>
          ))}
          {!items.length ? <div className="kn-palette-empty">Nenhuma pasta com esse nome</div> : null}
        </div>
      </div>
    </div>
  );
}
