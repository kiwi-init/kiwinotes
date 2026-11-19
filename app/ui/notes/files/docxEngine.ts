// O motor do docx nas Notas (T21151, spec #21080): o @docx-editor.dev/core (Apache-2.0), com as páginas como no Word.
// Desde o T21152, a pessoa edita nas páginas (o teclado, o ⌘Z, o ⌘B são do motor), e o `save()` dá o docx novo. Desde o
// T23238, a barra e os atalhos das Notas formatam (`format`), e o HTML colado de fora entra limpo (`docxFormat.ts`). Este arquivo é o único que o importa, e o `DocxViewer` o carrega só quando um docx abre: o motor e o
// CSS dele ficam num pedaço à parte do pack. Nada vai à rede: as fontes são as do Mac, pelo canvas.

import "@docx-editor.dev/core/styles/editor.css";

import { mountPaginatedSurface, type PaginatedSurface } from "@docx-editor.dev/core/editor";
import { forEachSemanticSpan, keyedRangeRects, type SemanticLayout, tryCreateCanvasMeasurer } from "@docx-editor.dev/core/layout";

import type { DocxOp } from "../../../src/shared/docx/ops.ts";
import type { DocxMatch, DocxPiece } from "./docxFind.ts";
import { paraIds } from "./docxIds.ts";
import { DocxKiwi, type KiwiPlayOptions } from "./docxKiwi.ts";
import { type DocxFormatAction, type DocxFormatState, docStyles, headingLevel, headingToggle, pastePlan, shortcutAction } from "./docxFormat.ts";
import { wordMeasurer } from "./docxMetrics.ts";
import { keepUntouchedParts } from "./docxParts.ts";
import { tidyDocx } from "./docxRuns.ts";

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
  /**
   * O id do n-ésimo parágrafo do corpo (de 1), pela lista do motor: o `{ paragraph: n }` que a busca das Notas acha
   * conta os mesmos (T22847). `null` se não existe.
   */
  paragraphId(n: number): string | null;
  /** Rola até um parágrafo, mesmo sem texto desenhado (o que só segura uma caixa de texto). */
  revealParagraph(id: string): void;
  /** Rola até o alto de uma página (a primeira é 0). */
  revealPage(index: number): void;
  /**
   * Toca as mudanças que o Kiwi Cat gravou (T21231): o cursor dele, o texto entrando, o realce. `false`: uma não deu
   * para tocar, e quem chamou abre o arquivo do disco.
   */
  play(ops: readonly DocxOp[], o: KiwiPlayOptions): Promise<boolean>;
  /** Só o realce destes parágrafos (pelo `w14:paraId`), de uma vez (T21231). */
  glow(paragraphIds: Iterable<string>): void;
  /** O docx com as edições, com os trechos iguais juntos (T21152). */
  save(): Uint8Array;
  undo(): void;
  redo(): void;
  /** Formata a seleção (T23238): a barra e os atalhos das Notas. Devolve `false` quando o documento não tem como. */
  format(action: DocxFormatAction): boolean;
  /** O que está ligado na seleção, para a barra. */
  formatState(): DocxFormatState | null;
  /** O retângulo do texto selecionado, na tela, ou `null` sem seleção (só o cursor) ou fora do documento. */
  selectionRect(): DOMRect | null;
  /** Solta o motor e o documento (#22186): a memória volta ao fechar o arquivo. */
  destroy(): void;
}

export type MountResult = { ok: true; handle: DocxHandle } | { ok: false; reason: string };

interface Options {
  zoom: number;
  /** A pessoa edita nas páginas (T21152); `false` é só leitura. */
  editable: boolean;
  /** Cada edição que mudou o documento. */
  onEdit(): void;
  /**
   * O parágrafo com o cursor da pessoa (o `w14:paraId`, o id que o agente usa), ou `null` quando o foco sai do
   * documento ou ele fecha (T21231: o gato espera a pessoa sair do parágrafo antes de mudá-lo). Só chama quando muda.
   */
  onCaret?(paragraphId: string | null): void;
  /** Um clique num link de fora: quem abre é o visualizador, depois de conferir o endereço. */
  onLink(href: string): void;
  /** A seleção ou a formatação dela mudou (T23238): a barra se move e acende os botões. */
  onSelection?(): void;
}

/** O `setScale` da superfície: o mesmo que o `setZoom` do editor do motor usa, fora dos tipos públicos. */
type Scalable = PaginatedSurface & { setScale?: (scale: number) => boolean };

export function mountDocx(host: HTMLElement, bytes: Uint8Array, { zoom, editable, onEdit, onCaret, onLink, onSelection }: Options): MountResult {
  // Uma cópia dos bytes abertos: o motor pode ficar com o buffer que recebeu.
  const original = bytes.slice();
  let lastCaret: string | null = null;
  // O id da tela (o nó) vira o do arquivo pela sessão do motor (`docxIds.ts`); antes de a superfície existir, nada.
  let toParaId: ((node: string) => string | null) | null = null;
  let kiwi: DocxKiwi | null = null;
  const caret = (node: string | null) => {
    if (kiwi?.playing) return;
    const id = node && toParaId ? toParaId(node) : null;
    if (id === lastCaret) return;
    lastCaret = id;
    onCaret?.(id);
  };
  const context = host.ownerDocument.createElement("canvas").getContext("2d");
  const base = context ? tryCreateCanvasMeasurer({ context, scale: PT_TO_PX }) : null;
  const r = mountPaginatedSurface(host, bytes, {
    editingMode: editable ? "edit" : "view",
    // As edições que o gato toca na tela já estão no disco: não são da pessoa.
    onEdit: () => {
      if (!kiwi?.playing) onEdit();
    },
    onChange: (state) => {
      caret(host.contains(host.ownerDocument.activeElement) ? state.selection.head.paragraphId : null);
      onSelection?.();
    },
    scale: zoom * PT_TO_PX,
    ...(base ? { measurer: wordMeasurer(base), producer: "kiwi-word-lines" } : {}),
    onHyperlinkPopover: ({ link }) => {
      // Um link de dentro do documento (um sumário, "veja a seção 3") o motor rola sozinho até o marcador.
      if (link.kind === "external" && link.href) onLink(link.href);
    },
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  const leave = () => caret(null);
  host.addEventListener("focusout", (e) => {
    if (!host.contains(e.relatedTarget as Node | null)) leave();
  });
  let surface: Scalable | null = r.surface;
  const ids = paraIds(r.surface);
  toParaId = ids ? (node) => ids.paraIdOf(node) : null;
  // O cursor de quando o documento abriu chegou antes da tradução: vai agora.
  if (host.contains(host.ownerDocument.activeElement)) caret(r.surface.state().selection.head.paragraphId);
  kiwi = new DocxKiwi(() => surface, editable);
  if (editable) {
    // Colar (T23238): a cópia de um docx entra como veio; o HTML de fora entra limpo, sem o estilo da página. Na captura,
    // antes do motor, que cola o HTML como está.
    host.addEventListener(
      "paste",
      (e) => {
        const data = e.clipboardData;
        if (!surface || !data) return;
        const plan = pastePlan(data.getData("text/html"), (html) => new DOMParser().parseFromString(html, "text/html").body);
        if (plan.kind === "keep") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        surface.pasteRich(data.getData("text/plain").replace(/\r\n?/g, "\n"), plan.kind === "html" ? plan.html : null);
      },
      true,
    );
    // Os atalhos das Notas que o motor não tem (o ⌘1 dele é o espaçamento, no Word): também na captura.
    host.addEventListener(
      "keydown",
      (e) => {
        const action = shortcutAction(e);
        if (!action || e.isComposing) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handle.format(action);
      },
      true,
    );
  }
  const win = host.ownerDocument.defaultView;
  if (win) win.__kiwiDocxLive = (win.__kiwiDocxLive ?? 0) + 1;
  let marks: { matches: DocxMatch[]; current: number } = { matches: [], current: -1 };

  surface.setHighlightPainter((frame) => {
    const { layer, layout, scale } = frame;
    const cat = kiwi?.paint(frame) ?? [];
    if (!marks.matches.length) {
      if (cat.length || layer.childElementCount) layer.replaceChildren(...cat);
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
    layer.replaceChildren(...els, ...cat);
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
    paragraphId: (n) => (surface && n >= 1 ? (surface.session.paragraphIds()[n - 1] ?? null) : null),
    revealParagraph(id) {
      surface?.revealParagraph(id, { block: "centerIfNeeded" });
    },
    revealPage(index) {
      surface?.revealPage(index, { block: "start", offsetPx: 0 });
    },
    play: (ops, o) => kiwi?.play(ops, o) ?? Promise.resolve(false),
    glow: (list) => kiwi?.glow(list),
    save() {
      if (!surface) throw new Error("o documento já foi fechado");
      surface.flushPendingInput();
      // As partes que o motor só reescreveu voltam com os bytes de quando o arquivo abriu.
      return tidyDocx(keepUntouchedParts(surface.save(), original));
    },
    undo: () => surface?.undo(),
    redo: () => surface?.redo(),
    format(action) {
      if (!surface || !editable) return false;
      const s = surface;
      switch (action) {
        case "bold":
          return s.toggleRunProperty("b") === null;
        case "italic":
          return s.toggleRunProperty("i") === null;
        case "underline":
          return s.toggleRunProperty("u", { val: "single" }) === null;
        case "strike":
          return s.toggleRunProperty("strike") === null;
        case "bullet":
        case "ordered":
          return s.toggleList(action);
        case "left":
        case "center":
        case "right":
        case "justify":
          s.setParagraphProperties([{ localName: "jc", attributes: { val: action === "justify" ? "both" : action }, physicalAlignment: true }]);
          return true;
        default: {
          const styles = docStyles(s.session.documentStyles());
          const current = handle.formatState()?.heading ?? 0;
          const level = action === "heading" ? 0 : Number(action.slice(7));
          // ⌘N no título N volta ao corpo, como nas Notas. Sem o estilo Normal no documento, o corpo é o parágrafo sem
          // estilo: o `val: null` tira o estilo dele.
          if (current > 0 && (action === "heading" || current === level)) {
            s.setParagraphProperty("pStyle", { val: styles.body });
            return true;
          }
          const id = action === "heading" ? headingToggle(current, styles) : (styles.headings.get(level) ?? null);
          if (!id) return false;
          s.setParagraphProperty("pStyle", { val: id });
          return true;
        }
      }
    },
    formatState() {
      if (!surface) return null;
      const f = surface.formatting();
      const style = f.styleId ? surface.session.documentStyles().find((x) => x.styleId === f.styleId) : undefined;
      return {
        bold: f.bold,
        italic: f.italic,
        underline: f.underline,
        strike: f.strikethrough,
        heading: style ? headingLevel(style) : 0,
        bullet: surface.isListActive("bullet"),
        ordered: surface.isListActive("ordered"),
        alignment: f.alignment === "both" ? "justify" : f.alignment,
      };
    },
    selectionRect() {
      if (!surface) return null;
      const { anchor, head } = surface.state().selection;
      if (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset) return null;
      const sel = host.ownerDocument.getSelection();
      if (!sel?.rangeCount || !host.contains(sel.anchorNode)) return null;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      return rect.width || rect.height ? rect : null;
    },
    destroy() {
      if (!surface) return;
      kiwi?.destroy();
      surface.setHighlightPainter(null);
      surface.destroy();
      caret(null);
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
