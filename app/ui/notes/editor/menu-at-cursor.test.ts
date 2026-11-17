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
});
