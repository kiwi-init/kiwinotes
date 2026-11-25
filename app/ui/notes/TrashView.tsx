// A Lixeira do app (T2593): o que foi apagado. O que ainda espera o Desfazer (10 min, no `.kiwi-trash` do vault) volta
// com "Restaurar"; o que já foi para o Lixo do macOS só aparece, com "Mostrar no Finder": tirar de lá pede o Acesso Total
// ao Disco (o TCC, #2493), e o app não pede.

import { useCallback, useEffect, useState } from "react";

import type { ExtrasApi, FoldersApi, TrashItem } from "./types.ts";
import { errorCode } from "./errors.ts";
import { useT } from "../src/i18n.ts";
import { type Locale, translate } from "../../src/shared/i18n/index.ts";

const name = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const where = (p: string, locale: Locale) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")).replace(/\//g, " / ") : translate(locale, "notes.trash.root");

/** "volta por mais 7 min", "volta por menos de 1 min" (na língua das telas, T29244). */
export function timeLeft(until: string, now = Date.now(), locale: Locale = "pt"): string {
  const min = Math.floor((Date.parse(until) - now) / 60_000);
  return min < 1 ? translate(locale, "notes.trash.backSoon") : translate(locale, "notes.trash.backIn", { min });
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
  const { t, locale } = useT();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    extras.trashList().then(setItems, () => setItems([]));
  }, [extras]);
  useEffect(load, [load, version]);
  // O prazo do Desfazer anda: de minuto em minuto a lista se refaz (o que passou dos 10 min vira "no Lixo do macOS").
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const restore = async (i: TrashItem) => {
    if (!folders) return;
    setError(null);
    try {
      await folders.restore(i.path);
      onRestored(i.path, i.kind);
      load();
    } catch (e) {
      setError(errorCode(e) === "E_EXISTS" ? t("notes.trash.exists", { name: name(i.path) }) : t("notes.trash.failed"));
    }
  };

  const waiting = items?.filter((i) => i.where === "kiwi") ?? [];
  return (
    <section className="kn-trash" aria-label={t("notes.side.trash")}>
      <header className="kn-trash-h">
        <h1 className="kn-trash-title">{t("notes.side.trash")}</h1>
        <span className="kn-trash-actions">
          <button type="button" className="kn-bt" disabled={!waiting.length} onClick={() => void extras.trashEmpty().then(load)}>
            {t("notes.trash.empty")}
          </button>
          <button type="button" className="kn-bt" onClick={() => void extras.trashReveal()}>
            {t("notes.trash.reveal")}
          </button>
        </span>
      </header>
      <p className="kn-faint">
        {t("notes.trash.hint")}
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
                {where(i.path, locale)} · {i.where === "kiwi" && i.until ? timeLeft(i.until, undefined, locale) : t("notes.trash.inMacTrash")}
              </span>
              {i.where === "kiwi" && folders ? (
                <button type="button" className="kn-bt" onClick={() => void restore(i)}>
                  {t("notes.trash.restore")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="kn-faint">{t("notes.trash.isEmpty")}</p>
      )}
    </section>
  );
}
