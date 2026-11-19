import { describe, expect, test } from "bun:test";

// O DOM dos testes: o mesmo leitor de HTML que o turndown usa fora do navegador (os tipos dele não são de módulo).
// @ts-expect-error: o index.d.ts do pacote declara `module 'domino'`
import domino from "@mixmark-io/domino";

import { cleanPastedHtml, docStyles, headingToggle, isActive, type PasteNode, pastePlan, shortcutAction } from "./docxFormat.ts";

const parse = (html: string) => ((domino as { createDocument(html: string): unknown }).createDocument(html) as { body: PasteNode }).body;
const clean = (html: string) => cleanPastedHtml(parse(html));

describe("colar no docx (T23238)", () => {
  test("de uma página: fica a estrutura e a ênfase, sai a fonte, a cor e o tamanho", () => {
    const html = `<p style="font-family:Comic Sans MS;color:red;font-size:22px" class="x"><b>Ana</b> e <i style="color:blue">Bruno</i></p>`;
    expect(clean(html)).toBe("<p><b>Ana</b> e <i>Bruno</i></p>");
  });

  test("título, lista, tabela e link", () => {
    const html = `<h2 class="t">Plano</h2><ul><li>um</li><li>dois</li></ul><ol><li>três</li></ol><table><tr><td colspan="2" style="background:#ff0">Cadeiras</td></tr></table><p><a href="https://example.com/a" style="color:red">link</a></p>`;
    expect(clean(html)).toBe(
      `<h2>Plano</h2><ul><li>um</li><li>dois</li></ul><ol><li>três</li></ol><table><tbody><tr><td colspan="2">Cadeiras</td></tr></tbody></table><p><a href="https://example.com/a">link</a></p>`,
    );
  });

  test("a ênfase que vem no estilo (Google Docs, e-mail) vira marca; o <b> de embrulho do Google Docs não é negrito", () => {
    const html = `<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700;font-family:Arial">forte</span> <span style="font-style:italic">leve</span> <span style="text-decoration:underline">sub</span> <span style="text-decoration:line-through">fora</span></p></b>`;
    expect(clean(html)).toBe("<p><b>forte</b> <i>leve</i> <u>sub</u> <s>fora</s></p>");
  });

  test("o que não é texto some: script, style, imagem (nada vai à rede) e o link perigoso", () => {
    const html = `<style>p{color:red}</style><p>Oi<script>alert(1)</script><img src="https://example.com/x.png"> <a href="javascript:alert(1)">aqui</a> <b>Carla</b></p>`;
    expect(clean(html)).toBe("<p>Oi aqui <b>Carla</b></p>");
  });

  test("o texto é escapado, não vira HTML", () => {
    expect(clean("<p><b>&lt;img src=x&gt; &amp; 1 &lt; 2</b></p>")).toBe("<p><b>&lt;img src=x&gt; &amp; 1 &lt; 2</b></p>");
  });

  test("só texto, sem nada além dele: cola como texto puro", () => {
    expect(clean(`<p style="font-family:Times">Uma linha</p><div style="color:red">Outra</div>`)).toBeNull();
    expect(pastePlan(`<meta charset="utf-8"><span style="color:red">só texto</span>`, parse)).toEqual({ kind: "plain" });
  });

  test("a cópia de um docx entra como veio, com a formatação do documento", () => {
    const html = `<div data-docx-fragment="UEsDBA" data-docx-fragment-end="open"><p style="font-family:Calibri"><b>Ana</b></p></div>`;
    expect(pastePlan(html, parse)).toEqual({ kind: "keep" });
    expect(pastePlan("", parse)).toEqual({ kind: "keep" });
  });

  test("os comentários do Word saem antes de ler", () => {
    expect(pastePlan(`<!--StartFragment--><p><b>Bruno</b></p><!--EndFragment-->`, parse)).toEqual({ kind: "html", html: "<p><b>Bruno</b></p>" });
  });

  test("HTML grande demais cola como texto", () => {
    expect(pastePlan(`<p><b>${"a".repeat(2_000_001)}</b></p>`, parse)).toEqual({ kind: "plain" });
  });
});

describe("os atalhos das Notas no docx (T23238)", () => {
  const key = (k: string, o: Partial<{ code: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
    key: k,
    metaKey: true,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...o,
  });
  test("⌘1 a ⌘6 títulos; ⇧⌘7 e ⇧⌘8 listas; ⇧⌘X tachado", () => {
    expect(shortcutAction(key("1", { code: "Digit1" }))).toBe("heading1");
    expect(shortcutAction(key("6", { code: "Digit6" }))).toBe("heading6");
    expect(shortcutAction(key("&", { code: "Digit7", shiftKey: true }))).toBe("ordered");
    expect(shortcutAction(key("*", { code: "Digit8", shiftKey: true }))).toBe("bullet");
    expect(shortcutAction(key("X", { code: "KeyX", shiftKey: true }))).toBe("strike");
  });
  test("o resto fica com o motor e com o visualizador: ⌘B, ⌘0 (o zoom), ⌘7, sem ⌘, com ⌥ ou ⌃", () => {
    expect(shortcutAction(key("b", { code: "KeyB" }))).toBeNull();
    expect(shortcutAction(key("0", { code: "Digit0" }))).toBeNull();
    expect(shortcutAction(key("7", { code: "Digit7" }))).toBeNull();
    expect(shortcutAction(key("1", { code: "Digit1", metaKey: false }))).toBeNull();
    expect(shortcutAction(key("1", { code: "Digit1", altKey: true }))).toBeNull();
    expect(shortcutAction(key("1", { code: "Digit1", ctrlKey: true }))).toBeNull();
  });
});

describe("os títulos vêm dos estilos do documento (T23238)", () => {
  const word = [
    { styleId: "Normal", name: "Normal", type: "paragraph" },
    { styleId: "Heading1", name: "heading 1", type: "paragraph" },
    { styleId: "Heading2", name: "heading 2", type: "paragraph" },
    { styleId: "Strong", name: "Strong", type: "character" },
  ];
  test("o botão H põe o título 2, como o ## das Notas, e tira o título de quem já é", () => {
    const s = docStyles(word);
    expect(headingToggle(0, s)).toBe("Heading2");
    expect(headingToggle(2, s)).toBe("Normal");
  });
  test("o id em outra língua: vale o nome do estilo", () => {
    const s = docStyles([
      { styleId: "Normal", name: "Normal", type: "paragraph" },
      { styleId: "Ttulo1", name: "heading 1", type: "paragraph" },
    ]);
    expect(s.headings.get(1)).toBe("Ttulo1");
    expect(headingToggle(0, s)).toBe("Ttulo1");
  });
  test("um documento sem títulos: o botão não tem o que pôr", () => {
    expect(headingToggle(0, docStyles([{ styleId: "Normal", name: "Normal", type: "paragraph" }]))).toBeNull();
  });
  test("os botões acesos seguem a seleção", () => {
    const st = { bold: true, italic: false, underline: false, strike: false, heading: 2, bullet: false, ordered: true, alignment: "center" as const };
    expect(isActive("bold", st)).toBe(true);
    expect(isActive("italic", st)).toBe(false);
    expect(isActive("heading", st)).toBe(true);
    expect(isActive("heading2", st)).toBe(true);
    expect(isActive("ordered", st)).toBe(true);
    expect(isActive("center", st)).toBe(true);
    expect(isActive("left", st)).toBe(false);
  });
});
