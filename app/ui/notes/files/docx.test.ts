import { expect, test } from "bun:test";

import { type DocNode, docText, ID_PREFIX, parseDocHtml } from "./docx.ts";

const tags = (nodes: DocNode[]): string[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [n.tag, ...tags(n.children)]));
const find = (nodes: DocNode[], tag: string): Extract<DocNode, object>[] =>
  nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.tag === tag ? [n] : []), ...find(n.children, tag)]));

test("o HTML do mammoth vira a árvore: títulos, ênfase, lista, tabela e o texto escapado", () => {
  const nodes = parseDocHtml(
    "<h1>Proposta</h1><p>Uma <strong>mudança</strong> de <em>sala</em> &amp; o orçamento &lt;aprovado&gt; &#8212; &#x2713;</p><ul><li>Cadeiras</li><li>Mesa</li></ul><table><tr><td><p>Item</p></td><td colspan=\"2\"><p>Valor</p></td></tr></table>",
  );
  // A linha que o mammoth põe direto na tabela ganha o <tbody> do navegador.
  expect(tags(nodes)).toEqual(["h1", "p", "strong", "em", "ul", "li", "li", "table", "tbody", "tr", "td", "p", "td", "p"]);
  expect(docText(nodes)).toBe("PropostaUma mudança de sala & o orçamento <aprovado> — ✓CadeirasMesaItemValor");
  expect(find(nodes, "td")[1]!.attrs).toEqual({ colSpan: "2" });
});

test("links: só http, https, mailto e as âncoras do próprio documento; o resto vira texto", () => {
  const nodes = parseDocHtml(
    `<p><a href="https://example.com/a?b=1&amp;c=2">site</a> <a href="javascript:alert(1)">mal</a> <a href=" JavaScript:alert(1)">mal2</a> <a href="file:///etc/passwd">arquivo</a> <a href="mailto:ana@example.com">e-mail</a> <a href="#${ID_PREFIX}footnote-1">1</a> <a href="#outro">x</a></p>`,
  );
  expect(find(nodes, "a").map((a): string | null => a.attrs.href ?? null)).toEqual([
    "https://example.com/a?b=1&c=2",
    null,
    null,
    null,
    "mailto:ana@example.com",
    `#${ID_PREFIX}footnote-1`,
    null,
  ]);
  // O texto do link perigoso continua lá.
  expect(docText(nodes)).toContain("mal");
});

test("imagens: só data: de png, jpeg, gif, webp ou bmp; svg e endereço de fora não passam", () => {
  const nodes = parseDocHtml(
    '<p><img alt="Planta" src="data:image/png;base64,iVBORw0KGgo=" /><img src="data:image/svg+xml;base64,PHN2Zz4=" /><img src="https://example.com/x.png" /><img src="data:image/jpeg;base64,/9j/4A==" onerror="alert(1)" /></p>',
  );
  expect(find(nodes, "img").map((i) => i.attrs)).toEqual([
    { alt: "Planta", src: "data:image/png;base64,iVBORw0KGgo=" },
    {},
    {},
    { src: "data:image/jpeg;base64,/9j/4A==" },
  ]);
});

test("o que não está na lista some: tags, atributos, script e style com o conteúdo", () => {
  const nodes = parseDocHtml(
    '<p style="color:red" onclick="alert(1)" class="x" id="fora">a<script>alert(1)</script>b<style>p{}</style>c<iframe src="x"></iframe><font color="red">d</font><!-- comentário --></p><div><p id="kn-docx-footnote-1">nota</p></div>',
  );
  expect(tags(nodes)).toEqual(["p", "p"]);
  expect(find(nodes, "p").map((p) => p.attrs)).toEqual([{}, { id: "kn-docx-footnote-1" }]);
  expect(docText(nodes)).toBe("abcdnota");
});

test("HTML torto não quebra: tag sem fechar, fechamento sobrando e texto solto", () => {
  expect(docText(parseDocHtml("<p>um<strong>dois</p>três</strong></em>quatro"))).toBe("umdoistrêsquatro");
  expect(tags(parseDocHtml("<ul><li>a<li>b</ul><p>c"))).toEqual(["ul", "li", "li", "p"]);
  expect(parseDocHtml("")).toEqual([]);
  expect(parseDocHtml("só texto &amp;")).toEqual(["só texto &"]);
  expect(docText(parseDocHtml("&#0; &#99999999; &bogus;"))).toBe("&#0; &#99999999; &bogus;");
});

test("o docx de exemplo (test/fixtures/files/proposta.docx) pelo mammoth: tudo o que o spec pede, e o link perigoso sai", async () => {
  const mammoth = (await import("mammoth")).default;
  const { readFileSync } = await import("node:fs");
  const buffer = readFileSync(new URL("../../../test/fixtures/files/proposta.docx", import.meta.url));
  const r = await mammoth.convertToHtml({ buffer }, { idPrefix: ID_PREFIX });
  expect(r.value).toContain('href="javascript:alert(1)"'); // o mammoth deixa passar
  const nodes = parseDocHtml(r.value);
  expect(new Set(tags(nodes))).toEqual(new Set(["h1", "h2", "p", "strong", "em", "ul", "li", "table", "tbody", "tr", "td", "img", "a"]));
  // As 3 linhas no mesmo <tbody>, e a tabela fecha antes do título seguinte.
  expect(find(nodes, "tbody").length).toBe(1);
  expect(find(nodes, "tbody")[0]!.children.length).toBe(3);
  expect(find(nodes, "h1").map((h) => docText(h.children))).toEqual(["Proposta de mudança"]);
  expect(find(nodes, "li").length).toBe(3);
  expect(find(nodes, "tr").length).toBe(3);
  expect(find(nodes, "img")[0]!.attrs).toMatchObject({ alt: "A planta da sala", src: expect.stringMatching(/^data:image\/png;base64,/) });
  expect(find(nodes, "a").map((a): string | null => a.attrs.href ?? null)).toEqual(["https://example.com/fornecedor", null]);
  expect(docText(nodes)).toContain("& o orçamento <aprovado>.");
});

test("a tabela com <thead> ou <tbody> do próprio HTML não ganha outro", () => {
  const nodes = parseDocHtml("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><table><tr><td>x</td></tr><tr><td>y</td></tr></table>");
  expect(tags(nodes)).toEqual(["table", "thead", "tr", "th", "tbody", "tr", "td", "table", "tbody", "tr", "td", "tr", "td"]);
});
