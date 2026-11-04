// O CodeMirror dentro do React: um EditorView por janela, e um estado novo a cada nota aberta (o desfazer não atravessa
// de uma nota para outra). O texto que chega de fora (a nota recarregada) troca o estado; o que a pessoa digita só sobe.

import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { AttachmentSource } from "./editor/attachments.ts";
import { editorExtensions, type LinkCache, type LinkTarget, stateFor } from "./editor/index.ts";

export interface NoteEditorProps {
  /** Muda quando outra nota abre, ou quando a mesma nota é recarregada do disco. */
  docKey: string;
  doc: string;
  links: LinkCache;
  onChange(doc: string): void;
  onOpenLink(target: string): void;
  /** Clique numa `#tag` (T2619). */
  onOpenTag?(tag: string): void;
  /** "/modelo" (T2660). */
  onSlashTemplate?(): void;
  linkTargets(): LinkTarget[];
  /** Os anexos (T2594); sem eles, colar e arrastar arquivo não faz nada de especial. Fixo durante a vida da janela. */
  attachments?: AttachmentSource;
  onError?(text: string): void;
}

export function NoteEditor({ docKey, doc, links, onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, attachments, onError }: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Os callbacks mudam a cada render; o editor chama sempre os de agora.
  const latest = useRef({ onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, onError });
  latest.current = { onChange, onOpenLink, onOpenTag, onSlashTemplate, linkTargets, onError };

  const extensions = useRef(
    editorExtensions(
      {
        onChange: (d) => latest.current.onChange(d),
        onOpenLink: (t) => latest.current.onOpenLink(t),
        onOpenTag: (t) => latest.current.onOpenTag?.(t),
        onSlashTemplate: () => latest.current.onSlashTemplate?.(),
        // Abre fora (no navegador padrão), com a política `newWindow: "external"` da janela; nunca navega a janela.
        onOpenUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
        linkTargets: () => latest.current.linkTargets(),
        ...(attachments ? { attachments, onError: (t: string) => latest.current.onError?.(t) } : {}),
      },
      links,
    ),
  );

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: stateFor(doc, extensions.current) });
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
      v.destroy();
      view.current = null;
    };
    // Um editor só por janela; as notas trocam o estado (abaixo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === doc) return;
    v.setState(stateFor(doc, extensions.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  return <div className="kn-note-editor" ref={host} />;
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
