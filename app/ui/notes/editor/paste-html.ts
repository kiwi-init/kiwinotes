// Colar HTML como Markdown (T6379, E10). Ideia e escolhas do SilverBullet (MIT, Copyright 2022 Zef Hemel),
// `client/codemirror/editing/editor_paste.ts`: o turndown com o plugin GFM do Joplin (tabelas, tarefas, riscado), títulos
// com `#`, código entre ```, e nada disso com o ⇧ nem dentro de código ou do frontmatter. Nenhum código copiado.
// Daqui: a lista com "-" e um espaço só; o `<div>` de e-mail como linha, não como parágrafo; o negrito, o itálico e o
// riscado que o Google Docs e o e-mail põem no estilo; sem imagem embutida (data:, cid:) nem pixel de rastreio; link só
// http(s) e mailto; e o texto puro quando o Markdown não acrescenta nada (um editor de código, um texto sem formatação).

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

import { externalUrl } from "../links.ts";
import { inFrontmatter } from "./livePreview.ts";

/** HTML maior que isto cola como texto: o turndown num documento inteiro trava a janela. */
const MAX_HTML = 2_000_000;

const BOLD = /font-weight\s*:\s*(?:bold|bolder|[6-9]00)\b/i;
const NOT_BOLD = /font-weight\s*:\s*(?:normal|[1-4]00)\b/i;
const ITALIC = /font-style\s*:\s*(?:italic|oblique)\b/i;
const STRIKE = /text-decoration(?:-line)?\s*:[^;]*line-through/i;

const styleOf = (node: HTMLElement) => node.getAttribute("style") ?? "";
function inside(node: Node, names: RegExp): boolean {
  for (let p = node.parentNode; p; p = p.parentNode) if (names.test(p.nodeName)) return true;
  return false;
}
/** Parênteses e espaço no endereço do link quebram o `(…)` do Markdown. */
const destination = (url: string) => url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
/** Negrito de verdade em volta (o `<b>` do Google Docs, com `font-weight:normal`, não conta). */
function insideBold(node: Node): boolean {
  for (let p = node.parentNode as HTMLElement | null; p; p = p.parentNode as HTMLElement | null) {
    if (/^(?:B|STRONG)$/.test(p.nodeName) && !notBold(p)) return true;
  }
  return false;
}
const notBold = (node: HTMLElement) => NOT_BOLD.test(styleOf(node)) || /^docs-internal-guid/.test(node.id ?? "");

const DROP = new Set(["SCRIPT", "STYLE", "TITLE", "META", "LINK", "HEAD", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "SELECT", "TEXTAREA"]);

let service: TurndownService | undefined;

function turndown(): TurndownService {
  if (service) return service;
  const s = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    // O editor e o desenho já tratam a quebra simples como quebra de linha (`hardSoftBreaks`).
    br: "",
  });
  s.use(gfm);
  // O que não é texto da página: some, com o que tiver dentro.
  s.remove((node) => DROP.has(node.nodeName.toUpperCase()));
  // O "_" no meio da palavra (snake_case) não vira itálico no Markdown: sem a barra, que só enfeia.
  const escape = s.escape.bind(s);
  s.escape = (text: string) => escape(text).replace(/([\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, "$1_");

  // As regras daqui valem antes das do turndown e do plugin (o `addRule` põe na frente).
  s.addRule("listItem", {
    filter: "li",
    replacement(content, node, options) {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === "OL") {
        const start = Number.parseInt(parent.getAttribute("start") ?? "", 10);
        prefix = `${(Number.isFinite(start) ? start : 1) + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const paragraph = /\n$/.test(content);
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "") + (paragraph ? "\n" : "");
      return prefix + body.replace(/\n/g, `\n${" ".repeat(prefix.length)}`) + (node.nextSibling ? "\n" : "");
    },
  });
  // O e-mail (Gmail, Apple Mail) escreve uma linha por `<div>`: cada um é uma linha, e o `<div><br></div>`, a linha vazia.
  s.addRule("divLine", {
    filter: (node) => node.nodeName === "DIV" && !inside(node, /^(?:PRE|CODE|TABLE)$/),
    replacement: (content) => `\n${content}\n`,
  });
  // O Google Docs embrulha tudo num `<b style="font-weight:normal">`: não é negrito.
  s.addRule("notBold", {
    filter: (node) => /^(?:B|STRONG)$/.test(node.nodeName) && notBold(node),
    replacement: (content) => content,
  });
  s.addRule("styledSpan", {
    filter: (node) => node.nodeName === "SPAN" && /font-weight|font-style|text-decoration/i.test(styleOf(node)) && !inside(node, /^(?:H[1-6]|PRE|CODE)$/),
    replacement(content, node) {
      if (!content.trim()) return content;
      const style = styleOf(node as HTMLElement);
      let out = content;
      if (STRIKE.test(style) && !inside(node, /^(?:S|DEL|STRIKE)$/)) out = `~~${out}~~`;
      if (ITALIC.test(style) && !inside(node, /^(?:I|EM)$/)) out = `*${out}*`;
      if (BOLD.test(style) && !insideBold(node)) out = `**${out}**`;
      return out;
    },
  });
  s.addRule("safeLink", {
    filter: (node) => node.nodeName === "A" && node.hasAttribute("href"),
    replacement(content, node) {
      const raw = (node as HTMLElement).getAttribute("href") ?? "";
      const url = externalUrl(raw);
      // Âncora da página (#), javascript:, endereço relativo: fica só o texto.
      if (!url || !content.trim()) return content;
      const text = content.trim();
      // O texto é o próprio endereço: o link automático do Markdown, como a pessoa escreveria.
      if (`mailto:${text}` === url || `mailto:${text}` === raw.trim()) return `<${text}>`;
      if (text === raw.trim() && !/[\s<>]/.test(text)) return `<${text}>`;
      if (text === url) return `<${url}>`;
      return `[${content}](${destination(url)})`;
    },
  });
  s.addRule("safeImage", {
    filter: "img",
    replacement(_content, node) {
      const el = node as HTMLElement;
      const alt = s.escape((el.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim());
      const src = (el.getAttribute("src") ?? "").trim();
      const url = /^https?:/i.test(src) ? externalUrl(src) : null;
      const pixel = Number(el.getAttribute("width")) <= 2 && Number(el.getAttribute("height")) <= 2 && el.hasAttribute("width") && el.hasAttribute("height");
      if (!url || pixel) return alt;
      return `![${alt}](${destination(url)})`;
    },
  });
  service = s;
  return s;
}

/** O HTML colado em Markdown limpo: sem comentário, sem espaço no fim da linha, no máximo uma linha em branco seguida. */
export function htmlToMarkdown(html: string): string {
  const md = turndown().turndown(html.replace(/<!--[\s\S]*?-->/g, ""));
  return betweenWords(md)
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    // A caixa da tarefa vem com o espaço dela e o do texto.
    .replace(/^([ \t]*(?:[-*+]|\d+\.) \[[ xX]\]) {2,}/gm, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\s+$/g, "");
}

/**
 * Os espaços seguidos no meio da linha viram um (o que sobra de uma imagem ou de um botão que saiu), menos no código, onde
 * o espaço é do código.
 */
function betweenWords(md: string): string {
  let fence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(?:```|~~~)/.test(line)) fence = !fence;
      return fence || line.startsWith("    ") ? line : line.replace(/(\S) {2,}(?=\S)/g, "$1 ");
    })
    .join("\n");
}

/** O texto, sem a marcação que o turndown escapa e com os espaços juntos: para ver se o Markdown acrescenta algo. */
const flat = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1").replace(/\s+/g, " ").trim();

const NO_CONVERT = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "Table", "HTMLBlock"]);

/** Dentro de código, de tabela ou do frontmatter, o colar é o de sempre (o texto puro). */
function plainHere(state: EditorState, pos: number): boolean {
  if (inFrontmatter(state, pos)) return true;
  for (const side of [-1, 1] as const) {
    for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (NO_CONVERT.has(n.name)) return true;
    }
  }
  return false;
}

export interface PasteData {
  readonly types: ArrayLike<string>;
  getData(type: string): string;
}

/**
 * O que colar no lugar do HTML, ou `null` para o colar de sempre (o texto puro): sem HTML, com o ⇧ (`plain`), vindo do
 * VS Code, dentro de código, tabela ou frontmatter, ou quando o Markdown não teria nada além do texto.
 */
export function pasteAsMarkdown(state: EditorState, data: PasteData | null | undefined, plain = false): string | null {
  if (!data || plain) return null;
  const types = Array.from(data.types);
  if (!types.includes("text/html") || types.includes("vscode-editor-data")) return null;
  if (state.selection.ranges.some((r) => plainHere(state, r.from))) return null;
  const html = data.getData("text/html");
  if (!html.trim() || html.length > MAX_HTML) return null;
  const md = htmlToMarkdown(html);
  if (!md.trim() || flat(md) === flat(data.getData("text/plain"))) return null;
  return md;
}
