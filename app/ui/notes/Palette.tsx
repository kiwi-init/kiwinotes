// A busca rápida ⌘K (B v4): uma caixa só, sem borda, com o resultado selecionado em peso de texto.

import { useEffect, useMemo, useRef, useState } from "react";

import { plainSnippet } from "./links.ts";
import { Highlight } from "./Highlight.tsx";
import { type PaletteCommand, type PaletteItem, paletteItems, snippetRanges, titleRanges } from "./palette.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import type { NoteMeta, NotesApi, SearchHit, VaultFile } from "./types.ts";
import { MAX_SEARCH_QUERY, searchTooLong } from "../../src/shared/query.ts";
import { useT } from "../src/i18n.ts";
import { type FileAt, fileAtLabel } from "../../src/shared/file-view.ts";

export interface PaletteProps {
  api: NotesApi;
  notes: NoteMeta[];
  /** `line` (T21240): um arquivo de texto achado pelo conteúdo abre na linha. */
  onOpen(path: string, at?: FileAt): void;
  onCreate(title: string): void;
  onClose(): void;
  /** A busca já aberta com um texto (T2619: o clique numa #tag abre com `tag:…`). */
  initialQuery?: string;
  commands?: PaletteCommand[];
  /** Um comando escolhido, com a busca de agora (o "Salvar esta busca" precisa dela). */
  onCommand?(id: string, query: string): void;
}

const NO_FILES: VaultFile[] = [];

export function Palette({ api, notes, onOpen, onCreate, onClose, initialQuery = "", commands = [], onCommand }: PaletteProps) {
  const { t, locale } = useT();
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState<{ query: string; hits: SearchHit[]; files: VaultFile[] } | null>(null);
  const hits = search?.query === query ? search.hits : [];
  const files = search?.query === query ? search.files : NO_FILES;
  const ranked = search?.query === query;
  const [sel, setSel] = useState(0);
  const seq = useRef(0);
  const tooLong = searchTooLong(query);

  // O texto vem do engine, um pouco depois de parar de digitar; uma resposta velha não sobrescreve a nova.
  useEffect(() => {
    const my = ++seq.current;
    // Longa demais (T7791): o engine recusaria; a lista dá lugar ao aviso.
    if (!query.trim() || tooLong) return setSearch(null);
    const id = setTimeout(() => {
      // Os arquivos pelo nome (T21240) vêm junto, do mesmo `findFiles` da barra; sem ele, só a busca.
      const byName = api.findFiles ? api.findFiles(query).catch(() => NO_FILES) : Promise.resolve(NO_FILES);
      Promise.all([api.search(query, 20), byName]).then(
        ([h, f]) => my === seq.current && setSearch({ query, hits: h, files: f }),
        () => my === seq.current && setSearch(null),
      );
    }, 120);
    return () => clearTimeout(id);
  }, [query, api, notes]);

  // Uma vez por mudança (T8110): o `setSel(0)` de cada letra desenhava de novo e refazia a lista das 10 mil notas.
  const items = useMemo(() => (tooLong ? [] : paletteItems(notes, query, hits, commands, ranked, files)), [tooLong, notes, query, hits, commands, ranked, files]);
  useEffect(() => setSel(0), [query]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === "note") onOpen(item.path, item.at);
    else if (item.kind === "command") onCommand?.(item.id, query);
    else onCreate(item.title);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setSel((s) => Math.min(items.length - 1, s + 1));
    else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
    else if (e.key === "Enter") choose(items[sel]);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div className="kn-palette-scrim" onMouseDown={onClose}>
      <div className="kn-palette" role="dialog" aria-label={t("notes.palette.label")} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="kn-palette-q"
          autoFocus
          {...NO_TEXT_ASSIST}
          placeholder={t("notes.palette.placeholder")}
          aria-label={t("notes.palette.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        {tooLong ? <div className="kn-palette-long" role="status">{t("notes.searchTooLong", { max: MAX_SEARCH_QUERY })}</div> : null}
        <div className="kn-palette-list" role="listbox">
          {items.map((it, i) => (
            <div
              key={it.kind === "note" ? it.path : it.kind === "command" ? `cmd:${it.id}` : `create:${it.title}`}
              className="kn-palette-it"
              role="option"
              aria-selected={i === sel}
              // Só com o mouse andando: a lista que abre embaixo de um ponteiro parado não rouba a seleção do teclado.
              onMouseMove={() => sel !== i && setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(it);
              }}
            >
              {it.kind === "note" ? (
                <>
                  <span className="kn-palette-title">
                    <Highlight text={it.title} ranges={titleRanges(it.title, query)} />
                    {it.snippet ? <Snippet text={plainSnippet(it.snippet)} query={query} /> : null}
                  </span>
                  <span className="kn-palette-r">
                    {it.format ? <span className="kn-palette-type" title={it.at ? fileAtLabel(it.at, locale) : undefined}>{it.format}{it.at ? `:${"line" in it.at ? it.at.line : fileAtLabel(it.at, locale)}` : ""}</span> : null}
                    {it.semantic ? <span className="kn-palette-why" title={t("notes.palette.semanticHint")}>{t("notes.palette.semantic")}</span> : null}
                    {it.detail}
                  </span>
                </>
              ) : it.kind === "command" ? (
                <span className="kn-palette-title kn-palette-create">{it.title}</span>
              ) : (
                <span className="kn-palette-title kn-palette-create">{t("notes.menu.createMain", { name: it.title })}</span>
              )}
            </div>
          ))}
          {!items.length && !tooLong ? <div className="kn-palette-empty">{t(query.trim() ? "notes.palette.none" : "notes.noNotes")}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Snippet({ text, query }: { text: string; query: string }) {
  return (
    <span className="kn-palette-snippet">
      <Highlight text={text} ranges={snippetRanges(text, query)} />
    </span>
  );
}
