// A barra lateral das Notas (B v4: só texto e espaço; selecionada é peso de texto). Com o T2469, o básico de app de notas:
// a busca na árvore, as fixadas e as recentes, o contador discreto de cada pasta, renomear ali mesmo, arrastar nota ou
// pasta para outra pasta (ou para a raiz, na área vazia) e o menu de botão direito. Com o T3370 (spec #3272): um ícone
// por tipo, a seta das pastas, os outros arquivos do cofre (abrem no app padrão do Mac) e a extensão, se a pessoa quiser.

import { type DragEvent, type ReactElement, useEffect, useRef, useState } from "react";

import { Highlight } from "./Highlight.tsx";
import { folderOf } from "./links.ts";
import { titleRanges } from "./palette.ts";
import type { FileNode, TreeNode } from "./tree.ts";
import { TreeIcon, Twisty } from "./treeIcons.tsx";
import type { SavedSearch } from "../../src/shared/query.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import type { NoteMeta, TagNode } from "./types.ts";

/** Em que o botão direito (ou o arrastar) caiu. */
export type SideTarget = { kind: "note"; path: string } | { kind: "folder"; path: string } | { kind: "empty" };

export interface SidebarProps {
  tree: TreeNode[];
  open: Set<string>;
  current: string | null;
  /** A pasta escolhida (a do ⌘N e da "Nova pasta"); "" é a raiz. */
  selectedFolder: string;
  query: string;
  onQuery(q: string): void;
  pinned: NoteMeta[];
  recent: NoteMeta[];
  /** O item com o menu de botão direito aberto (`n:path` ou `f:path`), ou null. */
  menuOn?: string | null;
  /** O item sendo renomeado ali mesmo (`n:path` ou `f:path`), ou null. */
  renaming: string | null;
  onRename(target: SideTarget, name: string | null): void;
  onToggle(folder: string): void;
  onOpen(path: string): void;
  onSelectFolder(folder: string): void;
  onMenu(e: { x: number; y: number }, target: SideTarget): void;
  /** As buscas salvas (T2660): um clique abre a busca; o × tira da lista. */
  saved?: SavedSearch[];
  onSaved?(query: string): void;
  onUnsave?(query: string): void;
  /** As tags do vault em árvore (T2619); um clique busca as notas com ela. */
  tags?: TagNode[];
  onTag?(tag: string): void;
  /** Soltar o que foi arrastado numa pasta ("" é a raiz). Sem as capacidades de pastas, nada é arrastável. */
  onDrop?(what: SideTarget, folder: string): void;
  /** A nota do dia (T2593): uma entrada no topo. Num engine sem ela, não aparece. */
  onDaily?(): void;
  /** A Lixeira do app (T2593): uma entrada no fim, com quantos itens. */
  onTrash?(): void;
  trashCount?: number;
  /** A Lixeira está aberta no meio da janela. */
  trashOpen?: boolean;
  /** Abre no app padrão do Mac um arquivo que não é nota (T3370). Sem isto, os arquivos aparecem sem abrir. */
  onOpenFile?(path: string): void;
  /** A extensão depois do nome (`.md`, `.pdf`), em cinza: o "Mostrar extensão dos arquivos" dos Ajustes (T3370). */
  showExtensions?: boolean;
  /** A pasta da nota do dia: as `AAAA-MM-DD.md` de lá ganham o ícone dela. */
  dailyFolder?: string;
  /**
   * Os botões fixos do topo (T3371): criam na pasta escolhida (a da nota aberta, ou a pasta clicada) ou, sem nada
   * escolhido, na raiz. A nota nova abre com o título selecionado; a pasta nova entra em renomear na árvore.
   */
  onNewNote?(folder: string): void;
  onNewFolder?(folder: string): void;
}

/** "na raiz" ou "em Projetos": onde os botões do topo criam. */
export const whereLabel = (folder: string) => (folder ? `em ${folder.slice(folder.lastIndexOf("/") + 1)}` : "na raiz");

/** Uma nota do dia: `AAAA-MM-DD.md` na pasta das notas do dia. */
export const isDailyNote = (path: string, dailyFolder: string | undefined) =>
  dailyFolder !== undefined && folderOf(path) === dailyFolder && /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i.test(path);

/** A extensão em cinza depois do nome. */
const Ext = ({ ext }: { ext: string }) => (ext ? <span className="kn-side-ext">.{ext}</span> : null);

const DRAG = "application/x-kiwi-notes";

/** O campo de renomear: Enter grava, Esc desiste, sair do campo grava. */
function RenameInput({ initial, depth, onDone }: { initial: string; depth: number; onDone(name: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="kn-side-rename"
      aria-label="Novo nome"
      style={{ marginLeft: depth * 14 }}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() && value.trim() !== initial ? value.trim() : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() && value.trim() !== initial ? value.trim() : null);
        else if (e.key === "Escape") finish(null);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}

export function Sidebar(p: SidebarProps) {
  const [dropOn, setDropOn] = useState<string | null>(null);
  const menu = (e: React.MouseEvent, target: SideTarget) => {
    e.preventDefault();
    e.stopPropagation();
    p.onMenu({ x: e.clientX, y: e.clientY }, target);
  };
  const drag = (target: SideTarget) =>
    p.onDrop
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(DRAG, JSON.stringify(target));
            e.dataTransfer.effectAllowed = "move";
          },
        }
      : {};
  const dropZone = (folder: string) =>
    p.onDrop
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropOn(folder);
          },
          onDragLeave: () => setDropOn((d) => (d === folder ? null : d)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDropOn(null);
            const raw = e.dataTransfer.getData(DRAG);
            if (raw) p.onDrop?.(JSON.parse(raw) as SideTarget, folder);
          },
        }
      : {};

  // Renomear só no lugar da árvore: a mesma nota nas fixadas e nas recentes segue como botão.
  const searching = p.query.trim().length > 0;
  const noteItem = (n: { path: string; name: string }, depth: number, key: string, inTree = true) =>
    inTree && p.renaming === `n:${n.path}` ? (
      <RenameInput key={key} initial={n.name} depth={depth} onDone={(name) => p.onRename({ kind: "note", path: n.path }, name)} />
    ) : (
      <button
        type="button"
        key={key}
        className="kn-side-item"
        data-kind="note"
        aria-current={n.path === p.current ? "page" : undefined}
        data-menu={(inTree && p.menuOn === `n:${n.path}`) || undefined}
        style={{ paddingLeft: depth * 14 }}
        // No Mac, ⌃-clique é o clique secundário: abre só o menu (o onContextMenu). O WebKit também manda um `click`, e
        // a nota abria e fechava a árvore por baixo do menu (T2693).
        onClick={(e) => !e.ctrlKey && p.onOpen(n.path)}
        onContextMenu={(e) => menu(e, { kind: "note", path: n.path })}
        {...drag({ kind: "note", path: n.path })}
      >
        {inTree ? <Twisty /> : null}
        <TreeIcon name={isDailyNote(n.path, p.dailyFolder) ? "daily" : "note"} />
        <span className="kn-side-name">{inTree && searching ? <Highlight text={n.name} ranges={titleRanges(n.name, p.query)} /> : n.name}</span>
        {p.showExtensions ? <Ext ext="md" /> : null}
      </button>
    );

  // Um arquivo que não é nota (T3370): o clique abre no app padrão do Mac. Sem menu nem arrastar: renomear e mover
  // um anexo é pelo Finder (os links das notas a ele não seriam reescritos aqui).
  const fileItem = (f: FileNode, depth: number) => (
    <button
      type="button"
      key={`a:${f.path}`}
      className="kn-side-item"
      data-kind="file"
      data-type={f.type}
      style={{ paddingLeft: depth * 14 }}
      title={`${f.path} · abre no app padrão do Mac`}
      onClick={(e) => !e.ctrlKey && p.onOpenFile?.(f.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Twisty />
      <TreeIcon name={f.type} />
      <span className="kn-side-name">{searching ? <Highlight text={f.name} ranges={titleRanges(f.name, p.query)} /> : f.name}</span>
      {p.showExtensions ? <Ext ext={f.ext} /> : null}
    </button>
  );

  const items = (nodes: TreeNode[], depth: number): ReactElement[] =>
    nodes.flatMap((n) => {
      if (n.kind === "note") return [noteItem(n, depth, `n:${n.path}`)];
      if (n.kind === "file") return [fileItem(n, depth)];
      const expanded = p.open.has(n.path);
      const row =
        p.renaming === `f:${n.path}` ? (
          <RenameInput key={`f:${n.path}`} initial={n.name} depth={depth} onDone={(name) => p.onRename({ kind: "folder", path: n.path }, name)} />
        ) : (
          <button
            type="button"
            key={`f:${n.path}`}
            className="kn-side-item"
            data-kind="folder"
            data-selected={p.selectedFolder === n.path || undefined}
            data-menu={p.menuOn === `f:${n.path}` || undefined}
            data-drop={dropOn === n.path || undefined}
            aria-expanded={expanded}
            style={{ paddingLeft: depth * 14 }}
            onClick={(e) => {
              if (e.ctrlKey) return; // o ⌃-clique é o menu, não abrir ou fechar a pasta (T2693)
              p.onSelectFolder(n.path);
              p.onToggle(n.path);
            }}
            onContextMenu={(e) => menu(e, { kind: "folder", path: n.path })}
            {...drag({ kind: "folder", path: n.path })}
            {...dropZone(n.path)}
          >
            <Twisty open={expanded} />
            <TreeIcon name={expanded ? "folder-open" : "folder"} />
            <span className="kn-side-name">{n.name}</span>
            {n.count ? <span className="kn-side-count">{n.count}</span> : null}
          </button>
        );
      return [row, ...(expanded ? items(n.children, depth + 1) : [])];
    });

  return (
    <nav
      className="kn-side"
      aria-label="Notas"
      data-drop={dropOn === "" || undefined}
      onContextMenu={(e) => menu(e, { kind: "empty" })}
      onClick={(e) => e.target === e.currentTarget && p.onSelectFolder("")}
      {...dropZone("")}
    >
      <div className="kn-side-top">
      <input
        className="kn-side-search"
        type="search"
        {...NO_TEXT_ASSIST}
        placeholder="Ir para uma nota ou pasta"
        aria-label="Ir para uma nota ou pasta"
        autoFocus
        value={p.query}
        onChange={(e) => p.onQuery(e.target.value)}
        onKeyDown={(e) => {
          // Com texto, o Esc limpa; vazio, ele sobe e fecha o popover da árvore.
          if (e.key === "Escape" && p.query) {
            e.preventDefault();
            p.onQuery("");
          }
        }}
      />
      {p.onNewNote ? (
        <button
          type="button"
          className="kn-side-new"
          data-new="note"
          title={`Nova nota ${whereLabel(p.selectedFolder)} (⌘N)`}
          aria-label={`Nova nota ${whereLabel(p.selectedFolder)}`}
          onClick={() => p.onNewNote?.(p.selectedFolder)}
        >
          <TreeIcon name="note-plus" />
        </button>
      ) : null}
      {p.onNewFolder ? (
        <button
          type="button"
          className="kn-side-new"
          data-new="folder"
          title={`Nova pasta ${whereLabel(p.selectedFolder)}`}
          aria-label={`Nova pasta ${whereLabel(p.selectedFolder)}`}
          onClick={() => p.onNewFolder?.(p.selectedFolder)}
        >
          <TreeIcon name="folder-plus" />
        </button>
      ) : null}
      </div>
      {!searching && p.onDaily ? (
        <button type="button" className="kn-side-item kn-side-daily" onClick={() => p.onDaily?.()} title="Nota do dia (⇧⌘D)">
          <TreeIcon name="today" />
          <span className="kn-side-name">Hoje</span>
          <span className="kn-side-count">⇧⌘D</span>
        </button>
      ) : null}
      {!searching && p.pinned.length ? (
        <>
          <div className="kn-side-head">Fixadas</div>
          {p.pinned.map((n) => noteItem({ path: n.path, name: n.title }, 0, `p:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {!searching && p.saved?.length && p.onSaved ? (
        <>
          <div className="kn-side-head">Buscas salvas</div>
          {p.saved.map((s) => (
            <div key={`s:${s.query}`} className="kn-side-saved">
              <button type="button" className="kn-side-item" data-kind="search" title={s.query} onClick={(e) => !e.ctrlKey && p.onSaved?.(s.query)}>
                <TreeIcon name="search" />
                <span className="kn-side-name">{s.name}</span>
              </button>
              {p.onUnsave ? (
                <button type="button" className="kn-side-x" aria-label={`Tirar a busca “${s.name}”`} title="Tirar da lista" onClick={() => p.onUnsave?.(s.query)}>
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {!searching && p.recent.length ? (
        <>
          <div className="kn-side-head">Recentes</div>
          {p.recent.map((n) => noteItem({ path: n.path, name: n.title }, 0, `r:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      <div className="kn-side-head">{searching ? "Resultado" : "Notas"}</div>
      {items(p.tree, 0)}
      {searching && !p.tree.length ? <div className="kn-side-empty">Nada com esse nome</div> : null}
      {!searching && p.tags?.length && p.onTag ? (
        <>
          <div className="kn-side-gap" />
          <div className="kn-side-head">Tags</div>
          {tagItems(p.tags, 0, p.onTag)}
        </>
      ) : null}
      {!searching && p.onTrash ? (
        <>
          <div className="kn-side-gap" />
          <button
            type="button"
            className="kn-side-item kn-side-trash"
            aria-current={p.trashOpen || undefined}
            onClick={() => p.onTrash?.()}
          >
            <TreeIcon name="trash" />
            <span className="kn-side-name">Lixeira</span>
            {p.trashCount ? <span className="kn-side-count">{p.trashCount}</span> : null}
          </button>
        </>
      ) : null}
    </nav>
  );
}

/** As tags, com as filhas recuadas embaixo da mãe, e quantas notas cada uma tem. */
function tagItems(tags: TagNode[], depth: number, onTag: (tag: string) => void): ReactElement[] {
  return tags.flatMap((t) => [
    <button
      type="button"
      key={`t:${t.tag}`}
      className="kn-side-item"
      data-kind="tag"
      style={{ paddingLeft: depth * 14 }}
      title={`Notas com #${t.tag}`}
      // ⌃-clique é o clique secundário do Mac: abre só o menu, não a busca por baixo dele (T2693, T2751).
      onClick={(e) => !e.ctrlKey && onTag(t.tag)}
    >
      <TreeIcon name="tag" />
      <span className="kn-side-name">#{t.name}</span>
      <span className="kn-side-count">{t.count}</span>
    </button>,
    ...tagItems(t.children, depth + 1, onTag),
  ]);
}
