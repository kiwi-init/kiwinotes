// Peças das listas editáveis: salvar sozinho com atraso, aviso de "Salvo" e ícones.
import "./lists.css";

import { useEffect, useRef, useState } from "react";

/** Salva `value` 500 ms depois da última mudança. Devolve se acabou de salvar (para o "Salvo"). */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, enabled: boolean): { saved: boolean; error: boolean } {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      save(value).then(
        () => {
          setError(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 1400);
        },
        () => setError(true),
      );
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);
  return { saved, error };
}

let nextKey = 0;
/** Chave estável para linhas que ainda não têm id. */
export const rowKey = () => `row-${nextKey++}`;

export function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
      <path d="M9.5 4.5V3.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M2.5 4h9M5.5 4V2.75h3V4M3.75 4l.6 7.25h5.3l.6-7.25" />
    </svg>
  );
}

export function SavedNote({ saved, error }: { saved: boolean; error: boolean }) {
  return (
    <span className="kn-saved" data-show={saved || error} role="status" style={error ? { color: "var(--danger)" } : undefined}>
      {error ? "Não deu para salvar" : "Salvo"}
    </span>
  );
}
