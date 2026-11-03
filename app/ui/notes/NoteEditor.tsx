// O CodeMirror dentro do React: um EditorView por janela, e um estado novo a cada nota aberta (o desfazer não atravessa
// de uma nota para outra). O texto que chega de fora (a nota recarregada) troca o estado; o que a pessoa digita só sobe.

import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { editorExtensions, type LinkCache, type LinkTarget, stateFor } from "./editor/index.ts";

export interface NoteEditorProps {
  /** Muda quando outra nota abre, ou quando a mesma nota é recarregada do disco. */
  docKey: string;
  doc: string;
  links: LinkCache;
  onChange(doc: string): void;
  onOpenLink(target: string): void;
  linkTargets(): LinkTarget[];
}

export function NoteEditor({ docKey, doc, links, onChange, onOpenLink, linkTargets }: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Os callbacks mudam a cada render; o editor chama sempre os de agora.
  const latest = useRef({ onChange, onOpenLink, linkTargets });
  latest.current = { onChange, onOpenLink, linkTargets };

  const extensions = useRef(
    editorExtensions(
      {
        onChange: (d) => latest.current.onChange(d),
        onOpenLink: (t) => latest.current.onOpenLink(t),
        // Abre fora (no navegador padrão), com a política `newWindow: "external"` da janela; nunca navega a janela.
        onOpenUrl: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
        linkTargets: () => latest.current.linkTargets(),
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
