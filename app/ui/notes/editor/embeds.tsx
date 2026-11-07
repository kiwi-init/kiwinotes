// Embutir nota, título e bloco no editor (T6594, E15, issue 191): uma linha que é só `![[nota]]`, `![[nota#Título]]`
// ou `![[nota#^id]]` (e não um anexo) aparece como o pedaço da outra nota, desenhado como o resto do texto. O corte vem
// do engine (`notes.embed`). Com o cursor na linha, o texto fica para editar e o embed aparece logo embaixo, como os
// anexos. Um embed dentro do embed vira link: um nível só, sem laço.

import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";

import type { NoteEmbed } from "../../../src/shared/ui-contract.ts";
import { noteEmbedLine } from "./embed-line.ts";
import { linksChanged } from "./livePreview.ts";
import { EmbeddedMarkdown, type RenderedActions } from "./renderedWidget.tsx";

export type EmbedSource = (link: string) => Promise<NoteEmbed | null>;

export { noteEmbedLine };

const embedLoaded = StateEffect.define<null>();

class EmbedCache {
  private known = new Map<string, NoteEmbed | null>();
  private asking = new Set<string>();
  constructor(private source: EmbedSource) {}
  get(link: string, view: EditorView): NoteEmbed | null | undefined {
    if (this.known.has(link)) return this.known.get(link);
    if (!this.asking.has(link)) {
      this.asking.add(link);
      this.source(link).then(
        (e) => this.settle(link, e, view),
        () => this.settle(link, null, view),
      );
    }
    return undefined;
  }
  /** As notas mudaram: pede de novo, mas mostra o de antes até chegar. */
  refresh(view: EditorView): void {
    for (const link of [...this.known.keys()]) {
      if (this.asking.has(link)) continue;
      this.asking.add(link);
      this.source(link).then(
        (e) => this.settle(link, e, view),
        () => this.settle(link, null, view),
      );
    }
  }
  private settle(link: string, e: NoteEmbed | null, view: EditorView) {
    this.asking.delete(link);
    const before = this.known.get(link);
    this.known.set(link, e);
    if (JSON.stringify(before) !== JSON.stringify(e)) queueMicrotask(() => view.dispatch({ effects: embedLoaded.of(null) }));
  }
}

const roots = new WeakMap<HTMLElement, Root>();

class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly link: string,
    readonly embed: NoteEmbed | null | undefined,
    readonly markdown: string,
    readonly from: number,
    readonly actions: RenderedActions,
  ) {
    super();
  }
  eq(o: NoteEmbedWidget) {
    return o.link === this.link && o.embed === this.embed && o.markdown === this.markdown && o.from === this.from;
  }
  get estimatedHeight() {
    return this.embed && "content" in this.embed ? 40 + this.embed.content.split("\n").length * 23 : 40;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "kn-embed";
    dom.dataset.link = this.link;
    const root = createRoot(dom);
    roots.set(dom, root);
    this.draw(root, view);
    // Clicar fora dos links põe o cursor na linha do embed (como a tabela e os anexos): ela vira texto para editar.
    dom.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("a, button")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.state.doc.lineAt(this.from).to } });
      view.focus();
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => view.requestMeasure()).observe(dom);
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const root = roots.get(dom);
    if (!root) return false;
    dom.dataset.link = this.link;
    this.draw(root, view);
    return true;
  }
  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    roots.delete(dom);
    if (root) queueMicrotask(() => root.unmount());
  }
  private draw(root: Root, view: EditorView) {
    const e = this.embed;
    const name = this.link.split("|")[0]!;
    const open = () => this.actions.onOpenLink(name.split("#")[0]!);
    const fragment = name.includes("#") ? name.slice(name.indexOf("#") + 1) : "";
    root.render(
      <div className="kn-embed-box" data-state={e === undefined ? "loading" : e === null ? "missing-note" : "missing" in e ? "missing" : "ok"}>
        <div className="kn-embed-head">
          <button type="button" className="kn-embed-title" onClick={open} title="Abrir a nota">
            {e && "title" in e ? e.title : name.split("#")[0]}
            {fragment ? <span className="kn-embed-fragment">{fragment.startsWith("^") ? " · bloco" : ` › ${fragment}`}</span> : null}
          </button>
        </div>
        {e === undefined ? null : e === null ? (
          <div className="kn-embed-note">Essa nota não existe.</div>
        ) : "missing" in e ? (
          <div className="kn-embed-note">{e.missing.startsWith("^") ? `O bloco ${e.missing} não está nessa nota.` : `O título “${e.missing}” não está nessa nota.`}</div>
        ) : e.content.trim() ? (
          <EmbeddedMarkdown markdown={this.markdown} actions={this.actions} onShown={() => view.requestMeasure()} />
        ) : (
          <div className="kn-embed-note">Vazia.</div>
        )}
      </div>,
    );
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, cache: EmbedCache, view: EditorView | null, toMarkdown: (content: string) => string, actions: RenderedActions): DecorationSet {
  if (!view) return Decoration.none;
  const out: Range<Decoration>[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes("![[")) continue;
    const link = noteEmbedLine(line.text);
    if (!link) continue;
    const embed = cache.get(link, view);
    const markdown = embed && "content" in embed ? toMarkdown(embed.content) : "";
    const widget = new NoteEmbedWidget(link, embed, markdown, line.from, actions);
    if (state.selection.ranges.some((r) => r.to >= line.from && r.from <= line.to)) out.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    else out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
  }
  return Decoration.set(out);
}

/** As linhas `![[nota]]` aparecem como a nota embutida. `toMarkdown` prepara o texto para a lib (os links da nota). */
export function notePreview(source: EmbedSource, toMarkdown: (content: string) => string, actions: RenderedActions) {
  const cache = new EmbedCache(source);
  let current: EditorView | null = null;
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (tr.effects.some((e) => e.is(linksChanged)) && current) cache.refresh(current);
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(embedLoaded) || e.is(linksChanged))) return build(tr.state, cache, current, toMarkdown, actions);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const bind = ViewPlugin.define((view) => {
    current = view;
    queueMicrotask(() => view.dispatch({ effects: embedLoaded.of(null) }));
    return {
      destroy() {
        if (current === view) current = null;
      },
    };
  });
  const theme = EditorView.theme({
    ".kn-embed": { padding: "4px 0", cursor: "default" },
    ".kn-embed-box": { borderLeft: "2px solid var(--border-strong)", padding: "4px 0 4px 14px" },
    ".kn-embed-head": { display: "flex", alignItems: "center", minHeight: "22px" },
    ".kn-embed-title": {
      border: "0", padding: "0", background: "none", cursor: "pointer",
      font: "inherit", fontSize: "12px", fontWeight: "600", color: "var(--text-3)", letterSpacing: "0.01em",
    },
    ".kn-embed-title:hover": { color: "var(--accent-text)" },
    ".kn-embed-fragment": { fontWeight: "400" },
    ".kn-embed-note": { fontSize: "13px", color: "var(--text-3)" },
    ".kn-embed-box[data-state='missing'], .kn-embed-box[data-state='missing-note']": { borderLeftColor: "var(--danger)" },
  });
  return [field, bind, theme];
}
