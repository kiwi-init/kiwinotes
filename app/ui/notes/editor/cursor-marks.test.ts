// A nota não muda de cara quando a pessoa clica para escrever (spec #17690, T17783): numa lista, só o item do cursor fica
// cru, e nele só a marca do trecho onde o cursor está aparece. Nota inventada.

import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { wikiLinkSyntax } from "./index.ts";
import { inlineDecorations } from "./livePreview.ts";
import { fullTree, imagesUnderCursor, renderedBlocks, topBlocksAround } from "./rendered.ts";

const md = markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] });
const stateOf = (doc: string, cursor = 0) => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [md] });

const NOTE = [
  "# Plano da semana",
  "",
  "Texto com **forte** e [[Ana]].",
  "",
  "- um **dois** três",
  "- item [[Projeto X]] fim",
  "- último *leve*",
  "",
  "Fim.",
].join("\n");
const at = (s: string, plus = 0) => NOTE.indexOf(s) + plus;
const firsts = (doc: string, cursor: number, focused = true) => renderedBlocks(stateOf(doc, cursor), focused).map((b) => b.source);

/** O texto que o preview esconde (as marcas que somem), na ordem. */
function hidden(doc: string, cursor: number, focused = true): string[] {
  const s = stateOf(doc, cursor);
  const set = inlineDecorations(s, focused, [{ from: 0, to: s.doc.length }], { status: () => "ok" } as never);
  const out: string[] = [];
  for (let c = set.iter(); c.value; c.next()) {
    const spec = c.value.spec as { widget?: unknown; class?: string };
    if (c.from < c.to && !spec.widget && !spec.class && c.value.point) out.push(s.doc.sliceString(c.from, c.to));
  }
  return out;
}
/** O texto de uma linha que o preview esconde. */
const hiddenIn = (line: string, cursor: number, focused = true) => {
  const from = NOTE.indexOf(line);
  const s = stateOf(NOTE, cursor);
  const set = inlineDecorations(s, focused, [{ from: 0, to: s.doc.length }], { status: () => "ok" } as never);
  const out: string[] = [];
  for (let c = set.iter(); c.value; c.next()) {
    const spec = c.value.spec as { widget?: unknown };
    if (c.from >= from && c.to <= from + line.length && c.from < c.to && c.value.point && !spec.widget) out.push(s.doc.sliceString(c.from, c.to));
  }
  return out;
};

describe("a lista do cursor (spec #17690)", () => {
  test("com o cursor num item, os itens de cima e de baixo continuam desenhados, e só o do cursor fica cru", () => {
    const blocks = firsts(NOTE, at("Projeto"));
    expect(blocks).toContain("- um **dois** três");
    expect(blocks).toContain("- último *leve*");
    expect(blocks.join("\n")).not.toContain("Projeto X");
    // O resto da nota continua como estava.
    expect(blocks).toContain("# Plano da semana");
    expect(blocks).toContain("Texto com **forte** e [[Ana]].");
  });

  test("no primeiro item, os de baixo vão juntos num desenho só; no último, os de cima", () => {
    expect(firsts(NOTE, at("um"))).toContain("- item [[Projeto X]] fim\n- último *leve*");
    expect(firsts(NOTE, at("último"))).toContain("- um **dois** três\n- item [[Projeto X]] fim");
  });

  test("numa lista numerada, os itens de baixo levam o número deles", () => {
    const doc = "1. a\n2. b\n3. c\n4. d";
    expect(firsts(doc, doc.indexOf("b"))).toEqual(["1. a", "3. c\n4. d"]);
  });

  test("um item com uma lista dentro fica cru com ela; os outros continuam desenhados", () => {
    const doc = "- a\n- b\n  - b1\n  - b2\n- c";
    expect(firsts(doc, doc.indexOf("b2"))).toEqual(["- a", "- c"]);
  });

  test("a seleção que pega dois itens deixa os dois crus", () => {
    const s = EditorState.create({ doc: NOTE, selection: { anchor: at("dois"), head: at("Projeto") }, extensions: [md] });
    const blocks = renderedBlocks(s, true).map((b) => b.source);
    expect(blocks).toContain("- último *leve*");
    expect(blocks.join("\n")).not.toContain("dois");
  });

  test("sem foco, a lista inteira é um desenho só, como antes", () => {
    expect(firsts(NOTE, at("Projeto"), false)).toContain("- um **dois** três\n- item [[Projeto X]] fim\n- último *leve*");
  });

  test("um parágrafo e um título com o cursor ficam crus inteiros, como antes", () => {
    expect(firsts(NOTE, at("forte")).join("\n")).not.toContain("Texto com");
    expect(firsts(NOTE, at("semana")).join("\n")).not.toContain("# Plano");
  });

  test("andar entre itens refaz a lista inteira; num parágrafo, só as linhas dele", () => {
    const s = stateOf(NOTE, at("Projeto"));
    const list = [at("- um"), at("leve*", 5)];
    expect(topBlocksAround(s, fullTree(s), [[at("Projeto"), at("Projeto")]])).toEqual([list as [number, number]]);
    expect(topBlocksAround(s, fullTree(s), [[at("forte"), at("forte")]])).toEqual([[at("forte"), at("forte")]]);
  });

  test("as imagens embaixo são só as do item do cursor", () => {
    const doc = "- a ![](um.png)\n- b ![](dois.png)\n- c";
    const out = imagesUnderCursor(stateOf(doc, doc.indexOf("b ")), true);
    expect(out).toEqual([{ to: doc.indexOf("\n- c"), markdown: "![](dois.png)" }]);
  });
});

describe("só a marca do cursor aparece (spec #17690)", () => {
  test("no item do cursor, fora do negrito, o ** continua escondido; dentro dele, aparece", () => {
    expect(hiddenIn("- um **dois** três", at("um", 1))).toEqual(["**", "**"]);
    expect(hiddenIn("- um **dois** três", at("dois", 2))).toEqual([]);
  });

  test("o link só aparece cru com o cursor dentro dele; na mesma linha, fora dele, fica o nome", () => {
    expect(hiddenIn("- item [[Projeto X]] fim", at("fim", 1))).toEqual(["[[", "]]"]);
    expect(hiddenIn("- item [[Projeto X]] fim", at("Projeto", 3))).toEqual([]);
  });

  test("o # do título só aparece com o cursor nele; no meio do título, ele continua escondido", () => {
    expect(hiddenIn("# Plano da semana", at("semana"))).toEqual(["# "]);
    expect(hiddenIn("# Plano da semana", 0)).toEqual([]);
    // No começo do texto, o Backspace apagaria o espaço do "# ": a pessoa vê o que apaga (#17924).
    expect(hiddenIn("# Plano da semana", at("Plano"))).toEqual([]);
  });

  test("a ênfase de outra linha, e a da mesma linha longe do cursor, continuam escondidas", () => {
    expect(hiddenIn("- último *leve*", at("último", 2))).toEqual(["*", "*"]);
    expect(hiddenIn("Texto com **forte** e [[Ana]].", at("Projeto"))).toEqual(["**", "**", "[[", "]]"]);
  });

  test("sem foco, toda marca fica escondida", () => {
    expect(hiddenIn("- um **dois** três", at("dois", 2), false)).toEqual(["**", "**"]);
  });

  test("a nota inteira: com o cursor no negrito do item, só aquele ** aparece", () => {
    const all = hidden(NOTE, at("dois", 2));
    expect(all.filter((t) => t === "**").length).toBe(2); // os do "forte"; os do "dois" aparecem
    expect(all).toContain("# ");
  });
});
