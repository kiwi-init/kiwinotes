// "Enviar para nota…" no Histórico (T1320): a lista do seletor e o que a tela diz depois. A busca é a mesma do ⌘K da
// janela Notas (`paletteItems`): sem busca, as notas mais recentes; com busca, título primeiro e depois o texto.

import { type Locale, translate } from "../../src/shared/i18n/index.ts";
import { paletteItems } from "../notes/palette.ts";
import type { NoteMeta, SearchHit } from "../notes/types.ts";

/** Onde a nota nova nasce (o `INBOX` do engine, src/notes/fromDictation.ts). */
export const INBOX_LABEL = "Caixa de entrada";

export type TargetItem = { kind: "new" } | { kind: "note"; path: string; title: string; detail: string; snippet?: string };

/** "Nota nova" sempre em cima (o título sai da 1ª frase do ditado), depois as notas que existem. */
export function targetItems(notes: NoteMeta[], query: string, textHits: SearchHit[]): TargetItem[] {
  const existing = paletteItems(notes, query, textHits).flatMap((i) =>
    i.kind === "note" ? [{ kind: "note" as const, path: i.path, title: i.title, detail: i.detail, snippet: i.snippet }] : [],
  );
  return [{ kind: "new" }, ...existing];
}

export interface ToNoteResult {
  note: NoteMeta;
  created: boolean;
  already: boolean;
}

/** O que aparece embaixo do ditado depois do envio, na língua das telas (T29247). A pasta é a do disco, como está. */
export function sentText(r: ToNoteResult, locale: Locale = "pt"): string {
  const title = r.note.title;
  if (r.already) return translate(locale, "history.sent.already", { title });
  return r.created
    ? translate(locale, "history.sent.created", { title, folder: r.note.folder || translate(locale, "history.sent.root") })
    : translate(locale, "history.sent.appended", { title });
}
