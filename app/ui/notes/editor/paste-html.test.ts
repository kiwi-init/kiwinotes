import { describe, expect, test } from "bun:test";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { fencedCodeText } from "./code-copy.ts";
import { wikiLinkSyntax } from "./index.ts";
import { htmlToMarkdown, pasteAsMarkdown } from "./paste-html.ts";

/** O cursor em `‸` (o `|` é da tabela). */
const stateAt = (marked: string) => {
  const at = marked.indexOf("‸");
  const state = EditorState.create({ doc: marked.replace("‸", ""), selection: { anchor: at }, extensions: [markdown({ base: markdownLanguage, extensions: [wikiLinkSyntax] })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
};
const clipboard = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (t: string) => data[t] ?? "" });

describe("colar HTML como Markdown (T6379)", () => {
  test("título, ênfase, link, listas e o _ no meio da palavra", () => {
    const html = `<meta charset="utf-8"><h2>Plano</h2><p>Um <b>negrito</b>, <i>itálico</i>, <s>riscado</s> e <a href="https://example.com/a(b)">link</a>. O snake_case fica.</p><ul><li>um</li><li>dois<ul><li>neto</li></ul></li></ul><ol start="3"><li>três</li><li>quatro</li></ol>`;
    expect(htmlToMarkdown(html)).toBe(
      "## Plano\n\nUm **negrito**, *itálico*, ~~riscado~~ e [link](https://example.com/a%28b%29). O snake_case fica.\n\n- um\n- dois\n  - neto\n\n3. três\n4. quatro",
    );
  });

  test("o Google Docs: o <b> que embrulha tudo não é negrito; o negrito e o itálico vêm do estilo", () => {
    const html = `<b style="font-weight:normal;" id="docs-internal-guid-1a2b"><p dir="ltr"><span style="font-weight:700;white-space:pre-wrap;">Prazo</span><span style="font-style:italic;white-space:pre-wrap;"> combinado</span><span style="white-space:pre-wrap;"> com a equipe.</span></p></b>`;
    expect(htmlToMarkdown(html)).toBe("**Prazo** *combinado* com a equipe.");
  });

  test("o e-mail: cada <div> é uma linha, e o <div><br></div>, a linha em branco", () => {
    expect(htmlToMarkdown("<div>Oi Ana,</div><div><br></div><div>Segue o relatório.</div><div>Abraço</div>")).toBe("Oi Ana,\n\nSegue o relatório.\nAbraço");
  });

  test("tabela, tarefas, código com a linguagem, citação, separador e <br>", () => {
    expect(htmlToMarkdown("<table><thead><tr><th>Item</th><th>Valor</th></tr></thead><tbody><tr><td>Rede</td><td>1.800</td></tr></tbody></table>")).toBe(
      "| Item | Valor |\n| --- | --- |\n| Rede | 1.800 |",
    );
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked disabled> feita</li><li><input type="checkbox" disabled> aberta</li></ul>')).toBe("- [x] feita\n- [ ] aberta");
    expect(htmlToMarkdown('<pre><code class="language-js">const a = 1;\n  if (a) b();</code></pre>')).toBe("```js\nconst a = 1;\n  if (a) b();\n```");
    expect(htmlToMarkdown("<blockquote><p>citação</p></blockquote><hr><p>fim<br>linha 2</p>")).toBe("> citação\n\n---\n\nfim\nlinha 2");
  });

  test("sem imagem embutida nem pixel, link só http(s) e mailto, e o endereço como texto vira link automático", () => {
    const html = `<p><img src="data:image/png;base64,AAAA" alt="foto"> <img src="https://x.com/p.gif" width="1" height="1"> <img src="https://x.com/a.png" alt="gráfico"></p><p><a href="javascript:alert(1)">mau</a> <a href="/relativo">rel</a> <a href="https://x.com">https://x.com</a> <a href="mailto:ana@x.com">ana@x.com</a></p>`;
    expect(htmlToMarkdown(html)).toBe("foto ![gráfico](https://x.com/a.png)\n\nmau rel <https://x.com> <ana@x.com>");
  });

  test("script, style e comentários somem; o espaço duro vira espaço", () => {
    expect(htmlToMarkdown("<style>p{color:red}</style><!--StartFragment--><p>a&nbsp;b</p><script>alert(1)</script><!--EndFragment-->")).toBe("a b");
  });

  test("quando colar Markdown e quando deixar o colar de sempre", () => {
    const rich = clipboard({ "text/plain": "Prazo combinado", "text/html": "<p><b>Prazo</b> combinado</p>" });
    expect(pasteAsMarkdown(stateAt("Texto ‸"), rich)).toBe("**Prazo** combinado");
    // Com o ⇧, sem HTML, do VS Code, ou quando o Markdown seria o próprio texto: o texto puro.
    expect(pasteAsMarkdown(stateAt("Texto ‸"), rich, true)).toBeNull();
    expect(pasteAsMarkdown(stateAt("Texto ‸"), clipboard({ "text/plain": "só texto" }))).toBeNull();
    expect(pasteAsMarkdown(stateAt("Texto ‸"), clipboard({ "text/plain": "x", "text/html": "<b>x</b>", "vscode-editor-data": "{}" }))).toBeNull();
    expect(pasteAsMarkdown(stateAt("Texto ‸"), clipboard({ "text/plain": "  if (a)\n    b();", "text/html": "<div><span>  if (a)</span></div><div><span>    b();</span></div>" }))).toBeNull();
    // Dentro de código, de tabela e do frontmatter, também.
    expect(pasteAsMarkdown(stateAt("```\n‸\n```"), rich)).toBeNull();
    expect(pasteAsMarkdown(stateAt("Um `có‸digo` aqui"), rich)).toBeNull();
    expect(pasteAsMarkdown(stateAt("| a | b |\n| --- | --- |\n| 1 | ‸2 |"), rich)).toBeNull();
    expect(pasteAsMarkdown(stateAt("---\ntags: [‸]\n---\nTexto"), rich)).toBeNull();
  });
});

describe("copiar o bloco de código (T6379)", () => {
  test("só o código, sem as cercas nem a quebra do fim", () => {
    const state = stateAt("Antes\n\n```js\nconst a = 1;\nb();\n```\n\nDepois‸");
    const open = state.doc.line(3);
    expect(fencedCodeText(state, open.from, open.to)).toBe("const a = 1;\nb();");
    const empty = stateAt("```\n```‸");
    expect(fencedCodeText(empty, 0, 3)).toBe("");
  });
});
