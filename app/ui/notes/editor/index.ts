// O editor da nota (T1317): CodeMirror 6, local, sem CDN. Markdown do GitHub (tabelas, tarefas, riscado) com preview ao
// vivo, `[[links]]` com autocomplete e clique, e tabela com Tab e Enter. Só o corpo da nota entra aqui: o frontmatter
// fica com quem chama e volta intacto ao gravar.

import { autocompletion, type Completion, type CompletionContext, type CompletionResult, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

import { externalUrl, linkAt } from "../links.ts";
import { commentPreview, inlinePreview, type LinkResolver, linksChanged, type LinkStatus, tablePreview } from "./livePreview.ts";
import { tableEnter, tableTab } from "./table.ts";

export interface LinkTarget {
  /** O título da nota (o que aparece na lista). */
  title: string;
  /** A pasta, para diferenciar notas com o mesmo nome. */
  folder: string;
  /** O que vai dentro do `[[…]]` (linkTextFor). */
  link: string;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange(doc: string): void;
  /** Clique num `[[link]]` (⌘-clique com o cursor dentro dele). */
  onOpenLink(target: string): void;
  /** ⌘-clique num link do Markdown que pode abrir fora (já passou pelo `externalUrl`). */
  onOpenUrl(url: string): void;
  /** As notas para o autocomplete do `[[`. */
  linkTargets(): LinkTarget[];
  /** `notes.resolve`: para desenhar o link que ainda não existe de outro jeito. */
  resolve(target: string): Promise<string | null>;
}

// ---------------------------------------------------------------- [[link]] no parser

/**
 * `[[nota]]` vira um nó `WikiLink` antes do parser de links do Markdown olhar: sem isso, o `[nota]` de dentro virava
 * link de referência. Termina no `]]` da mesma linha; um `[` ou uma quebra antes dele desfaz.
 */
export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: [{ name: "WikiLink", style: t.link }],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1;
        for (let i = pos + 2; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === 10 /* \n */ || c === 91) return -1;
          if (c === 93 /* ] */) return cx.char(i + 1) === 93 && i > pos + 2 ? cx.addElement(cx.elt("WikiLink", pos, i + 2)) : -1;
        }
        return -1;
      },
    },
  ],
};

// ---------------------------------------------------------------- autocomplete

/** Depois de `[[`, as notas do vault; escolher uma completa o link e fecha os colchetes. */
export function linkCompletion(targets: () => LinkTarget[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\[\]|#\n]*/);
    if (!m) return null;
    const from = m.from + 2;
    const options: Completion[] = targets().map((n) => ({
      label: n.title,
      detail: n.folder || undefined,
      apply: (view, _c, a, b) => {
        const close = view.state.doc.sliceString(b, b + 2) === "]]" ? "" : "]]";
        view.dispatch({ changes: { from: a, to: b, insert: n.link + close }, selection: { anchor: a + n.link.length + 2 } });
      },
    }));
    return { from, options, validFor: /^[^\[\]|#\n]*$/ };
  };
}

// ---------------------------------------------------------------- tabelas

/**
 * A árvore até `pos`: o parser anda aos poucos, e logo depois de digitar numa nota longa ele pode não ter chegado lá.
 * Espera até 50 ms; se não der, usa o que tem.
 */
const treeUpTo = (state: EditorState, pos: number) => ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 50) ?? syntaxTree(state);

function tableAt(state: EditorState): { from: number; to: number } | null {
  const pos = state.selection.main.head;
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = treeUpTo(state, pos).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "Table") return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
  }
  return null;
}

function tableCommand(step: (text: string, offset: number) => ReturnType<typeof tableEnter>) {
  return (view: EditorView): boolean => {
    const range = tableAt(view.state);
    if (!range) return false;
    const text = view.state.doc.sliceString(range.from, range.to);
    const r = step(text, view.state.selection.main.head - range.from);
    if (!r) return false;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: r.text },
      selection: { anchor: range.from + r.anchor, head: range.from + r.head },
      scrollIntoView: true,
    });
    return true;
  };
}

const tableKeys = Prec.high(
  keymap.of([
    { key: "Tab", run: tableCommand((x, o) => tableTab(x, o, 1)) },
    { key: "Shift-Tab", run: tableCommand((x, o) => tableTab(x, o, -1)) },
    { key: "Enter", run: tableCommand(tableEnter) },
  ]),
);

// ---------------------------------------------------------------- aparência

/** As cores e fontes vêm dos tokens do app (tokens.css), então o claro e o escuro seguem o sistema sozinhos. */
const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "transparent", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.65", overflow: "visible" },
  ".cm-content": { padding: "0 0 40vh", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-placeholder": { color: "var(--text-3)" },
  // Títulos: hierarquia por tamanho, peso e espaço (B v4), nunca por linha.
  ".cm-h": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-h1": { fontSize: "20px", paddingTop: "22px !important", letterSpacing: "-0.01em" },
  ".cm-h2": { fontSize: "14px", paddingTop: "20px !important", paddingBottom: "2px !important" },
  ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { fontSize: "14px", color: "var(--text-2)", paddingTop: "14px !important" },
  ".cm-inline-code": { fontFamily: "var(--font-mono)", fontSize: "12.5px", color: "var(--text-2)" },
  ".cm-codeblock": { fontFamily: "var(--font-mono)", fontSize: "12.5px", color: "var(--text-2)", paddingLeft: "16px !important" },
  ".cm-quote": { color: "var(--text-2)", paddingLeft: "16px !important" },
  ".cm-bullet": { color: "var(--text-3)", display: "inline-block", width: "10px" },
  ".cm-task-box": {
    display: "inline-block",
    width: "13px",
    height: "13px",
    margin: "0 10px -1px 0",
    borderRadius: "4px",
    background: "var(--surface-2)",
    cursor: "pointer",
    verticalAlign: "baseline",
  },
  ".cm-task-box[data-checked=true]": { background: "var(--accent)" },
  ".cm-task-done": { color: "var(--text-3)", textDecoration: "line-through" },
  ".cm-wikilink": { color: "var(--accent-text)", cursor: "pointer" },
  // O comentário do Obsidian, quando aparece (na linha do cursor), e a legenda do ditado (o `.said` do B v4).
  ".cm-comment": { color: "var(--text-3)", opacity: "0.7" },
  ".cm-said": { fontSize: "11px", lineHeight: "1.4", color: "var(--accent-text)" },
  ".cm-said *": { fontStyle: "normal" },
  ".cm-wikilink-raw": { cursor: "text" },
  ".cm-wikilink-missing": { opacity: "0.55" },
  // Sem margem no bloco (o CodeMirror mede sem ela): o espaço vem do padding.
  ".cm-md-table-wrap": { padding: "4px 0 10px" },
  ".cm-md-table": { borderCollapse: "collapse", fontSize: "13px", cursor: "text" },
  ".cm-md-table th": { fontSize: "11px", fontWeight: "400", color: "var(--text-3)", textAlign: "left", padding: "0 28px 8px 0" },
  ".cm-md-table td": { padding: "0 28px 4px 0", fontVariantNumeric: "tabular-nums" },
  ".cm-tooltip": { border: "none", borderRadius: "10px", background: "var(--surface)", boxShadow: "var(--shadow-pop)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font)", fontSize: "13px", padding: "4px 0" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "5px 14px !important", color: "var(--text-2)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "transparent !important", color: "var(--text) !important", fontWeight: "600" },
  ".cm-completionDetail": { marginLeft: "10px", fontStyle: "normal", color: "var(--text-3)", fontWeight: "400" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent-text)" },
});

const highlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-3)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--text-3)" },
  { tag: [t.link, t.url], color: "var(--accent-text)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)" },
]);

// ---------------------------------------------------------------- o editor

/** O cache do `notes.resolve` de uma janela: cada alvo pergunta uma vez, até o vault mudar. */
export class LinkCache implements LinkResolver {
  private known = new Map<string, string | null>();
  private asking = new Set<string>();
  private views = new Set<EditorView>();
  constructor(private resolveFn: (target: string) => Promise<string | null>) {}

  attach(view: EditorView) {
    this.views.add(view);
    return () => this.views.delete(view);
  }

  status(target: string): LinkStatus {
    const key = target.toLocaleLowerCase("pt-BR");
    if (this.known.has(key)) return this.known.get(key) ? "ok" : "missing";
    if (!this.asking.has(key)) {
      this.asking.add(key);
      this.resolveFn(target).then(
        (path) => this.settle(key, path),
        () => this.settle(key, null),
      );
    }
    return "unknown";
  }

  private settle(key: string, path: string | null) {
    this.asking.delete(key);
    this.known.set(key, path);
    // Fora do ciclo de update do editor: o resolve pode ter respondido dentro dele.
    queueMicrotask(() => {
      for (const v of this.views) v.dispatch({ effects: linksChanged.of(null) });
    });
  }

  /** O vault mudou: pergunta de novo. */
  clear() {
    this.known.clear();
    for (const v of this.views) v.dispatch({ effects: linksChanged.of(null) });
  }
}

export function editorExtensions(opts: Omit<EditorOptions, "parent" | "doc" | "resolve">, links: LinkResolver): Extension[] {
  return [
    history(),
    closeBrackets(),
    markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax], addKeymap: true }),
    syntaxHighlighting(highlight),
    inlinePreview(links),
    tablePreview,
    commentPreview,
    autocompletion({ override: [linkCompletion(opts.linkTargets)], icons: false, closeOnBlur: true }),
    tableKeys,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    placeholder("Escreva, ou segure Fn e dite"),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink");
        // Link mostrado como link: um clique abre. Com o cursor dentro (o link cru), só o ⌘-clique abre.
        if (el && !el.classList.contains("cm-wikilink-raw") && el.dataset.target && e.button === 0) {
          e.preventDefault();
          opts.onOpenLink(el.dataset.target);
          return true;
        }
        if (e.metaKey && e.button === 0) {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          const link = linkAt(line.text, pos - line.from);
          if (link) {
            e.preventDefault();
            opts.onOpenLink(link.target);
            return true;
          }
          // Link do Markdown ([texto](https://…) ou <https://…>): ⌘-clique abre fora, nunca na janela.
          const url = urlAt(view.state, pos);
          if (url) {
            e.preventDefault();
            opts.onOpenUrl(url);
            return true;
          }
        }
        return false;
      },
    }),
  ];
}

/** O endereço do link do Markdown sob `pos`, se ele pode abrir fora (`externalUrl`). */
export function urlAt(state: EditorState, pos: number): string | null {
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = treeUpTo(state, pos).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "URL") return externalUrl(state.doc.sliceString(n.from, n.to));
    if (n.name === "Link" || n.name === "Autolink") {
      const u = n.getChild("URL");
      return u ? externalUrl(state.doc.sliceString(u.from, u.to)) : null;
    }
  }
  return null;
}

/** Um estado novo para outra nota: o desfazer não atravessa de uma nota para outra. */
export function stateFor(doc: string, extensions: Extension[]): EditorState {
  return EditorState.create({ doc, extensions });
}
