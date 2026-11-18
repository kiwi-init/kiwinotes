// Lista e título não mudam de recuo com o cursor (spec #17690, T17784): o item cru tem o recuo, o espaço entre itens e o
// marcador da lista desenhada, e o "## " do título com o cursor nele fica na margem. Nota inventada.

import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { wikiLinkSyntax } from "./index.ts";
import { inlineDecorations, itemHasGap, listItemAtLine } from "./livePreview.ts";
import { fullTree } from "./rendered.ts";

const md = markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] });
const stateOf = (doc: string, cursor = 0) => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [md] });

const NOTE = [
  "## Próximos passos",
  "",
  "- item um",
  "- item dois",
  "  - aninhado",
  "",
  "1. primeiro",
  "2. segundo",
  "",
  "- [ ] tarefa um",
  "- [x] tarefa dois",
  "",
  "Fim.",
].join("\n");
const at = (s: string, plus = 0) => NOTE.indexOf(s) + plus;

type Found = { from: number; to: number; text: string; cls?: string; widget?: { text?: string; level?: number; constructor: { name: string } } };
function decos(cursor: number): Found[] {
  const s = stateOf(NOTE, cursor);
  const set = inlineDecorations(s, true, [{ from: 0, to: s.doc.length }], { status: () => "ok" } as never, fullTree(s));
  const out: Found[] = [];
  for (let c = set.iter(); c.value; c.next()) {
    const spec = c.value.spec as { widget?: Found["widget"]; class?: string };
    out.push({ from: c.from, to: c.to, text: s.doc.sliceString(c.from, c.to), cls: spec.class, widget: spec.widget });
  }
  return out;
}
const ranges = (cursor: number) => decos(cursor).filter((d) => d.to > d.from);
const lineClass = (cursor: number, line: string) =>
  decos(cursor)
    .filter((d) => d.from === stateOf(NOTE).doc.lineAt(at(line)).from && d.from === d.to && d.cls)
    .map((d) => d.cls)
    .join(" ");

describe("o item cru tem o recuo e o espaço da lista desenhada", () => {
  test("o nível e o espaço de 2 px entre itens", () => {
    const c = at("item dois", 3);
    expect(lineClass(c, "- item um")).toBe("cm-li cm-li-1");
    expect(lineClass(c, "- item dois")).toBe("cm-li cm-li-1 cm-li-gap");
    expect(lineClass(at("aninhado", 2), "  - aninhado")).toBe("cm-li cm-li-2 cm-li-gap");
    expect(lineClass(c, "2. segundo")).toBe("cm-li cm-li-1 cm-li-gap");
  });

  test("a tarefa fica um nível antes: a caixa no recuo, como a lista desenhada sem padding", () => {
    expect(lineClass(at("tarefa um", 2), "- [ ] tarefa um")).toContain("cm-li cm-li-0");
  });

  test("o marcador fica desenhado mesmo com o cursor no item, e os espaços do começo somem", () => {
    const list = decos(at("aninhado", 2));
    const mark = list.find((d) => d.text === "- " && d.from === at("- aninhado"));
    expect(mark?.widget?.constructor.name).toBe("ListMarkWidget");
    expect(mark?.widget?.level).toBe(2);
    expect(list.some((d) => d.from === at("  - aninhado") && d.text === "  " && !d.widget)).toBe(true);
    const num = ranges(at("segundo", 2)).find((d) => d.from === at("2. segundo"));
    expect(num?.text).toBe("2. ");
    expect(num?.widget?.text).toBe("2.");
  });

  test("o \"- \" antes da caixa some, e a caixa leva o espaço depois do \"]\"", () => {
    const list = decos(at("tarefa dois", 2));
    expect(list.some((d) => d.from === at("- [x]") && d.text === "- " && !d.widget)).toBe(true);
    expect(list.find((d) => d.from === at("[x]") && d.to > d.from)?.text).toBe("[x] ");
  });
});

describe("o \"## \" do título", () => {
  test("com o cursor nele, aparece num widget (na margem); com o cursor no texto, some", () => {
    const on = ranges(1).find((d) => d.from === 0);
    expect(on?.text).toBe("## ");
    expect(on?.widget?.constructor.name).toBe("HeadMarkWidget");
    const off = ranges(at("passos", 2)).find((d) => d.from === 0);
    expect(off?.text).toBe("## ");
    expect(off?.widget).toBeUndefined();
  });
});

describe("o bloco desenhado que começa no meio da lista", () => {
  const s = stateOf(NOTE);
  // A árvore inteira: a do `syntaxTree` para no orçamento de tempo do parser e vem parcial com a máquina carregada.
  const tree = fullTree(s);
  const item = (line: string) => listItemAtLine(s, tree, s.doc.lineAt(at(line)).from);
  test("o 2º item e o aninhado guardam o espaço; o 1º e as linhas fora da lista, não", () => {
    expect(itemHasGap(item("- item um")!)).toBe(false);
    expect(itemHasGap(item("- item dois")!)).toBe(true);
    expect(itemHasGap(item("  - aninhado")!)).toBe(true);
    expect(itemHasGap(item("1. primeiro")!)).toBe(false);
    expect(item("Fim.")).toBeNull();
    expect(item("## Próximos")).toBeNull();
  });
});
