// A busca rápida ⌘K (B v4): uma caixa só, sem borda, com o resultado selecionado em peso de texto.

import { useEffect, useRef, useState } from "react";

import { plainSnippet } from "./links.ts";
import { Highlight } from "./Highlight.tsx";
import { type PaletteCommand, type PaletteItem, paletteItems, snippetRanges, titleRanges } from "./palette.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import type { NoteMeta, NotesApi, SearchHit } from "./types.ts";

export interface PaletteProps {
  api: NotesApi;
  notes: NoteMeta[];
  onOpen(path: string): void;
  onCreate(title: string): void;
  onClose(): void;
  /** A busca já aberta com um texto (T2619: o clique numa #tag abre com `tag:…`). */
  initialQuery?: string;
  commands?: PaletteCommand[];
  /** Um comando escolhido, com a busca de agora (o "Salvar esta busca" precisa dela). */
  onCommand?(id: string, query: string): void;
}

export function Palette({ api, notes, onOpen, onCreate, onClose, initialQuery = "", commands = [], onCommand }: PaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);

  // O texto vem do engine, um pouco depois de parar de digitar; uma resposta velha não sobrescreve a nova.
  useEffect(() => {
    const my = ++seq.current;
    if (!query.trim()) return setHits([]);
    const t = setTimeout(() => {
      api.search(query, 20).then(
        (h) => my === seq.current && setHits(h),
        () => my === seq.current && setHits([]),
      );
    }, 120);
    return () => clearTimeout(t);
  }, [query, api]);

  const items = paletteItems(notes, query, hits, commands);
  useEffect(() => setSel(0), [query]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === "note") onOpen(item.path);
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
      <div className="kn-palette" role="dialog" aria-label="Buscar notas" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="kn-palette-q"
          autoFocus
          {...NO_TEXT_ASSIST}
          placeholder="Buscar ou criar nota"
          aria-label="Buscar ou criar nota"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
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
                  <span className="kn-palette-r">{it.detail}</span>
                </>
              ) : it.kind === "command" ? (
                <span className="kn-palette-title kn-palette-create">{it.title}</span>
              ) : (
                <span className="kn-palette-title kn-palette-create">Criar “{it.title}”</span>
              )}
            </div>
          ))}
          {!items.length ? <div className="kn-palette-empty">{query.trim() ? "Nenhuma nota com isso" : "Nenhuma nota ainda"}</div> : null}
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
