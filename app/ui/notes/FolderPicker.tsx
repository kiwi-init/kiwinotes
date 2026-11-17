// As listas com filtro, como o ⌘K: "Mover para…" (T2469) e "Nova nota a partir de modelo…" (T2619). Enter escolhe; Esc
// fecha.

import { useState } from "react";

import { fold } from "./palette.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";

export interface PickItem {
  value: string;
  label: string;
}

export function ListPicker({ title, items, emptyText, onPick, onClose }: { title: string; items: PickItem[]; emptyText: string; onPick(value: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const shown = items.filter((it) => words.every((w) => fold(it.label).includes(w)));
  const pick = (it: PickItem | undefined) => it && onPick(it.value);
  return (
    <div className="kn-palette-scrim" onMouseDown={onClose}>
      <div className="kn-palette" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="kn-palette-q"
          autoFocus
          {...NO_TEXT_ASSIST}
          placeholder={title}
          aria-label={title}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(shown.length - 1, s + 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            else if (e.key === "Enter") pick(shown[sel]);
            else if (e.key === "Escape") onClose();
            else return;
            e.preventDefault();
          }}
        />
        <div className="kn-palette-list" role="listbox">
          {shown.map((it, i) => (
            <div
              key={it.value || "/"}
              className="kn-palette-it"
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => sel !== i && setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
            >
              <span className="kn-palette-title">{it.label}</span>
            </div>
          ))}
          {!shown.length ? <div className="kn-palette-empty">{emptyText}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** `folders` já vem com a raiz ("") quando ela é um destino; a lista não põe a raiz por conta própria. */
export function FolderPicker({ title, folders, onPick, onClose }: { title: string; folders: string[]; onPick(folder: string): void; onClose(): void }) {
  const items = folders.map((f) => ({ value: f, label: f ? f.replace(/\//g, " / ") : "Raiz do vault" }));
  return <ListPicker title={title} items={items} emptyText="Nenhuma pasta com esse nome" onPick={onPick} onClose={onClose} />;
}
