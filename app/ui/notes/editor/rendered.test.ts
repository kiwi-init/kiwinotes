// Os blocos renderizados pela lib do Channels (T2983): quais blocos, o Markdown que vai para a lib, o clique.

import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { wikiLinkSyntax } from "./index.ts";
import { scanFootnotes } from "./footnotes.ts";
import { linksApart, mermaidCode, picturesOff, shapesWithoutPictures } from "./mermaid.tsx";
import { fullTree, imagesUnderCursor, imageSource, linkAction, MAX_RENDERED_CHARS, MAX_RENDERED_LINES, mermaidUnderCursor, renderedBlocks, sourceOffset, taskMarks, toRenderable } from "./rendered.ts";

const md = markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] });
const stateOf = (doc: string, cursor = 0) => EditorState.create({ doc, selection: { anchor: cursor }, extensions: [md] });

const NOTE = [
  "# Reunião", // 0
  "",
  "Falei com **Ana** sobre o site.",
  "",
  "- um",
  "- [ ] dois",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "![[planta.png]]",
  "",
  "*🎙 ditado às 14:30* %%dictation:abc%%",
  "",
  "> [!note] Ideia",
  "> boa",
  "",
  "```js",
  "x %% y",
  "```",
].join("\n");

describe("blocos renderizados", () => {
  test("sem foco, todos os blocos que a lib desenha; tabela, anexo e legenda do ditado ficam de fora", () => {
    const s = stateOf(NOTE);
    const blocks = renderedBlocks(s, false).map((b) => b.source.split("\n")[0]);
    expect(blocks).toEqual(["# Reunião", "Falei com **Ana** sobre o site.", "- um", "> [!note] Ideia", "```js"]);
  });

  test("o bloco do cursor fica cru; os outros continuam renderizados", () => {
    const at = NOTE.indexOf("Ana");
    const blocks = renderedBlocks(stateOf(NOTE, at), true).map((b) => b.source.split("\n")[0]);
    expect(blocks).not.toContain("Falei com **Ana** sobre o site.");
    expect(blocks).toContain("# Reunião");
    expect(blocks).toContain("- um");
  });

  test("o cursor no fim de um bloco (depois do último caractere) também deixa ele cru", () => {
    const end = "# Reunião".length;
    expect(renderedBlocks(stateOf(NOTE, end), true).map((b) => b.source)).not.toContain("# Reunião");
  });

  // T8046: um bloco enorme num widget só não tem a virtualização do editor, e o WebKit levava ~12 s para medir.
  test("um bloco grande demais (linhas ou caracteres) fica cru; o do limite ainda renderiza", () => {
    const para = (lines: number, width = 40) => Array.from({ length: lines }, (_, i) => `Linha ${i} [[B]] ${"x".repeat(width)}`).join("\n");
    const doc = (body: string) => `# Topo\n\n${body}\n\nFim.`;
    // A árvore inteira, sem prazo (T8175): com os 200 ms da produção, um runner lento devolvia a árvore pela metade.
    const firsts = (body: string) => {
      const s = stateOf(doc(body));
      return renderedBlocks(s, false, fullTree(s, 60_000)).map((b) => b.source.split("\n")[0]);
    };
    expect(firsts(para(MAX_RENDERED_LINES, 10))).toEqual(["# Topo", "Linha 0 [[B]] xxxxxxxxxx", "Fim."]);
    expect(firsts(para(MAX_RENDERED_LINES + 1, 10))).toEqual(["# Topo", "Fim."]);
    expect(firsts(para(12_000))).toEqual(["# Topo", "Fim."]);
    // Poucas linhas, mas compridas demais.
    expect(firsts(para(3, MAX_RENDERED_CHARS / 2))).toEqual(["# Topo", "Fim."]);
  });

  // T8175: o parser que não chega ao fim no prazo (o runner lento, uma nota enorme). O que volta é coerente: os blocos que
  // a árvore já cobre, iguais aos da árvore inteira, e nenhum erro.
  test("com o prazo do parser curto demais, volta só o que já foi parseado, igual ao da árvore inteira", () => {
    const body = Array.from({ length: 400 }, (_, i) => `## Seção ${i}\n\nTexto ${i} com [[B]] e *ênfase*.\n\n- item ${i}`).join("\n\n");
    const s = stateOf(`# Topo\n\n${body}\n\nFim.`);
    const all = renderedBlocks(s, false, fullTree(stateOf(s.doc.toString()), 60_000));
    for (const budget of [0, 1]) {
      const fresh = stateOf(s.doc.toString());
      const part = renderedBlocks(fresh, false, fullTree(fresh, budget));
      const key = (b: { from: number; to: number; source: string }) => `${b.from}:${b.to}:${b.source}`;
      const whole = new Set(all.map(key));
      expect(part.every((b) => whole.has(key(b)))).toBe(true);
      expect(part.length).toBeLessThanOrEqual(all.length);
    }
    expect(all.at(-1)?.source).toBe("Fim.");
  });

  test("o bloco vai do começo da primeira linha ao fim da última", () => {
    const list = renderedBlocks(stateOf(NOTE), false).find((b) => b.source.startsWith("- um"))!;
    expect(list.source).toBe("- um\n- [ ] dois");
    expect(NOTE.slice(list.from, list.to)).toBe(list.source);
  });

  test("um parágrafo com comentário fica com o preview de hoje; com imagem, renderiza (T2984)", () => {
    const doc = "Veja ![foto](https://x.com/a.png) aqui\n\ntexto %%nota%% fim\n\nnormal ![[a.png]] no meio";
    expect(renderedBlocks(stateOf(doc), false).map((b) => b.source)).toEqual(["Veja ![foto](https://x.com/a.png) aqui", "normal ![[a.png]] no meio"]);
  });
});

describe("o Markdown que vai para a lib", () => {
  const status = (t: string): "missing" | "ok" => (t === "Nada" ? "missing" : "ok");
  const render = (doc: string) => toRenderable(doc, 0, fullTree(stateOf(doc)), status);

  test("[[link]] vira link da nota, com o apelido; o que não existe ganha o endereço de faltando", () => {
    expect(render("com [[Ana]] e [[Site novo|o site]] e [[Nada]]")).toBe(
      "com [Ana](kiwi-note:Ana) e [o site](kiwi-note:Site%20novo) e [Nada](kiwi-note-missing:Nada)",
    );
  });

  test("[[nota#título]] mostra o nome da nota", () => {
    expect(render("ver [[Ana#Contato]] e [[#Local]]")).toBe("ver [Ana](kiwi-note:Ana%23Contato) e [Local](kiwi-note:%23Local)");
  });

  test("#tag vira link de tag; #2026 e tag em código não", () => {
    expect(render("#projeto ok #2026 e `#code`")).toBe("[#projeto](kiwi-tag:projeto) ok #2026 e `#code`");
  });

  test("[[link]] dentro de código fica como está", () => {
    expect(render("use `[[Ana]]` assim")).toBe("use `[[Ana]]` assim");
  });

  test("a marcação no apelido fica escapada: aparece como foi escrita", () => {
    expect(render("[[Ana|a*b*]]")).toBe("[a\\*b\\*](kiwi-note:Ana)");
  });
});

describe("callouts do Obsidian", () => {
  const render = (doc: string) => toRenderable(doc, 0, fullTree(stateOf(doc)), () => "ok");

  test("o cabeçalho fica como está: quem desenha é o widget do callout (T6383)", () => {
    expect(render("> [!note] Ideia\n> boa")).toBe("> [!note] Ideia\n> boa");
    expect(render("> [!danger]-\n> cuidado")).toBe("> [!danger]-\n> cuidado");
  });

  test("o link no título continua link", () => {
    expect(render("> [!tip] Ver [[Ana]]\n> x")).toBe("> [!tip] Ver [Ana](kiwi-note:Ana)\n> x");
  });
});

describe("notas de rodapé (T6377)", () => {
  const blocks = (doc: string) => {
    const state = stateOf(doc, 0);
    const tree = fullTree(state);
    const notes = scanFootnotes(doc);
    return renderedBlocks(state, false, tree).map((b) => toRenderable(b.source, b.from, tree, () => "ok", notes));
  };

  test("revisão: a chamada dentro da nota em linha é texto dela; rótulo com parêntese; a definição de uma palavra continua", () => {
    expect(blocks("Texto ^[ver [^1]] mais.\n")).toEqual(["Texto [¹](kiwi-footnote-inline:1) mais."]);
    expect(blocks("A[^a)b].\n\n[^a)b]: Nota.\n")).toEqual(["A[¹](kiwi-footnote:a%29b).", "[¹](kiwi-footnote-def:a%29b) Nota."]);
    expect(linkAction("kiwi-footnote:a%29b")).toEqual({ kind: "footnote", label: "a)b" });
    // `[^1]: Fonte:` é um link de referência para o parser, e a linha recuada viraria bloco de código: vão juntas.
    expect(blocks("X[^1].\n\n[^1]: Fonte:\n    https://x.com/a\n")).toEqual(["X[¹](kiwi-footnote:1).", "[¹](kiwi-footnote-def:1) Fonte:\n    https://x.com/a"]);
    // O bloco de código do parser segue depois da linha em branco: nada fica cru no meio.
    expect(blocks("X[^1].\n\n[^1]: Fonte:\n    https://x.com/a\n\n    mais um trecho\n")).toEqual([
      "X[¹](kiwi-footnote:1).",
      "[¹](kiwi-footnote-def:1) Fonte:\n    https://x.com/a\n\n    mais um trecho",
    ]);
  });

  test("a chamada e a nota em linha viram o número, como link; a definição mostra o número dela", () => {
    expect(blocks("Texto[^a] e ^[em linha].\n\n[^a]: A nota.\n")).toEqual([
      "Texto[¹](kiwi-footnote:a) e [²](kiwi-footnote-inline:2).",
      "[¹](kiwi-footnote-def:a) A nota.",
    ]);
  });

  test("a chamada sem definição fica apagada; a definição de uma palavra só (link de referência pro parser) também desenha", () => {
    expect(blocks("x[^1] y[^falta]\n\n[^1]: Palavra\n")).toEqual([
      "x[¹](kiwi-footnote:1) y[²](kiwi-footnote-missing:falta)",
      "[¹](kiwi-footnote-def:1) Palavra",
    ]);
  });

  test("os links de dentro da nota em linha somem com ela; em código, nada muda", () => {
    expect(blocks("a ^[ver [[Ana]]] e [[Ana]]")).toEqual(["a [¹](kiwi-footnote-inline:1) e [Ana](kiwi-note:Ana)"]);
    expect(blocks("`[^1]` e ^[x]")).toEqual(["`[^1]` e [¹](kiwi-footnote-inline:1)"]);
  });

  test("o clique no número", () => {
    expect(linkAction("kiwi-footnote:a%20b")).toEqual({ kind: "footnote", label: "a b" });
    expect(linkAction("kiwi-footnote-missing:x")).toEqual({ kind: "footnote", label: "x" });
    expect(linkAction("kiwi-footnote-def:1")).toEqual({ kind: "footnoteDef", label: "1" });
    expect(linkAction("kiwi-footnote-inline:3")).toEqual({ kind: "footnoteInline", n: 3 });
    expect(linkAction("kiwi-footnote-inline:x")).toBeNull();
  });
});

describe("o ^id de bloco (T6594)", () => {
  const render = (doc: string) => toRenderable(doc, 0, fullTree(stateOf(doc)), () => "ok");
  test("some do texto desenhado; no código e no meio da linha, fica", () => {
    expect(render("Os detalhes ficam aqui. ^detalhe")).toBe("Os detalhes ficam aqui.");
    expect(render("- item dois ^item-2")).toBe("- item dois");
    expect(render("o ^meio da linha")).toBe("o ^meio da linha");
    expect(render("`x ^id`")).toBe("`x ^id`");
  });
});

describe("o clique num link desenhado", () => {
  test("nota, tag e endereço", () => {
    expect(linkAction("kiwi-note:Site%20novo")).toEqual({ kind: "note", target: "Site novo" });
    expect(linkAction("kiwi-note-missing:Nada")).toEqual({ kind: "note", target: "Nada" });
    expect(linkAction("kiwi-tag:projeto%2Fsub")).toEqual({ kind: "tag", tag: "projeto/sub" });
    expect(linkAction("https://kiwi.dev")).toEqual({ kind: "url", url: "https://kiwi.dev" });
    expect(linkAction("kiwi-note:%E0%A4%A")).toBeNull();
  });
});

describe("as tarefas", () => {
  test("a posição do caractere de dentro do [ ] de cada tarefa, na ordem", () => {
    const doc = "- [ ] a\n- [x] b\n  - [ ] c";
    const marks = taskMarks(fullTree(stateOf(doc)), 0, doc.length);
    expect(marks.map((p) => doc[p])).toEqual([" ", "x", " "]);
    expect(marks.map((p) => doc.slice(p - 1, p + 2))).toEqual(["[ ]", "[x]", "[ ]"]);
  });
});

describe("onde cai o clique", () => {
  test("a marcação some do desenho, e o clique cai no caractere certo do .md", () => {
    const src = "Falei com **Ana** sobre o site.";
    const shown = "Falei com Ana sobre o site.";
    expect(src.slice(sourceOffset(src, shown, shown.indexOf("Ana")))).toStartWith("Ana**");
    expect(src.slice(sourceOffset(src, shown, shown.indexOf("sobre")))).toStartWith("sobre");
  });

  test("numa lista, o número desenhado não anda na fonte", () => {
    const src = "1. primeiro\n2. segundo";
    const shown = "1.primeiro2.segundo";
    expect(src.slice(sourceOffset(src, shown, shown.indexOf("segundo")))).toBe("segundo");
  });

  test("no título, o # não aparece", () => {
    const src = "## Custos do mês";
    const shown = "Custos do mês";
    expect(src.slice(sourceOffset(src, shown, shown.indexOf("mês")))).toBe("mês");
  });

  test("no primeiro caractere, logo depois da marcação que abre; com tudo, o fim", () => {
    expect(sourceOffset("**a**", "a", 0)).toBe(2);
    expect(sourceOffset("- item", "item", 0)).toBe(2);
    expect(sourceOffset("abc", "abc", 3)).toBe(3);
  });
});

describe("imagens (T2984)", () => {
  const render = (doc: string) => toRenderable(doc, 0, fullTree(stateOf(doc)), () => "ok");

  test("![[foto.png]] no meio do texto vira a imagem do anexo; ![[Nota]] vira o link da nota", () => {
    expect(render("veja ![[Anexos/foto 1.png]] e ![[Ana]]")).toBe("veja ![foto 1.png](kiwi-attachment:Anexos%2Ffoto%201.png) e [Ana](kiwi-note:Ana)");
  });

  test("de onde vem a imagem: anexo, data:, de fora (nunca carrega) ou nada", () => {
    expect(imageSource("kiwi-attachment:Anexos%2Ffoto.png")).toEqual({ kind: "attachment", target: "Anexos/foto.png" });
    expect(imageSource("anexos/foto%201.png")).toEqual({ kind: "attachment", target: "anexos/foto 1.png" });
    expect(imageSource("data:image/png;base64,AAA")).toEqual({ kind: "data" });
    expect(imageSource("https://x.com/a.png")).toEqual({ kind: "remote", url: "https://x.com/a.png" });
    expect(imageSource("file:///etc/a.png")).toEqual({ kind: "none" });
    expect(imageSource("/Users/x/a.png")).toEqual({ kind: "none" });
    expect(imageSource("notas.md")).toEqual({ kind: "none" });
  });
});

describe("mermaid (T2984)", () => {
  const DOC = "texto\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nfim";

  test("o código do bloco ```mermaid; outro bloco ou vazio, nada", () => {
    expect(mermaidCode("```mermaid\ngraph TD\n  A --> B\n```")).toBe("graph TD\n  A --> B");
    expect(mermaidCode("~~~ Mermaid\nsequenceDiagram\n~~~")).toBe("sequenceDiagram");
    expect(mermaidCode("```js\nx\n```")).toBeNull();
    expect(mermaidCode("```mermaid\n\n```")).toBeNull();
  });

  test("com o cursor no bloco, ele fica cru e o diagrama fica embaixo; sem foco, nada embaixo", () => {
    const at = DOC.indexOf("A -->");
    const under = mermaidUnderCursor(stateOf(DOC, at), true);
    expect(under).toHaveLength(1);
    expect(DOC.slice(0, under[0]!.to).endsWith("```")).toBe(true);
    expect(renderedBlocks(stateOf(DOC, at), true).map((b) => b.source)).toEqual(["texto", "fim"]);
    expect(mermaidUnderCursor(stateOf(DOC, at), false)).toEqual([]);
  });

  test("o SVG sai sem link que não abre fora e sem imagem que não é data:", () => {
    expect(linksApart('<a href="javascript:alert(1)">x</a><a xlink:href="https://kiwi.dev">y</a>')).toBe(
      '<a target="_blank" rel="noopener noreferrer">x</a><a xlink:href="https://kiwi.dev" target="_blank" rel="noopener noreferrer">y</a>',
    );
    expect(picturesOff('<image href="https://x.com/a.png"/><img src="data:image/png;base64,A">')).toBe('<image/><img src="data:image/png;base64,A">');
  });
});

describe("as imagens do bloco do cursor", () => {
  const under = (doc: string, at: number) => imagesUnderCursor(stateOf(doc, at), true);

  test("o parágrafo do cursor fica cru e as imagens dele aparecem logo abaixo, na ordem", () => {
    const doc = "Veja ![[planta.png|120]] e ![foto](anexo.png) e ![](https://x.com/a.png)\n\noutro ![x](b.png)";
    expect(under(doc, 2)).toEqual([{ to: doc.indexOf("\n"), markdown: "![planta.png](kiwi-attachment:planta.png) ![foto](anexo.png) ![](https://x.com/a.png)" }]);
  });

  test("sem foco, nada; sem imagem, nada; ![[Nota]] não é imagem", () => {
    expect(imagesUnderCursor(stateOf("a ![x](b.png)", 0), false)).toEqual([]);
    expect(under("só texto", 0)).toEqual([]);
    expect(under("ver ![[Nota]] aqui", 0)).toEqual([]);
  });

  test("o anexo sozinho na linha fica com o widget dele; imagem em código não conta", () => {
    expect(under("![[planta.png]]", 0)).toEqual([]);
    expect(under("```\n![x](b.png)\n```", 0)).toEqual([]);
    expect(under("a `![x](b.png)`", 0)).toEqual([]);
  });
});

describe("a forma de imagem do mermaid (review do #109)", () => {
  test("sai o img: de fora, fica o rótulo; data: fica", () => {
    expect(shapesWithoutPictures('A@{ img: "https://x.com/a.png", label: "foto" } --> B')).toBe('A@{ label: "foto" } --> B');
    expect(shapesWithoutPictures('A@{ label: "foto", img: "https://x.com/a.png", pos: "t" }')).toBe('A@{ label: "foto", pos: "t" }');
    expect(shapesWithoutPictures("A@{ label: 'x', img: 'https://x.com/a.png' }")).toBe("A@{ label: 'x' }");
    expect(shapesWithoutPictures('A@{ img: "data:image/png;base64,AA", label: "x" }')).toBe('A@{ img: "data:image/png;base64,AA", label: "x" }');
    expect(shapesWithoutPictures("graph TD\n  A[img: x] --> B")).toBe("graph TD\n  A[img: x] --> B");
  });
});
