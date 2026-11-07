// O quadro branco (T6600, E16): o `.canvas` do Obsidian (JSON Canvas 1.0) aberto no Kiwi. Cartões de texto, notas,
// imagens, links e grupos, com as setas entre eles. Arrastar move, o canto redimensiona, a bolinha do lado liga, o clique
// duplo no fundo cria um cartão, e o ⌘Z desfaz. Grava sozinho como a nota (condicional pela versão), e o que o Kiwi não
// conhece no arquivo fica como estava. Nada de rede: um nó de link é um cartão com o endereço, que só abre no clique.

import { memo, type MutableRefObject, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  addEdge,
  addNode,
  arrowHead,
  boundsOf,
  bringToFront,
  canvasColor,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  CanvasParseError,
  CANVAS_PRESET_NAMES,
  CANVAS_PRESETS,
  type CanvasSide,
  edgeGeometry,
  insideGroup,
  isDrawableEdge,
  isDrawableNode,
  nearestSide,
  newCanvasId,
  nodeAt,
  parseCanvas,
  type Point,
  removeItems,
  sidePoint,
  stringifyCanvas,
  updateEdge,
  updateNode,
} from "../../../src/shared/json-canvas.ts";
import { ContextMenu, type MenuItem } from "../ContextMenu.tsx";
import type { AttachmentFile } from "../editor/attachments.ts";
import { splitFrontmatter } from "../frontmatter.ts";
import { externalUrl } from "../links.ts";
import type { CanvasApi, CanvasFile, NotesApi } from "../types.ts";
import { CanvasMarkdown, type CanvasLinks } from "./CanvasMarkdown.tsx";
import { canvasName, noteSection } from "./names.ts";
import { fit, pan, toWorld, type Viewport, wheelFactor, zoomAt } from "./viewport.ts";
import "./canvas.css";

const SIDES: CanvasSide[] = ["top", "right", "bottom", "left"];
const MIN_W = 60;
const MIN_H = 40;
/** Quanto o ponteiro anda antes de virar arrastar (e não clique). */
const DRAG_PX = 3;
const SAVE_MS = 400;
const HISTORY = 200;

/** `idle`: nada mudou desde que abriu (o status fica vazio). */
type SaveState = "idle" | "saved" | "pending" | "saving" | "conflict" | "error";

export interface CanvasViewProps {
  api: NotesApi & { canvas: CanvasApi };
  path: string;
  /** O NotesApp chama antes de sair do quadro (abrir uma nota, criar, renomear): grava, e diz se pode sair. */
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  /** Um `[[link]]` de um cartão de texto (pelo nome, como no editor). */
  onOpenLink(target: string): void;
  /** O nó de nota: abre a nota pelo caminho. */
  onOpenNote(path: string): void;
  onOpenTag?(tag: string): void;
  /** O nó de um arquivo que não é nota nem imagem: abre no app padrão do Mac. */
  onOpenFile?(path: string): void;
  onRenamed(path: string): void;
  onError(text: string): void;
}

type Gesture =
  | { kind: "pan"; start: Point; vp: Viewport; moved: boolean }
  | { kind: "move"; start: Point; before: CanvasDoc; ids: string[]; moved: boolean }
  | { kind: "resize"; start: Point; before: CanvasDoc; id: string; w: number; h: number; moved: boolean }
  | { kind: "connect"; from: string; side: CanvasSide };

interface Handlers {
  nodeDown(e: ReactPointerEvent, node: CanvasNode): void;
  nodeDouble(node: CanvasNode): void;
  resizeDown(e: ReactPointerEvent, node: CanvasNode): void;
  connectDown(e: ReactPointerEvent, node: CanvasNode, side: CanvasSide): void;
  menu(e: React.MouseEvent, id: string): void;
  editText(id: string, text: string): void;
  stopEditing(): void;
  editLabel(id: string, label: string): void;
}

export function CanvasView({ api, path, flushRef, onOpenLink, onOpenNote, onOpenTag, onOpenFile, onRenamed, onError }: CanvasViewProps) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<CanvasFile | null>(null);
  const [vp, setVp] = useState<Viewport>({ tx: 0, ty: 0, zoom: 1 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; side: CanvasSide; to: Point } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [title, setTitle] = useState(canvasName(path));

  const board = useRef<HTMLDivElement>(null);
  const docRef = useRef<CanvasDoc | null>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const version = useRef("");
  const dirty = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflictRef = useRef<CanvasFile | null>(null);
  conflictRef.current = conflict;
  const past = useRef<CanvasDoc[]>([]);
  const future = useRef<CanvasDoc[]>([]);
  const editBefore = useRef<CanvasDoc | null>(null);
  const editingId = useRef<string | null>(null);
  /** O cartão que acabou de nascer: se sair da edição vazio (um clique duplo sem querer), some sem deixar rastro. */
  const fresh = useRef<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const fitted = useRef(false);

  // ---------------------------------------------------------------- abrir e gravar

  const load = useCallback(
    (file: CanvasFile) => {
      try {
        const d = parseCanvas(file.content);
        version.current = file.version;
        docRef.current = d;
        setDoc(d);
        setProblem(null);
      } catch (e) {
        setProblem(e instanceof CanvasParseError ? `Este quadro não abre: ${e.message}. O arquivo fica como está.` : "Este quadro não abre.");
      }
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    api.canvas.get(path).then(
      (f) => alive && load(f),
      () => alive && setProblem("Este quadro não está mais no vault."),
    );
    return () => {
      alive = false;
    };
  }, [api, path, load]);

  const save = useCallback(async (): Promise<boolean> => {
    while (saving.current) await saving.current;
    const d = docRef.current;
    if (!dirty.current || !d || conflictRef.current) return !dirty.current;
    dirty.current = false;
    setSaveState("saving");
    const run = (async () => {
      try {
        const r = await api.canvas.save(path, stringifyCanvas(d), version.current);
        if (r.saved) {
          version.current = r.version;
          setSaveState(dirty.current ? "pending" : "saved");
          return true;
        }
        dirty.current = true;
        setConflict(r.current);
        setSaveState("conflict");
        return false;
      } catch {
        dirty.current = true;
        setSaveState("error");
        return false;
      }
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, [api, path]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (conflictRef.current) return;
    setSaveState("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_MS);
  }, [save]);

  useEffect(() => {
    flushRef.current = async () => {
      clearTimeout(timer.current);
      if (conflictRef.current) return false;
      return dirty.current ? save() : true;
    };
    return () => {
      flushRef.current = null;
      clearTimeout(timer.current);
    };
  }, [flushRef, save]);

  // Mudou fora (o Obsidian, o Git): sem nada pendente aqui, o quadro recarrega. Com algo pendente, o save acha o conflito.
  useEffect(
    () =>
      api.files?.onChanged((paths) => {
        if (!paths.includes(path) || dirty.current || saving.current) return;
        void api.canvas.get(path).then(
          (f) => {
            if (f.version !== version.current && !dirty.current) load(f);
          },
          () => {},
        );
      }),
    [api, path, load],
  );

  // ---------------------------------------------------------------- mudar (com o ⌘Z)

  /** Uma mudança que entra no histórico. */
  const change = useCallback(
    (next: CanvasDoc, before: CanvasDoc | null = docRef.current) => {
      if (!before || next === before) return;
      past.current.push(before);
      if (past.current.length > HISTORY) past.current.shift();
      future.current = [];
      docRef.current = next;
      setDoc(next);
      schedule();
    },
    [schedule],
  );

  /** Uma mudança no meio de um gesto (arrastar, digitar): na tela e no save, e o histórico guarda o começo no fim. */
  const live = useCallback(
    (next: CanvasDoc) => {
      docRef.current = next;
      setDoc(next);
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(
    (redo = false) => {
      const from = redo ? future.current : past.current;
      const to = redo ? past.current : future.current;
      const prev = from.pop();
      if (!prev || !docRef.current) return;
      to.push(docRef.current);
      docRef.current = prev;
      setDoc(prev);
      setSelected((s) => new Set([...s].filter((id) => prev.nodes.some((n) => n.id === id) || prev.edges.some((e) => e.id === id))));
      schedule();
    },
    [schedule],
  );

  // ---------------------------------------------------------------- o que está à vista

  const nodes = useMemo(() => (doc?.nodes ?? []).filter(isDrawableNode), [doc]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edges = useMemo(() => {
    const ids = new Set(byId.keys());
    return (doc?.edges ?? []).filter((e) => isDrawableEdge(e, ids));
  }, [doc, byId]);

  const size = () => {
    const r = board.current?.getBoundingClientRect();
    return { width: r?.width ?? 800, height: r?.height ?? 600 };
  };
  const fitAll = useCallback(() => {
    const { width, height } = size();
    setVp(fit(boundsOf(nodes), width, height));
  }, [nodes]);

  useLayoutEffect(() => {
    if (!doc || fitted.current || !board.current) return;
    fitted.current = true;
    fitAll();
  }, [doc, fitAll]);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = board.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // A rolagem anda com o quadro; com ⌘ (ou a pinça do trackpad, que chega com ctrl), aproxima no ponto do mouse.
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.(".kn-canvas-scroll") && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setVp((v) => zoomAt(v, local(e), wheelFactor(e.deltaY, e.ctrlKey)));
      else setVp((v) => pan(v, -e.deltaX, -e.deltaY));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [doc !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Segue o ponteiro na janela inteira até soltar (o arrastar sai do quadro e volta). */
  const track = (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      onUp(e);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };

  const stopEditing = useCallback(() => {
    const id = editingId.current;
    const d = docRef.current;
    const node = id && d ? d.nodes.find((n) => n.id === id) : undefined;
    if (id && d && fresh.current === id && node?.type === "text" && !String(node.text ?? "").trim()) {
      // Some o cartão vazio, e com ele o passo de criar no ⌘Z.
      const top = past.current.at(-1);
      if (top && !top.nodes.some((n) => n.id === id)) past.current.pop();
      const next = removeItems(d, new Set([id]));
      docRef.current = next;
      setDoc(next);
      setSelected(new Set());
      schedule();
    } else if (editBefore.current && d && editBefore.current !== d) {
      past.current.push(editBefore.current);
      future.current = [];
    }
    editBefore.current = null;
    editingId.current = null;
    fresh.current = null;
    setEditing(null);
  }, [schedule]);

  const startEditing = (id: string, isNew = false) => {
    editBefore.current = docRef.current;
    editingId.current = id;
    fresh.current = isNew ? id : null;
    setSelected(new Set([id]));
    setEditing(id);
  };

  // ---------------------------------------------------------------- os gestos

  const backgroundDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (editing) stopEditing();
    board.current?.focus();
    if (!e.shiftKey) setSelected(new Set());
    const g: Gesture = { kind: "pan", start: local(e), vp: vpRef.current, moved: false };
    gesture.current = g;
    track(
      (m) => {
        const p = local(m);
        if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_PX) return;
        g.moved = true;
        setVp(pan(g.vp, p.x - g.start.x, p.y - g.start.y));
      },
      () => (gesture.current = null),
    );
  };

  const backgroundDouble = (e: React.MouseEvent) => {
    const d = docRef.current;
    if (!d) return;
    const w = toWorld(vpRef.current, local(e));
    const id = newCanvasId(d);
    change(addNode(d, { id, type: "text", text: "", x: w.x - 125, y: w.y - 30, width: 250, height: 60 }));
    startEditing(id, true);
  };

  /** Adiciona um cartão de texto no meio do que está à vista (o botão da barra). */
  const addTextHere = () => {
    const d = docRef.current;
    if (!d) return;
    const { width, height } = size();
    const w = toWorld(vpRef.current, { x: width / 2, y: height / 2 });
    const id = newCanvasId(d);
    change(addNode(d, { id, type: "text", text: "", x: w.x - 125, y: w.y - 30, width: 250, height: 60 }));
    startEditing(id, true);
  };

  const handlers = useRef<Handlers>(null as unknown as Handlers);
  handlers.current = {
    nodeDown(e, node) {
      if (e.button !== 0) return;
      const t = e.target as Element;
      if (t.closest("textarea, input, a, button, .kn-canvas-scroll-active")) return;
      e.stopPropagation();
      if (editing && editing !== node.id) stopEditing();
      board.current?.focus();
      const d = docRef.current;
      if (!d) return;
      let sel: ReadonlySet<string> = selected;
      if (e.shiftKey) {
        const next = new Set(selected);
        if (!next.delete(node.id)) next.add(node.id);
        sel = next;
      } else if (!selected.has(node.id)) sel = new Set([node.id]);
      setSelected(sel);
      // O grupo anda com o que está dentro dele.
      const ids = new Set([...sel].filter((id) => byId.has(id)));
      for (const id of [...ids]) {
        const n = byId.get(id)!;
        if (n.type === "group") for (const inner of insideGroup(nodes, n)) ids.add(inner.id);
      }
      const g: Gesture = { kind: "move", start: local(e), before: d, ids: [...ids], moved: false };
      gesture.current = g;
      track(
        (m) => {
          const p = local(m);
          if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_PX) return;
          g.moved = true;
          const dx = (p.x - g.start.x) / vpRef.current.zoom;
          const dy = (p.y - g.start.y) / vpRef.current.zoom;
          const moving = new Set(g.ids);
          live({
            ...g.before,
            nodes: g.before.nodes.map((n) => (moving.has(n.id) && isDrawableNode(n) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n)),
          });
        },
        () => {
          gesture.current = null;
          if (g.moved && docRef.current !== g.before) {
            past.current.push(g.before);
            future.current = [];
          }
        },
      );
    },
    nodeDouble(node) {
      if (node.type === "text") startEditing(node.id);
      else if (node.type === "file" && typeof node.file === "string" && /\.md$/i.test(node.file)) onOpenNote(node.file);
      else if (node.type === "group") startEditing(node.id);
    },
    resizeDown(e, node) {
      if (e.button !== 0) return;
      e.stopPropagation();
      const d = docRef.current;
      if (!d) return;
      const g: Gesture = { kind: "resize", start: local(e), before: d, id: node.id, w: node.width, h: node.height, moved: false };
      gesture.current = g;
      track(
        (m) => {
          const p = local(m);
          g.moved = true;
          const z = vpRef.current.zoom;
          live(updateNode(g.before, g.id, { width: Math.max(MIN_W, g.w + (p.x - g.start.x) / z), height: Math.max(MIN_H, g.h + (p.y - g.start.y) / z) }));
        },
        () => {
          gesture.current = null;
          if (g.moved && docRef.current !== g.before) {
            past.current.push(g.before);
            future.current = [];
          }
        },
      );
    },
    connectDown(e, node, side) {
      if (e.button !== 0) return;
      e.stopPropagation();
      gesture.current = { kind: "connect", from: node.id, side };
      setConnecting({ from: node.id, side, to: sidePoint(node, side) });
      track(
        (m) => setConnecting({ from: node.id, side, to: toWorld(vpRef.current, local(m)) }),
        (u) => {
          gesture.current = null;
          setConnecting(null);
          const d = docRef.current;
          if (!d) return;
          const w = toWorld(vpRef.current, local(u));
          const target = nodeAt(d.nodes, w);
          if (!target || target.id === node.id) return;
          const id = newCanvasId(d);
          change(addEdge(d, { id, fromNode: node.id, fromSide: side, toNode: target.id, toSide: nearestSide(target, w) }));
          setSelected(new Set([id]));
        },
      );
    },
    menu(e, id) {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(id)) setSelected(new Set([id]));
      setMenu({ x: e.clientX, y: e.clientY, id });
    },
    editText(id, text) {
      const d = docRef.current;
      if (d) live(updateNode(d, id, { text }));
    },
    stopEditing,
    editLabel(id, label) {
      const d = docRef.current;
      if (!d) return;
      if (byId.has(id)) live(updateNode(d, id, { label: label || undefined }));
      else live(updateEdge(d, id, { label: label || undefined }));
    },
  };

  const removeSelected = () => {
    const d = docRef.current;
    if (!d || !selected.size) return;
    change(removeItems(d, selected));
    setSelected(new Set());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("textarea, input")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo(e.shiftKey);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set([...nodes.map((n) => n.id), ...edges.map((x) => x.id)]));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "Escape") {
      setSelected(new Set());
    } else if (e.key === "Enter" && selected.size === 1) {
      const n = byId.get([...selected][0]!);
      if (n?.type === "text") {
        e.preventDefault();
        startEditing(n.id);
      }
    }
  };

  // ---------------------------------------------------------------- o nome do quadro

  useEffect(() => setTitle(canvasName(path)), [path]);
  const rename = async () => {
    const name = title.trim().replace(/[\\/:]/g, "-");
    if (!name || name === canvasName(path)) return setTitle(canvasName(path));
    const flush = flushRef.current;
    if (flush && !(await flush())) return setTitle(canvasName(path));
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    try {
      const r = await api.canvas.rename(path, `${dir}${name}.canvas`);
      onRenamed(r.path);
    } catch (e) {
      setTitle(canvasName(path));
      onError(/E_EXISTS/.test(String(e)) ? "Já existe um quadro com esse nome." : "Não deu para renomear o quadro.");
    }
  };

  // ---------------------------------------------------------------- o menu do botão direito

  const menuItems = (id: string): MenuItem[] => {
    const d = docRef.current;
    const node = byId.get(id);
    const edge = edges.find((x) => x.id === id);
    const current = node?.color ?? edge?.color;
    const paint = (color: string | undefined) => () => {
      if (!d) return;
      const ids = selected.has(id) ? [...selected] : [id];
      let next = d;
      for (const x of ids) next = byId.has(x) ? updateNode(next, x, { color }) : updateEdge(next, x, { color });
      change(next);
    };
    const colors: MenuItem = {
      kind: "submenu",
      label: "Cor",
      items: [
        { label: "Sem cor", checked: current === undefined, onSelect: paint(undefined) },
        ...CANVAS_PRESETS.map((c) => ({ label: CANVAS_PRESET_NAMES[c]!, checked: current === c, onSelect: paint(c) })),
      ],
    };
    const items: MenuItem[] = [];
    if (node?.type === "text") items.push({ label: "Editar o texto", onSelect: () => startEditing(id) });
    if (node?.type === "group") items.push({ label: "Renomear o grupo", onSelect: () => startEditing(id) });
    if (node?.type === "file" && typeof node.file === "string") {
      const file = node.file;
      if (/\.md$/i.test(file)) items.push({ label: "Abrir a nota", onSelect: () => onOpenNote(file) });
      else if (onOpenFile) items.push({ label: "Abrir no app padrão", onSelect: () => onOpenFile(file) });
    }
    if (node?.type === "link") {
      const url = externalUrl(String(node.url ?? ""));
      if (url) items.push({ label: "Abrir no navegador", onSelect: () => void window.open(url, "_blank", "noopener,noreferrer") });
    }
    if (edge) items.push({ label: edge.label ? "Editar o rótulo" : "Pôr um rótulo", onSelect: () => startEditing(id) });
    items.push(colors);
    if (node && node.type !== "group" && d) items.push({ label: "Trazer para a frente", onSelect: () => change(bringToFront(d, id)) });
    items.push({ kind: "separator" }, { label: "Apagar", danger: true, onSelect: removeSelected });
    return items;
  };

  // ---------------------------------------------------------------- o desenho

  const links: CanvasLinks = useMemo(
    () => ({
      onOpenNote: onOpenLink,
      onOpenTag,
      onOpenUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
      attachments: api.attachments,
    }),
    [api, onOpenLink, onOpenTag],
  );

  if (problem) {
    return (
      <div className="kn-canvas-problem" role="alert">
        {problem}
      </div>
    );
  }
  if (!doc) return <div className="kn-canvas" aria-busy="true" />;

  const groups = nodes.filter((n) => n.type === "group");
  const cards = nodes.filter((n) => n.type !== "group");
  const single = selected.size === 1 ? byId.get([...selected][0]!) : undefined;
  const grid = vp.zoom >= 0.3 ? 24 * vp.zoom : 0;
  const status = saveState === "saving" || saveState === "pending" ? "Gravando…" : saveState === "saved" ? "Gravado" : "";

  return (
    <div className="kn-canvas-wrap">
      <div className="kn-canvas-head">
        <input
          className="kn-canvas-title"
          aria-label="Nome do quadro"
          value={title}
          size={Math.max(6, title.length + 1)}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(canvasName(path));
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
        />
        <span className="kn-canvas-status" aria-live="polite">
          {status}
        </span>
      </div>
      {conflict ? (
        <div className="kn-conflict kn-canvas-alert" role="alert">
          O quadro mudou fora do Kiwi Notes enquanto você editava.
          <span className="kn-conflict-actions">
            <button
              type="button"
              className="kn-bt"
              onClick={() => {
                const c = conflict;
                setConflict(null);
                conflictRef.current = null;
                dirty.current = false;
                past.current = [];
                future.current = [];
                load(c);
                setSaveState("saved");
              }}
            >
              Usar o de fora
            </button>
            <button
              type="button"
              className="kn-bt kn-bt-acc"
              onClick={() => {
                version.current = conflict.version;
                setConflict(null);
                conflictRef.current = null;
                dirty.current = true;
                void save();
              }}
            >
              Manter o meu
            </button>
          </span>
        </div>
      ) : saveState === "error" ? (
        <div className="kn-conflict kn-canvas-alert kn-save-alert" role="alert">
          Não deu para gravar o quadro.
          <span className="kn-conflict-actions">
            <button type="button" className="kn-bt kn-bt-acc" onClick={() => void save()}>
              Tentar de novo
            </button>
          </span>
        </div>
      ) : null}
      <div
        ref={board}
        className="kn-canvas"
        tabIndex={0}
        role="application"
        aria-label={`Quadro ${canvasName(path)}`}
        style={grid ? { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${vp.tx}px ${vp.ty}px` } : { backgroundImage: "none" }}
        onPointerDown={backgroundDown}
        onDoubleClick={(e) => {
          if (e.target === board.current || (e.target as Element).classList.contains("kn-canvas-world")) backgroundDouble(e);
        }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="kn-canvas-world" style={{ transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.zoom})` }}>
          {groups.map((n) => (
            <NodeBox key={n.id} node={n} selected={selected.has(n.id)} editing={editing === n.id} handlers={handlers} api={api} links={links} />
          ))}
          <svg className="kn-canvas-edges" width="1" height="1" overflow="visible" aria-hidden="true">
            {edges.map((x) => (
              <EdgePath key={x.id} edge={x} from={byId.get(x.fromNode)!} to={byId.get(x.toNode)!} selected={selected.has(x.id)} onDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                board.current?.focus();
                setSelected(e.shiftKey ? new Set([...selected, x.id]) : new Set([x.id]));
              }} onDouble={() => startEditing(x.id)} onMenu={(e) => handlers.current.menu(e, x.id)} />
            ))}
            {connecting && byId.get(connecting.from) ? (
              <path className="kn-canvas-connecting" d={`M ${sidePoint(byId.get(connecting.from)!, connecting.side).x} ${sidePoint(byId.get(connecting.from)!, connecting.side).y} L ${connecting.to.x} ${connecting.to.y}`} />
            ) : null}
          </svg>
          {edges.map((x) => {
            if (!x.label && editing !== x.id) return null;
            const g = edgeGeometry(byId.get(x.fromNode)!, byId.get(x.toNode)!, x.fromSide, x.toSide);
            return editing === x.id ? (
              <input
                key={`label-${x.id}`}
                className="kn-canvas-edge-label kn-canvas-edge-input"
                style={{ left: g.middle.x, top: g.middle.y }}
                autoFocus
                defaultValue={x.label ?? ""}
                aria-label="Rótulo da seta"
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => handlers.current.editLabel(x.id, e.target.value)}
                onBlur={stopEditing}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && backToBoard(e)}
              />
            ) : (
              <div
                key={`label-${x.id}`}
                className={`kn-canvas-edge-label${selected.has(x.id) ? " is-selected" : ""}`}
                style={{ left: g.middle.x, top: g.middle.y }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected(new Set([x.id]));
                }}
                onDoubleClick={() => startEditing(x.id)}
                onContextMenu={(e) => handlers.current.menu(e, x.id)}
              >
                {x.label}
              </div>
            );
          })}
          {cards.map((n) => (
            <NodeBox key={n.id} node={n} selected={selected.has(n.id)} editing={editing === n.id} handlers={handlers} api={api} links={links} />
          ))}
          {single && !editing ? <Handles node={single} handlers={handlers} zoom={vp.zoom} /> : null}
        </div>
        {!nodes.length ? <div className="kn-canvas-empty">Clique duas vezes no quadro para escrever um cartão.</div> : null}
      </div>
      <div className="kn-canvas-bar" role="toolbar" aria-label="Quadro">
        <button type="button" className="kn-bt" onClick={addTextHere} title="Um cartão de texto no meio da tela">
          + Cartão
        </button>
        <span className="kn-canvas-bar-sep" />
        <button type="button" className="kn-bt" aria-label="Afastar" onClick={() => setVp((v) => zoomAt(v, { x: size().width / 2, y: size().height / 2 }, 1 / 1.25))}>
          −
        </button>
        <button type="button" className="kn-bt kn-canvas-zoom" title="Voltar a 100%" onClick={() => setVp((v) => zoomAt(v, { x: size().width / 2, y: size().height / 2 }, 1 / v.zoom))}>
          {Math.round(vp.zoom * 100)}%
        </button>
        <button type="button" className="kn-bt" aria-label="Aproximar" onClick={() => setVp((v) => zoomAt(v, { x: size().width / 2, y: size().height / 2 }, 1.25))}>
          +
        </button>
        <span className="kn-canvas-bar-sep" />
        <button type="button" className="kn-bt" onClick={fitAll} title="Mostrar o quadro inteiro">
          Enquadrar
        </button>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} onRestoreFocus={() => board.current?.focus()} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- as peças

/** Sai do campo de um cartão ou de uma seta de volta para o quadro (o blur do campo termina a edição). */
const backToBoard = (e: { target: EventTarget }) => (e.target as HTMLElement).closest<HTMLElement>(".kn-canvas")?.focus();

const colorStyle = (color: unknown): React.CSSProperties | undefined => {
  const c = canvasColor(color);
  return c ? ({ "--node-color": c } as React.CSSProperties) : undefined;
};

const NodeBox = memo(function NodeBox({ node, selected, editing, handlers, api, links }: {
  node: CanvasNode;
  selected: boolean;
  editing: boolean;
  handlers: MutableRefObject<Handlers>;
  api: NotesApi;
  links: CanvasLinks;
}) {
  const cls = `kn-canvas-node kn-canvas-type-${["text", "file", "link", "group"].includes(node.type) ? node.type : "other"}${selected ? " is-selected" : ""}${canvasColor(node.color) ? " has-color" : ""}`;
  const style: React.CSSProperties = { left: node.x, top: node.y, width: node.width, height: node.height, ...colorStyle(node.color) };
  const common = {
    "data-id": node.id,
    onPointerDown: (e: ReactPointerEvent) => handlers.current.nodeDown(e, node),
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      handlers.current.nodeDouble(node);
    },
    onContextMenu: (e: React.MouseEvent) => handlers.current.menu(e, node.id),
  };
  if (node.type === "group") {
    return (
      <div className={cls} style={style} {...common}>
        {editing ? (
          <input
            className="kn-canvas-group-label kn-canvas-group-input"
            autoFocus
            defaultValue={node.label ?? ""}
            aria-label="Nome do grupo"
            onChange={(e) => handlers.current.editLabel(node.id, e.target.value)}
            onBlur={() => handlers.current.stopEditing()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && backToBoard(e)}
          />
        ) : node.label ? (
          <div className="kn-canvas-group-label">{node.label}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cls} style={style} {...common}>
      {node.type === "text" ? (
        editing ? (
          <textarea
            className="kn-canvas-textarea"
            autoFocus
            defaultValue={node.text ?? ""}
            aria-label="Texto do cartão"
            spellCheck
            onChange={(e) => handlers.current.editText(node.id, e.target.value)}
            onBlur={() => handlers.current.stopEditing()}
            onKeyDown={(e) => {
              if (e.key === "Escape") backToBoard(e);
            }}
          />
        ) : (
          <div className="kn-canvas-scroll">
            <CanvasMarkdown text={node.text ?? ""} links={links} />
          </div>
        )
      ) : node.type === "file" ? (
        <FileBody node={node} api={api} links={links} />
      ) : node.type === "link" ? (
        <LinkBody url={String(node.url ?? "")} />
      ) : (
        <div className="kn-canvas-other">O Kiwi ainda não desenha este tipo de nó ({node.type}). Ele fica no arquivo como está.</div>
      )}
    </div>
  );
});

const IMAGE = /\.(png|jpe?g|gif|webp|heic|svg)$/i;

function FileBody({ node, api, links }: { node: CanvasNode; api: NotesApi; links: CanvasLinks }) {
  const file = typeof node.file === "string" ? node.file : "";
  const note = /\.md$/i.test(file);
  const image = IMAGE.test(file);
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [img, setImg] = useState<AttachmentFile | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (note) api.get(file).then((n) => alive && setContent(noteSection(splitFrontmatter(n.content).body, node.subpath)), () => alive && setContent(null));
    else if (image && api.attachments) api.attachments.read(file).then((f) => alive && setImg(f), () => alive && setImg(null));
    return () => {
      alive = false;
    };
  }, [api, file, note, image, node.subpath]);
  const name = file.split("/").at(-1) ?? file;
  if (image) {
    if (img === undefined) return <div className="kn-canvas-file-name">{name}</div>;
    if (img === null) return <div className="kn-canvas-missing">{name} não está no vault</div>;
    return <img className="kn-canvas-image" src={img.dataUrl} alt={name} draggable={false} />;
  }
  if (!note) {
    return (
      <div className="kn-canvas-file">
        <span className="kn-canvas-file-name">{name}</span>
        <span className="kn-canvas-file-kind">{name.split(".").at(-1)?.toUpperCase()}</span>
      </div>
    );
  }
  return (
    <>
      <div className="kn-canvas-file-head">
        {name.replace(/\.md$/i, "")}
        {node.subpath ? <span className="kn-canvas-subpath">{node.subpath}</span> : null}
      </div>
      {content === null ? (
        <div className="kn-canvas-missing">Esta nota não está no vault.</div>
      ) : (
        <div className="kn-canvas-scroll">{content ? <CanvasMarkdown text={content} links={links} /> : null}</div>
      )}
    </>
  );
}

function LinkBody({ url }: { url: string }) {
  const safe = externalUrl(url);
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    /* fica o texto */
  }
  return (
    <div className="kn-canvas-link">
      <span className="kn-canvas-link-host">{host}</span>
      <span className="kn-canvas-link-url">{url}</span>
      {safe ? (
        <button type="button" className="kn-bt kn-canvas-link-open" onClick={() => void window.open(safe, "_blank", "noopener,noreferrer")}>
          Abrir no navegador
        </button>
      ) : null}
    </div>
  );
}

function EdgePath({ edge, from, to, selected, onDown, onDouble, onMenu }: {
  edge: CanvasEdge;
  from: CanvasNode;
  to: CanvasNode;
  selected: boolean;
  onDown(e: ReactPointerEvent): void;
  onDouble(): void;
  onMenu(e: React.MouseEvent): void;
}) {
  const g = edgeGeometry(from, to, edge.fromSide, edge.toSide);
  const color = canvasColor(edge.color) ?? "var(--kn-canvas-edge)";
  return (
    <g className={`kn-canvas-edge${selected ? " is-selected" : ""}`} style={{ "--edge-color": color } as React.CSSProperties} data-id={edge.id}>
      <path className="kn-canvas-edge-hit" d={g.path} onPointerDown={onDown} onDoubleClick={(e) => {
        e.stopPropagation();
        onDouble();
      }} onContextMenu={onMenu} />
      <path className="kn-canvas-edge-line" d={g.path} />
      {edge.toEnd !== "none" ? <polygon className="kn-canvas-edge-arrow" points={arrowHead(g.to, g.toSide)} /> : null}
      {edge.fromEnd === "arrow" ? <polygon className="kn-canvas-edge-arrow" points={arrowHead(g.from, g.fromSide)} /> : null}
    </g>
  );
}

function Handles({ node, handlers, zoom }: { node: CanvasNode; handlers: MutableRefObject<Handlers>; zoom: number }) {
  // As alças ficam do mesmo tamanho na tela, com qualquer zoom.
  const s = 1 / zoom;
  return (
    <>
      {SIDES.map((side) => {
        const p = sidePoint(node, side);
        return (
          <div
            key={side}
            className="kn-canvas-port"
            data-side={side}
            title="Arraste até outro cartão para ligar"
            style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${s})` }}
            onPointerDown={(e) => handlers.current.connectDown(e, node, side)}
          />
        );
      })}
      <div
        className="kn-canvas-resize"
        title="Arraste para mudar o tamanho"
        style={{ left: node.x + node.width, top: node.y + node.height, transform: `translate(-50%, -50%) scale(${s})` }}
        onPointerDown={(e) => handlers.current.resizeDown(e, node)}
      />
    </>
  );
}
