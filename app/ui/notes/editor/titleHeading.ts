// O título não repete (spec #12626, ponto 1): quando a primeira linha da nota (depois do frontmatter) é um `# ` igual
// ao título, a nota aberta não mostra esse H1 de novo embaixo do título. Só na vista: o arquivo não muda. Some como os
// comentários `%%…%%` (`livePreview.ts`) e volta quando a seleção toca a linha, para dar para editar (⌘↑, a seta para
// cima e ⌘A+⌫ nunca mexem num texto invisível). Renomear pelo campo do título deixa o H1 diferente, e ele reaparece.

import { Compartment, type EditorState, type Extension, Facet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { editorFocused, focusChanged } from "./livePreview.ts";

/**
 * O H1 é o título: a regra que o app usa para virar o título no nome do arquivo (o `rename` das Notas): o texto em NFC,
 * com `trim()` e `\ / :` trocados por `-`, comparado sem mudar maiúsculas com o título da nota.
 */
export function sameTitle(heading: string, title: string): boolean {
  const name = heading.normalize("NFC").trim().replace(/[\\/:]/g, "-");
  return name.length > 0 && name === title.normalize("NFC").trim();
}

/** O frontmatter do começo da nota, com a quebra do fim: onde a primeira linha de verdade começa. */
function afterFrontmatter(state: EditorState): number {
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 20_000));
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(head);
  return m ? m[0].length : 0;
}

/**
 * O trecho do H1 repetido: a linha do `# <título>` e a linha em branco que vem depois, ou null. Linhas em branco entre o
 * frontmatter e o H1 não contam: ele ainda é a primeira linha de texto.
 */
export function titleHeadingLines(state: EditorState, title: string | null): { first: number; last: number } | null {
  if (!title) return null;
  const doc = state.doc;
  let line = doc.lineAt(afterFrontmatter(state));
  while (!line.text.trim() && line.number < doc.lines) line = doc.line(line.number + 1);
  const m = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line.text);
  if (!m || !sameTitle(m[1]!, title)) return null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  return { first: line.number, last: next && !next.text.trim() && next.number < doc.lines ? next.number : line.number };
}

/** A seleção toca o trecho (com o editor focado): ele aparece, para editar. */
function touched(state: EditorState, first: number, last: number): boolean {
  if (!(state.field(editorFocused, false) ?? false)) return false;
  return state.selection.ranges.some((r) => state.doc.lineAt(r.from).number <= last && state.doc.lineAt(r.to).number >= first);
}

/** O título da nota aberta, que o compartimento troca quando a nota muda de nome. */
const titleFacet = Facet.define<string | null, string | null>({ combine: (v) => v[0] ?? null });

/** O trecho escondido agora (do começo do H1 ao fim da linha em branco), ou null. */
function hiddenRange(state: EditorState): { from: number; to: number } | null {
  const lines = titleHeadingLines(state, state.facet(titleFacet));
  if (!lines || touched(state, lines.first, lines.last)) return null;
  return { from: state.doc.line(lines.first).from, to: state.doc.line(lines.last).to };
}

const titleField = StateField.define<{ from: number; to: number } | null>({
  create: hiddenRange,
  update(value, tr) {
    const changed = tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focusChanged)) || tr.startState.facet(titleFacet) !== tr.state.facet(titleFacet);
    return changed ? hiddenRange(tr.state) : value;
  },
  // O H1 e a linha em branco depois dele somem juntos, sem deixar uma linha vazia no alto.
  provide: (f) => EditorView.decorations.from(f, (r): DecorationSet => (r ? Decoration.set([Decoration.replace({ block: true }).range(r.from, r.to)]) : Decoration.none)),
});

/**
 * O trecho do título escondido, para o preview renderizado (`renderedWidget.tsx`) não desenhar o H1 por cima: um bloco
 * dentro dele fica de fora.
 */
export function hiddenTitle(state: EditorState): { from: number; to: number } | null {
  return state.field(titleField, false) ?? null;
}

/** O compartimento do título: a nota trocada ou renomeada reconfigura só ele. */
export const titleCompartment = new Compartment();
export const titleHeading = (title: string | null): Extension => [titleFacet.of(title), titleField];
