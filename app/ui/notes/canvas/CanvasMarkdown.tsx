// O Markdown de um nó do quadro branco (T6600): o mesmo desenho dos blocos do editor (a lib, os `[[links]]`, as #tags e
// as imagens do vault), fora do CodeMirror. Só leitura: editar o texto é no nó, com o texto cru.

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { memo, useMemo } from "react";

import { externalUrl } from "../links.ts";
import type { AttachmentSource } from "../editor/attachments.ts";
import { highlightSyntax } from "../editor/highlight.ts";
import { wikiLinkSyntax } from "../editor/index.ts";
import { fullTree, linkAction, toRenderable } from "../editor/rendered.ts";
import { RenderedBlock } from "../editor/renderedWidget.tsx";

export interface CanvasLinks {
  onOpenNote(target: string): void;
  onOpenTag?(tag: string): void;
  onOpenUrl(url: string): void;
  attachments?: AttachmentSource;
}

/** O texto como a lib desenha: os `[[links]]` e as #tags viram links do Kiwi, como num bloco do editor. */
export function renderableMarkdown(text: string): string {
  const state = EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax, highlightSyntax] })] });
  // Para onde o `[[link]]` aponta, o engine diz no clique: aqui todos aparecem como link.
  return toRenderable(text, 0, fullTree(state), () => "ok");
}

export const CanvasMarkdown = memo(function CanvasMarkdown({ text, links }: { text: string; links: CanvasLinks }) {
  const md = useMemo(() => renderableMarkdown(text), [text]);
  const callbacks = useMemo(
    () => ({
      onLinkPress: ({ url }: { url: string }) => {
        const act = linkAction(url);
        if (act?.kind === "note") links.onOpenNote(act.target);
        else if (act?.kind === "tag") links.onOpenTag?.(act.tag);
        else if (act?.kind === "url") {
          const safe = externalUrl(act.url);
          if (safe) links.onOpenUrl(safe);
        }
      },
    }),
    [links],
  );
  if (!text.trim()) return null;
  return (
    <div className="kn-canvas-md cm-rendered">
      <RenderedBlock markdown={md} source={text} callbacks={callbacks} attachments={links.attachments} onShown={() => {}} />
    </div>
  );
});
