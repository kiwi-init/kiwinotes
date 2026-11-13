// A barra lateral das Notas (B v4: só texto e espaço; selecionada é peso de texto). Com o T2469, o básico de app de notas:
// a busca na árvore, as fixadas e as recentes, o contador discreto de cada pasta, renomear ali mesmo, arrastar nota ou
// pasta para outra pasta (ou para a raiz, na área vazia) e o menu de botão direito. Com o T3370 (spec #3272): um ícone
// por tipo, a seta das pastas, os outros arquivos do cofre (abrem no app padrão do Mac) e a extensão, se a pessoa quiser.

import { type CSSProperties, type DragEvent, type ReactElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./hover-rows.css";

import { Highlight } from "./Highlight.tsx";
import { folderOf } from "./links.ts";
import { titleRanges } from "./palette.ts";
import type { FileNode, TreeNode } from "./tree.ts";
import { HoverLabel } from "../src/kit/index.tsx";
import { TreeIcon, Twisty } from "./treeIcons.tsx";
import { type SavedSearch, SEARCH_TOO_LONG, searchTooLong } from "../../src/shared/query.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import type { SectionId } from "./sidebarState.ts";
import type { NoteMeta, TagNode } from "./types.ts";

/** Em que o botão direito (ou o arrastar) caiu. */
export type SideTarget = { kind: "note"; path: string } | { kind: "folder"; path: string } | { kind: "empty" };

export interface SidebarProps {
  /** Hover não deve mover o cursor de quem está escrevendo. */
  autoFocus?: boolean;
  metadata?: ReadonlyMap<string, NoteMeta>;
  fileTimes?: ReadonlyMap<string, string>;
  onPin?(path: string): void | Promise<void>;
  /**
   * Os projetos (spec #9847), pela pasta: a pasta ganha o sinal, a nota principal também, e a pasta sem nota principal
   * mostra o aviso. O clique no aviso chama `onProjectWarning`.
   */
  projects?: ReadonlyMap<string, { main: string | null }>;
  onProjectWarning?(folder: string, at: { x: number; y: number }): void;
  tree: TreeNode[];
  open: Set<string>;
  current: string | null;
  /** A pasta escolhida (a do ⌘N e da "Nova pasta"); "" é a raiz. */
  selectedFolder: string;
  /** Como os atalhos aparecem agora ("⌘N", "⇧⌘D"), ou null quando desligados (T5349). Sem isto, os padrões. */
  keys?: { newNote: string | null; dailyNote: string | null };
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
  onTagMenu?(position: { x: number; y: number }, tag: string): void;
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
  /**
   * A pasta raiz das notas (T5298, issue #211): a primeira linha da árvore. Ela abre ali mesmo o "Abrir pasta…" e as
   * pastas recentes, para que a árvore seja o lugar único de navegação, sem controle extra ao lado dela.
   */
  root?: SideRoot;
  /**
   * As seções recolhidas (T7390, spec #7383): Fixadas, Buscas salvas, Recentes, Notas e Tags recolhem pelo título.
   * Sem `onSection`, os títulos são só texto e tudo fica aberto.
   */
  collapsed?: ReadonlySet<SectionId>;
  onSection?(id: SectionId): void;
  /** Os botões do topo que fecham e abrem todas as pastas da árvore, também as de dentro. */
  onCollapseAll?(): void;
  onExpandAll?(): void;
}

/** A pasta aberta e as recentes (sem a aberta). `onOpen()` abre o seletor; `onOpen(key)`, uma recente. */
export interface SideRoot {
  name: string;
  path: string;
  recent: { key: string; name: string; path: string }[];
  onOpen(recent?: string): void;
  error?: string;
}

function ModifiedAt({ value }: { value?: string }) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const date = new Date(value);
  return (
    <time dateTime={value} title={date.toLocaleString("pt-BR")}>
      {date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
    </time>
  );
}

/** "na raiz" ou "em Projetos": onde os botões do topo criam. */
export const whereLabel = (folder: string) => (folder ? `em ${folder.slice(folder.lastIndexOf("/") + 1)}` : "na raiz");

/** Uma nota do dia: `AAAA-MM-DD.md` na pasta das notas do dia. */
export const isDailyNote = (path: string, dailyFolder: string | undefined) =>
  dailyFolder !== undefined && folderOf(path) === dailyFolder && /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i.test(path);

/** A extensão em cinza depois do nome. */
const Ext = ({ ext }: { ext: string }) => (ext ? <span className="kn-side-ext">.{ext}</span> : null);

const DRAG = "application/x-kiwi-notes";

/**
 * A lista da árvore desenha só o que está na tela, mais uma margem, quando passa disto (T7875): um cofre de 10 mil notas
 * com tudo expandido tinha 10 mil linhas no DOM, e abrir a árvore levava 4 a 8 s. Abaixo disto, tudo como antes.
 */
export const VIRTUAL_FROM = 300;
/** As linhas desenhadas acima e abaixo da tela: o Tab e o rolar rápido não chegam ao vazio. */
const OVERSCAN = 40;

/** Uma linha da árvore: a nota, o arquivo ou a pasta, e o recuo. As pastas abertas trazem as de dentro logo depois. */
export interface TreeRow {
  node: TreeNode;
  depth: number;
}

/** A árvore como as linhas que aparecem, na ordem: o que está dentro de uma pasta fechada não entra. */
export function treeRows(nodes: TreeNode[], open: ReadonlySet<string>, depth = 0, out: TreeRow[] = []): TreeRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.kind === "folder" && open.has(node.path)) treeRows(node.children, open, depth + 1, out);
  }
  return out;
}

/** As linhas `[first, last)` para desenhar: a janela da rolagem sobre a lista, com a margem. */
export function visibleRange(count: number, rowHeight: number, listTop: number, scrollTop: number, viewHeight: number): [number, number] {
  if (count <= VIRTUAL_FROM || rowHeight <= 0) return [0, count];
  const from = scrollTop - listTop;
  const first = Math.max(0, Math.floor(from / rowHeight) - OVERSCAN);
  const last = Math.min(count, Math.ceil((from + viewHeight) / rowHeight) + OVERSCAN);
  return [Math.min(first, last), last];
}

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
  // A janela da rolagem, para a lista virtual (T7875): o `nav` é quem rola.
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 900 });
  const [rowHeight, setRowHeight] = useState(28);
  const frame = useRef(0);
  const measureView = () => {
    const nav = navRef.current;
    if (nav) setView((v) => (v.top === nav.scrollTop && v.height === nav.clientHeight ? v : { top: nav.scrollTop, height: nav.clientHeight }));
  };
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measureView();
    });
  };
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    measureView();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureView);
    ro?.observe(nav);
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const newNoteKey = p.keys ? p.keys.newNote : "⌘N";
  const dailyKey = p.keys ? p.keys.dailyNote : "⇧⌘D";
  const shut = (id: SectionId) => Boolean(p.onSection && p.collapsed?.has(id));
  /** O título de uma seção: com `onSection`, um botão com a seta que recolhe e abre a seção (T7390). */
  const head = (id: SectionId, label: string) =>
    p.onSection ? (
      <button type="button" className="kn-side-head" data-section={id} aria-expanded={!shut(id)} onClick={() => p.onSection?.(id)}>
        <Twisty open={!shut(id)} />
        {label}
      </button>
    ) : (
      <div className="kn-side-head" data-section={id}>
        {label}
      </div>
    );
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

  const pinned = new Set(p.pinned.map((note) => note.path));
  const mains = new Set([...(p.projects?.values() ?? [])].flatMap((x) => (x.main ? [x.main] : [])));
  const rowStyle = (date: boolean, pin: boolean): CSSProperties => ({
    "--row-tools": `${28 + (date ? 44 : 0) + (pin ? 26 : 0)}px`,
  } as CSSProperties);
  const tools = (target: Exclude<SideTarget, { kind: "empty" }>, name: string, mtime?: string) => (
    <span className="kn-side-tools" onContextMenu={(event) => menu(event, target)}>
      <ModifiedAt value={mtime} />
      {target.kind === "note" && p.onPin ? (
        <button type="button" className="kn-side-action" aria-label={`${pinned.has(target.path) ? "Desafixar" : "Fixar"} “${name}”`} aria-pressed={pinned.has(target.path)} onClick={async (event) => {
          if (event.ctrlKey) return; // ⌃-clique no Mac é menu, não fixar (#2693).
          const button = event.currentTarget;
          const nav = button.closest("nav");
          const restoreFocus = document.activeElement === button;
          await p.onPin?.(target.path);
          if (restoreFocus) requestAnimationFrame(() => {
            // Desafixar pode remover esta cópia da linha. O teclado continua
            // na mesma nota (recentes/árvore), ou na busca se ela está recolhida.
            if (button.isConnected) return;
            const next = [...(nav?.querySelectorAll<HTMLButtonElement>('.kn-side-item[data-kind="note"]') ?? [])]
              .find((item) => item.dataset.path === target.path) ?? nav?.querySelector<HTMLInputElement>(".kn-side-search");
            next?.focus();
          });
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M5 2h6l-1 5 2 3H4l2-3-1-5ZM8 10v4" /></svg>
        </button>
      ) : null}
      <button type="button" className="kn-side-action" aria-label={`Mais ações para “${name}”`} aria-haspopup="menu" aria-expanded={p.menuOn === `${target.kind === "note" ? "n" : "f"}:${target.path}`} onClick={(event) => {
        if (event.ctrlKey) return;
        const rect = event.currentTarget.getBoundingClientRect();
        p.onMenu({ x: rect.left, y: rect.bottom }, target);
      }}>…</button>
    </span>
  );

  // Ações são irmãs do botão de abrir: teclado/click nunca abrem a nota ao fixar.
  // Renomear só no lugar da árvore: a mesma nota nas fixadas e nas recentes segue como botão.
  const searching = p.query.trim().length > 0;
  const noteItem = (n: { path: string; name: string }, depth: number, key: string, inTree = true) =>
    inTree && p.renaming === `n:${n.path}` ? (
      <RenameInput key={key} initial={n.name} depth={depth} onDone={(name) => p.onRename({ kind: "note", path: n.path }, name)} />
    ) : (
      <div key={key} className="kn-side-row" data-menu={p.menuOn === `n:${n.path}` || undefined} style={rowStyle(Boolean(p.metadata?.get(n.path)?.mtime), Boolean(p.onPin))}>
        <button
          type="button"
          className="kn-side-item"
          data-kind="note"
          data-tree={inTree || undefined}
          aria-keyshortcuts="Shift+F10"
          data-path={n.path}
          title={n.name}
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
          {inTree && mains.has(n.path) ? <ProjectMark kind="main" /> : null}
          {p.showExtensions ? <Ext ext="md" /> : null}
        </button>
        {tools({ kind: "note", path: n.path }, n.name, p.metadata?.get(n.path)?.mtime)}
      </div>
    );

  // Um arquivo que não é nota (T3370): o clique abre no app padrão do Mac. Sem menu nem arrastar: renomear e mover
  // um anexo é pelo Finder (os links das notas a ele não seriam reescritos aqui).
  const fileItem = (f: FileNode, depth: number) => (
    <div key={`a:${f.path}`} className="kn-side-row" style={{ "--row-tools": p.fileTimes?.has(f.path) ? "44px" : "0px" } as CSSProperties} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <button
        type="button"
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
      <span className="kn-side-tools">
        <ModifiedAt value={p.fileTimes?.get(f.path)} />
      </span>
    </div>
  );

  const row = ({ node: n, depth }: TreeRow): ReactElement => {
      if (n.kind === "note") return noteItem(n, depth, `n:${n.path}`);
      if (n.kind === "file") return fileItem(n, depth);
      const expanded = p.open.has(n.path);
      return p.renaming === `f:${n.path}` ? (
          <RenameInput key={`f:${n.path}`} initial={n.name} depth={depth} onDone={(name) => p.onRename({ kind: "folder", path: n.path }, name)} />
        ) : (
          <div key={`f:${n.path}`} className="kn-side-row" data-menu={p.menuOn === `f:${n.path}` || undefined} style={rowStyle(false, false)}>
            <button
              type="button"
              className="kn-side-item"
              data-kind="folder"
              data-path={n.path}
              aria-keyshortcuts="Shift+F10"
              data-selected={p.selectedFolder === n.path || undefined}
              data-menu={p.menuOn === `f:${n.path}` || undefined}
              data-drop={dropOn === n.path || undefined}
              aria-expanded={expanded}
              style={{ paddingLeft: depth * 14 }}
              onClick={(e) => {
                if (e.ctrlKey) return; // o ⌃-clique é o menu, não abrir ou fechar a pasta (T2693)
                // O aviso da nota principal apagada (spec #9847): o clique nele escolhe a nota, e a pasta fica como está.
                const warn = (e.target as Element).closest?.(".kn-side-warn");
                if (warn && p.onProjectWarning) {
                  const rect = warn.getBoundingClientRect();
                  p.onProjectWarning(n.path, { x: rect.left, y: rect.bottom });
                  return;
                }
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
              {p.projects?.has(n.path) ? <ProjectMark kind="folder" /> : null}
              {p.projects?.get(n.path)?.main === null ? (
                <span className="kn-side-warn" title="A nota principal foi apagada: clique para escolher outra" aria-label="sem nota principal">
                  !
                </span>
              ) : null}
              {n.count ? <span className="kn-side-count">{n.count}</span> : null}
            </button>
            {tools({ kind: "folder", path: n.path }, n.name)}
          </div>
        );
    };

  // As linhas da árvore, e só as da janela quando são muitas (T7875). Em cima e embaixo, o espaço das que não estão
  // desenhadas: a barra de rolagem e a posição seguem as de verdade.
  const showTree = searching || !shut("notes");
  const rows = useMemo(() => (showTree ? treeRows(p.tree, p.open) : []), [showTree, p.tree, p.open]);
  const virtual = rows.length > VIRTUAL_FROM;
  const [first, last] = visibleRange(rows.length, rowHeight, listRef.current?.offsetTop ?? 0, view.top, view.height);
  // A altura de uma linha, medida (o tamanho do texto muda ela).
  useLayoutEffect(() => {
    if (!virtual) return;
    const h = listRef.current?.querySelector<HTMLElement>(".kn-side-row")?.offsetHeight;
    if (h && Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
  });
  // Renomear (a pasta nova, o "Renomear" do menu) numa linha fora da janela: a lista rola até ela, e o campo aparece.
  useEffect(() => {
    const nav = navRef.current;
    if (!virtual || !p.renaming || !nav) return;
    const index = rows.findIndex((r) => `${r.node.kind === "folder" ? "f" : "n"}:${r.node.path}` === p.renaming);
    if (index < 0) return;
    const top = (listRef.current?.offsetTop ?? 0) + index * rowHeight;
    if (top < nav.scrollTop || top + rowHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = top - nav.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.renaming, virtual]);

  return (
    <nav
      ref={navRef}
      className="kn-side"
      aria-label="Notas"
      onScroll={onScroll}
      data-drop={dropOn === "" || undefined}
      onContextMenu={(e) => menu(e, { kind: "empty" })}
      onClick={(e) => e.target === e.currentTarget && p.onSelectFolder("")}
      onKeyDown={(e) => {
        // O teclado na árvore (spec #9847): no WebKit, como no Safari, o Tab pula os botões, e as linhas e o "…" não
        // recebiam foco. ↓ no campo de busca entra na árvore, ↑/↓ andam entre as linhas, e ⇧F10 (ou a tecla de menu)
        // abre o menu da linha em foco, como o clique direito.
        const nav = e.currentTarget;
        const items = () => [...nav.querySelectorAll<HTMLElement>('.kn-side-item[data-kind="note"], .kn-side-item[data-kind="folder"]')];
        const el = e.target as HTMLElement;
        if (el.classList.contains("kn-side-search")) {
          if (e.key !== "ArrowDown") return;
          const first = items()[0];
          if (!first) return;
          e.preventDefault();
          first.focus();
          return;
        }
        if (!el.classList.contains("kn-side-item")) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const all = items();
          const i = all.indexOf(el);
          const next = e.key === "ArrowDown" ? all[i + 1] : i > 0 ? all[i - 1] : nav.querySelector<HTMLElement>(".kn-side-search");
          if (!next) return;
          e.preventDefault();
          next.focus();
          next.scrollIntoView?.({ block: "nearest" });
          return;
        }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const kind = el.dataset.kind;
          const path = el.dataset.path;
          if (path === undefined) return;
          if (kind === "folder") {
            // → abre a pasta fechada (ou entra na 1ª linha dela, já aberta); ← fecha a aberta (ou sobe para a de cima).
            const expanded = el.getAttribute("aria-expanded") === "true";
            e.preventDefault();
            if (e.key === "ArrowRight") {
              if (!expanded) p.onToggle(path);
              else items()[items().indexOf(el) + 1]?.focus();
            } else if (expanded) p.onToggle(path);
            else nav.querySelector<HTMLElement>(`.kn-side-item[data-kind="folder"][data-path="${CSS.escape(folderOf(path))}"]`)?.focus();
            return;
          }
          if (kind === "note" && e.key === "ArrowLeft" && el.dataset.tree) {
            // Numa nota da árvore, ← sobe para a pasta dela.
            const up = nav.querySelector<HTMLElement>(`.kn-side-item[data-kind="folder"][data-path="${CSS.escape(folderOf(path))}"]`);
            if (up) {
              e.preventDefault();
              up.focus();
            }
          }
          return;
        }
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          const kind = el.dataset.kind;
          const path = el.dataset.path;
          if ((kind !== "note" && kind !== "folder") || path === undefined) return;
          e.preventDefault();
          const rect = el.getBoundingClientRect();
          p.onMenu({ x: rect.left + 24, y: rect.bottom }, { kind, path });
        }
      }}
      {...dropZone("")}
    >
      <div className="kn-side-top">
      <input
        className="kn-side-search"
        type="search"
        {...NO_TEXT_ASSIST}
        placeholder="Ir para uma nota ou pasta"
        aria-label="Ir para uma nota ou pasta"
        autoFocus={p.autoFocus ?? true}
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
          className="kn-side-new kn-expand"
          data-new="note"
          title={`Nova nota ${whereLabel(p.selectedFolder)}${newNoteKey ? ` (${newNoteKey})` : ""}`}
          aria-label={`Nova nota ${whereLabel(p.selectedFolder)}`}
          onClick={() => p.onNewNote?.(p.selectedFolder)}
        >
          <TreeIcon name="note-plus" />
          <HoverLabel>Nota</HoverLabel>
        </button>
      ) : null}
      {p.onNewFolder ? (
        <button
          type="button"
          className="kn-side-new kn-expand"
          data-new="folder"
          title={`Nova pasta ${whereLabel(p.selectedFolder)}`}
          aria-label={`Nova pasta ${whereLabel(p.selectedFolder)}`}
          onClick={() => p.onNewFolder?.(p.selectedFolder)}
        >
          <TreeIcon name="folder-plus" />
          <HoverLabel>Pasta</HoverLabel>
        </button>
      ) : null}
      {p.onCollapseAll ? (
        <button type="button" className="kn-side-new kn-expand" data-all="collapse" title="Recolher todas as pastas" aria-label="Recolher todas as pastas" onClick={() => p.onCollapseAll?.()}>
          <TreeIcon name="collapse-all" />
          <HoverLabel>Recolher</HoverLabel>
        </button>
      ) : null}
      {p.onExpandAll ? (
        <button type="button" className="kn-side-new kn-expand" data-all="expand" title="Expandir todas as pastas" aria-label="Expandir todas as pastas" onClick={() => p.onExpandAll?.()}>
          <TreeIcon name="expand-all" />
          <HoverLabel>Expandir</HoverLabel>
        </button>
      ) : null}
      </div>
      {!searching && p.root ? <RootFolder root={p.root} /> : null}
      {!searching && p.onDaily ? (
        <button type="button" className="kn-side-item kn-side-daily" onClick={() => p.onDaily?.()} title={`Nota do dia${dailyKey ? ` (${dailyKey})` : ""}`}>
          <TreeIcon name="today" />
          <span className="kn-side-name">Hoje</span>
          {dailyKey ? <span className="kn-side-count">{dailyKey}</span> : null}
        </button>
      ) : null}
      {!searching && p.pinned.length ? (
        <>
          {head("pinned", "Fixadas")}
          {!shut("pinned") && p.pinned.map((n) => noteItem({ path: n.path, name: n.title }, 0, `p:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {!searching && p.saved?.length && p.onSaved ? (
        <>
          {head("saved", "Buscas salvas")}
          {!shut("saved") && p.saved.map((s) => (
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
          {head("recent", "Recentes")}
          {!shut("recent") && p.recent.map((n) => noteItem({ path: n.path, name: n.title }, 0, `r:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {/* Na busca, o resultado vem inteiro, mesmo com a seção Notas recolhida. */}
      {searching ? <div className="kn-side-head" data-section="notes">Resultado</div> : head("notes", "Notas")}
      {showTree ? (
        <div
          ref={listRef}
          className="kn-side-list"
          data-virtual={virtual || undefined}
          style={virtual ? { paddingTop: first * rowHeight, paddingBottom: (rows.length - last) * rowHeight } : undefined}
        >
          {rows.slice(first, last).map(row)}
        </div>
      ) : null}
      {searching && !p.tree.length ? <div className="kn-side-empty">{searchTooLong(p.query) ? SEARCH_TOO_LONG : "Nada com esse nome"}</div> : null}
      {!searching && p.tags?.length && p.onTag ? (
        <>
          <div className="kn-side-gap" />
          {head("tags", "Tags")}
          {!shut("tags") && tagItems(p.tags, 0, p.onTag, p.onTagMenu)}
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
function tagItems(tags: TagNode[], depth: number, onTag: (tag: string) => void, onMenu?: SidebarProps["onTagMenu"]): ReactElement[] {
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
      onContextMenu={onMenu ? e => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }, t.tag); } : undefined}
    >
      <TreeIcon name="tag" />
      <span className="kn-side-name">#{t.name}</span>
      <span className="kn-side-count">{t.count}</span>
    </button>,
    ...tagItems(t.children, depth + 1, onTag, onMenu),
  ]);
}

/** A pasta raiz no topo da árvore: um clique mostra, logo abaixo e dentro da árvore, o "Abrir pasta…" e as recentes. */
function RootFolder({ root }: { root: SideRoot }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="kn-side-root" data-open={open || undefined}>
      <button
        type="button"
        className="kn-side-item kn-side-root-bt"
        aria-expanded={open}
        aria-label={`Pasta das notas: ${root.name}`}
        title={root.path}
        onClick={() => setOpen(!open)}
      >
        <Twisty open={open} />
        <TreeIcon name={open ? "folder-open" : "folder"} />
        <span className="kn-side-name">{root.name}</span>
      </button>
      {open ? (
        <div className="kn-side-root-list" role="group" aria-label="Pastas de notas">
          <button type="button" className="kn-side-item" data-root="open" onClick={() => root.onOpen()}>
            <TreeIcon name="folder-plus" />
            <span className="kn-side-name">Abrir pasta…</span>
          </button>
          {root.recent.map((r) => (
            <button type="button" className="kn-side-item" data-root="recent" key={r.key} title={r.path} onClick={() => root.onOpen(r.key)}>
              <TreeIcon name="folder" />
              <span className="kn-side-name">{r.name}</span>
              <span className="kn-side-root-path">{r.path}</span>
            </button>
          ))}
        </div>
      ) : null}
      {root.error ? <p className="kn-side-root-error" role="alert">{root.error}</p> : null}
    </div>
  );
}

/**
 * O sinal discreto de um projeto (spec #9847): na pasta, uma pastinha com uma marca; na nota principal, uma estrela
 * pequena. Só a cor do texto secundário, para não brigar com o nome.
 */
function ProjectMark({ kind }: { kind: "folder" | "main" }) {
  return kind === "folder" ? (
    <span className="kn-side-project" data-project="folder" title="Projeto" aria-label="projeto">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M3 13V3.5h7.5L9 6l1.5 2.5H3" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span className="kn-side-project" data-project="main" title="Nota principal do projeto" aria-label="nota principal">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5Z" />
      </svg>
    </span>
  );
}
