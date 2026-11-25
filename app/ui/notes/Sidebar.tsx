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
import { useT } from "../src/i18n.ts";
import { INTL_TAG, type Locale, translate } from "../../src/shared/i18n/index.ts";
import { TreeIcon, Twisty } from "./treeIcons.tsx";
import { MAX_SEARCH_QUERY, type SavedSearch, searchTooLong } from "../../src/shared/query.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import type { SectionId } from "./sidebarState.ts";
import { canDrop, type Dragged, dropEdge, dropFolder, type DropRow, springFolder, springOpener } from "./treeDrop.ts";
import type { NoteMeta, TagNode } from "./types.ts";

/** Em que o botão direito (ou o arrastar) caiu. */
export type SideTarget = { kind: "note"; path: string } | { kind: "folder"; path: string } | { kind: "file"; path: string } | { kind: "empty" };

/** A chave de um item no `menuOn` e no `renaming`: `n:` nota, `f:` pasta, `a:` arquivo que não é nota (T19878). */
export const sideKey = (target: Exclude<SideTarget, { kind: "empty" }>) => `${target.kind === "note" ? "n" : target.kind === "folder" ? "f" : "a"}:${target.path}`;

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
  /** O item com o menu de botão direito aberto (`n:path`, `f:path` ou `a:path`, veja `sideKey`), ou null. */
  menuOn?: string | null;
  /** O item sendo renomeado ali mesmo (`n:path`, `f:path` ou `a:path`), ou null. */
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
  /** A pasta que acabou de ser criada (spec #19265): a linha dela pisca de leve, e a árvore rola até ela. */
  fresh?: string | null;
  /** A pasta nova ficou fora da vista mesmo assim: quem chama mostra um aviso curto de onde ela nasceu. */
  onFreshHidden?(path: string): void;
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
  const { locale } = useT();
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const date = new Date(value);
  const tag = INTL_TAG[locale];
  return (
    <time dateTime={value} title={date.toLocaleString(tag)}>
      {date.toLocaleDateString(tag, { day: "2-digit", month: "2-digit" })}
    </time>
  );
}

/** O que fica por cima da árvore e tem o próprio Esc: o menu, a busca, o aviso. */
const ESC_LAYERS = ".kn-menu, .kn-palette-scrim, .kn-toast";
/** Quando conferir se a pasta nova ficou à vista: depois da rolagem até ela. */
const FRESH_CHECK_MS = 250;

/** "na raiz" ou "em Projetos": onde os botões do topo criam, na língua das telas (T29244). */
export const whereLabel = (folder: string, locale: Locale = "pt") =>
  folder ? translate(locale, "notes.where.in", { folder: folder.slice(folder.lastIndexOf("/") + 1) }) : translate(locale, "notes.where.root");

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

/**
 * O nome novo de um arquivo que não é nota (T19878): o campo mostra o nome sem a extensão, e ela volta no fim. Quem
 * digita o nome com a extensão (`relatorio.pdf`) não fica com `relatorio.pdf.pdf`, e o tipo nunca se perde.
 */
export function withExt(name: string | null, ext: string): string | null {
  if (name === null || !ext) return name;
  const tail = `.${ext}`;
  return name.toLowerCase().endsWith(tail.toLowerCase()) ? name.slice(0, -tail.length) + tail : `${name}${tail}`;
}

/** O campo de renomear: Enter grava, Esc desiste, sair do campo grava. */
function RenameInput({ initial, depth, fresh, onDone }: { initial: string; depth: number; fresh?: boolean; onDone(name: string | null): void }) {
  const { t } = useT();
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
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <input
      ref={ref}
      className="kn-side-rename"
      data-fresh={fresh || undefined}
      aria-label={t("notes.side.newName")}
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
  const { t, locale } = useT();
  const [dropOn, setDropOn] = useState<string | null>(null);
  // O que está sendo arrastado (T19937): o `dragover` não lê o `dataTransfer`, e o destino depende do que se arrasta.
  const dragged = useRef<Dragged | null>(null);
  const [dragging, setDragging] = useState(false);
  // A linha fina onde o item cai: a linha sob o mouse (`kind:path`) e a borda dela.
  const [dropLine, setDropLine] = useState<{ row: string; edge: "top" | "bottom" } | null>(null);
  // Segurar sobre uma pasta fechada abre ela (spec #19261). O `latest` dá ao timer as props de quando ele dispara.
  const latest = useRef(p);
  latest.current = p;
  const spring = useMemo(() => springOpener((folder) => {
    if (!latest.current.open.has(folder)) latest.current.onToggle(folder);
  }), []);
  useEffect(() => () => spring.cancel(), [spring]);
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
  const drag = (target: Exclude<SideTarget, { kind: "empty" }>) =>
    p.onDrop
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(DRAG, JSON.stringify(target));
            e.dataTransfer.effectAllowed = "move";
            dragged.current = target;
            // A faixa "Raiz" entra depois do início do arrasto: mexer no DOM dentro do dragstart cancela o arrasto no WebKit.
            requestAnimationFrame(() => dragged.current && setDragging(true));
          },
          onDragEnd: () => {
            dragged.current = null;
            spring.cancel();
            setDragging(false);
            setDropOn(null);
            setDropLine(null);
          },
        }
      : {};
  const dropped = (e: DragEvent, folder: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const what = dragged.current;
    dragged.current = null;
    spring.cancel();
    setDragging(false);
    setDropOn(null);
    setDropLine(null);
    if (what && folder !== null) p.onDrop?.(what, folder);
  };
  /** O fundo da árvore e a faixa "Raiz": soltar ali põe na pasta dada (a raiz). */
  const dropZone = (folder: string) =>
    p.onDrop
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG)) return;
            spring.cancel();
            setDropLine(null);
            if (!canDrop(dragged.current, folder)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropOn(folder);
          },
          onDragLeave: () => setDropOn((d) => (d === folder ? null : d)),
          onDrop: (e: DragEvent) => dropped(e, canDrop(dragged.current, folder) ? folder : null),
        }
      : {};
  /**
   * Uma linha da árvore (T19937, spec #19261): soltar numa nota ou num arquivo põe na pasta deles; numa pasta, no meio
   * põe dentro, e nas bordas põe ao lado. Onde não muda nada, o cursor diz que não pode.
   */
  const rowDrop = (row: DropRow) => {
    if (!p.onDrop) return {};
    const at = (e: DragEvent) => {
      const r = e.currentTarget.getBoundingClientRect();
      return r.height ? (e.clientY - r.top) / r.height : 0.5;
    };
    const target = (e: DragEvent) => dropFolder(row, at(e), dragged.current);
    const key = `${row.kind}:${row.path}`;
    return {
      "data-drop-line": dropLine?.row === key ? dropLine.edge : undefined,
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG)) return;
        // A linha decide sozinha: o fundo (a raiz) não pega o que ela recusou.
        e.stopPropagation();
        const y = at(e);
        const folder = dropFolder(row, y, dragged.current);
        const edge = dropEdge(row, y, folder);
        spring.over(springFolder(row, y, dragged.current));
        setDropOn(folder);
        setDropLine((d) => (edge ? (d?.row === key && d.edge === edge ? d : { row: key, edge }) : null));
        if (folder === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (e: DragEvent) => {
        // Sair da linha (não para um filho dela) desliga o timer e a linha fina.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        spring.over(null);
        setDropLine((d) => (d?.row === key ? null : d));
      },
      onDrop: (e: DragEvent) => dropped(e, target(e)),
    };
  };

  const pinned = new Set(p.pinned.map((note) => note.path));
  const mains = new Set([...(p.projects?.values() ?? [])].flatMap((x) => (x.main ? [x.main] : [])));
  const rowStyle = (date: boolean, pin: boolean): CSSProperties => ({
    "--row-tools": `${28 + (date ? 44 : 0) + (pin ? 26 : 0)}px`,
  } as CSSProperties);
  const tools = (target: Exclude<SideTarget, { kind: "empty" }>, name: string, mtime?: string) => (
    <span className="kn-side-tools" onContextMenu={(event) => menu(event, target)}>
      <ModifiedAt value={mtime} />
      {target.kind === "note" && p.onPin ? (
        <button type="button" className="kn-side-action" aria-label={t(pinned.has(target.path) ? "notes.side.unpinName" : "notes.side.pinName", { name })} aria-pressed={pinned.has(target.path)} onClick={async (event) => {
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
      <button type="button" className="kn-side-action" aria-label={t("notes.side.moreActions", { name })} aria-haspopup="menu" aria-expanded={p.menuOn === sideKey(target)} onClick={(event) => {
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
          {...(inTree ? rowDrop({ kind: "note", path: n.path }) : {})}
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

  // Um arquivo que não é nota (T3370): o clique abre (no app padrão do Mac, ou no Kiwi, se ele mostra). O botão direito
  // abre o menu dele (T19878, spec #19256): renomear e mover reescrevem os links das notas, pelo `files.rename`.
  const fileItem = (f: FileNode, depth: number) => {
    const target = { kind: "file" as const, path: f.path };
    const full = f.ext ? `${f.name}.${f.ext}` : f.name;
    return p.renaming === sideKey(target) ? (
      <RenameInput key={`a:${f.path}`} initial={f.name} depth={depth} onDone={(name) => p.onRename(target, withExt(name, f.ext))} />
    ) : (
      <div key={`a:${f.path}`} className="kn-side-row" data-menu={p.menuOn === sideKey(target) || undefined} style={{ "--row-tools": `${28 + (p.fileTimes?.has(f.path) ? 44 : 0)}px` } as CSSProperties}>
        <button
          type="button"
          className="kn-side-item"
          data-kind="file"
          data-type={f.type}
          data-path={f.path}
          aria-keyshortcuts="Shift+F10"
          data-menu={p.menuOn === sideKey(target) || undefined}
          style={{ paddingLeft: depth * 14 }}
          title={f.path}
          // ⌃-clique é o menu, como nas notas (T2693).
          onClick={(e) => !e.ctrlKey && p.onOpenFile?.(f.path)}
          onContextMenu={(e) => menu(e, target)}
          {...drag(target)}
          {...rowDrop({ kind: "file", path: f.path })}
        >
          <Twisty />
          <TreeIcon name={f.type} />
          <span className="kn-side-name">{searching ? <Highlight text={f.name} ranges={titleRanges(f.name, p.query)} /> : f.name}</span>
          {p.showExtensions ? <Ext ext={f.ext} /> : null}
        </button>
        {tools(target, full, p.fileTimes?.get(f.path))}
      </div>
    );
  };

  const row = ({ node: n, depth }: TreeRow): ReactElement => {
      if (n.kind === "note") return noteItem(n, depth, `n:${n.path}`);
      if (n.kind === "file") return fileItem(n, depth);
      const expanded = p.open.has(n.path);
      return p.renaming === `f:${n.path}` ? (
          <RenameInput key={`f:${n.path}`} initial={n.name} depth={depth} fresh={p.fresh === n.path} onDone={(name) => p.onRename({ kind: "folder", path: n.path }, name)} />
        ) : (
          <div key={`f:${n.path}`} className="kn-side-row" data-menu={p.menuOn === `f:${n.path}` || undefined} style={rowStyle(false, false)}>
            <button
              type="button"
              className="kn-side-item"
              data-kind="folder"
              data-path={n.path}
              aria-keyshortcuts="Shift+F10"
              data-selected={p.selectedFolder === n.path || undefined}
              data-fresh={p.fresh === n.path || undefined}
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
              {...rowDrop({ kind: "folder", path: n.path, expanded })}
            >
              <Twisty open={expanded} />
              <TreeIcon name={expanded ? "folder-open" : "folder"} />
              <span className="kn-side-name">{n.name}</span>
              {p.projects?.has(n.path) ? <ProjectMark kind="folder" /> : null}
              {p.projects?.get(n.path)?.main === null ? (
                <span className="kn-side-warn" title={t("notes.side.mainGone")} aria-label={t("notes.side.noMain")}>
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
    const index = rows.findIndex((r) => sideKey({ kind: r.node.kind, path: r.node.path }) === p.renaming);
    if (index < 0) return;
    const top = (listRef.current?.offsetTop ?? 0) + index * rowHeight;
    if (top < nav.scrollTop || top + rowHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = top - nav.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.renaming, virtual]);
  // Esc numa linha da árvore com uma pasta escolhida volta à raiz (spec #19265); com a raiz já escolhida, ele fecha a
  // árvore, como antes. Só com o foco numa linha (o teclado): com o mouse, o Esc segue fechando a árvore, e a raiz se
  // escolhe pelo clique no topo. Na captura da janela, antes do Esc do TreePopover, que respeita o preventDefault.
  const escState = useRef({ selected: p.selectedFolder, select: p.onSelectFolder });
  escState.current = { selected: p.selectedFolder, select: p.onSelectFolder };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const nav = navRef.current;
      const { selected, select } = escState.current;
      const el = document.activeElement;
      if (e.key !== "Escape" || e.defaultPrevented || !selected || !nav || document.querySelector(ESC_LAYERS)) return;
      if (!(el instanceof HTMLElement) || !nav.contains(el) || !el.classList.contains("kn-side-item")) return;
      e.preventDefault();
      select("");
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const freshRenaming = useRef(p.renaming);
  freshRenaming.current = p.renaming;
  // A pasta nova fora da vista mesmo depois de rolar (spec #19265): o aviso diz onde ela nasceu.
  useEffect(() => {
    const nav = navRef.current;
    const path = p.fresh;
    if (!path || !nav || !p.onFreshHidden) return;
    // Depois da rolagem: na lista virtual, a linha só existe quando a janela dela é desenhada.
    const id = setTimeout(() => {
      const el = nav.querySelector<HTMLElement>("[data-fresh]");
      // Sem a linha: só conta como fora da vista se ela ainda está no renomear (a lista virtual não a desenhou). Se a
      // pessoa já deu outro nome, a linha velha sumiu porque mudou de path, não porque está fora da vista.
      if (!el && freshRenaming.current !== `f:${path}`) return;
      const box = el?.getBoundingClientRect();
      const view = nav.getBoundingClientRect();
      if (!box || box.bottom <= view.top || box.top >= view.bottom || !box.height) p.onFreshHidden?.(path);
    }, FRESH_CHECK_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fresh]);

  return (
    <nav
      ref={navRef}
      className="kn-side"
      aria-label={t("notes.title")}
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
              else {
                // Só entra se a linha seguinte é de dentro dela: numa pasta vazia, → não faz nada (revisão da T10353).
                const next = items()[items().indexOf(el) + 1];
                if (next?.dataset.path?.startsWith(`${path}/`)) next.focus();
              }
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
          if ((kind !== "note" && kind !== "folder" && kind !== "file") || path === undefined) return;
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
        placeholder={t("notes.side.goTo")}
        aria-label={t("notes.side.goTo")}
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
          title={`${t("notes.side.newNoteWhere", { where: whereLabel(p.selectedFolder, locale) })}${newNoteKey ? ` (${newNoteKey})` : ""}`}
          aria-label={t("notes.side.newNoteWhere", { where: whereLabel(p.selectedFolder, locale) })}
          onClick={() => p.onNewNote?.(p.selectedFolder)}
        >
          <TreeIcon name="note-plus" />
          <HoverLabel>{t("notes.side.note")}</HoverLabel>
        </button>
      ) : null}
      {p.onNewFolder ? (
        <button
          type="button"
          className="kn-side-new kn-expand"
          data-new="folder"
          title={t("notes.side.newFolderWhere", { where: whereLabel(p.selectedFolder, locale) })}
          aria-label={t("notes.side.newFolderWhere", { where: whereLabel(p.selectedFolder, locale) })}
          onClick={() => p.onNewFolder?.(p.selectedFolder)}
        >
          <TreeIcon name="folder-plus" />
          <HoverLabel>{t("notes.folder")}</HoverLabel>
        </button>
      ) : null}
      {p.onCollapseAll ? (
        <button type="button" className="kn-side-new kn-expand" data-all="collapse" title={t("notes.side.collapseAll")} aria-label={t("notes.side.collapseAll")} onClick={() => p.onCollapseAll?.()}>
          <TreeIcon name="collapse-all" />
          <HoverLabel>{t("notes.side.collapse")}</HoverLabel>
        </button>
      ) : null}
      {p.onExpandAll ? (
        <button type="button" className="kn-side-new kn-expand" data-all="expand" title={t("notes.side.expandAll")} aria-label={t("notes.side.expandAll")} onClick={() => p.onExpandAll?.()}>
          <TreeIcon name="expand-all" />
          <HoverLabel>{t("notes.side.expand")}</HoverLabel>
        </button>
      ) : null}
      {dragging ? (
        // A faixa "Raiz" (T19937): enquanto arrasta, presa embaixo da busca, por cima da árvore (não empurra as linhas).
        <div className="kn-side-rootdrop" data-drop={dropOn === "" || undefined} data-off={!canDrop(dragged.current, "") || undefined} {...dropZone("")}>
          <TreeIcon name="folder" />
          <span>{p.root ? t("notes.side.rootOf", { name: p.root.name }) : t("notes.side.root")}</span>
        </div>
      ) : null}
      </div>
      {!searching && p.root ? <RootFolder root={p.root} selected={p.selectedFolder === ""} onSelect={() => p.onSelectFolder("")} /> : null}
      {!searching && p.onDaily ? (
        <button type="button" className="kn-side-item kn-side-daily" onClick={() => p.onDaily?.()} title={`${t("notes.side.daily")}${dailyKey ? ` (${dailyKey})` : ""}`}>
          <TreeIcon name="today" />
          <span className="kn-side-name">{t("notes.side.today")}</span>
          {dailyKey ? <span className="kn-side-count">{dailyKey}</span> : null}
        </button>
      ) : null}
      {!searching && p.pinned.length ? (
        <>
          {head("pinned", t("notes.side.pinned"))}
          {!shut("pinned") && p.pinned.map((n) => noteItem({ path: n.path, name: n.title }, 0, `p:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {!searching && p.saved?.length && p.onSaved ? (
        <>
          {head("saved", t("notes.side.saved"))}
          {!shut("saved") && p.saved.map((s) => (
            <div key={`s:${s.query}`} className="kn-side-saved">
              <button type="button" className="kn-side-item" data-kind="search" title={s.query} onClick={(e) => !e.ctrlKey && p.onSaved?.(s.query)}>
                <TreeIcon name="search" />
                <span className="kn-side-name">{s.name}</span>
              </button>
              {p.onUnsave ? (
                <button type="button" className="kn-side-x" aria-label={t("notes.side.unsave", { name: s.name })} title={t("notes.side.unsaveTitle")} onClick={() => p.onUnsave?.(s.query)}>
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
          {head("recent", t("notes.side.recent"))}
          {!shut("recent") && p.recent.map((n) => noteItem({ path: n.path, name: n.title }, 0, `r:${n.path}`, false))}
          <div className="kn-side-gap" />
        </>
      ) : null}
      {/* Na busca, o resultado vem inteiro, mesmo com a seção Notas recolhida. */}
      {searching ? <div className="kn-side-head" data-section="notes">{t("notes.side.result")}</div> : head("notes", t("notes.title"))}
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
      {searching && !p.tree.length ? <div className="kn-side-empty">{searchTooLong(p.query) ? t("notes.searchTooLong", { max: MAX_SEARCH_QUERY }) : t("notes.side.nothing")}</div> : null}
      {!searching && p.tags?.length && p.onTag ? (
        <>
          <div className="kn-side-gap" />
          {head("tags", t("notes.side.tags"))}
          {!shut("tags") && tagItems(p.tags, 0, p.onTag, p.onTagMenu, locale)}
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
            <span className="kn-side-name">{t("notes.side.trash")}</span>
            {p.trashCount ? <span className="kn-side-count">{p.trashCount}</span> : null}
          </button>
        </>
      ) : null}
    </nav>
  );
}

/** As tags, com as filhas recuadas embaixo da mãe, e quantas notas cada uma tem. */
function tagItems(tags: TagNode[], depth: number, onTag: (tag: string) => void, onMenu: SidebarProps["onTagMenu"], locale: Locale): ReactElement[] {
  return tags.flatMap((t) => [
    <button
      type="button"
      key={`t:${t.tag}`}
      className="kn-side-item"
      data-kind="tag"
      style={{ paddingLeft: depth * 14 }}
      title={translate(locale, "notes.withTag", { tag: t.tag })}
      // ⌃-clique é o clique secundário do Mac: abre só o menu, não a busca por baixo dele (T2693, T2751).
      onClick={(e) => !e.ctrlKey && onTag(t.tag)}
      onContextMenu={onMenu ? e => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }, t.tag); } : undefined}
    >
      <TreeIcon name="tag" />
      <span className="kn-side-name">#{t.name}</span>
      <span className="kn-side-count">{t.count}</span>
    </button>,
    ...tagItems(t.children, depth + 1, onTag, onMenu, locale),
  ]);
}

/**
 * A pasta raiz no topo da árvore: o clique na linha a escolhe (spec #19265); a seta mostra, logo abaixo e dentro da
 * árvore, o "Abrir pasta…" e as recentes.
 */
function RootFolder({ root, selected, onSelect }: { root: SideRoot; selected: boolean; onSelect(): void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="kn-side-root" data-open={open || undefined}>
      {/* Spec #19265: o clique na linha só escolhe a raiz (onde o + Nota e o + Pasta criam); o "Abrir pasta…" e as
          recentes abrem só pela seta, para não abrir um menu a cada volta à raiz. */}
      <div className="kn-side-root-row">
        <button
          type="button"
          className="kn-side-root-toggle"
          aria-expanded={open}
          aria-label={t("notes.side.otherRoots")}
          title={t("notes.side.openOtherRoot")}
          onClick={() => setOpen(!open)}
        >
          <Twisty open={open} />
        </button>
        <button
          type="button"
          className="kn-side-item kn-side-root-bt"
          data-selected={selected || undefined}
          aria-label={t("notes.side.rootLabel", { name: root.name })}
          title={t("notes.side.rootTitle", { path: root.path })}
          onClick={(e) => !e.ctrlKey && onSelect()}
        >
          <TreeIcon name={open ? "folder-open" : "folder"} />
          <span className="kn-side-name">{root.name}</span>
        </button>
      </div>
      {open ? (
        <div className="kn-side-root-list" role="group" aria-label={t("notes.side.roots")}>
          <button type="button" className="kn-side-item" data-root="open" onClick={() => root.onOpen()}>
            <TreeIcon name="folder-plus" />
            <span className="kn-side-name">{t("notes.menu.openFolder")}</span>
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
  const { t } = useT();
  return kind === "folder" ? (
    <span className="kn-side-project" data-project="folder" title={t("notes.side.project")} aria-label={t("notes.side.projectLower")}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M3 13V3.5h7.5L9 6l1.5 2.5H3" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span className="kn-side-project" data-project="main" title={t("notes.side.projectMain")} aria-label={t("notes.side.projectMainLower")}>
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5Z" />
      </svg>
    </span>
  );
}
