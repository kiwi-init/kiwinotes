// O editor da nota (T1317): CodeMirror 6, local, sem CDN. Markdown do GitHub (tabelas, tarefas, riscado) com preview ao
// vivo, `[[links]]` com autocomplete e clique, e tabela com Tab e Enter. Só o corpo da nota entra aqui: o frontmatter
// fica com quem chama e volta intacto ao gravar.

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Prec, StateField, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder, showTooltip, type Tooltip } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

import { externalUrl, linkAt } from "../links.ts";
import { attachmentInput, attachmentPreview, type AttachmentSource, attachmentTheme } from "./attachments.ts";
import { commentPreview, inlinePreview, type LinkResolver, linksChanged, type LinkStatus, tablePreview, tagPreview } from "./livePreview.ts";
import { renderedPreview } from "./renderedWidget.tsx";
import { tableEnter, tableTab } from "./table.ts";
import { slashInsert, slashMatches, slashTrigger } from "./slash.ts";
import { linkFromPaste, listIndent, toggleHeading, wrapLink } from "./text.ts";
import { clearInline, insertLink, mapLines, setHeading, toggleInline, toggleList, toggleTask } from "./format.ts";

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
  /** Clique numa `#tag` do texto: a busca por ela (T2619). */
  onOpenTag?(tag: string): void;
  /** "/modelo" (T2660): a janela abre a lista de modelos e põe o escolhido no cursor. */
  onSlashTemplate?(): void;
  /** As notas para o autocomplete do `[[`. */
  linkTargets(): LinkTarget[];
  /** `notes.resolve`: para desenhar o link que ainda não existe de outro jeito. */
  resolve(target: string): Promise<string | null>;
  /** Os anexos (T2594): colar e arrastar imagem e PDF, e desenhar o `![[…]]`. Sem isto (um engine antigo), nada muda. */
  attachments?: AttachmentSource;
  /** Um aviso curto para a pessoa (o anexo que não entrou). */
  onError?(text: string): void;
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

/** Tab e ⇧Tab num item de lista (T2469): desce ou sobe um nível, com os filhos (`listIndent`). */
function listCommand(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const sel = state.selection.main;
    const first = state.doc.lineAt(sel.from).number;
    const last = state.doc.lineAt(sel.to).number;
    const lines = state.doc.toString().split("\n");
    const changes = listIndent(lines, first - 1, last - 1, dir);
    if (!changes) return false;
    if (!changes.length) return true;
    view.dispatch(
      state.update({
        changes: changes.map((c) => {
          const line = state.doc.line(c.line + 1);
          return { from: line.from, to: line.from + c.remove, insert: " ".repeat(c.add) };
        }),
        scrollIntoView: true,
        userEvent: "input.indent",
      }),
    );
    return true;
  };
}

const tableKeys = Prec.high(
  keymap.of([
    { key: "Tab", run: tableCommand((x, o) => tableTab(x, o, 1)) },
    { key: "Shift-Tab", run: tableCommand((x, o) => tableTab(x, o, -1)) },
    { key: "Enter", run: tableCommand(tableEnter) },
    // Fora de tabela, num item de lista.
    { key: "Tab", run: listCommand(1) },
    { key: "Shift-Tab", run: listCommand(-1) },
  ]),
);

// ---------------------------------------------------------------- aparência

/** As cores e fontes vêm dos tokens do app (tokens.css), então o claro e o escuro seguem o sistema sozinhos. */
const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "transparent", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.65", overflow: "visible" },
  // T5299 (#212): nunca scroll horizontal. O CodeMirror põe `flex-shrink: 0` no conteúdo, e o `min-width: auto` do flex
  // fazia a coluna inteira crescer até a coisa mais larga que não quebra (URL, bloco de código, tabela). Com o conteúdo
  // podendo encolher, a linha quebra na largura da coluna; URL e palavra gigante quebram em qualquer ponto.
  ".cm-content": { padding: "0 0 40vh", caretColor: "var(--accent)", minWidth: "0", flexShrink: "1" },
  "&.cm-editor .cm-lineWrapping": { overflowWrap: "anywhere" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-placeholder": { color: "var(--text-3)" },
  // Títulos: hierarquia por tamanho, peso e espaço (B v4), nunca por linha.
  ".cm-h": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-h1": { fontSize: "20px", paddingTop: "22px !important", letterSpacing: "var(--tracking-tight)" },
  ".cm-h2": { fontSize: "14px", paddingTop: "20px !important", paddingBottom: "2px !important" },
  ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { fontSize: "14px", color: "var(--text-2)", paddingTop: "14px !important" },
  ".cm-inline-code": { fontFamily: "var(--font-mono)", fontSize: "var(--text-code)", color: "var(--text-2)" },
  ".cm-codeblock": { fontFamily: "var(--font-mono)", fontSize: "var(--text-code)", color: "var(--text-2)", paddingLeft: "16px !important" },
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
  // A #tag como etiqueta (T2619): o mesmo verde do link, num fundo suave, e o clique busca por ela.
  ".cm-tag": {
    color: "var(--accent-text)",
    backgroundColor: "var(--accent-soft)",
    borderRadius: "4px",
    padding: "0 3px",
    cursor: "pointer",
  },
  // O comentário do Obsidian, quando aparece (na linha do cursor), e a legenda do ditado (o `.said` do B v4).
  ".cm-comment": { color: "var(--text-3)", opacity: "0.7" },
  ".cm-said": { fontSize: "11px", lineHeight: "1.4", color: "var(--accent-text)" },
  ".cm-said *": { fontStyle: "normal" },
  ".cm-wikilink-raw": { cursor: "text" },
  ".cm-wikilink-missing": { opacity: "0.55" },
  // Sem margem no bloco (o CodeMirror mede sem ela): o espaço vem do padding.
  // A tabela larga rola dentro dela, nunca a nota (T5299).
  ".cm-md-table-wrap": { padding: "4px 0 10px", maxWidth: "100%", overflowX: "auto" },
  // As células não quebram no meio da palavra (o `anywhere` da linha não vale aqui): a tabela rola dentro dela.
  ".cm-md-table": { borderCollapse: "collapse", fontSize: "13px", cursor: "text", overflowWrap: "normal", whiteSpace: "nowrap" },
  ".cm-md-table th": { fontSize: "11px", fontWeight: "400", color: "var(--text-3)", textAlign: "left", padding: "0 28px 8px 0" },
  ".cm-md-table td": { padding: "0 28px 4px 0", fontVariantNumeric: "tabular-nums" },
  ".cm-tooltip": { border: "none", borderRadius: "10px", background: "var(--surface)", boxShadow: "var(--shadow-pop)" },
  // Com as duas classes: o tema base do CodeMirror põe monospace em `.cm-tooltip.cm-tooltip-autocomplete > ul`.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--ui, var(--font))", fontSize: "13px", padding: "4px 0" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "5px 14px !important", color: "var(--text-2)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "transparent !important", color: "var(--text) !important", fontWeight: "600" },
  // A barra de formatação (T2660): um grupo que flutua, como os do Channels.
  ".cm-tooltip:has(> .kn-fmt)": { background: "var(--float, var(--surface))", boxShadow: "var(--shadow-float, var(--shadow-pop))", borderRadius: "10px" },
  ".kn-fmt": { display: "flex", gap: "2px", padding: "2px" },
  ".kn-fmt-bt": {
    minWidth: "28px",
    height: "28px",
    padding: "0 8px",
    border: "0",
    borderRadius: "8px",
    background: "none",
    color: "var(--ink-2, var(--text-2))",
    font: "600 13px/1 var(--ui, var(--font))",
    cursor: "default",
  },
  ".kn-fmt-bt:hover": { background: "var(--wash-2, var(--surface-hover))", color: "var(--ink, var(--text))" },
  ".kn-fmt-italic": { fontStyle: "italic", fontFamily: "Georgia, serif" },
  ".kn-fmt-code": { fontFamily: "var(--mono, var(--font-mono))", fontSize: "11px" },
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
    // O colar-link é o nosso (o `paste` abaixo): o do lang-markdown não escapa "(" nem ")" do endereço nem "[" do texto.
    markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax], addKeymap: true, pasteURLAsLink: false }),
    syntaxHighlighting(highlight),
    // Os blocos fora do cursor, desenhados pela lib do Channels (T2983); antes do resto, para cobrir o preview de linha.
    renderedPreview(links, opts),
    inlinePreview(links),
    tagPreview,
    tablePreview,
    commentPreview,
    ...(opts.attachments ? [attachmentPreview(opts.attachments), attachmentInput(opts.attachments, (t) => opts.onError?.(t)), attachmentTheme] : []),
    autocompletion({ override: [slashCompletion(opts), linkCompletion(opts.linkTargets)], icons: false, closeOnBlur: true }),
    formatBar,
    tableKeys,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    placeholder("Escreva, ou segure Fn e dite"),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      // Colar um link com texto selecionado vira [texto](link).
      paste(e, view) {
        const sel = view.state.selection.main;
        if (sel.empty || view.state.selection.ranges.length > 1) return false;
        const link = linkFromPaste(view.state.sliceDoc(sel.from, sel.to), e.clipboardData?.getData("text/plain") ?? "");
        if (!link) return false;
        e.preventDefault();
        view.dispatch(view.state.replaceSelection(link), { userEvent: "input.paste", scrollIntoView: true });
        return true;
      },
      mousedown(e, view) {
        // Um clique na #tag abre a busca por ela; com ⌥, o clique só põe o cursor (para editar a tag).
        const tagEl = (e.target as HTMLElement).closest<HTMLElement>(".cm-tag");
        if (tagEl?.dataset.tag && e.button === 0 && !e.altKey && !e.shiftKey && opts.onOpenTag) {
          e.preventDefault();
          opts.onOpenTag(tagEl.dataset.tag);
          return true;
        }
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

// ---------------------------------------------------------------- o comando "/" (T2660)

/** O menu do "/": no começo da linha ou depois de um espaço. O texto de cada item vem do slash.ts. */
export function slashCompletion(opts: Pick<EditorOptions, "onSlashTemplate">) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const trig = slashTrigger(line.text.slice(0, ctx.pos - line.from));
    if (!trig) return null;
    // Dentro de código, "/" é só "/".
    for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent) {
      if (n.name === "FencedCode" || n.name === "InlineCode" || n.name === "CodeBlock") return null;
    }
    const from = line.from + trig.from;
    const options: Completion[] = slashMatches(trig.typed).map((it, i) => ({
      label: it.label,
      detail: it.detail,
      // A ordem do slash.ts, não a do filtro do CodeMirror.
      boost: 100 - i,
      apply: (view: EditorView, _c: Completion, a: number, b: number) => {
        if (it.id === "template") {
          view.dispatch({ changes: { from: a, to: b, insert: "" }, selection: { anchor: a } });
          opts.onSlashTemplate?.();
          return;
        }
        const r = slashInsert(it.id, trig.atLineStart, new Date());
        if (!r) return;
        view.dispatch({ changes: { from: a, to: b, insert: r.insert }, selection: { anchor: a + r.cursor }, userEvent: "input.complete" });
        // "[[" abre a lista de notas, como se a pessoa tivesse digitado.
        if (it.id === "link") startCompletion(view);
      },
    }));
    return { from, to: ctx.pos, options, filter: false };
  };
}

// ---------------------------------------------------------------- a barra de formatação (T2660)

type FormatAction = "bold" | "italic" | "strike" | "highlight" | "code" | "link" | "heading";

/** Aplica uma ação da barra na seleção principal. */
export function applyFormat(view: EditorView, action: FormatAction): void {
  const { state } = view;
  const sel = state.selection.main;
  if (action === "heading") {
    const line = state.doc.lineAt(sel.from);
    const next = toggleHeading(line.text);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: line.from, head: line.from + next.length } });
    return;
  }
  const selected = state.sliceDoc(sel.from, sel.to);
  if (action === "link") {
    const r = wrapLink(selected);
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: r.insert }, selection: { anchor: sel.from + r.cursor } });
    view.focus();
    return;
  }
  view.dispatch(toggleInline(state, action));
}

/** Roda um comando de `format.ts` (que devolve a transação) como comando do CodeMirror. */
const run = (make: (s: EditorState) => TransactionSpec | null) => (view: EditorView) => {
  const spec = make(view.state);
  if (!spec) return false;
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input.format" });
  return true;
};

/**
 * Os atalhos de formatação (E1, T5555). São de edição, então ficam fixos, como o ⌘B (os globais estão em Configurações
 * › Atalhos). Os mesmos do Typora e do Google Docs: ⌘1 a ⌘6 títulos e ⌘0 corpo; ⇧⌘7/8/9 numerada, lista e tarefas.
 * O ⌘K só vira link com texto selecionado; sem seleção, a tecla segue para a paleta das Notas.
 */
export const FORMAT_KEYS: { key: string; label: string; run: (view: EditorView) => boolean }[] = [
  { key: "Mod-b", label: "Negrito", run: run((s) => toggleInline(s, "bold")) },
  { key: "Mod-i", label: "Itálico", run: run((s) => toggleInline(s, "italic")) },
  { key: "Shift-Mod-x", label: "Tachado", run: run((s) => toggleInline(s, "strike")) },
  { key: "Shift-Mod-h", label: "Realce", run: run((s) => toggleInline(s, "highlight")) },
  { key: "Mod-e", label: "Código", run: run((s) => toggleInline(s, "code")) },
  { key: "Mod-/", label: "Comentário", run: run((s) => toggleInline(s, "comment")) },
  { key: "Mod-k", label: "Link", run: run((s) => (s.selection.main.empty ? null : insertLink(s))) },
  { key: "Mod-\\", label: "Limpar formatação", run: run(clearInline) },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-${level}`, label: `Título ${level}`, run: run((s) => mapLines(s, (ls) => ls.map((l) => setHeading(l, level)))) })),
  { key: "Mod-0", label: "Corpo", run: run((s) => mapLines(s, (ls) => ls.map((l) => setHeading(l, 0)))) },
  { key: "Shift-Mod-8", label: "Lista", run: run((s) => mapLines(s, (ls) => toggleList(ls, "bullet"))) },
  { key: "Shift-Mod-7", label: "Lista numerada", run: run((s) => mapLines(s, (ls) => toggleList(ls, "numbered"))) },
  { key: "Shift-Mod-9", label: "Lista de tarefas", run: run((s) => mapLines(s, (ls) => toggleList(ls, "task"))) },
  { key: "Shift-Mod-.", label: "Citação", run: run((s) => mapLines(s, (ls) => toggleList(ls, "quote"))) },
  { key: "Mod-l", label: "Marcar tarefa", run: run((s) => mapLines(s, (ls) => ls.map((l) => (l.trim() ? toggleTask(l) : l)))) },
];

const FORMAT_BUTTONS: { action: FormatAction; label: string; title: string }[] = [
  { action: "bold", label: "B", title: "Negrito (⌘B)" },
  { action: "italic", label: "I", title: "Itálico (⌘I)" },
  { action: "strike", label: "S", title: "Tachado (⇧⌘X)" },
  { action: "highlight", label: "==", title: "Realce (⇧⌘H)" },
  { action: "code", label: "</>", title: "Código (⌘E)" },
  { action: "link", label: "Link", title: "Link (⌘K)" },
  { action: "heading", label: "H", title: "Cabeçalho" },
];

function formatTooltip(state: EditorState): Tooltip | null {
  const sel = state.selection.main;
  if (sel.empty || state.selection.ranges.length > 1) return null;
  return {
    pos: sel.from,
    above: true,
    strictSide: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "kn-fmt";
      dom.setAttribute("role", "toolbar");
      dom.setAttribute("aria-label", "Formatação");
      for (const b of FORMAT_BUTTONS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `kn-fmt-bt kn-fmt-${b.action}`;
        btn.textContent = b.label;
        btn.title = b.title;
        // O mousedown tiraria a seleção do editor: a barra age sem pegar o foco.
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => applyFormat(view, b.action));
        dom.append(btn);
      }
      return { dom };
    },
  };
}

/** A barra aparece em cima de uma seleção, como a do Channels; some quando a seleção acaba. */
const formatBar = [
  StateField.define<Tooltip | null>({
    create: (state) => formatTooltip(state),
    update: (tip, tr) => (tr.docChanged || tr.selection ? formatTooltip(tr.state) : tip),
    provide: (f) => showTooltip.from(f),
  }),
  keymap.of(FORMAT_KEYS.map(({ key, run }) => ({ key, run }))),
];
