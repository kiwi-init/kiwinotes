// A barra do ⌘F do quadro branco e do diagrama (T22217): o campo, a contagem e as setas. Enter vai ao próximo,
// Shift+Enter ao anterior, Escape fecha; o ⌘F com a barra aberta seleciona o que já estava escrito.

import { type RefObject, useEffect, useRef } from "react";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import { findCount } from "./find.ts";
import "./find-bar.css";

/**
 * O ⌘F que abre a barra: com o foco dentro de `root`, ou em lugar nenhum (o viewer do diagrama nem sempre fica com o
 * foco). Com alguém escrevendo noutro campo da janela, o ⌘F é dele.
 */
export function useFindKey(root: RefObject<HTMLElement | null>, onFind: () => void): void {
  const cb = useRef(onFind);
  cb.current = onFind;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.metaKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== "f") return;
      const t = e.target instanceof Element ? e.target : null;
      const inside = !!t && !!root.current?.contains(t);
      if (!inside && t?.closest("input, textarea, [contenteditable='true'], [contenteditable=''], .cm-editor")) return;
      if (!root.current) return;
      e.preventDefault();
      cb.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}

export function FindBar({ label, query, index, total, inputRef, onQuery, onStep, onClose }: {
  label: string;
  query: string;
  index: number;
  total: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  return (
    <div className="kn-findbar" role="search">
      <input
        ref={inputRef}
        className="kn-findbar-query"
        type="search"
        {...NO_TEXT_ASSIST}
        aria-label={label}
        placeholder="Procurar"
        value={query}
        autoFocus
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.metaKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            e.currentTarget.select();
          }
        }}
      />
      <span className="kn-findbar-count" aria-live="polite">
        {findCount(query, index, total)}
      </span>
      <button type="button" className="kn-bt" aria-label="Achado anterior" disabled={!total} onClick={() => onStep(-1)}>
        ↑
      </button>
      <button type="button" className="kn-bt" aria-label="Próximo achado" disabled={!total} onClick={() => onStep(1)}>
        ↓
      </button>
      <button type="button" className="kn-bt" aria-label="Fechar a busca" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
