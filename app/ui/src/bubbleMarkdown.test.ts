// O markdown do balão (spec #17679): a árvore certa para uma resposta inventada, e o texto perigoso como texto.

import { describe, expect, test } from "bun:test";

import type { BubbleLink } from "../../src/shared/ui-contract.ts";
import { type MdChild, type MdDocument, type MdNode, mountMarkdown, parseMarkdown, plainMarkdown, renderMarkdown } from "./bubbleMarkdown.ts";

/** Uma resposta inventada do agente: título, lista com caixas, tabela de 3 colunas, código e link. */
const RESPOSTA = [
  "## Compras da semana",
  "",
  "Separei o que a **Ana** pediu, com o *preço* de hoje:",
  "",
  "- pão",
  "- [x] café",
  "- [ ] leite",
  "",
  "| Item | Loja | Preço |",
  "|:--|:-:|--:|",
  "| Pão | Padaria | 8 |",
  "| Café | | 22 |",
  "",
  "```",
  "total = 30",
  "```",
  "",
  "Detalhes no [site](https://example.com/compras).",
].join("\n");

/** Um `Document` de mentira: guarda a árvore e escreve como HTML, escapando o texto. */
type Fake = { tag: string; attrs: Record<string, string>; kids: (Fake | { text: string })[] };
const fakeDoc = (): MdDocument => {
  const el = (tag: string): Fake & { append: (...n: unknown[]) => void; setAttribute: (k: string, v: string) => void } => {
    const e: Fake = { tag, attrs: {}, kids: [] };
    return Object.assign(e, {
      append: (...n: unknown[]) => e.kids.push(...(n as Fake[])),
      setAttribute: (k: string, v: string) => {
        e.attrs[k] = v;
      },
    });
  };
  return { createElement: el, createDocumentFragment: () => el("#fragment"), createTextNode: (text: string) => ({ text }) };
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (n: Fake | { text: string }): string => {
  if ("text" in n) return esc(n.text);
  const inner = n.kids.map(html).join("");
  if (n.tag === "#fragment") return inner;
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return `<${n.tag}${attrs}>${inner}</${n.tag}>`;
};
const mounted = (text: string) => html(renderMarkdown(text, fakeDoc()) as unknown as Fake);

/** Todas as tags da árvore. */
const tags = (nodes: MdChild[]): string[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [n.tag, ...tags(n.children)]));
const find = (nodes: MdChild[], tag: string): MdNode[] =>
  nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.tag === tag ? [n] : []), ...find(n.children, tag)]));
const text = (n: MdChild): string => (typeof n === "string" ? n : n.children.map(text).join(""));

describe("a resposta inventada vira os elementos certos", () => {
  const tree = parseMarkdown(RESPOSTA);

  test("título, parágrafo com negrito e itálico", () => {
    expect(tree[0]).toEqual({ tag: "h2", children: ["Compras da semana"] });
    expect(tree[1]).toEqual({ tag: "p", children: ["Separei o que a ", { tag: "strong", children: ["Ana"] }, " pediu, com o ", { tag: "em", children: ["preço"] }, " de hoje:"] });
  });

  test("a lista com as caixas, marcada e não", () => {
    const [ul] = find(tree, "ul");
    expect(ul!.children.map(text)).toEqual(["pão", "café", "leite"]);
    expect(find(tree, "task").map((t) => t.attrs?.checked)).toEqual([true, false]);
  });

  test("a tabela de 3 colunas: cabeçalho, linhas, a célula vazia no lugar e o alinhamento", () => {
    const [table] = find(tree, "table");
    const rows = find([table!], "tr").map((r) => r.children.map(text));
    expect(rows).toEqual([["Item", "Loja", "Preço"], ["Pão", "Padaria", "8"], ["Café", "", "22"]]);
    expect(find([table!], "th").map((c) => c.attrs?.align)).toEqual(["left", "center", "right"]);
    expect(text(table!)).not.toContain("|");
  });

  test("o bloco de código e o link", () => {
    expect(find(tree, "pre")[0]).toEqual({ tag: "pre", children: [{ tag: "code", children: ["total = 30"] }] });
    expect(find(tree, "a")).toEqual([{ tag: "a", attrs: { href: "https://example.com/compras" }, children: ["site"] }]);
  });

  test("montado: a tabela num rolador, o link sem href, a caixa como símbolo", () => {
    const out = mounted(RESPOSTA);
    expect(out).toContain('<div class="kn-md-scroll"><table class="kn-md-table"><thead><tr><th class="kn-md-align-left">Item</th>');
    expect(out).toContain('<a class="kn-md-link" data-href="https://example.com/compras" title="https://example.com/compras" role="link" tabindex="0">site</a>');
    expect(out).not.toMatch(/ href=/);
    expect(out).toContain('<span class="kn-md-task is-checked" role="img" aria-label="feito">☑</span>café');
    expect(out).toContain("<pre><code>total = 30</code></pre>");
  });
});

describe("seguro (spec #12938): o texto perigoso fica texto", () => {
  const PERIGO = 'Oi <script>alert("x")</script> e <img src=x onerror=alert(1)>.\n\n<script>roubar()</script>\n\n<iframe src="https://example.com"></iframe>';

  test("nenhum elemento fora da lista fechada", () => {
    const allowed = new Set(["p", "br", "strong", "em", "del", "code", "pre", "a", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "task", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td"]);
    for (const t of tags(parseMarkdown(PERIGO))) expect(allowed.has(t)).toBe(true);
  });

  test("o <script> e o <img onerror> aparecem como texto, escapados no DOM", () => {
    const tree = parseMarkdown(PERIGO);
    expect(text({ tag: "p", children: tree })).toContain('<script>alert("x")</script>');
    expect(text({ tag: "p", children: tree })).toContain("<img src=x onerror=alert(1)>");
    const out = mounted(PERIGO);
    expect(out).not.toMatch(/<(script|img|iframe)/);
    expect(out).toContain("&lt;script&gt;alert(\"x\")&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("um link javascript: fica texto, e uma imagem vira o texto dela, sem carregar", () => {
    expect(find(parseMarkdown("[clique](javascript:alert(1))"), "a")).toEqual([]);
    expect(text(parseMarkdown("[clique](javascript:alert(1))")[0]!)).toBe("clique");
    const img = parseMarkdown("Veja ![a foto](https://example.com/x.png).");
    expect(tags(img)).toEqual(["p"]);
    expect(text(img[0]!)).toBe("Veja a foto.");
  });

  test("o montador só usa createElement, createTextNode e setAttribute", () => {
    const calls: string[] = [];
    const doc = fakeDoc();
    const spy: MdDocument = {
      createElement: (t) => (calls.push(`el:${t}`), doc.createElement(t)),
      createTextNode: (t) => (calls.push("text"), doc.createTextNode(t)),
      createDocumentFragment: () => doc.createDocumentFragment(),
    };
    mountMarkdown(parseMarkdown(PERIGO), spy);
    expect(calls.filter((c) => c.startsWith("el:"))).toEqual(["el:p", "el:p", "el:p"]);
  });
});

describe("o texto corrido do balão fechado", () => {
  test("sem **, #, | nem `", () => {
    const plain = plainMarkdown(RESPOSTA);
    expect(plain).not.toMatch(/[*#|`]/);
    expect(plain.split("\n")).toEqual([
      "Compras da semana",
      "Separei o que a Ana pediu, com o preço de hoje:",
      "• pão",
      "• ☑ café",
      "• ☐ leite",
      "Item · Loja · Preço",
      "Pão · Padaria · 8",
      "Café ·  · 22",
      "total = 30",
      "Detalhes no site.",
    ]);
  });

  test("a citação e a lista numerada", () => {
    expect(plainMarkdown("> uma ideia\n> em duas linhas\n\n3. três\n4. quatro")).toBe("uma ideia\nem duas linhas\n3. três\n4. quatro");
  });

  test("colchete dentro do texto do link (CommonMark): o link fica, com o colchete no texto", () => {
    const link = (t: string) => find(parseMarkdown(t), "a").map((a) => [text(a), a.attrs?.href]);
    expect(link("[link [aninhado]](https://example.com/a)")).toEqual([["link [aninhado]", "https://example.com/a"]]);
    expect(link("Veja [a [b [c]] d](https://example.com/a) e [outro](https://example.com/b).")).toEqual([
      ["a [b [c]] d", "https://example.com/a"],
      ["outro", "https://example.com/b"],
    ]);
    expect(plainMarkdown("[link [aninhado]](https://example.com/a)")).toBe("link [aninhado]");
    // Um link de dentro ganha, como no CommonMark (e o endereço de fora fica um endereço solto, que o GFM linka);
    // o código e as caixas não mudam.
    expect(link("[a [b](https://example.com/b)](https://example.com/a)")).toEqual([
      ["b", "https://example.com/b"],
      ["https://example.com/a", "https://example.com/a"],
    ]);
    expect(plainMarkdown("`[a [b]](x)` e\n\n- [ ] [c]")).toBe("[a [b]](x) e\n• ☐ [c]");
  });

  test("texto sem markdown passa igual", () => {
    expect(plainMarkdown("Pronto, salvei a nota.")).toBe("Pronto, salvei a nota.");
  });
});

describe("as notas e os arquivos da pasta como link (spec #17683)", () => {
  const RESP = "Criei [[Plano|o plano]] e salvei `Projeto X/relatorio.pdf`. Veja também [isto](kiwi-file:segredo.md).";
  const at = (text: string, path: string, kind: BubbleLink["kind"]): BubbleLink => {
    const from = RESP.indexOf(text);
    return { text, from, to: from + text.length, path, kind };
  };
  const LINKS = [at("[[Plano|o plano]]", "Plano.md", "note"), at("`Projeto X/relatorio.pdf`", "Projeto X/relatorio.pdf", "file")];
  const out = html(renderMarkdown(RESP, fakeDoc(), LINKS) as unknown as Fake);

  test("cada menção achada pelo main vira link com o caminho, sem href", () => {
    expect(out).toContain('<a class="kn-md-link kn-md-file" data-path="Plano.md" title="Plano.md" role="link" tabindex="0">o plano</a>');
    expect(out).toContain('<a class="kn-md-link kn-md-file" data-path="Projeto X/relatorio.pdf" title="Projeto X/relatorio.pdf" role="link" tabindex="0"><code>Projeto X/relatorio.pdf</code></a>');
    expect(out).not.toMatch(/ href=/);
  });

  test("um kiwi-file: que a resposta escreveu sozinha fica texto", () => {
    expect(out).toContain("Veja também isto.");
    expect(out).not.toContain("segredo.md");
    expect(html(renderMarkdown("[x](kiwi-file:Plano.md)", fakeDoc()) as unknown as Fake)).toBe("<p>x</p>");
  });

  test("sem links, o [[…]] fica como está; a posição que não bate com o texto não vira link", () => {
    expect(plainMarkdown("Criei [[Plano]].")).toBe("Criei [[Plano]].");
    const wrong = { ...LINKS[0]!, from: 0, to: LINKS[0]!.text.length };
    expect(html(renderMarkdown(RESP, fakeDoc(), [wrong]) as unknown as Fake)).not.toContain("data-path");
  });
});
