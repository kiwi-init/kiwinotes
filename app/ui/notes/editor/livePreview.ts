// O Markdown "ao vivo": a marcação (#, **, `, [[ ]]) some fora do trecho em que o cursor está (spec #17690), os checkboxes viram
// caixas clicáveis e as tabelas aparecem como tabela até o cursor entrar nelas. Como no Obsidian, a nota continua
// sendo o .md puro: nada aqui muda o texto, só como ele aparece.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

import { tagsInLine } from "../../../src/shared/tags.ts";
import { parseLinks } from "../links.ts";
import { footnoteJump, footnoteLabel, footnotesOf, superscript } from "./footnotes.ts";
import { parseTable } from "./table.ts";

// ---------------------------------------------------------------- links

export type LinkStatus = "ok" | "missing" | "unknown";

export interface LinkResolver {
  /** Para onde aponta `[[alvo]]` (pelo `notes.resolve` do engine): "unknown" até a resposta chegar. */
  status(target: string): LinkStatus;
}

/** Avisa o editor que chegaram respostas do resolve, para redesenhar os links. */
export const linksChanged = StateEffect.define<null>();

/**
 * As linhas que têm cursor ou seleção: nelas a marcação aparece, para dar para editar. Com o editor sem foco, nenhuma:
 * a nota aberta ainda sem clique mostra tudo como preview.
 */
function activeLines(state: EditorState, focused = true): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly at: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-task-box";
    box.dataset.checked = String(this.checked);
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // O marcador é "[ ]" ou "[x]": troca só o caractere do meio.
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** O "## " do título com o cursor nele (T17784): na margem, à esquerda, para o título não sair do lugar. */
class HeadMarkWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: HeadMarkWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const mark = document.createElement("span");
    mark.className = "cm-hmark";
    mark.textContent = this.text;
    return mark;
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * O marcador do item (T17784, spec #17690), sempre desenhado e no recuo, onde a lista desenhada põe o dela; o texto do
 * item começa no mesmo lugar nas duas caras: o número como está, e no lugar do "-" o mesmo marcador da
 * lista desenhada do WebKit, que muda com o nível (o disco, o círculo e, do 3º nível em diante, o quadrado).
 */
class ListMarkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly level: number,
  ) {
    super();
  }
  eq(other: ListMarkWidget) {
    return other.text === this.text && other.level === this.level;
  }
  toDOM() {
    const mark = document.createElement("span");
    mark.setAttribute("aria-hidden", "true");
    if (/^[-*+]$/.test(this.text)) {
      mark.className = "cm-bullet";
      const dot = document.createElement("span");
      dot.className = `cm-dot cm-dot-${this.level <= 1 ? "disc" : this.level === 2 ? "circle" : "square"}`;
      mark.append(dot);
    } else {
      mark.className = "cm-bullet cm-bullet-n";
      mark.textContent = this.text;
    }
    return mark;
  }
  ignoreEvent() {
    return false;
  }
}

export const LIST_INDENT = 22;
/** Os níveis com classe de recuo; mais fundo que isto fica no último. */
export const LIST_DEPTH_MAX = 6;

/**
 * O item que não abre a lista (T17784): o 2º em diante, ou o primeiro de uma lista recuada. Na lista desenhada ele tem
 * 2 px em cima (o `itemSpacing`); o item cru e o bloco desenhado que começa nele guardam esse espaço.
 */
export function itemHasGap(item: SyntaxNode): boolean {
  return !!item.prevSibling || listDepth(item) > 1;
}

/** O item de lista que começa na linha de `lineFrom`, se houver. */
export function listItemAtLine(state: EditorState, tree: Tree, lineFrom: number): SyntaxNode | null {
  const line = state.doc.lineAt(lineFrom);
  const start = line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0);
  for (let n: SyntaxNode | null = tree.resolveInner(start, 1); n; n = n.parent) {
    if (n.name === "ListItem") return n.from >= line.from ? n : null;
  }
  return null;
}

/** Quantas listas há em volta do nó: 1 numa lista de fora, 2 numa lista dentro de um item, e assim por diante. */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let n: SyntaxNode | null = node; n; n = n.parent) if (n.name === "BulletList" || n.name === "OrderedList") depth++;
  return depth;
}

/**
 * O número de uma nota de rodapé fora da linha do cursor (T6377): o `[^1]`, o `^[…]` e o `[^1]:` da definição viram o
 * número em sobrescrito. O clique anda entre a chamada e a definição, como no bloco desenhado; o hover mostra o texto.
 */
class FootnoteWidget extends WidgetType {
  constructor(
    readonly shown: string,
    readonly cls: string,
    readonly attrs: Record<string, string>,
    readonly jump: Parameters<typeof footnoteJump>[1],
  ) {
    super();
  }
  eq(other: FootnoteWidget) {
    return other.shown === this.shown && other.cls === this.cls && JSON.stringify(other.attrs) === JSON.stringify(this.attrs);
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = this.cls;
    el.textContent = this.shown;
    for (const [k, v] of Object.entries(this.attrs)) el.setAttribute(k, v);
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.altKey || e.shiftKey) return;
      e.preventDefault();
      focusEditorNow(view);
      const tr = footnoteJump(view.state, this.jump);
      if (tr) view.dispatch(tr);
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const hide = Decoration.replace({});

function inCode(node: SyntaxNode | null): boolean {
  for (let n = node; n; n = n.parent) if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
}

function buildInline(view: EditorView, resolver: LinkResolver): DecorationSet {
  return inlineDecorations(view.state, view.hasFocus, view.visibleRanges, resolver);
}

/**
 * As decorações do preview em linha, sem DOM (testadas): `focused` é o editor com foco, `ranges` os trechos na tela.
 */
export function inlineDecorations(state: EditorState, focused: boolean, ranges: readonly { from: number; to: number }[], resolver: LinkResolver): DecorationSet {
  // Spec #17690: a marca só aparece no trecho exato onde está o cursor (o `**` do negrito em que ele está, o link em que
  // ele está), e não na linha inteira. O resto da linha continua desenhado, sem nada pular.
  const near = (from: number, to: number) => focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const around = (node: { node: SyntaxNode }) => {
    const p = node.node.parent;
    return p ? near(p.from, p.to) : false;
  };
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          out.push(Decoration.line({ class: `cm-h cm-h${heading[1]}` }).range(state.doc.lineAt(node.from).from));
          return;
        }
        if (name === "HeaderMark") {
          const after = state.doc.sliceString(node.to, node.to + 1);
          // Só o "#" do começo do título ("## Custos"), não o "#" que fecha um título ("## Custos ##").
          if (node.from !== state.doc.lineAt(node.from).from) return;
          const end = node.to + (after === " " ? 1 : 0);
          // Com o cursor nele, o "## " aparece na margem, à esquerda, e o título não sai do lugar (T17784).
          // Um widget, não uma marca: o texto dentro da caixa da margem não é editado (o WebKit perdia o espaço do "## ").
          out.push(near(node.from, end) ? Decoration.replace({ widget: new HeadMarkWidget(state.doc.sliceString(node.from, end)) }).range(node.from, end) : hide.range(node.from, end));
          return;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          if (!around(node)) out.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "Highlight") {
          out.push(Decoration.mark({ class: "cm-highlight" }).range(node.from, node.to));
          return;
        }
        if (name === "HighlightMark") {
          if (!around(node)) out.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "InlineCode") {
          out.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
          return;
        }
        if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          if (!around(node)) out.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "FencedCode") {
          for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++) {
            out.push(Decoration.line({ class: "cm-codeblock" }).range(state.doc.line(n).from));
          }
          return false;
        }
        if (name === "QuoteMark") {
          out.push(Decoration.line({ class: "cm-quote" }).range(state.doc.lineAt(node.from).from));
          const quoteEnd = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
          if (!near(node.from, quoteEnd)) out.push(hide.range(node.from, quoteEnd));
          return;
        }
        if (name === "Task") {
          const marker = node.node.getChild("TaskMarker");
          if (!marker) return;
          const checked = /x/i.test(state.doc.sliceString(marker.from, marker.to));
          const line = state.doc.lineAt(node.from);
          if (checked) out.push(Decoration.line({ class: "cm-task-done" }).range(line.from));
          // O "- " antes da caixa some sempre, como na lista desenhada (T17784); a caixa fica, menos com o cursor no "[ ]".
          const listMark = node.node.parent?.getChild("ListMark");
          if (listMark && state.doc.lineAt(listMark.from).number === line.number) out.push(hide.range(listMark.from, marker.from));
          const cursorIn = state.selection.ranges.some((r) => r.from <= marker.to && r.to >= marker.from);
          if (cursorIn) return;
          // O espaço depois do "]" vai junto: a margem da caixa já é o espaço até o texto.
          const gap = /[ \t]/.test(state.doc.sliceString(marker.to, marker.to + 1)) ? 1 : 0;
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(marker.from, marker.to + gap));
          return;
        }
        if (name === "ListMark") {
          // A linha do item com o recuo e o espaço da lista desenhada, com o cursor nela ou fora (T17784, spec #17690):
          // o marcador fica desenhado no recuo, os espaços do começo somem, e o texto começa onde começa no desenho.
          const line = state.doc.lineAt(node.from);
          const item = node.node.parent;
          const list = item?.parent;
          if (!item || !list || !/^\s*$/.test(state.doc.sliceString(line.from, node.from))) return;
          const text = state.doc.sliceString(node.from, node.to);
          const isTask = !!item.getChild("Task");
          const depth = Math.min(listDepth(item), LIST_DEPTH_MAX);
          // A lista de tarefas desenhada não tem recuo próprio (o `listStyle` da lib): a caixa fica na margem do nível.
          const level = isTask ? depth - 1 : depth;
          out.push(Decoration.line({ class: `cm-li cm-li-${level}${itemHasGap(item) ? " cm-li-gap" : ""}` }).range(line.from));
          if (node.from > line.from) out.push(hide.range(line.from, node.from));
          if (isTask) return;
          const after = state.doc.sliceString(node.to, node.to + 1);
          const end = after === " " || after === "\t" ? node.to + 1 : node.to;
          out.push(Decoration.replace({ widget: new ListMarkWidget(text, depth) }).range(node.from, end));
          return;
        }
      },
    });

    // As notas de rodapé (T6377): na linha do cursor, o `[^1]` cru e marcado; fora dela, o número.
    const notes = footnotesOf(state);
    /** As notas em linha que viraram número: os links de dentro delas não ganham decoração. */
    const folded: [number, number][] = [];
    for (const m of notes.marks) {
      if (m.to < from || m.from > to || inCode(tree.resolveInner(m.from + 1, 1))) continue;
      const missing = m.kind === "ref" && !notes.def(m.label);
      const cls = `cm-footnote${missing ? " cm-footnote-missing" : ""}`;
      const attrs: Record<string, string> = m.kind === "ref" ? { "data-footnote": m.label } : { "data-footnote-n": String(m.n) };
      if (near(m.from, m.to)) {
        out.push(Decoration.mark({ class: `${cls} cm-footnote-raw`, attributes: attrs }).range(m.from, m.to));
        continue;
      }
      const jump = m.kind === "ref" ? { kind: "footnote" as const, label: m.label } : { kind: "footnoteInline" as const, n: m.n };
      if (m.kind === "inline") folded.push([m.from, m.to]);
      out.push(Decoration.replace({ widget: new FootnoteWidget(superscript(m.n), cls, attrs, jump) }).range(m.from, m.to));
    }
    for (const d of notes.defs) {
      const marker = d.markerTo - `[^${d.label}]:`.length;
      if (d.markerTo < from || marker > to || inCode(tree.resolveInner(marker + 1, 1))) continue;
      if (near(marker, d.markerTo)) {
        out.push(Decoration.mark({ class: "cm-footnote cm-footnote-def cm-footnote-raw" }).range(marker, d.markerTo));
        continue;
      }
      const jump = { kind: "footnoteDef" as const, label: d.label };
      out.push(Decoration.replace({ widget: new FootnoteWidget(footnoteLabel(notes, d.label), "cm-footnote cm-footnote-def", {}, jump) }).range(marker, d.markerTo));
    }

    // Links [[…]]: fora da linha do cursor, só o nome (ou o apelido) aparece, como link.
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (DICTATION_CAPTION.test(line.text)) out.push(Decoration.line({ class: "cm-said" }).range(line.from));
      for (const link of parseLinks(line.text)) {
        const a = line.from + link.from;
        const b = line.from + link.to;
        if (inCode(tree.resolveInner(a + 2, 1))) continue;
        if (folded.some(([x, y]) => a >= x && a < y)) continue;
        const status = link.target ? resolver.status(link.target) : "ok";
        const cls = `cm-wikilink${status === "missing" ? " cm-wikilink-missing" : ""}`;
        const destination = link.target + (link.heading ? `#${link.heading}` : "");
        const attributes = { "data-target": destination, title: status === "missing" ? `${link.target} (ainda não existe)` : destination };
        if (near(a, b)) {
          out.push(Decoration.mark({ class: `${cls} cm-wikilink-raw`, attributes }).range(a, b));
          continue;
        }
        // O que aparece é o apelido (depois do "|") ou o alvo (até o "#" ou o "]]"); o resto some.
        const raw = line.text.slice(link.from, link.to);
        const bar = raw.lastIndexOf("|");
        const hash = raw.indexOf("#");
        const shownAt = bar > 0 ? bar + 1 : !link.target && hash > 0 ? hash + 1 : 2;
        const shownEnd = bar > 0 || !link.target ? raw.length - 2 : hash > 0 ? hash : raw.length - 2;
        if (shownEnd <= shownAt) continue; // apelido vazio ("[[Ana|]]"): fica cru
        out.push(hide.range(a, a + shownAt));
        out.push(Decoration.mark({ class: cls, attributes }).range(a + shownAt, a + shownEnd));
        out.push(hide.range(a + shownEnd, b));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

export function inlinePreview(resolver: LinkResolver) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInline(view, resolver);
      }
      update(u: ViewUpdate) {
        const resolved = u.transactions.some((t) => t.effects.some((e) => e.is(linksChanged)));
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || resolved || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = buildInline(u.view, resolver);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---------------------------------------------------------------- comentários e legenda do ditado

/**
 * A legenda que o ditado→nota (A3, T1320/T1565) põe embaixo do trecho ditado, com o id do ditado num comentário do
 * Obsidian: `*🎙 ditado às 14:30* %%dictation:…%%`. Fica pequena e verde, como o `.said` do B v4.
 */
export const DICTATION_CAPTION = /^\*🎙 ditado às \d\d:\d\d\*( %%dictation:[^%]+%%)?$/u;

/** Os comentários do Obsidian (`%%…%%`, inclusive de várias linhas) no texto: [início, fim). Um `%%` sem par não conta. */
export function findComments(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/%%[\s\S]*?%%/g)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** O editor está com o foco? Sem foco, nada é "linha do cursor": a nota inteira fica em preview. */
export const focusChanged = StateEffect.define<boolean>();
export const editorFocused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(focusChanged) ? e.value : acc), v),
});

/**
 * O foco volta para o editor, e o `editorFocused` vai junto, na hora. A transação de foco do CodeMirror chega uns 10 ms
 * depois, e o que fosse despachado antes dela ainda via o editor sem foco, com o bloco de destino desenhado: o
 * navegador punha o cursor na beira do desenho, e o texto digitado logo em seguida caía na linha de cima (o menu
 * Inserir › Nota de rodapé, T6377). Chame antes de despachar a ação.
 */
export function focusEditorNow(view: EditorView): void {
  view.focus();
  if (view.hasFocus && view.state.field(editorFocused, false) === false) view.dispatch({ effects: focusChanged.of(true) });
}

/**
 * O `editorFocused` igual ao foco de verdade. O CodeMirror monta a transação de foco quando o foco muda e a aplica um
 * instante depois. Se o foco voltou nesse meio, ela chega com o valor velho, e ele não corrige mais. Foi o que
 * aconteceu no /modelo, que insere com a paleta na frente e devolve o foco logo em seguida. Com o campo em `false` e o
 * editor focado, o bloco do cursor continuava desenhado. O clique punha o cursor nele, mas o do navegador ia para a
 * beira do desenho, e o texto digitado caía na linha de baixo (T3190). Quando os dois discordam, o campo é corrigido.
 */
const focusReconcile = ViewPlugin.define((view) => {
  let queued = false;
  const settle = () => {
    queued = false;
    const field = view.state.field(editorFocused, false);
    if (field !== undefined && field !== view.hasFocus && view.dom.isConnected) view.dispatch({ effects: focusChanged.of(view.hasFocus) });
  };
  return {
    update(u: ViewUpdate) {
      const field = u.state.field(editorFocused, false);
      if (queued || field === undefined || field === u.view.hasFocus) return;
      // Fora do update: nada de dispatch no meio de outro.
      queued = true;
      queueMicrotask(settle);
    },
  };
});

function buildComments(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const focused = state.field(editorFocused, false) ?? false;
  const active = activeLines(state, focused);
  const tree = syntaxTree(state);
  for (const [a, b] of findComments(state.doc.toString())) {
    // `%%` dentro de código é código: fica como foi escrito.
    let code = false;
    for (let n: SyntaxNode | null = tree.resolveInner(a, 1); n; n = n.parent) {
      if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") code = true;
    }
    if (code) continue;
    const first = state.doc.lineAt(a);
    const last = state.doc.lineAt(b);
    let touched = false;
    for (let n = first.number; n <= last.number && !touched; n++) touched = active.has(n);
    if (touched) {
      // Na linha do cursor aparece apagado, para dar para editar.
      out.push(Decoration.mark({ class: "cm-comment" }).range(a, b));
    } else if (a === first.from && b === last.to && first.number !== last.number) {
      // Um bloco de linhas inteiras some sem deixar linha vazia.
      out.push(Decoration.replace({ block: true }).range(a, b));
    } else {
      // No fim da linha, o espaço antes do comentário some junto ("legenda %%id%%" → "legenda").
      const from = b === last.to && a > first.from && state.doc.sliceString(a - 1, a) === " " ? a - 1 : a;
      out.push(hide.range(from, b));
    }
  }
  return Decoration.set(out, true);
}

/**
 * O comentário do Obsidian some fora da linha do cursor, como no Obsidian. Vem de um StateField porque um comentário
 * de várias linhas esconde quebras de linha, o que um ViewPlugin não pode fazer.
 */
export const commentPreview = [
  editorFocused,
  EditorView.focusChangeEffect.of((_state, focusing) => focusChanged.of(focusing)),
  focusReconcile,
  StateField.define<DecorationSet>({
    create: buildComments,
    update(value, tr) {
      const focus = tr.effects.some((e) => e.is(focusChanged));
      if (tr.docChanged || tr.selection || focus || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildComments(tr.state);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  }),
];

// ---------------------------------------------------------------- tabelas

/** Onde começa o texto da célula `col` numa linha de tabela crua (com ou sem o pipe do começo). */
export function rawCellStart(line: string, col: number): number {
  let i = 0;
  while (line[i] === " ") i++;
  let pipes = line[i] === "|" ? -1 : 0;
  for (; i < line.length && pipes < col; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") i++;
    else if (line[i] === "|") pipes++;
  }
  if (pipes === -1) i++;
  while (line[i] === " ") i++;
  return Math.min(i, line.length);
}

class TableWidget extends WidgetType {
  constructor(readonly text: string, readonly from: number) {
    super();
  }
  eq(other: TableWidget) {
    return other.text === this.text && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const t = parseTable(this.text);
    // O espaço em volta vem do padding do invólucro: o CodeMirror mede o bloco sem a margem, e uma margem na tabela
    // deixava a medida das linhas de baixo 14 px atrás (o clique caía na linha seguinte).
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    wrap.append(table);
    if (!t) return wrap;
    const lines = this.text.split("\n");
    const cell = (tag: "th" | "td", text: string, row: number, col: number) => {
      const el = document.createElement(tag);
      el.textContent = text.replace(/\\\|/g, "|");
      const a = t.align[col];
      if (a) el.style.textAlign = a;
      let offset = 0;
      for (let i = 0; i < row; i++) offset += lines[i]!.length + 1;
      const cellPos = this.from + offset + rawCellStart(lines[row]!, col);
      el.dataset.kiwiTablePos = String(cellPos);
      el.addEventListener("mousedown", (e) => {
        // Keep the widget alive until contextmenu reaches NoteEditor on a secondary click.
        if (e.button !== 0 || e.ctrlKey) { e.preventDefault(); return; }
        e.preventDefault();
        // Clicar numa célula põe o cursor nela: a tabela vira texto para editar.
        view.dispatch({ selection: { anchor: cellPos } });
        view.focus();
      });
      return el;
    };
    const head = table.createTHead().insertRow();
    t.header.forEach((h, c) => head.append(cell("th", h, 0, c)));
    const body = table.createTBody();
    t.rows.forEach((r, i) => {
      const tr = body.insertRow();
      r.forEach((v, c) => tr.append(cell("td", v, i + 2, c)));
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildTables(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (state.selection.ranges.some((r) => r.to >= from && r.from <= to)) return false;
      const text = state.doc.sliceString(from, to);
      if (parseTable(text)) out.push(Decoration.replace({ widget: new TableWidget(text, from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(out);
}

/** As tabelas aparecem como tabela; com o cursor dentro, voltam a ser texto (as decorações de bloco vêm de um StateField). */
export const tablePreview = StateField.define<DecorationSet>({
  create: buildTables,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildTables(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});


// ---------------------------------------------------------------- tags (T2619)

const TAG_SKIP = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "URL", "Link", "Autolink", "HTMLBlock", "Comment"]);

function buildTags(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      for (const t of tagsInLine(line.text)) {
        const a = line.from + t.from;
        let skip = false;
        for (let n: SyntaxNode | null = tree.resolveInner(a, 1); n && !skip; n = n.parent) skip = TAG_SKIP.has(n.name);
        // O frontmatter não é Markdown: lá a tag é do YAML, não do texto.
        if (!skip && !inFrontmatter(view.state, a)) {
          out.push(Decoration.mark({ class: "cm-tag", attributes: { "data-tag": t.tag } }).range(a, line.from + t.to));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

export function inFrontmatter(state: EditorState, pos: number): boolean {
  if (!state.doc.sliceString(0, 4).startsWith("---")) return false;
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(state.doc.sliceString(0, Math.min(state.doc.length, 20_000)));
  return !!m && pos < m[0].length;
}

/** A `#tag` do texto aparece como etiqueta, e um clique abre a busca por ela (T2619). */
export const tagPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildTags(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = buildTags(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
