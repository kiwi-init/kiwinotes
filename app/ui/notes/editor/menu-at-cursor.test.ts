// O menu do botão direito sem ler a nota inteira (spec #13385): o título e o callout do cursor saem da árvore e das
// linhas em volta, e dão sempre o mesmo que a conta antiga, com a nota inteira.

import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";

import { markdownStructure } from "../../../src/shared/markdown-structure.ts";
import { calloutAt } from "./callouts.ts";
import { calloutAtCursor, headingAtCursor } from "./context-menu.ts";
import { wikiLinkSyntax } from "./index.ts";

const md = markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] });

const NOTE = [
  "---",
  "tags: [a]",
  "---",
  "# Plano do trimestre",
  "",
  "Texto com # no meio, que não é título.",
  "",
  "## Prazo ##",
  "",
  "Título setext",
  "=============",
  "",
  "> [!warning] Cuidado",
  "> com o prazo",
  "> e com o time",
  "",
  "> citação comum",
  "",
  "```",
  "# não é título (código)",
  "```",
  "",
  "   ### Recuado",
  "",
  "- item",
  "  > [!tip] Dentro da lista",
  "  > ok",
].join("\n");

describe("o título e o callout do cursor, sem a nota inteira (spec #13385)", () => {
  test("em cada posição, iguais à conta com a nota inteira", () => {
    const headings = markdownStructure(NOTE).headings;
    for (let pos = 0; pos <= NOTE.length; pos++) {
      const state = EditorState.create({ doc: NOTE, selection: EditorSelection.cursor(pos), extensions: [md] });
      const old = headings.find((h) => h.from <= pos && pos <= h.to);
      const now = headingAtCursor(state);
      expect([pos, now?.from, now?.title]).toEqual([pos, old?.from, old?.title]);
      expect([pos, calloutAtCursor(state)]).toEqual([pos, calloutAt(NOTE, pos)]);
    }
  });

  // #465: o título desenhado é um bloco só, e o clique nele dá o começo da linha. Na 1ª linha da nota, a posição 0.
  // (Com frontmatter, o editor recebe o texto sem ele, e o título também começa no 0.)
  test("o título na 1ª linha, com o cursor no começo dela (#465)", () => {
    const doc = "# Bolo de cenoura\n\nTexto do bolo.\n";
    for (const pos of [0, 2, 17]) {
      const state = EditorState.create({ doc, selection: EditorSelection.cursor(pos), extensions: [md] });
      expect([pos, headingAtCursor(state)?.title]).toEqual([pos, "Bolo de cenoura"]);
    }
    const setext = EditorState.create({ doc: "Bolo\n====\n\nTexto.\n", selection: EditorSelection.cursor(0), extensions: [md] });
    expect(headingAtCursor(setext)?.title).toBe("Bolo");
    // O frontmatter continua sem título, também no fim da cerca de baixo.
    const fm = "---\ntags: [a]\n---\n# Bolo\n";
    for (const pos of [0, 4, 16]) {
      const state = EditorState.create({ doc: fm, selection: EditorSelection.cursor(pos), extensions: [md] });
      expect([pos, headingAtCursor(state)]).toEqual([pos, undefined]);
    }
  });
});
