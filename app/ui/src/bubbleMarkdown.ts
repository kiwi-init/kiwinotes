// O markdown do balão do gato (spec #17679): a resposta do agente formatada, com título, negrito, listas, caixas,
// tabela, citação, código e link. Continua seguro como no spec #12938: o texto vira uma árvore neutra de elementos de
// uma lista fechada, e o DOM se monta um a um, com `createElement` e nós de texto, nunca com `innerHTML`. Um `<script>`
// ou um `<img onerror>` no texto aparece como texto. Uma imagem vira o texto dela. Um link não tem `href`: mostra o
// endereço, e quem abre, no clique da pessoa, é o balão.
//
// Puro, sem React: o balão sobre a tela (TS puro) e o do Hub (React) usam o mesmo código.

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser as baseParser } from "@lezer/markdown";

import { kiwiFilePath, linkify } from "../../src/shared/bubble-links.ts";
import type { BubbleLink } from "../../src/shared/ui-contract.ts";

const parser = baseParser.configure(GFM);

/** As tags que o balão monta. `task` é a caixa de um item `- [ ]`. */
export type MdTag =
  | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "strong" | "em" | "del" | "code" | "pre"
  | "ul" | "ol" | "li" | "task" | "blockquote" | "hr" | "br" | "a"
  | "table" | "thead" | "tbody" | "tr" | "th" | "td";

export type MdAttrs = {
  /** O endereço do link (só `http`, `https` e `mailto`). */
  href?: string;
  /** O caminho de uma nota ou arquivo da pasta (spec #17683), relativo a ela: um link `kiwi-file:` que o main achou. */
  path?: string;
  /** O número do primeiro item de uma lista numerada, quando não é 1. */
  start?: number;
  /** A caixa marcada. */
  checked?: boolean;
  /** O alinhamento da coluna da tabela. */
  align?: "left" | "center" | "right";
};

export type MdNode = { tag: MdTag; attrs?: MdAttrs; children: MdChild[] };
export type MdChild = MdNode | string;

/** Os nós que são só marcação: somem do desenho. */
const MARKS = new Set([
  "HeaderMark", "QuoteMark", "ListMark", "CodeMark", "CodeInfo", "LinkMark", "EmphasisMark", "StrikethroughMark",
  "TableDelimiter", "TaskMarker", "LinkTitle", "LinkLabel",
]);

/** Só estes viram link; `javascript:` e o resto ficam como texto. */
export function safeHref(url: string): string | null {
  const u = url.trim().replace(/^<|>$/g, "");
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(u) ? u : null;
}

const node = (tag: MdTag, children: MdChild[], attrs?: MdAttrs): MdNode => (attrs ? { tag, attrs, children } : { tag, children });

/** Junta os textos vizinhos, e tira os espaços do começo e do fim do bloco. */
function tidy(children: MdChild[]): MdChild[] {
  const out: MdChild[] = [];
  for (const c of children) {
    const last = out[out.length - 1];
    if (typeof c === "string" && typeof last === "string") out[out.length - 1] = last + c;
    else if (c !== "") out.push(c);
  }
  // Depois de uma quebra, a linha começa sem o espaço que sobrou da marca (o "> " da citação).
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    if (typeof out[i] === "string" && typeof prev !== "string" && prev?.tag === "br") out[i] = (out[i] as string).replace(/^[ \t]+/, "");
  }
  if (typeof out[0] === "string") out[0] = out[0].replace(/^\s+/, "");
  const end = out.length - 1;
  if (typeof out[end] === "string") out[end] = (out[end] as string).replace(/\s+$/, "");
  return out.filter((c) => c !== "");
}

/** O texto solto entre os nós: a quebra de linha do agente vira `br`, sem o recuo da linha seguinte. */
function gap(text: string): MdChild[] {
  if (!text.includes("\n")) return [text];
  const out: MdChild[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) out.push(node("br", []));
    out.push(i > 0 ? part.replace(/^[ \t>]+/, "") : part);
  });
  return out;
}

class Builder {
  /** `files`: os caminhos que o main conferiu na pasta. Só eles viram link `kiwi-file:`; o resto fica texto. */
  constructor(readonly src: string, readonly files: ReadonlySet<string> = new Set()) {}

  text(n: { from: number; to: number }): string {
    return this.src.slice(n.from, n.to);
  }

  /** O conteúdo em linha de `n`, de `from` a `to`. */
  inline(n: SyntaxNode, from = n.from, to = n.to): MdChild[] {
    const out: MdChild[] = [];
    let at = from;
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (c.from > at) out.push(...gap(this.src.slice(at, c.from)));
      out.push(...this.inlineNode(c));
      at = Math.max(at, c.to);
    }
    if (at < to) out.push(...gap(this.src.slice(at, to)));
    return out;
  }

  inlineNode(c: SyntaxNode): MdChild[] {
    switch (c.name) {
      case "Emphasis":
        return [node("em", this.inline(c))];
      case "StrongEmphasis":
        return [node("strong", this.inline(c))];
      case "Strikethrough":
        return [node("del", this.inline(c))];
      case "InlineCode": {
        const marks = c.getChildren("CodeMark");
        const a = marks[0]?.to ?? c.from;
        const b = marks.length > 1 ? marks[marks.length - 1]!.from : c.to;
        return [node("code", [this.src.slice(a, b)])];
      }
      case "Link": {
        const url = c.getChild("URL");
        const marks = c.getChildren("LinkMark");
        const label = marks.length >= 2 ? this.inline(c, marks[0]!.to, marks[1]!.from) : [this.text(c)];
        // `[c]` ou `[a][b]`, sem `(…)`: uma referência, e o balão não tem nenhuma definida. No CommonMark isso é
        // texto, com os colchetes.
        if (marks.length >= 2 && this.src[marks[1]!.to] !== "(") return ["[", ...label, this.src.slice(marks[1]!.from, c.to)];
        // Uma nota ou um arquivo da pasta (spec #17683): só se o main achou esse caminho nesta resposta. Um
        // `[x](kiwi-file:…)` que a resposta escreveu sozinha fica texto.
        const path = url ? kiwiFilePath(this.text(url)) : null;
        if (path !== null) return this.files.has(path) ? [node("a", tidy(label), { path })] : label;
        const href = url ? safeHref(this.text(url)) : null;
        // Sem endereço que preste (um `javascript:`): só o texto do link.
        return href ? [node("a", tidy(label), { href })] : label;
      }
      case "Autolink": {
        const url = c.getChild("URL");
        const href = url ? safeHref(this.text(url)) : null;
        return href ? [node("a", [href.replace(/^mailto:/i, "")], { href })] : [this.text(c)];
      }
      case "URL": {
        // O link solto do GFM (www., https://).
        const raw = this.text(c);
        const href = safeHref(/^www\./i.test(raw) ? `https://${raw}` : raw);
        return href ? [node("a", [raw], { href })] : [raw];
      }
      case "Image": {
        // A imagem não carrega: fica o texto dela.
        const marks = c.getChildren("LinkMark");
        return marks.length >= 2 ? this.inline(c, marks[0]!.to, marks[1]!.from) : [];
      }
      case "Escape":
        return [this.src.slice(c.from + 1, c.to)];
      case "HardBreak":
        return [node("br", [])];
      default:
        // Uma marca some; o resto (uma tag HTML, uma entidade, um comentário) aparece como texto.
        return MARKS.has(c.name) ? [] : [this.text(c)];
    }
  }

  blocks(parent: SyntaxNode): MdNode[] {
    const out: MdNode[] = [];
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (MARKS.has(c.name)) continue;
      const b = this.block(c);
      if (b) out.push(b);
    }
    return out;
  }

  block(c: SyntaxNode): MdNode | null {
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(c.name);
    if (heading) return node(`h${heading[1]}` as MdTag, tidy(this.inline(c)));
    switch (c.name) {
      case "Paragraph":
        return node("p", tidy(this.inline(c)));
      case "Blockquote":
        return node("blockquote", this.blocks(c));
      case "BulletList":
        return node("ul", c.getChildren("ListItem").map((i) => this.item(i)));
      case "OrderedList": {
        const first = c.getChild("ListItem")?.getChild("ListMark");
        const start = first ? Number.parseInt(this.text(first), 10) : 1;
        return node("ol", c.getChildren("ListItem").map((i) => this.item(i)), Number.isFinite(start) && start !== 1 ? { start } : undefined);
      }
      case "FencedCode": {
        const body = c.getChild("CodeText");
        return node("pre", [node("code", [body ? this.text(body) : ""])]);
      }
      case "CodeBlock": {
        const lines = this.text(c).split("\n").map((l) => l.replace(/^( {4}|\t)/, ""));
        return node("pre", [node("code", [lines.join("\n")])]);
      }
      case "HorizontalRule":
        return node("hr", []);
      case "Table":
        return this.table(c);
      case "LinkReference":
        return null;
      default: {
        // Um bloco de HTML, um comentário, o que mais vier: como texto, num parágrafo.
        const text = this.text(c).trim();
        return text ? node("p", tidy(gap(text))) : null;
      }
    }
  }

  item(i: SyntaxNode): MdNode {
    const children: MdChild[] = [];
    for (let c = i.firstChild; c; c = c.nextSibling) {
      if (c.name === "ListMark") continue;
      if (c.name === "Task") {
        const marker = c.getChild("TaskMarker");
        const checked = marker ? /x/i.test(this.text(marker)) : false;
        children.push(node("task", [], { checked }), ...tidy(this.inline(c, marker?.to ?? c.from, c.to)));
      } else if (c.name === "Paragraph") {
        // O item simples fica sem `p`: o texto direto no `li`.
        if (children.length) children.push(node("br", []));
        children.push(...tidy(this.inline(c)));
      } else {
        const b = this.block(c);
        if (b) children.push(b);
      }
    }
    return node("li", children);
  }

  /** As células de uma linha pela posição entre os `|`: a célula vazia não tem nó, e não pode puxar as outras. */
  cells(r: SyntaxNode): MdChild[][] {
    const pipes = r.getChildren("TableDelimiter");
    const edges = [r.from, ...pipes.flatMap((d) => [d.from, d.to]), r.to];
    const slots: { from: number; to: number }[] = [];
    for (let i = 0; i < edges.length; i += 2) slots.push({ from: edges[i]!, to: edges[i + 1]! });
    // O `|` do começo e o do fim da linha não abrem célula.
    if (slots.length > 1 && !this.src.slice(slots[0]!.from, slots[0]!.to).trim()) slots.shift();
    if (slots.length > 1 && !this.src.slice(slots[slots.length - 1]!.from, slots[slots.length - 1]!.to).trim()) slots.pop();
    const cells = r.getChildren("TableCell");
    return slots.map((s) => {
      const cell = cells.find((c) => c.from >= s.from && c.to <= s.to);
      return cell ? tidy(this.inline(cell)) : [];
    });
  }

  table(t: SyntaxNode): MdNode {
    const header = t.getChild("TableHeader");
    const delimiter = t.getChildren("TableDelimiter").find((d) => /-/.test(this.text(d)));
    const align = delimiter
      ? this.text(delimiter).replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => {
          const x = s.trim();
          return x.startsWith(":") && x.endsWith(":") ? "center" : x.endsWith(":") ? "right" : x.startsWith(":") ? "left" : undefined;
        })
      : [];
    const cols = header ? this.cells(header).length : 0;
    const row = (r: SyntaxNode, tag: "th" | "td"): MdNode => {
      const cells = this.cells(r);
      while (cells.length < cols) cells.push([]);
      return node("tr", cells.slice(0, Math.max(cols, cells.length)).map((kids, i) => node(tag, kids, align[i] ? { align: align[i] } : undefined)));
    };
    const out: MdChild[] = [];
    if (header) out.push(node("thead", [row(header, "th")]));
    const rows = t.getChildren("TableRow");
    if (rows.length) out.push(node("tbody", rows.map((r) => row(r, "td"))));
    return node("table", out);
  }
}

/** A resposta em árvore de elementos (só as tags de `MdTag`; o texto, sempre string). */
export function parseMarkdown(text: string, files?: ReadonlySet<string>): MdNode[] {
  let tree = parser.parse(text);
  const nested = escapeNestedBrackets(text, tree.topNode);
  if (nested !== text) {
    text = nested;
    tree = parser.parse(text);
  }
  return new Builder(text, files).blocks(tree.topNode);
}

/**
 * A resposta com as notas e os arquivos que o main achou (spec #17683) como links: o texto com cada menção trocada
 * por `[rótulo](kiwi-file:…)` e os caminhos que podem virar link. Sem `links`, o texto como veio.
 */
export function withFileLinks(text: string, links?: readonly BubbleLink[]): { text: string; files: ReadonlySet<string> } {
  if (!links?.length) return { text, files: new Set() };
  return { text: linkify(text, links), files: new Set(links.map((l) => l.path)) };
}

/** Onde o `[` não é marca: código, endereço, tag HTML, escape. */
const LITERAL = new Set(["InlineCode", "FencedCode", "CodeBlock", "Autolink", "URL", "HTMLTag", "HTMLBlock", "Escape"]);

/**
 * `[link [aninhado]](url)` é um link com o texto "link [aninhado]" no CommonMark: o `[aninhado]` só seria link se
 * houvesse a referência, e o balão não tem referências. O lezer o lê como link e o de fora fica cru. Aqui os
 * colchetes de dentro do texto de um link viram `\[` `\]`, fora do código; um `[x](y)` de dentro continua link.
 */
function escapeNestedBrackets(text: string, top: SyntaxNode): string {
  const literal = new Uint8Array(text.length);
  const cursor = top.cursor();
  do {
    if (LITERAL.has(cursor.name)) literal.fill(1, cursor.from, cursor.to);
  } while (cursor.next());
  const escape = new Set<number>();
  for (let open = 0; open < text.length; open++) {
    if (text[open] !== "[" || literal[open]) continue;
    const inner: number[][] = [];
    const stack: number[] = [];
    let close = -1;
    // O texto do link fica no parágrafo: para numa linha vazia.
    for (let i = open + 1; i < text.length && !(text[i] === "\n" && text[i + 1] === "\n"); i++) {
      if (literal[i]) continue;
      if (text[i] === "[") stack.push(i);
      else if (text[i] === "]") {
        if (stack.length === 0) {
          close = i;
          break;
        }
        const from = stack.pop()!;
        if (text[i + 1] !== "(") inner.push([from, i]);
      }
    }
    if (close < 0 || text[close + 1] !== "(" || inner.length === 0) continue;
    for (const [a, b] of inner) escape.add(a!).add(b!);
    open = close;
  }
  if (escape.size === 0) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) out += escape.has(i) ? `\\${text[i]}` : text[i];
  return out;
}

/** Os blocos que levam quebra de linha no texto corrido. */
const BLOCKS = new Set<MdTag>(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tr", "hr"]);

/**
 * O texto corrido, sem os símbolos (`**`, `#`, `|`, `` ` ``): para o balão fechado. Cada bloco numa linha, o item com
 * "•" (ou o número), a caixa com ☐ ou ☑, e as células de uma linha da tabela separadas por " · ".
 */
export function plainMarkdown(text: string): string {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };
  const walk = (n: MdChild, prefix = "") => {
    if (typeof n === "string") {
      line += n;
      return;
    }
    if (n.tag === "br") {
      flush();
      return;
    }
    if (n.tag === "task") {
      line += n.attrs?.checked ? "☑ " : "☐ ";
      return;
    }
    if (n.tag === "tr") {
      flush();
      // As células vazias do fim da linha (uma linha mais curta que o cabeçalho) não deixam um " · " sobrando.
      let last = n.children.length;
      while (last > 0 && typeof n.children[last - 1] !== "string" && (n.children[last - 1] as MdNode).children.length === 0) last--;
      n.children.slice(0, last).forEach((cell, i) => {
        if (i > 0) line += " · ";
        if (typeof cell !== "string") cell.children.forEach((c) => walk(c));
      });
      flush();
      return;
    }
    if (n.tag === "ul" || n.tag === "ol") {
      flush();
      let k = n.attrs?.start ?? 1;
      for (const li of n.children) walk(li, n.tag === "ol" ? `${k++}. ` : "• ");
      flush();
      return;
    }
    if (BLOCKS.has(n.tag)) flush();
    line += prefix;
    for (const c of n.children) walk(c);
    if (BLOCKS.has(n.tag)) flush();
  };
  for (const b of parseMarkdown(text)) walk(b);
  flush();
  return lines.join("\n");
}

/** O pedaço do `Document` que o montador usa: dá para testar sem DOM de verdade. */
export type MdDocument = {
  createElement(tag: string): MdElement;
  createTextNode(text: string): unknown;
  createDocumentFragment(): MdElement;
};
export type MdElement = { append(...nodes: unknown[]): void; setAttribute(name: string, value: string): void };

/** A tag do DOM de cada nó (a caixa é um `span`). */
const DOM_TAG: Record<MdTag, string> = {
  p: "p", h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6",
  strong: "strong", em: "em", del: "del", code: "code", pre: "pre",
  ul: "ul", ol: "ol", li: "li", task: "span", blockquote: "blockquote", hr: "hr", br: "br", a: "a",
  table: "table", thead: "thead", tbody: "tbody", tr: "tr", th: "th", td: "td",
};

function mountNode(doc: MdDocument, n: MdChild): unknown {
  if (typeof n === "string") return doc.createTextNode(n);
  const el = doc.createElement(DOM_TAG[n.tag]);
  const a = n.attrs;
  if (n.tag === "a" && a?.path) {
    // A nota ou o arquivo (spec #17683): também sem `href`. O clique manda o caminho para o app abrir.
    el.setAttribute("class", "kn-md-link kn-md-file");
    el.setAttribute("data-path", a.path);
    el.setAttribute("title", a.path);
    el.setAttribute("role", "link");
    el.setAttribute("tabindex", "0");
  }
  if (n.tag === "a" && a?.href) {
    // Sem `href`: o clique não navega sozinho. O balão lê o `data-href` e abre, no clique da pessoa.
    el.setAttribute("class", "kn-md-link");
    el.setAttribute("data-href", a.href);
    el.setAttribute("title", a.href);
    el.setAttribute("role", "link");
    el.setAttribute("tabindex", "0");
  }
  if (n.tag === "task") {
    el.setAttribute("class", `kn-md-task${a?.checked ? " is-checked" : ""}`);
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", a?.checked ? "feito" : "a fazer");
    el.append(doc.createTextNode(a?.checked ? "☑" : "☐"));
    return el;
  }
  if (n.tag === "table") el.setAttribute("class", "kn-md-table");
  if (n.tag === "ol" && a?.start) el.setAttribute("start", String(a.start));
  if (a?.align) el.setAttribute("class", `kn-md-align-${a.align}`);
  for (const c of n.children) el.append(mountNode(doc, c));
  if (n.tag === "table") {
    // A tabela larga rola de lado dentro do balão, sem alargar o resto.
    const wrap = doc.createElement("div");
    wrap.setAttribute("class", "kn-md-scroll");
    wrap.append(el);
    return wrap;
  }
  return el;
}

/** Monta a árvore no DOM, nó por nó. Nunca `innerHTML`. */
export function mountMarkdown(nodes: MdNode[]): DocumentFragment;
export function mountMarkdown(nodes: MdNode[], doc: MdDocument): MdElement;
export function mountMarkdown(nodes: MdNode[], doc: MdDocument = document as unknown as MdDocument): MdElement | DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const n of nodes) frag.append(mountNode(doc, n));
  return frag;
}

/** O atalho: o texto do agente já montado (`mountMarkdown(parseMarkdown(text))`). */
export function renderMarkdown(text: string, doc?: undefined, links?: readonly BubbleLink[]): DocumentFragment;
export function renderMarkdown(text: string, doc: MdDocument, links?: readonly BubbleLink[]): MdElement;
export function renderMarkdown(text: string, doc?: MdDocument, links?: readonly BubbleLink[]): MdElement | DocumentFragment {
  const md = withFileLinks(text, links);
  const nodes = parseMarkdown(md.text, md.files);
  return doc ? mountMarkdown(nodes, doc) : mountMarkdown(nodes);
}
