// Peças das listas editáveis: salvar sozinho com atraso, aviso de "Salvo" e ícones.
import "./lists.css";

import { useEffect, useRef, useState } from "react";

import { Button } from "./index.tsx";

/**
 * Salva `value` 500 ms depois da última mudança. Devolve se acabou de salvar (para o "Salvo").
 * O que ainda não foi salvo sai na hora quando a janela some, fecha ou o componente desmonta: antes, fechar a janela
 * logo depois da última tecla perdia a edição (T914).
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, enabled: boolean): { saved: boolean; error: boolean } {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const first = useRef(true);
  /** O valor que mudou e ainda não foi salvo. */
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const alive = useRef(true);

  const flush = useRef(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveRef.current(p.value).then(
      () => {
        if (!alive.current) return;
        setError(false);
        setSaved(true);
        setTimeout(() => alive.current && setSaved(false), 1400);
      },
      () => alive.current && setError(true),
    );
  }).current;

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = { value };
    const t = setTimeout(flush, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  useEffect(() => {
    alive.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
      alive.current = false;
    };
  }, [flush]);

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

/** `incomplete`: linhas com algo escrito que ainda não valem (e não foram salvas), para o "Salvo" não enganar (T914). */
export function SavedNote({ saved, error, incomplete = 0 }: { saved: boolean; error: boolean; incomplete?: number }) {
  const text = error
    ? "Não deu para salvar"
    : incomplete
      ? `Salvo, menos ${incomplete === 1 ? "a linha incompleta" : `as ${incomplete} linhas incompletas`}`
      : "Salvo";
  return (
    <span className="kn-saved" data-show={saved || error} role="status" style={error ? { color: "var(--danger)" } : undefined}>
      {text}
    </span>
  );
}

export type LoadState = "loading" | "ready" | "error";

/** A lista não abriu (o arquivo editado à mão não é um JSON válido): diz qual, em vez de parecer vazia (T914). */
export function LoadError({ file, onRetry }: { file: string; onRetry: () => void }) {
  return (
    <div className="kn-list-empty" role="alert">
      <div style={{ color: "var(--danger)", marginBottom: 8 }}>
        Não deu para ler o <code>{file}</code>. Corrija o arquivo (ou apague-o para começar do zero) e tente de novo. Até
        lá, nada daqui é salvo.
      </div>
      <Button onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
}
