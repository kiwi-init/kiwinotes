// A Lixeira do app (T2593): o que foi apagado. O que ainda espera o Desfazer (10 min, no `.kiwi-trash` do vault) volta
// com "Restaurar"; o que já foi para o Lixo do macOS só aparece, com "Mostrar no Finder": tirar de lá pede o Acesso Total
// ao Disco (o TCC, #2493), e o app não pede.

import { useCallback, useEffect, useState } from "react";

import type { ExtrasApi, FoldersApi, TrashItem } from "./types.ts";

const name = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const where = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")).replace(/\//g, " / ") : "raiz");

/** "volta por mais 7 min", "por menos de 1 min". */
export function timeLeft(until: string, now = Date.now()): string {
  const min = Math.floor((Date.parse(until) - now) / 60_000);
  return min < 1 ? "por menos de 1 min" : `por mais ${min} min`;
}

export function TrashView({
  extras,
  folders,
  onRestored,
  version,
}: {
  extras: ExtrasApi;
  folders?: FoldersApi;
  onRestored(path: string, kind: TrashItem["kind"]): void;
  /** Muda quando o vault muda (um apagar em outro lugar): a lista se refaz. */
  version: number;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    extras.trashList().then(setItems, () => setItems([]));
  }, [extras]);
  useEffect(load, [load, version]);
  // O prazo do Desfazer anda: de minuto em minuto a lista se refaz (o que passou dos 10 min vira "no Lixo do macOS").
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const restore = async (i: TrashItem) => {
    if (!folders) return;
    setError(null);
    try {
      await folders.restore(i.path);
      onRestored(i.path, i.kind);
      load();
    } catch (e) {
      setError(/E_EXISTS/.test(String((e as Error)?.message ?? e)) ? `Já existe “${name(i.path)}” nesse lugar: renomeie e tente de novo.` : "Não deu para restaurar.");
    }
  };

  const waiting = items?.filter((i) => i.where === "kiwi") ?? [];
  return (
    <section className="kn-trash" aria-label="Lixeira">
      <header className="kn-trash-h">
        <h1 className="kn-trash-title">Lixeira</h1>
        <span className="kn-trash-actions">
          <button type="button" className="kn-bt" disabled={!waiting.length} onClick={() => void extras.trashEmpty().then(load)}>
            Mandar para o Lixo agora
          </button>
          <button type="button" className="kn-bt" onClick={() => void extras.trashReveal()}>
            Mostrar o Lixo no Finder
          </button>
        </span>
      </header>
      <p className="kn-faint">
        O que você apaga fica aqui 10 minutos para voltar e depois vai para o Lixo do macOS.
      </p>
      {error ? <p className="kn-trash-error" role="alert">{error}</p> : null}
      {items === null ? null : items.length ? (
        <ul className="kn-trash-list">
          {items.map((i) => (
            <li key={`${i.where}:${i.path}:${i.deletedAt}`} className="kn-trash-item" data-where={i.where}>
              <span className="kn-trash-name">
                {i.kind === "folder" ? "▸ " : ""}
                {name(i.path)}
              </span>
              <span className="kn-trash-meta">
                {where(i.path)} · {i.where === "kiwi" && i.until ? `volta ${timeLeft(i.until)}` : "no Lixo do macOS"}
              </span>
              {i.where === "kiwi" && folders ? (
                <button type="button" className="kn-bt" onClick={() => void restore(i)}>
                  Restaurar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="kn-faint">A Lixeira está vazia.</p>
      )}
    </section>
  );
}
