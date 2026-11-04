// O desenho dos blocos renderizados (T2983, spec #2973): a mesma lib e o mesmo STYLE das mensagens do Channels
// (`ui/src/chat/markdown.tsx` do kiwi-init/channels), com os tokens das Notas. Cada bloco fora do cursor vira um
// widget do CodeMirror com uma raiz React; clicar nele põe o cursor no ponto do `.md` que corresponde ao clique.
// O parser (md4c em WASM) vem embutido na lib como base64: nada é baixado.

// Antes da lib: o `__DEV__` que ela lê.
import "./enrichedEnv.ts";

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MarkdownStyle } from "react-native-enriched-markdown/lib/module/index.web.js";
import { normalizeMarkdownStyle } from "react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js";
import { ENRM_TEXT_CLASS } from "react-native-enriched-markdown/lib/module/web/globalStyles.js";
import { parseMarkdown } from "react-native-enriched-markdown/lib/module/web/parseMarkdown.js";
import { RenderNode } from "react-native-enriched-markdown/lib/module/web/renderers/index.js";
import { buildStyles, zeroTrailingMargins } from "react-native-enriched-markdown/lib/module/web/styles.js";
import { indexTaskItems } from "react-native-enriched-markdown/lib/module/web/utils.js";
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types";

import { externalUrl } from "../links.ts";
import { editorFocused, type LinkResolver, linksChanged } from "./livePreview.ts";
import { fullTree, linkAction, MISSING_LINK, NOTE_LINK, renderedBlocks, sourceOffset, TAG_LINK, taskMarks, toRenderable } from "./rendered.ts";

// ---------------------------------------------------------------- o estilo do Channels, com os tokens das Notas

// O corpo no tamanho do editor (14 px, entrelinha 1.65): o bloco não muda de altura ao virar texto para editar.
const TEXT = { fontSize: 14, fontFamily: "var(--font)", color: "var(--text)", lineHeight: 23, marginTop: 0, marginBottom: 0 };
const HEAD = { fontFamily: "var(--font)", fontWeight: "600", color: "var(--text)", marginTop: 0, marginBottom: 0 };

const STYLE: MarkdownStyle = {
  paragraph: TEXT,
  h1: { ...HEAD, fontSize: 19, lineHeight: 26 },
  h2: { ...HEAD, fontSize: 17, lineHeight: 24 },
  h3: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h4: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h5: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--text-2)" },
  h6: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--text-2)" },
  blockquote: {
    ...TEXT,
    color: "var(--text-2)",
    borderColor: "var(--border-strong)",
    borderWidth: 2,
    gapWidth: 12,
    backgroundColor: "transparent",
    padding: 0,
    admonitions: {
      note: { color: "var(--accent-text)", backgroundColor: "var(--accent-soft)" },
      tip: { color: "var(--accent-text)", backgroundColor: "var(--surface-2)" },
      important: { color: "var(--text)", backgroundColor: "var(--surface-2)" },
      warning: { color: "var(--danger)", backgroundColor: "var(--surface-2)" },
      caution: { color: "var(--danger)", backgroundColor: "var(--surface-2)" },
    },
  },
  list: { ...TEXT, bulletColor: "var(--text-3)", bulletSize: 5, markerColor: "var(--text-3)", markerFontWeight: "500", gapWidth: 6, marginLeft: 22, itemSpacing: 2 },
  codeBlock: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    color: "var(--text)",
    lineHeight: 19,
    marginTop: 0,
    marginBottom: 0,
    backgroundColor: "var(--surface-2)",
    borderColor: "transparent",
    borderWidth: 0,
    borderRadius: 10,
    padding: 12,
  },
  link: { color: "var(--accent-text)", underline: false },
  linkVariants: {
    [`^${MISSING_LINK}`]: { color: "var(--text-3)", underline: false },
    [`^${NOTE_LINK}`]: { color: "var(--accent-text)", underline: false },
    [`^${TAG_LINK}`]: { color: "var(--accent-text)", backgroundColor: "var(--accent-soft)", underline: false },
  },
  strong: { color: "var(--text)" },
  em: { color: "var(--text)" },
  strikethrough: { color: "var(--text-3)" },
  code: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-2)", backgroundColor: "var(--surface-2)", borderColor: "transparent" },
  thematicBreak: { color: "var(--border)", height: 1, marginTop: 11, marginBottom: 11 },
  taskList: { checkedColor: "var(--accent)", borderColor: "var(--border-strong)", checkmarkColor: "var(--on-accent)", checkedTextColor: "var(--text-3)" },
};

// Um bloco por widget: sem margem embaixo (o CodeMirror mede o bloco sem a margem; o espaço é a linha em branco).
const NORMAL = zeroTrailingMargins(normalizeMarkdownStyle(STYLE));
const STYLES = buildStyles(NORMAL);
const CAPABILITIES = { katex: null, enableTaskListItemToggle: true };
// Quebra simples vira quebra de linha, como o editor mostra; sem LaTeX (não entra o KaTeX).
const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true };

// ---------------------------------------------------------------- o parse, com cache

const LIMIT = 800;
const parsed = new Map<string, ASTNode>();
const parsing = new Map<string, Promise<ASTNode>>();

function parse(markdown: string): Promise<ASTNode> {
  const done = parsed.get(markdown);
  if (done) return Promise.resolve(done);
  const pending = parsing.get(markdown);
  if (pending) return pending;
  const next = parseMarkdown(markdown, FLAGS)
    .then((ast) => {
      indexTaskItems(ast);
      noPictures(ast);
      parsed.set(markdown, ast);
      if (parsed.size > LIMIT) parsed.delete(parsed.keys().next().value!);
      return ast;
    })
    .finally(() => parsing.delete(markdown));
  parsing.set(markdown, next);
  return next;
}

/** Imagem fica para o T2984 (os blocos com imagem não chegam aqui); se uma escapar, vira o texto dela: nada é baixado. */
function noPictures(node: ASTNode): void {
  if (node.type === "Image") {
    const alt = textOf(node);
    node.type = "Text";
    node.content = alt;
    node.children = [];
    node.attributes = {};
  }
  for (const child of node.children ?? []) noPictures(child);
}

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("");

// ---------------------------------------------------------------- o widget

export interface RenderedActions {
  onOpenLink(target: string): void;
  onOpenTag?(tag: string): void;
  onOpenUrl(url: string): void;
}

interface BlockProps {
  markdown: string;
  source: string;
  callbacks: Parameters<typeof RenderNode>[0]["callbacks"];
  onShown(): void;
}

function Block({ markdown, source, callbacks, onShown }: BlockProps) {
  const [, parsedNow] = useState(0);
  const current = parsed.get(markdown) ?? null;
  useLayoutEffect(() => {
    if (current) return;
    let live = true;
    parse(markdown).then(
      () => live && parsedNow((n) => n + 1),
      () => {
        // Não deu para ler: o texto cru continua.
      },
    );
    return () => {
      live = false;
    };
  }, [markdown, current]);
  useLayoutEffect(onShown, [current, onShown]);
  // Até o parse chegar (só na primeira vez de cada bloco), o texto cru, do mesmo tamanho.
  if (!current) return <div className="cm-rendered-raw">{source}</div>;
  return (
    <div className={ENRM_TEXT_CLASS} style={{ display: "flex", flexDirection: "column" }}>
      {(current.children ?? []).map((child, i) => (
        <RenderNode key={`${child.type}-${i}`} node={child} style={NORMAL} styles={STYLES} callbacks={callbacks} capabilities={CAPABILITIES} />
      ))}
    </div>
  );
}

const roots = new WeakMap<HTMLElement, Root>();
/** O widget de agora de cada DOM: o CodeMirror reaproveita o DOM (`updateDOM`) com outro widget, de outro texto. */
const widgets = new WeakMap<HTMLElement, RenderedWidget>();

/** Um ⌥-clique num link desenhado põe o cursor (para editar), como no editor; o clique que vem depois não abre. */
let altClick = false;

class RenderedWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly source: string,
    readonly actions: RenderedActions,
  ) {
    super();
  }

  eq(other: RenderedWidget) {
    return other.markdown === this.markdown && other.source === this.source;
  }

  get estimatedHeight() {
    return this.source.split("\n").length * 23;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-rendered";
    const root = createRoot(dom);
    roots.set(dom, root);
    widgets.set(dom, this);
    this.draw(root, view, dom);
    // Lê o widget pelo DOM: depois de um `updateDOM`, o `this` daqui é o de antes.
    dom.addEventListener("mousedown", (e) => widgets.get(dom)?.place(e, view, dom));
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    const root = roots.get(dom);
    if (!root) return false;
    widgets.set(dom, this);
    this.draw(root, view, dom);
    return true;
  }

  private draw(root: Root, view: EditorView, dom: HTMLElement) {
    const at = () => view.posAtDOM(dom);
    const callbacks = {
      onLinkPress: ({ url }: { url: string }) => {
        if (altClick) {
          altClick = false;
          return;
        }
        const act = linkAction(url);
        if (act?.kind === "note") this.actions.onOpenLink(act.target);
        else if (act?.kind === "tag") this.actions.onOpenTag?.(act.tag);
        else if (act?.kind === "url") {
          // Só o que pode abrir fora (http, https, mailto); o resto não faz nada, como no editor.
          const safe = externalUrl(act.url);
          if (safe) this.actions.onOpenUrl(safe);
        }
      },
      onTaskListItemPress: ({ index }: { index: number }) => {
        const from = at();
        const marks = taskMarks(fullTree(view.state), from, from + this.source.length);
        const pos = marks[index];
        if (pos == null) return;
        const checked = /x/i.test(view.state.doc.sliceString(pos, pos + 1));
        view.dispatch({ changes: { from: pos, to: pos + 1, insert: checked ? " " : "x" } });
      },
    };
    root.render(<Block markdown={this.markdown} source={this.source} callbacks={callbacks} onShown={() => view.requestMeasure()} />);
  }

  /** Clique fora de link e de caixa: o cursor vai para o ponto do `.md` onde a pessoa clicou, e o bloco vira texto. */
  /**
   * O clique fora de link e de caixa (ou um ⌥-clique num link): o cursor vai para o ponto do `.md` onde a pessoa
   * clicou e o bloco vira texto. Com ⇧, estende a seleção; arrastando, seleciona como no resto do editor.
   */
  place(e: MouseEvent, view: EditorView, dom: HTMLElement) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    altClick = e.altKey && !!target.closest("a");
    if (target.closest("input, button") || (target.closest("a") && !e.altKey)) return;
    e.preventDefault();
    const at = view.posAtDOM(dom) + this.offsetAt(dom, e.clientX, e.clientY);
    const anchor = e.shiftKey ? view.state.selection.main.anchor : at;
    // O foco antes da seleção: focado depois, o navegador põe o cursor dele e o editor lê esse no lugar do nosso.
    view.focus();
    view.dispatch({ selection: EditorSelection.single(anchor, at), userEvent: "select.pointer" });
    // O bloco já é texto: arrastar daqui em diante usa a posição de verdade do editor.
    const move = (m: MouseEvent) => {
      const head = view.posAtCoords({ x: m.clientX, y: m.clientY }, false);
      if (head !== view.state.selection.main.head) view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent: "select.pointer" });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  /** Quantos caracteres do `.md` do bloco ficam antes do ponto clicado. */
  private offsetAt(dom: HTMLElement, x: number, y: number): number {
    try {
      const caret = document.caretRangeFromPoint?.(x, y);
      if (!caret || !dom.contains(caret.startContainer)) return 0;
      const before = document.createRange();
      before.setStart(dom, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      const shown = before.toString();
      return sourceOffset(this.source, shown, shown.length);
    } catch {
      // Um ponto que não dá para medir (dentro de um desenho): o começo do bloco.
      return 0;
    }
  }

  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    roots.delete(dom);
    // Fora do ciclo do React: desmontar no meio de um render dele dá aviso.
    if (root) queueMicrotask(() => root.unmount());
  }

  ignoreEvent() {
    // O widget cuida dos próprios cliques (link, caixa, pôr o cursor).
    return true;
  }
}

function buildRendered(state: EditorState, resolver: LinkResolver, actions: RenderedActions): DecorationSet {
  const focused = state.field(editorFocused, false) ?? false;
  const tree = fullTree(state);
  const out: Range<Decoration>[] = [];
  for (const b of renderedBlocks(state, focused, tree)) {
    const markdown = toRenderable(b.source, b.from, tree, (t) => resolver.status(t));
    out.push(Decoration.replace({ widget: new RenderedWidget(markdown, b.source, actions), block: true }).range(b.from, b.to));
  }
  return Decoration.set(out);
}

/**
 * Os blocos fora do cursor aparecem renderizados pela lib do Channels. Vem de um StateField porque um bloco de várias
 * linhas esconde quebras de linha. Precisa do `commentPreview` (que guarda se o editor está com foco).
 */
export function renderedPreview(resolver: LinkResolver, actions: RenderedActions) {
  return [
    StateField.define<DecorationSet>({
      create: (state) => buildRendered(state, resolver, actions),
      update(value, tr) {
        const changed =
          tr.docChanged ||
          tr.selection ||
          tr.effects.some((e) => e.is(linksChanged)) ||
          syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
          tr.startState.field(editorFocused, false) !== tr.state.field(editorFocused, false);
        return changed ? buildRendered(tr.state, resolver, actions) : value;
      },
      provide: (f) => EditorView.decorations.from(f),
    }),
    renderedTheme,
  ];
}

const renderedTheme = EditorView.theme({
  // Sem margem (o CodeMirror mede sem ela); `cursor: text` porque o clique edita.
  ".cm-rendered": { cursor: "text", padding: "0" },
  ".cm-rendered-raw": { whiteSpace: "pre-wrap" },
  ".cm-rendered a": { cursor: "pointer" },
  ".cm-rendered a[href^='kiwi-tag:']": { borderRadius: "4px", padding: "0 3px" },
  ".cm-rendered input[type=checkbox]": { cursor: "pointer" },
});
