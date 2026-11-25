// Formatar e colar no docx (T23238, spec #21080), com a cara das Notas: a mesma barra que flutua em cima da seleção
// (`kn-fmt`) e os mesmos atalhos (⌘1 a ⌘6 títulos, ⇧⌘7 e ⇧⌘8 listas, ⇧⌘X tachado). O ⌘B, o ⌘I, o ⌘U e o alinhamento
// (⌘L, ⌘E, ⌘J) são do motor, como no Word. O ⌘0 continua sendo o zoom de 100% do visualizador.
//
// O colar: a cópia de outro docx (o motor marca o HTML dela com `data-docx-fragment`) entra como está, com a formatação
// do documento. O HTML de fora (uma página, um e-mail, o Word) passa por `cleanPastedHtml`: fica a estrutura (título,
// parágrafo, lista, tabela, negrito, itálico, sublinhado, tachado, link) e sai o estilo da página (fonte, cor, tamanho,
// fundo, classes), que no docx viraria lixo nos trechos. Nada de imagem nem de pedido à rede.

import type { TextKey } from "../../../src/shared/i18n/index.ts";

/** O que a barra e os atalhos fazem. */
export type DocxFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "heading"
  | "bullet"
  | "ordered"
  | "left"
  | "center"
  | "right"
  | "justify"
  | `heading${1 | 2 | 3 | 4 | 5 | 6}`;

/** O estado da seleção, para a barra mostrar o que já está ligado. */
export interface DocxFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** O nível do título do parágrafo (1 a 6), ou 0. */
  heading: number;
  bullet: boolean;
  ordered: boolean;
  alignment: "left" | "center" | "right" | "justify" | null;
}

/** `title` é a chave do catálogo (`viewers.*.ts`): a barra traduz na língua da tela. */
export const DOCX_FORMAT_BUTTONS: readonly { action: DocxFormatAction; label: string; title: TextKey; group: number }[] = [
  { action: "bold", label: "B", title: "files.docx.format.bold", group: 0 },
  { action: "italic", label: "I", title: "files.docx.format.italic", group: 0 },
  { action: "underline", label: "U", title: "files.docx.format.underline", group: 0 },
  { action: "strike", label: "S", title: "files.docx.format.strike", group: 0 },
  { action: "heading", label: "H", title: "files.docx.format.heading", group: 1 },
  { action: "bullet", label: "•", title: "files.docx.format.bullet", group: 1 },
  { action: "ordered", label: "1.", title: "files.docx.format.ordered", group: 1 },
  { action: "left", label: "", title: "files.docx.format.left", group: 2 },
  { action: "center", label: "", title: "files.docx.format.center", group: 2 },
  { action: "right", label: "", title: "files.docx.format.right", group: 2 },
  { action: "justify", label: "", title: "files.docx.format.justify", group: 2 },
];

/** O botão aceso para este estado. */
export function isActive(action: DocxFormatAction, s: DocxFormatState): boolean {
  switch (action) {
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "bullet":
    case "ordered":
      return s[action];
    case "heading":
      return s.heading > 0;
    case "left":
    case "center":
    case "right":
    case "justify":
      return s.alignment === action;
    default:
      return s.heading === Number(action.slice(7));
  }
}

/** Os atalhos das Notas que o motor não tem. O ⌘ é o `metaKey`; nada com ⌥ nem ⌃. */
export function shortcutAction(e: { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): DocxFormatAction | null {
  if (!e.metaKey || e.altKey || e.ctrlKey) return null;
  // Com o ⇧, o `key` do 7 e do 8 muda conforme o teclado (`&`, `*`, `/`, `(`): o `code` é a tecla.
  const digit = /^Digit(\d)$/.exec(e.code ?? "")?.[1] ?? (/^\d$/.test(e.key) ? e.key : null);
  if (e.shiftKey) {
    if (digit === "7") return "ordered";
    if (digit === "8") return "bullet";
    if (e.key.toLowerCase() === "x" || e.code === "KeyX") return "strike";
    return null;
  }
  if (digit && digit >= "1" && digit <= "6") return `heading${Number(digit) as 1 | 2 | 3 | 4 | 5 | 6}`;
  return null;
}

/** Um estilo de parágrafo do documento, como o motor lista. */
export interface DocStyle {
  styleId: string;
  name: string;
  type: string;
}

/** O nível de título de um estilo (o `Heading2` do Word, ou o nome "heading 2" em outra língua de id), ou 0. */
export function headingLevel(style: Pick<DocStyle, "styleId" | "name">): number {
  const m = /^heading\s*([1-6])$/i.exec(style.styleId) ?? /^heading\s*([1-6])$/i.exec(style.name);
  return m ? Number(m[1]) : 0;
}

/**
 * Os estilos que o documento oferece para os títulos (1 a 6) e o do corpo. Um nível que o documento não define fica de
 * fora: o motor recusa um estilo que não existe no arquivo.
 */
export function docStyles(styles: readonly DocStyle[]): { headings: Map<number, string>; body: string | null } {
  const headings = new Map<number, string>();
  let body: string | null = null;
  for (const s of styles) {
    if (s.type !== "paragraph") continue;
    const level = headingLevel(s);
    if (level && !headings.has(level)) headings.set(level, s.styleId);
    if (!body && (s.styleId === "Normal" || /^normal$/i.test(s.name))) body = s.styleId;
  }
  return { headings, body };
}

/**
 * O estilo que o botão H põe, como o das Notas: tira o título de um parágrafo que já é título, e senão põe o 2 (o `##`
 * das Notas), ou o nível mais perto que o documento tiver. `null` quando o documento não tem como.
 */
export function headingToggle(current: number, styles: ReturnType<typeof docStyles>): string | null {
  if (current > 0) return styles.body;
  for (const level of [2, 1, 3, 4, 5, 6]) {
    const id = styles.headings.get(level);
    if (id) return id;
  }
  return null;
}

/** O HTML maior que isto cola como texto puro, como nas Notas: limpar um documento inteiro trava a janela. */
export const MAX_PASTE_HTML = 2_000_000;

/** A cópia de um docx (deste ou de outro arquivo), que o motor cola com a formatação do documento. */
export const isDocxFragment = (html: string) => html.includes('data-docx-fragment="');

const BLOCK = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH"]);
/** Viram parágrafo: as linhas do e-mail (`div`), a citação, o código e o resto que é bloco. */
const AS_PARAGRAPH = new Set(["DIV", "BLOCKQUOTE", "PRE", "ADDRESS", "ARTICLE", "SECTION", "HEADER", "FOOTER", "ASIDE", "MAIN", "NAV", "FIGURE", "FIGCAPTION", "DT", "DD", "CAPTION"]);
const INLINE: Record<string, string> = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", INS: "u", S: "s", STRIKE: "s", DEL: "s", SUB: "sub", SUP: "sup" };
/** O que não é texto da página: some, com o que tiver dentro. */
const DROP = new Set(["SCRIPT", "STYLE", "TITLE", "META", "LINK", "HEAD", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "BUTTON", "SELECT", "TEXTAREA", "INPUT", "IMG", "PICTURE", "VIDEO", "AUDIO", "MAP", "FORM", "XML"]);

const BOLD = /font-weight\s*:\s*(?:bold|bolder|[6-9]00)\b/i;
const NOT_BOLD = /font-weight\s*:\s*(?:normal|[1-4]00)\b/i;
const ITALIC = /font-style\s*:\s*(?:italic|oblique)\b/i;
const UNDERLINE = /text-decoration(?:-line)?\s*:[^;]*underline/i;
const STRIKE = /text-decoration(?:-line)?\s*:[^;]*line-through/i;

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** Um link que pode entrar no documento: http, https e mailto. */
function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

/** O pedaço do DOM que o limpador lê: o `DOMParser` no app, o domino nos testes. */
export interface PasteNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<PasteNode>;
  getAttribute?(name: string): string | null;
}

/**
 * O HTML de fora, só com a estrutura e a ênfase: sem fonte, cor, tamanho, fundo nem classe. `body` é o `<body>` já lido
 * (o `DOMParser` no app). Devolve `null` quando não sobra nada além do texto, e aí o colar é o do texto puro.
 */
export function cleanPastedHtml(body: PasteNode): string | null {
  let rich = false;
  const walk = (node: PasteNode): string => {
    if (node.nodeType === 3) return escapeText(node.nodeValue ?? "");
    if (node.nodeType !== 1) return "";
    const name = node.nodeName.toUpperCase();
    if (DROP.has(name)) return "";
    const inner = () => Array.from(node.childNodes, walk).join("");
    const style = node.getAttribute?.("style") ?? "";
    if (name === "BR") return "<br>";
    if (name === "A") {
      const href = safeHref(node.getAttribute?.("href") ?? null);
      if (!href) return inner();
      rich = true;
      return `<a href="${escapeAttr(href)}">${inner()}</a>`;
    }
    if (BLOCK.has(name)) {
      if (name !== "P") rich = true;
      const span = name === "TD" || name === "TH" ? cellSpan(node) : "";
      return `<${name.toLowerCase()}${span}>${emphasis(style, inner())}</${name.toLowerCase()}>`;
    }
    if (AS_PARAGRAPH.has(name)) return `<p>${emphasis(style, inner())}</p>`;
    const tag = INLINE[name];
    // O Google Docs embrulha tudo num `<b style="font-weight:normal" id="docs-internal-guid-…">`: não é negrito.
    if (tag && !(tag === "b" && (NOT_BOLD.test(style) || /^docs-internal-guid/.test(node.getAttribute?.("id") ?? "")))) {
      rich = true;
      return `<${tag}>${emphasis(style, inner(), tag)}</${tag}>`;
    }
    // `span`, `font` e o resto: o que o estilo diz de ênfase fica; a fonte, a cor e o tamanho, não.
    return emphasis(style, inner());
  };
  /** O negrito, o itálico, o sublinhado e o tachado que vêm no `style` (o Google Docs e o e-mail fazem assim). */
  const emphasis = (style: string, html: string, already = ""): string => {
    if (!style || !html) return html;
    let out = html;
    if (STRIKE.test(style) && already !== "s") out = `<s>${out}</s>`;
    if (UNDERLINE.test(style) && already !== "u") out = `<u>${out}</u>`;
    if (ITALIC.test(style) && already !== "i") out = `<i>${out}</i>`;
    if (BOLD.test(style) && already !== "b") out = `<b>${out}</b>`;
    if (out !== html) rich = true;
    return out;
  };
  const html = Array.from(body.childNodes, walk).join("").trim();
  return rich && html ? html : null;
}

function cellSpan(node: PasteNode): string {
  let out = "";
  for (const a of ["colspan", "rowspan"]) {
    const v = Number(node.getAttribute?.(a));
    if (Number.isInteger(v) && v > 1 && v <= 100) out += ` ${a}="${v}"`;
  }
  return out;
}

/**
 * O que colar: `keep` deixa o motor colar como veio (a cópia de um docx, ou só texto); `html` é o HTML limpo; `plain`
 * cola só o texto (HTML grande demais, ou sem nada além do texto).
 */
export function pastePlan(html: string, parse: (html: string) => PasteNode): { kind: "keep" } | { kind: "html"; html: string } | { kind: "plain" } {
  if (!html.trim() || isDocxFragment(html)) return { kind: "keep" };
  if (html.length > MAX_PASTE_HTML) return { kind: "plain" };
  const clean = cleanPastedHtml(parse(html.replace(/<!--[\s\S]*?-->/g, "")));
  return clean ? { kind: "html", html: clean } : { kind: "plain" };
}
