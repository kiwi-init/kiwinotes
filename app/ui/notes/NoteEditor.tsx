// O CodeMirror dentro do React: um EditorView por janela, e um estado novo a cada nota aberta (o desfazer não atravessa
// de uma nota para outra). O texto que chega de fora (a nota recarregada) troca o estado; o que a pessoa digita só sobe.

import { EditorSelection, type Extension, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { headingFor, markdownStructure } from "../../src/shared/markdown-structure.ts";
import { moveSection } from "./editor/section-move.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api as appApi, has } from "../src/api.ts";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import { editorMenu } from "./editor/context-menu.ts";
import { splitNote } from "./editor/tools.ts";
import { spellingAt, spellingForMenu, spellingMenu } from "./editor/spelling.ts";
import { isSpellingLanguage } from "../../src/shared/spelling.ts";

import { lineChanges } from "../../src/shared/merge3.ts";

import type { AttachmentSource } from "./editor/attachments.ts";
import { focusCompartment, focusExtension, typewriterCompartment, typewriterExtension } from "./editor/focus.ts";
import { editorExtensions, type LinkCache, type LinkTarget, stateFor,
} from "./editor/index.ts";

const externalUpdates = new WeakSet<EditorView>();

export interface NoteEditorProps {
  /** Muda quando outra nota abre, ou quando a mesma nota é recarregada do disco. */
  docKey: string;
  headingJump: { heading: string; sequence: number } | null;
  doc: string;
  links: LinkCache;
  onChange(doc: string): void;
  onOpenLink(target: string): void;
  /** Clique numa `#tag` (T2619). */
  onOpenTag?(tag: string): void;
  /** "/modelo" (T2660). */
  onSlashTemplate?(): void;
  linkTargets(): LinkTarget[];
  headingContent(target: string): Promise<string | null>;
  /** Os anexos (T2594); sem eles, colar e arrastar arquivo não faz nada de especial. Fixo durante a vida da janela. */
  attachments?: AttachmentSource;
  onError?(text: string): void;
  createSplit?(tail: string): Promise<string>;
  onSplitDone?(path: string): void;
  onRenameHeading?(offset: number, title: string, source: string): void;
  /** O modo foco e a máquina de escrever (T6385, E13). */
  focus?: boolean;
  typewriter?: boolean;
  /** Os dois no menu do botão direito, com o atalho de agora. */
  viewModes?: { focusKey?: string; typewriterKey?: string; toggleFocus(): void; toggleTypewriter(): void };
}

export function NoteEditor({ docKey, headingJump, doc, links, onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, headingContent, attachments, onError, createSplit, onSplitDone, onRenameHeading,
  focus = false, typewriter = false, viewModes,
}: NoteEditorProps) {
  const modes = useRef({ focus, typewriter });
  modes.current = { focus, typewriter };
  const withModes = (base: Extension[]): Extension[] => [
    ...base,
    focusCompartment.of(focusExtension(modes.current.focus)),
    typewriterCompartment.of(typewriterExtension(modes.current.typewriter)),
  ];
  const host = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [editorDoc, setEditorDoc] = useState(doc);
  const view = useRef<EditorView | null>(null);
  const spellingRequest = useRef(0);
  const splitting = useRef(false);
  // Os callbacks mudam a cada render; o editor chama sempre os de agora.
  const latest = useRef({ onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, headingContent, onError, createSplit, onSplitDone, onRenameHeading,
  });
  latest.current = { onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, headingContent, onError, createSplit, onSplitDone, onRenameHeading,
  };
  const modeMenu = useRef({ focus, typewriter, viewModes });
  modeMenu.current = { focus, typewriter, viewModes };

  const extensions = useRef(
    editorExtensions(
      {
        onChange: (d) => {
          setEditorDoc(d);
          if (!view.current || !externalUpdates.has(view.current))
            latest.current.onChange(d);
        },
        onOpenLink: (t) => latest.current.onOpenLink(t),
        onOpenTag: (t) => latest.current.onOpenTag?.(t),
        onSlashTemplate: () => latest.current.onSlashTemplate?.(),
        // Abre fora (no navegador padrão), com a política `newWindow: "external"` da janela; nunca navega a janela.
        onOpenUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
        linkTargets: () => latest.current.linkTargets(),
        headingContent: (target) => latest.current.headingContent(target),
        ...(attachments ? { attachments, onError: (t: string) => latest.current.onError?.(t) } : {}),
        ...(has("clipboard.write") ? { copy: (text: string) => appApi.copy(text) } : {}),
      },
      links,
    ),
  );

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: stateFor(doc, withModes(extensions.current)),
    });
    view.current = v;
    const detach = links.attach(v);
    // Quem rola é a coluna da nota (o título e a meta rolam junto), não o editor. Sem avisar o editor, a medida das
    // linhas fica velha numa nota longa e o clique cai na linha de baixo.
    const scroller = host.current!.closest(".kn-center");
    const remeasure = () => v.requestMeasure();
    scroller?.addEventListener("scroll", remeasure, { passive: true });
    return () => {
      scroller?.removeEventListener("scroll", remeasure);
      detach();
      spellingRequest.current++;
      v.destroy();
      view.current = null;
    };
    // Um editor só por janela; as notas trocam o estado (abaixo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    spellingRequest.current++;
    setMenu(null);
    setEditorDoc(doc);
    const v = view.current;
    if (!v) return;
    v.setState(stateFor(doc, withModes(extensions.current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({
      effects: [focusCompartment.reconfigure(focusExtension(focus)), typewriterCompartment.reconfigure(typewriterExtension(typewriter))],
    });
    if (typewriter) v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) });
  }, [focus, typewriter]);

  useEffect(() => {
    const v = view.current;
    if (!v || !headingJump) return;
    const heading = headingFor(markdownStructure(v.state.doc.toString()).headings, headingJump.heading);
    if (!heading) return;
    v.dispatch({ selection: { anchor: heading.from }, effects: EditorView.scrollIntoView(heading.from, { y: "center" }) });
    v.focus();
  }, [headingJump, docKey]);

  useEffect(() => {
    const cancelPending = () => { spellingRequest.current++; };
    addEventListener("mousedown", cancelPending, true);
    addEventListener("keydown", cancelPending, true);
    addEventListener("blur", cancelPending);
    return () => { removeEventListener("mousedown", cancelPending, true); removeEventListener("keydown", cancelPending, true); removeEventListener("blur", cancelPending); };
  }, []);

  const openMenu = async (x: number, y: number, moveCursor: boolean, tablePos?: number) => {
    const v = view.current;
    if (!v) return;
    let spellingPos: number | null = v.state.selection.main.head;
    if (moveCursor) {
      const pos = tablePos !== undefined && Number.isInteger(tablePos) && tablePos >= 0 && tablePos <= v.state.doc.length
        ? tablePos : v.posAtCoords({ x, y });
      spellingPos = pos;
      if (pos !== null && !v.state.selection.ranges.some((range) => pos >= range.from && pos <= range.to))
        v.dispatch({ selection: EditorSelection.cursor(pos) });
    }
    const request = ++spellingRequest.current;
    const snapshot = v.state.doc;
    const target = spellingPos === null ? null : spellingAt(v.state, spellingPos);
    let spellingItems: MenuItem[] = [];
    if (target && has("spelling.suggest")) {
      const lang = v.contentDOM.lang || document.documentElement.lang;
      const result = await spellingForMenu(target.word, () => appApi.spelling.suggest(target.word, isSpellingLanguage(lang) ? lang : undefined));
      if (request !== spellingRequest.current || !v.dom.isConnected || v.state.doc !== snapshot) return;
      spellingItems = spellingMenu(v, target, result);
    }
    if (request !== spellingRequest.current || !v.dom.isConnected || v.state.doc !== snapshot) return;
    setMenu({ x, y, items: [...spellingItems, ...editorMenu(v, {
      ...(has("clipboard.write") ? { write: (text: string) => appApi.copy(text) } : {}),
      ...(has("clipboard.read") ? { read: () => appApi.readClipboard() } : {}),
    }, (message) => latest.current.onError?.(message), latest.current.createSplit ? () => {
      if (splitting.current) return;
      splitting.current = true;
      void splitNote(v, tail => latest.current.createSplit!(tail)).then(result => {
        if (!result) return;
        if (result.moved) latest.current.onSplitDone?.(result.path);
        else latest.current.onError?.(`A nota mudou. A continuação foi copiada para ${result.path}; o original foi mantido.`);
      }).catch(() => latest.current.onError?.("Não foi possível criar a continuação. O texto original foi mantido."))
        .finally(() => { splitting.current = false; });
    } : undefined, latest.current.onRenameHeading), ...viewModeItems()] });
  };
  const viewModeItems = (): MenuItem[] => {
    const m = modeMenu.current;
    if (!m.viewModes) return [];
    const { toggleFocus, toggleTypewriter, focusKey, typewriterKey } = m.viewModes;
    return [
      { kind: "separator" },
      { label: "Modo foco", hint: focusKey, checked: m.focus, onSelect: toggleFocus },
      { label: "Máquina de escrever", hint: typewriterKey, checked: m.typewriter, onSelect: toggleTypewriter },
    ];
  };
  const headings = useMemo(() => markdownStructure(editorDoc).headings, [editorDoc]);
  const goToHeading = (offset: number) => {
    const v = view.current;
    if (!v || offset > v.state.doc.length) return;
    v.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "center" }) });
    v.focus();
  };
  const reorder = (offset: number, direction: "up" | "down") => {
    const v = view.current;
    if (!v || v.state.doc.toString() !== editorDoc) return;
    const next = moveSection(editorDoc, offset, direction);
    if (next === editorDoc) return;
    v.dispatch({ changes: lineChanges(editorDoc, next), annotations: isolateHistory.of("full"), userEvent: "input.move" });
  };
  return <>
    {headings.length ? <details className="kn-outline">
      <summary>Sumário</summary>
      <ol>{headings.map((heading) => <li key={heading.from} style={{ paddingInlineStart: `${(heading.level - 1) * 12}px` }}>
        <button type="button" className="kn-outline-title" onClick={() => goToHeading(heading.from)}>{heading.title || "Sem título"}</button>
        <button type="button" aria-label={`Mover ${heading.title} para cima`} onClick={() => reorder(heading.from, "up")}>↑</button>
        <button type="button" aria-label={`Mover ${heading.title} para baixo`} onClick={() => reorder(heading.from, "down")}>↓</button>
      </li>)}</ol>
    </details> : null}
    <div className="kn-note-editor" ref={host} data-context-menu-open={menu ? true : undefined}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        const cell = (e.target as Element).closest<HTMLElement>("[data-kiwi-table-pos]");
        openMenu(e.clientX, e.clientY, true, cell ? Number(cell.dataset.kiwiTablePos) : undefined);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
        e.preventDefault(); e.stopPropagation();
        const v = view.current, at = v?.coordsAtPos(v.state.selection.main.head);
        if (at) openMenu(at.left, at.bottom, false);
      }} />
    {menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} onRestoreFocus={() => view.current?.focus()} /> : null}
  </>;
}

/** Põe o foco no editor da janela (depois de criar uma nota, por exemplo). */
export function focusEditor(): void {
  (document.querySelector(".kn-note-editor .cm-content") as HTMLElement | null)?.focus();
}

/**
 * O texto de fora do editor (o `/modelo`) entra onde o cursor dele ficou, como o ditado. Com um espaço antes se ele colaria
 * numa palavra. `false` quando não há nota aberta.
 */
export function insertIntoEditor(text: string): boolean {
  const dom = document.querySelector<HTMLElement>(".kn-note-editor .cm-editor");
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view || !text.trim()) return false;
  const at = view.state.selection.main;
  const before = view.state.sliceDoc(Math.max(0, at.from - 1), at.from);
  const insert = joinInsert(before, text.trim());
  view.dispatch({
    changes: { from: at.from, to: at.to, insert },
    selection: { anchor: at.from + insert.length },
    scrollIntoView: true,
    userEvent: "input.type",
  });
  return true;
}

/** O que entra depois de `before` (o caractere antes do cursor): um espaço quando colaria numa palavra. */
export function joinInsert(before: string, text: string): string {
  return before && !/\s/.test(before) ? ` ${text}` : text;
}

/** Aplica a escrita da reunião ou um merge (T5454) sem trocar o estado do editor, o cursor, a rolagem nem o desfazer. */
export function updateEditorDocument(next: string): void {
  const dom = document.querySelector<HTMLElement>(".kn-note-editor .cm-editor");
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) return;
  const before = view.state.doc.toString();
  if (before === next) return;
  externalUpdates.add(view);
  try {
    // Linha a linha (T5454): um merge muda o topo e o fim, e o cursor no meio, onde a pessoa escreve, não pula.
    view.dispatch({
      changes: lineChanges(before, next),
      annotations: Transaction.addToHistory.of(false),
    });
  } finally {
    externalUpdates.delete(view);
  }
}
