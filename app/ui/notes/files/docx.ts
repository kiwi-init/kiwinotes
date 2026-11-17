// O docx das Notas (T7110, spec #7079), a parte pura: o HTML que o mammoth escreve vira uma árvore só com o que é
// seguro mostrar. O mammoth não limpa nada (o README dele avisa): um docx pode trazer link `javascript:`. E as janelas
// do Kiwi nunca montam HTML a partir de texto (window-security.ts). Então o HTML é lido aqui, tag a tag, e só passam as
// tags e os atributos da lista; o resto some (a tag, não o texto de dentro). O `DocxViewer` desenha a árvore com React.
//
// O leitor entende o HTML que o mammoth escreve (bem formado, com o texto e os atributos escapados), não HTML qualquer.

import { externalUrl } from "../links.ts";

export type DocNode = string | { tag: string; attrs: Record<string, string>; children: DocNode[] };

/** As tags que passam. As de fora somem, e o texto delas fica. */
const ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "sup", "sub", "span",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "a", "img", "blockquote", "pre", "code",
]);
const VOID = new Set(["br", "hr", "img"]);
/** O conteúdo destas some inteiro, texto e tudo (o mammoth não escreve nenhuma; é só por garantia). */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript"]);

/** O prefixo dos ids que o mammoth escreve (`idPrefix`): as notas de rodapé e os marcadores. */
export const ID_PREFIX = "kn-docx-";

/** Imagem só como `data:` de um tipo de imagem que o WebKit mostra. SVG fica de fora (pode ter script). */
const IMAGE_SRC = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    const c = code.toLowerCase();
    if (c === "amp") return "&";
    if (c === "lt") return "<";
    if (c === "gt") return ">";
    if (c === "quot") return '"';
    if (c === "apos") return "'";
    if (c === "nbsp") return " ";
    const n = c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/** Os atributos que passam em cada tag, já conferidos. Um link que não é seguro vira texto (sem `href`). */
function cleanAttrs(tag: string, raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const id = raw.id;
  if (id && id.startsWith(ID_PREFIX) && /^[\w-]+$/.test(id)) out.id = id;
  if (tag === "a") {
    const href = raw.href?.trim() ?? "";
    if (href.startsWith(`#${ID_PREFIX}`) && /^#[\w-]+$/.test(href)) out.href = href;
    else {
      const url = externalUrl(href);
      if (url) out.href = url;
    }
  }
  if (tag === "img") {
    if (raw.src && IMAGE_SRC.test(raw.src)) out.src = raw.src;
    if (raw.alt) out.alt = raw.alt;
  }
  if ((tag === "td" || tag === "th") && raw.colspan && /^\d{1,3}$/.test(raw.colspan)) out.colSpan = raw.colspan;
  if ((tag === "td" || tag === "th") && raw.rowspan && /^\d{1,4}$/.test(raw.rowspan)) out.rowSpan = raw.rowspan;
  if (tag === "ol" && raw.start && /^\d{1,6}$/.test(raw.start)) out.start = raw.start;
  return out;
}

/** A árvore do HTML, só com o que passa. */
export function parseDocHtml(html: string): DocNode[] {
  const root: { tag: string; attrs: Record<string, string>; children: DocNode[] } = { tag: "", attrs: {}, children: [] };
  const stack = [root];
  /** Dentro de uma tag de `DROP`: tudo some até ela fechar. */
  let dropping: string | null = null;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let at = 0;
  const text = (s: string) => {
    if (dropping || !s) return;
    const value = decode(s);
    const parent = stack.at(-1)!;
    const last = parent.children.at(-1);
    if (typeof last === "string") parent.children[parent.children.length - 1] = last + value;
    else parent.children.push(value);
  };
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    text(html.slice(at, m.index));
    at = m.index + m[0].length;
    if (!m[2]) continue; // comentário
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (DROP.has(tag)) {
      if (!closing && !m[4]) dropping = tag;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      // Fecha até a tag aberta com esse nome; uma que não abriu é ignorada.
      const index = stack.map((n) => n.tag).lastIndexOf(tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    }
    const node = { tag, attrs: cleanAttrs(tag, attrs), children: [] as DocNode[] };
    // O mammoth põe a linha direto na tabela; o navegador e o React querem um <tbody> no meio.
    if (tag === "tr" && stack.at(-1)!.tag === "table") {
      const table = stack.at(-1)!;
      let body = table.children.at(-1);
      if (typeof body === "string" || body?.tag !== "tbody") {
        body = { tag: "tbody", attrs: {}, children: [] };
        table.children.push(body);
      }
      stack.push(body);
    }
    stack.at(-1)!.children.push(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  text(html.slice(at));
  return root.children;
}

/** O texto da árvore, para a busca e para os testes. */
export function docText(nodes: DocNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : docText(n.children))).join("");
}

/** O que o mammoth avisou e a pessoa deve saber: o que ficou de fora da conversão. */
export function docWarnings(messages: { type: string; message: string }[]): number {
  return messages.filter((m) => m.type === "warning" || m.type === "error").length;
}
