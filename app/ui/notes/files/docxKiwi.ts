// O Kiwi Cat escrevendo no docx aberto (T21231, spec #21155), como na nota e na planilha (#20843): o agente já gravou
// o arquivo, e a tela toca cada mudança dele por cima do documento que está aberto: o cursor do gato no lugar, o
// texto entrando aos pedaços, o realce que some sozinho, a página rolando até lá. Um parágrafo novo nasce depois do
// outro; um apagado esmaece antes de sair.
//
// A tela toca pelas mesmas operações do motor que o teclado usa, e o docx da tela é conferido com o do disco no fim
// (`docxText.ts`, no `DocxViewer`): se algo não bate, ou uma operação não dá para tocar aqui (um parágrafo que a tela
// não acha, o início do documento), a tela abre o arquivo do disco, só com o realce. A tela nunca mostra o que não
// está no arquivo.

import type { PaginatedSurface, SemanticSelection } from "@docx-editor.dev/core/editor";
import { forEachSemanticSpan, keyedRangeRects, type SemanticLayout } from "@docx-editor.dev/core/layout";

import type { DocxOp } from "../../../src/shared/docx/ops.ts";
import { type ParaIdSession, paraIds } from "./docxIds.ts";
import { KIWI_GAP_MS, KIWI_HOLD_MS, KIWI_TYPED_MAX, typingFrames } from "./kiwi-sheet.ts";

type Frame = Parameters<NonNullable<Parameters<PaginatedSurface["setHighlightPainter"]>[0]>>[0];

/** Um trecho realçado, pelo nó da tela. `gone`: o parágrafo que vai sair. */
interface Mark {
  node: string;
  from: number;
  to: number;
  gone?: boolean;
}

export interface KiwiPlayOptions {
  /** A imagem do rosto do gato, para a etiqueta do cursor (vazio: o ponto na cor dele). */
  face: string;
  /** Sem animação (a pessoa pediu menos movimento): tudo de uma vez, só o realce. */
  reduced: boolean;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** O texto de cada parágrafo do corpo na tela, pelo nó. Um parágrafo vazio não aparece (o layout não tem trecho dele). */
export function screenTexts(layout: SemanticLayout): Map<string, string> {
  const out = new Map<string, string>();
  forEachSemanticSpan(layout, (v) => {
    if (v.rootStory !== "body") return;
    const { range, text } = v.span;
    out.set(range.paragraphId, (out.get(range.paragraphId) ?? "") + text);
  });
  return out;
}

export class DocxKiwi {
  private marks: Mark[] = [];
  private caret: { node: string; offset: number } | null = null;
  private fading = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private face = "";
  /** A tela está tocando: as edições e o cursor não são da pessoa. */
  playing = false;

  constructor(
    private readonly surface: () => PaginatedSurface | null,
    private readonly editable: boolean,
  ) {}

  /**
   * Toca as operações no documento aberto. `true`: todas foram tocadas (o `DocxViewer` ainda confere com o disco);
   * `false`: uma não deu, e o documento ficou no meio: quem chamou abre o do disco.
   */
  async play(ops: readonly DocxOp[], o: KiwiPlayOptions): Promise<boolean> {
    const s = this.surface();
    const ids = s && paraIds(s);
    if (!s || !ids) return false;
    this.stopFade();
    this.face = o.face;
    const before: SemanticSelection = s.state().selection;
    // Muitas mudanças de uma vez: as primeiras digitadas, as outras entram de uma vez, realçadas (como na planilha).
    let typed = o.reduced ? 0 : KIWI_TYPED_MAX;
    this.playing = true;
    // A pessoa não digita no meio do gato: o cursor dela estaria no parágrafo dele.
    s.setEditable(false);
    try {
      for (const op of ops) {
        if (this.surface() !== s) return false;
        if (!(await this.one(s, ids, op, typed-- > 0))) return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      this.caret = null;
      this.playing = false;
      if (this.surface() === s) {
        s.setEditable(this.editable);
        try {
          s.setSelection(before);
        } catch {
          // O parágrafo do cursor da pessoa saiu: o cursor fica onde o motor o pôs.
        }
        this.fade();
      }
    }
  }

  /** Só o realce dos parágrafos (pelo `w14:paraId`), de uma vez: o docx estava fechado, ou a tela abriu o do disco. */
  glow(paragraphIds: Iterable<string>): void {
    const s = this.surface();
    const ids = s && paraIds(s);
    if (!s || !ids) return;
    const texts = screenTexts(s.layout());
    this.stopFade();
    this.marks = [];
    for (const id of paragraphIds) {
      const node = ids.nodeIdOf(id);
      const len = node ? (texts.get(node)?.length ?? 0) : 0;
      if (node && len) this.marks.push({ node, from: 0, to: len });
    }
    const first = this.marks[0];
    if (first) s.revealPosition({ paragraphId: first.node, offset: 0 }, { block: "centerIfNeeded" });
    this.fade();
  }

  /** Os elementos do gato na camada de realce: os trechos, e o cursor com a etiqueta. */
  paint(frame: Frame): HTMLElement[] {
    if (!this.marks.length && !this.caret) return [];
    const { layer, layout, scale } = frame;
    const doc = layer.ownerDocument;
    const ranges = this.marks.map((m, i) => ({ key: `m${i}`, from: { paragraphId: m.node, offset: m.from }, to: { paragraphId: m.node, offset: m.to } }));
    const c = this.caret;
    // O cursor fica depois do caractere de antes (ou antes do primeiro, no início do parágrafo).
    const len = c ? (screenTexts(layout).get(c.node)?.length ?? 0) : 0;
    if (c && len) {
      const at = c.offset > 0 ? Math.min(c.offset, len) : 0;
      ranges.push({ key: at > 0 ? "c-after" : "c-before", from: { paragraphId: c.node, offset: at > 0 ? at - 1 : 0 }, to: { paragraphId: c.node, offset: at > 0 ? at : 1 } });
    }
    const els: HTMLElement[] = [];
    for (const [key, list] of keyedRangeRects(layout, ranges, frame.pages, frame.measurer)) {
      const isCaret = key.startsWith("c-");
      const rects = isCaret ? list.slice(-1) : list;
      for (const rect of rects) {
        const page = layout.pages[rect.pageIndex];
        if (!page) continue;
        const dx = frame.pageOffsetX?.get(rect.pageIndex) ?? 0;
        const left = (page.contentBox.x + rect.x + dx) * scale;
        const top = (page.contentBox.y + rect.y) * scale;
        if (isCaret) {
          els.push(this.cursor(doc, key === "c-after" ? left + rect.width * scale : left, top, rect.height * scale));
          continue;
        }
        const el = doc.createElement("div");
        el.className = "kn-file-docx-kiwi";
        const m = this.marks[Number(key.slice(1))];
        if (m?.gone) el.dataset.gone = "";
        if (this.fading) el.dataset.fading = "";
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${rect.width * scale}px`;
        el.style.height = `${rect.height * scale}px`;
        els.push(el);
      }
    }
    return els;
  }

  destroy(): void {
    this.playing = false;
    this.stopFade();
    this.marks = [];
    this.caret = null;
  }

  private cursor(doc: Document, left: number, top: number, height: number): HTMLElement {
    const el = doc.createElement("span");
    el.className = "kn-kiwi-cursor kn-file-docx-kiwi-cursor";
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;
    const caret = doc.createElement("span");
    caret.className = "kn-kiwi-caret";
    const tag = doc.createElement("span");
    tag.className = "kn-kiwi-tag";
    const face = doc.createElement(this.face ? "img" : "span");
    face.className = "kn-kiwi-face";
    if (this.face) {
      (face as HTMLImageElement).src = this.face;
      (face as HTMLImageElement).alt = "";
      (face as HTMLImageElement).draggable = false;
    }
    tag.append(face, "Kiwi");
    el.append(caret, tag);
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  private repaint(s: PaginatedSurface): void {
    s.flushPendingInput();
    s.repaintHighlights();
  }

  private textOf(s: PaginatedSurface, node: string): string {
    s.flushPendingInput();
    return screenTexts(s.layout()).get(node) ?? "";
  }

  /** As marcas no mesmo parágrafo, depois de `at`, andam com o texto que entrou ou saiu. */
  private shift(node: string, at: number, delta: number): void {
    for (const m of this.marks) {
      if (m.node !== node) continue;
      if (m.from >= at) m.from += delta;
      if (m.to >= at) m.to += delta;
    }
  }

  private async type(s: PaginatedSurface, node: string, from: number, text: string, animate: boolean, write: (piece: string) => void): Promise<void> {
    const mark: Mark = { node, from, to: from };
    this.marks.push(mark);
    const { frames, stepMs } = animate ? typingFrames(text) : { frames: [text], stepMs: 0 };
    let done = 0;
    for (const f of frames) {
      const piece = f.slice(done);
      write(piece);
      done = f.length;
      mark.to = from + done;
      this.caret = { node, offset: from + done };
      this.repaint(s);
      s.revealPosition({ paragraphId: node, offset: from + done }, { block: "nearest" });
      if (stepMs) await wait(stepMs);
    }
  }

  private async one(s: PaginatedSurface, ids: ParaIdSession, op: DocxOp, animate: boolean): Promise<boolean> {
    if (op.op === "replace") {
      const node = ids.nodeIdOf(op.paragraphId);
      if (!node) return false;
      const len = this.textOf(s, node).length;
      if (op.from < 0 || op.to > len || op.from > op.to) return false;
      s.revealPosition({ paragraphId: node, offset: op.from }, { block: "centerIfNeeded" });
      this.caret = { node, offset: op.to };
      if (op.to > op.from && animate) {
        // O trecho que sai fica marcado um instante antes de sair.
        const out: Mark = { node, from: op.from, to: op.to, gone: true };
        this.marks.push(out);
        this.repaint(s);
        await wait(KIWI_GAP_MS * 2);
        this.marks.splice(this.marks.indexOf(out), 1);
      }
      if (op.to > op.from && !s.replaceTextInPlace(node, op.from, op.to, "")) return false;
      this.shift(node, op.to, op.from - op.to);
      if (!op.text) {
        this.repaint(s);
        return true;
      }
      this.shift(node, op.from, op.text.length);
      let at = op.from;
      let ok = true;
      await this.type(s, node, op.from, op.text, animate, (piece) => {
        ok = ok && s.replaceTextInPlace(node, at, at, piece);
        at += piece.length;
      });
      return ok && this.textOf(s, node).slice(op.from, op.from + op.text.length) === op.text;
    }
    if (op.op === "insert") {
      // No início do documento, o motor da tela e o do agente podem dar o id a parágrafos diferentes: abre o do disco.
      if (op.after === null) return false;
      const prev = ids.nodeIdOf(op.after);
      if (!prev) return false;
      const end = this.textOf(s, prev).length;
      s.setSelection({ anchor: { paragraphId: prev, offset: end }, head: { paragraphId: prev, offset: end } });
      s.splitParagraph();
      s.flushPendingInput();
      const node = s.state().selection.head.paragraphId;
      // O parágrafo novo tem de ganhar o mesmo id que ganhou no arquivo: as operações seguintes falam por ele.
      if (node === prev || ids.paraIdOf(node)?.toUpperCase() !== op.paragraphId.toUpperCase()) return false;
      s.revealPosition({ paragraphId: node, offset: 0 }, { block: "centerIfNeeded" });
      if (op.text) await this.type(s, node, 0, op.text, animate, (piece) => s.insertPlainText(piece));
      else this.repaint(s);
      return this.textOf(s, node) === op.text;
    }
    const node = ids.nodeIdOf(op.paragraphId);
    if (!node) return false;
    const order = ids.order();
    const i = order.indexOf(node);
    if (i < 0) return false;
    const len = this.textOf(s, node).length;
    s.revealPosition({ paragraphId: node, offset: 0 }, { block: "centerIfNeeded" });
    if (animate && len) {
      const out: Mark = { node, from: 0, to: len, gone: true };
      this.marks.push(out);
      this.caret = { node, offset: len };
      this.repaint(s);
      await wait(KIWI_GAP_MS * 3);
      this.marks.splice(this.marks.indexOf(out), 1);
    }
    this.caret = null;
    this.marks = this.marks.filter((m) => m.node !== node);
    const prev = order[i - 1];
    const next = order[i + 1];
    if (prev) {
      // Do fim do parágrafo de antes ao fim deste: o de antes fica como estava, e este sai inteiro.
      const end = this.textOf(s, prev).length;
      s.setSelection({ anchor: { paragraphId: prev, offset: end }, head: { paragraphId: node, offset: len } });
      s.deleteBackward();
    } else if (next) {
      // O primeiro do documento: dele até o início do seguinte. O que fica pode guardar o id deste: a conferência no
      // fim abre o do disco se o texto não bater.
      s.setSelection({ anchor: { paragraphId: node, offset: 0 }, head: { paragraphId: next, offset: 0 } });
      s.deleteForward();
    } else return false;
    this.repaint(s);
    return !ids.order().includes(node) || this.textOf(s, node) !== "";
  }

  private fade(): void {
    this.stopFade();
    const s = this.surface();
    if (!s || !this.marks.length) return s?.repaintHighlights();
    this.fading = true;
    s.repaintHighlights();
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.fading = false;
      this.marks = [];
      this.surface()?.repaintHighlights();
    }, KIWI_HOLD_MS + 500);
  }

  private stopFade(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.fading = false;
  }
}
