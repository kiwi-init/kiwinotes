// O markdown do agente no balão grande do Hub (T17986, spec #17679): o mesmo montador do overlay
// (`ui/src/bubbleMarkdown.ts`, T17984), que monta os elementos um a um, sem innerHTML (#12938). O React só cuida da
// caixa (`.kn-md`); o conteúdo é o fragmento do montador, trocado a cada texto novo. O CSS é o `bubble-md.css`, comum.
//
// O link sai sem `href` (`data-href`): nada abre sozinho. Só o clique (ou o Enter nele) abre, fora do app.
// Uma nota ou um arquivo da pasta (spec #17683, `data-path`) abre no app, pelo `notes.openPath`.

import { useLayoutEffect, useRef } from "react";

import type { BubbleLink } from "../../src/shared/ui-contract";
import { api } from "../src/api";
import { renderMarkdown, safeHref } from "../src/bubbleMarkdown";

export function MdView({ text, links, className }: { text: string; links?: readonly BubbleLink[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    box.current?.replaceChildren(renderMarkdown(text, undefined, links) as unknown as Node);
  }, [text, links]);
  return <div ref={box} className={className ? `kn-md ${className}` : "kn-md"} />;
}

/** O clique num link do balão: abre no navegador padrão. Devolve se era um link. */
export function openMdLink(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target.closest(".kn-md-link") : null;
  if (!el) return false;
  const path = el.getAttribute("data-path");
  if (path) {
    // O app confere o caminho de novo (dentro da pasta, existe) antes de abrir.
    void api.notes.openPath(path).catch(() => {});
    return true;
  }
  // O montador só deixa `http(s)` e `mailto` virarem link; confere de novo antes de abrir.
  const href = safeHref(el.getAttribute("data-href") ?? "");
  if (href) window.open(href, "_blank", "noopener,noreferrer");
  return true;
}
