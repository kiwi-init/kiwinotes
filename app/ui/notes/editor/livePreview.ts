// O Markdown "ao vivo": a marcação (#, **, `, [[ ]]) some fora da linha em que o cursor está, os checkboxes viram
// caixas clicáveis e as tabelas aparecem como tabela até o cursor entrar nelas. Como no Obsidian, a nota continua
// sendo o .md puro: nada aqui muda o texto, só como ele aparece.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { tagsInLine } from "../../../src/shared/tags.ts";
import { parseLinks } from "../links.ts";
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

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });

function inCode(node: SyntaxNode | null): boolean {
  for (let n = node; n; n = n.parent) if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
}

function buildInline(view: EditorView, resolver: LinkResolver): DecorationSet {
  const { state } = view;
  const active = activeLines(state, view.hasFocus);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
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
          if (isActive(node.from)) return;
          const after = state.doc.sliceString(node.to, node.to + 1);
          // Só o "#" do começo do título ("## Custos"), não o "#" que fecha um título ("## Custos ##").
          if (node.from === state.doc.lineAt(node.from).from) out.push(hide.range(node.from, node.to + (after === " " ? 1 : 0)));
          return;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          if (!isActive(node.from)) out.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "InlineCode") {
          out.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
          return;
        }
        if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          if (!isActive(node.from)) out.push(hide.range(node.from, node.to));
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
          if (!isActive(node.from)) out.push(hide.range(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to)));
          return;
        }
        if (name === "Task") {
          const marker = node.node.getChild("TaskMarker");
          if (!marker) return;
          const checked = /x/i.test(state.doc.sliceString(marker.from, marker.to));
          const line = state.doc.lineAt(node.from);
          if (checked) out.push(Decoration.line({ class: "cm-task-done" }).range(line.from));
          // O "- " antes da caixa some, e a caixa fica mesmo na linha do cursor (menos com o cursor dentro do "[ ]").
          const listMark = node.node.parent?.getChild("ListMark");
          const cursorIn = state.selection.ranges.some((r) => r.from <= marker.to && r.to >= marker.from);
          if (cursorIn) return;
          if (listMark && !isActive(node.from)) out.push(hide.range(listMark.from, marker.from));
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(marker.from, marker.to));
          return;
        }
        if (name === "ListMark") {
          const text = state.doc.sliceString(node.from, node.to);
          const isTask = node.node.parent?.getChild("Task");
          if (!isTask && /^[-*+]$/.test(text) && !isActive(node.from)) out.push(bullet.range(node.from, node.to));
          return;
        }
      },
    });

    // Links [[…]]: fora da linha do cursor, só o nome (ou o apelido) aparece, como link.
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (DICTATION_CAPTION.test(line.text)) out.push(Decoration.line({ class: "cm-said" }).range(line.from));
      for (const link of parseLinks(line.text)) {
        const a = line.from + link.from;
        const b = line.from + link.to;
        if (inCode(tree.resolveInner(a + 2, 1))) continue;
        const status = resolver.status(link.target);
        const cls = `cm-wikilink${status === "missing" ? " cm-wikilink-missing" : ""}`;
        const attributes = { "data-target": link.target, title: status === "missing" ? `${link.target} (ainda não existe)` : link.target };
        if (isActive(a)) {
          out.push(Decoration.mark({ class: `${cls} cm-wikilink-raw`, attributes }).range(a, b));
          continue;
        }
        // O que aparece é o apelido (depois do "|") ou o alvo (até o "#" ou o "]]"); o resto some.
        const raw = line.text.slice(link.from, link.to);
        const bar = raw.lastIndexOf("|");
        const hash = raw.indexOf("#");
        const shownAt = bar > 0 ? bar + 1 : 2;
        const shownEnd = bar > 0 ? raw.length - 2 : hash > 0 ? hash : raw.length - 2;
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
const focusChanged = StateEffect.define<boolean>();
export const editorFocused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(focusChanged) ? e.value : acc), v),
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
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        // Clicar numa célula põe o cursor nela: a tabela vira texto para editar.
        let offset = 0;
        for (let i = 0; i < row; i++) offset += lines[i]!.length + 1;
        view.dispatch({ selection: { anchor: this.from + offset + rawCellStart(lines[row]!, col) } });
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

function inFrontmatter(state: EditorState, pos: number): boolean {
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
