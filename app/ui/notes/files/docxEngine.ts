// O motor do docx nas Notas (T21151, spec #21080): o @docx-editor.dev/core (Apache-2.0), só leitura, com as páginas
// como no Word. Este arquivo é o único que o importa, e o `DocxViewer` o carrega só quando um docx abre: o motor e o
// CSS dele ficam num pedaço à parte do pack. Nada vai à rede: as fontes são as do Mac, pelo canvas.

import "@docx-editor.dev/core/styles/editor.css";

import { mountPaginatedSurface, type PaginatedSurface } from "@docx-editor.dev/core/editor";
import { forEachSemanticSpan, keyedRangeRects, type SemanticLayout, tryCreateCanvasMeasurer } from "@docx-editor.dev/core/layout";

import type { DocxMatch, DocxPiece } from "./docxFind.ts";
import { wordMeasurer } from "./docxMetrics.ts";

declare global {
  interface Window {
    /** Quantos documentos o motor tem abertos nesta janela (#22186): a prova de que fechar solta o motor. */
    __kiwiDocxLive?: number;
  }
}

/** Pontos para pixels do CSS, como o Word a 100%. */
export const PT_TO_PX = 96 / 72;

export interface DocxHandle {
  pages(): number;
  /** Os pedaços de texto do corpo, para o ⌘F. */
  pieces(): DocxPiece[];
  /** O zoom (1 = 100%). Devolve `false` se o motor não aceitou. */
  setZoom(zoom: number): boolean;
  /** Marca os achados; o `current` com a outra cor. */
  mark(matches: DocxMatch[], current: number): void;
  /** Rola até o achado, só se ele não está à vista. */
  reveal(match: DocxMatch): void;
  /** Rola até o alto de uma página (a primeira é 0). */
  revealPage(index: number): void;
  /** Solta o motor e o documento (#22186): a memória volta ao fechar o arquivo. */
  destroy(): void;
}

export type MountResult = { ok: true; handle: DocxHandle } | { ok: false; reason: string };

interface Options {
  zoom: number;
  /** Um clique num link de fora: quem abre é o visualizador, depois de conferir o endereço. */
  onLink(href: string): void;
}

/** O `setScale` da superfície: o mesmo que o `setZoom` do editor do motor usa, fora dos tipos públicos. */
type Scalable = PaginatedSurface & { setScale?: (scale: number) => boolean };

export function mountDocx(host: HTMLElement, bytes: Uint8Array, { zoom, onLink }: Options): MountResult {
  const context = host.ownerDocument.createElement("canvas").getContext("2d");
  const base = context ? tryCreateCanvasMeasurer({ context, scale: PT_TO_PX }) : null;
  const r = mountPaginatedSurface(host, bytes, {
    editingMode: "view",
    scale: zoom * PT_TO_PX,
    ...(base ? { measurer: wordMeasurer(base), producer: "kiwi-word-lines" } : {}),
    onHyperlinkPopover: ({ link }) => {
      // Um link de dentro do documento (um sumário, "veja a seção 3") o motor rola sozinho até o marcador.
      if (link.kind === "external" && link.href) onLink(link.href);
    },
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  let surface: Scalable | null = r.surface;
  const win = host.ownerDocument.defaultView;
  if (win) win.__kiwiDocxLive = (win.__kiwiDocxLive ?? 0) + 1;
  let marks: { matches: DocxMatch[]; current: number } = { matches: [], current: -1 };

  surface.setHighlightPainter((frame) => {
    const { layer, layout, scale } = frame;
    if (!marks.matches.length) {
      if (layer.childElementCount) layer.replaceChildren();
      return;
    }
    const ranges = marks.matches.map((m, i) => ({ key: String(i), from: { paragraphId: m.paragraphId, offset: m.from }, to: { paragraphId: m.paragraphId, offset: m.to } }));
    const rects = keyedRangeRects(layout, ranges, frame.pages, frame.measurer);
    const doc = layer.ownerDocument;
    const els: HTMLElement[] = [];
    for (const [key, list] of rects) {
      for (const rect of list) {
        const page = layout.pages[rect.pageIndex];
        if (!page) continue;
        const dx = frame.pageOffsetX?.get(rect.pageIndex) ?? 0;
        const el = doc.createElement("div");
        el.className = "kn-file-docx-mark";
        if (Number(key) === marks.current) el.dataset.current = "";
        el.style.left = `${(page.contentBox.x + rect.x + dx) * scale}px`;
        el.style.top = `${(page.contentBox.y + rect.y) * scale}px`;
        el.style.width = `${rect.width * scale}px`;
        el.style.height = `${rect.height * scale}px`;
        els.push(el);
      }
    }
    layer.replaceChildren(...els);
  });

  const handle: DocxHandle = {
    pages: () => surface?.layout().pages.length ?? 0,
    pieces: () => (surface ? bodyPieces(surface.layout()) : []),
    setZoom: (z) => surface?.setScale?.(z * PT_TO_PX) ?? false,
    mark(matches, current) {
      marks = { matches, current };
      surface?.repaintHighlights();
    },
    reveal(m) {
      surface?.revealPosition({ paragraphId: m.paragraphId, offset: m.from }, { block: "centerIfNeeded" });
    },
    revealPage(index) {
      surface?.revealPage(index, { block: "start", offsetPx: 0 });
    },
    destroy() {
      if (!surface) return;
      surface.setHighlightPainter(null);
      surface.destroy();
      surface = null;
      if (win) win.__kiwiDocxLive = Math.max(0, (win.__kiwiDocxLive ?? 1) - 1);
      marks = { matches: [], current: -1 };
      host.replaceChildren();
    },
  };
  return { ok: true, handle };
}

/** Os pedaços do corpo do documento (sem cabeçalho, rodapé e notas, que o motor ainda não marca), na ordem da página. */
function bodyPieces(layout: SemanticLayout): DocxPiece[] {
  const out: DocxPiece[] = [];
  forEachSemanticSpan(layout, (v) => {
    if (v.rootStory !== "body" || v.story !== "body") return;
    const { range, text } = v.span;
    out.push({ paragraphId: range.paragraphId, start: range.start, end: range.end, text, page: v.page.index });
  });
  return out;
}
