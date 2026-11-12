// O Markdown renderizado fora do cursor (T2983, spec #2973): cada bloco em que o cursor não está aparece desenhado pela
// mesma lib do Channels (react-native-enriched-markdown), e o bloco do cursor fica cru para editar. Aqui fica a parte
// sem DOM (testada): quais blocos renderizar, o Markdown que vai para a lib e onde cai o clique no texto. O desenho
// fica em `renderedWidget.tsx`.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

import { isAttachmentName } from "../../../src/shared/attachments.ts";
import { tagsInLine } from "../../../src/shared/tags.ts";
import { parseLinks } from "../links.ts";
import { embedLine } from "./attachments.ts";
import { noteEmbedLine } from "./embed-line.ts";
import { type Footnotes, footnoteLabel, footnotesOf, superscript } from "./footnotes.ts";
import { DICTATION_CAPTION } from "./livePreview.ts";

/** Os blocos de cima da árvore que a lib desenha. Tabela tem o widget editável dela (`tablePreview`). */
const RENDERED = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "BulletList",
  "OrderedList",
  "Blockquote",
  "FencedCode",
  "CodeBlock",
  "HorizontalRule",
]);

const CODE = new Set(["FencedCode", "CodeBlock"]);

export interface RenderedBlock {
  /** Do começo da primeira linha ao fim da última. */
  from: number;
  to: number;
  /** O texto do bloco como está no `.md`. */
  source: string;
}

/** A árvore inteira: o parser anda aos poucos, e um bloco do fim da nota sem árvore ficaria cru. */
export function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}


/**
 * Fica cru (com o preview de hoje) o que outra parte do editor já desenha: a linha que é só um anexo `![[…]]` (o
 * widget do anexo), os comentários `%%` (o `commentPreview` os esconde) e a legenda do ditado.
 */
export function keepsRaw(node: SyntaxNode, source: string): boolean {
  if (CODE.has(node.name)) return false;
  if (source.includes("%%")) return true;
  return source.split("\n").some((l) => DICTATION_CAPTION.test(l) || embedLine(l) || noteEmbedLine(l));
}

/**
 * O maior bloco que vira um widget só (T8046). O editor só põe na página as linhas que estão na tela, mas um bloco
 * renderizado entra inteiro: um parágrafo de 12 mil linhas (uma reunião longa, um diário com uma linha por item, sem
 * linha em branco) eram ~24 mil nós, e o WebKit levava ~12 s para medir ao ir para o fim. Maior que isto, o bloco fica
 * cru, linha a linha, com o preview de cada linha (o `livePreview`).
 */
export const MAX_RENDERED_LINES = 300;
export const MAX_RENDERED_CHARS = 30_000;

/**
 * Os blocos que aparecem renderizados. Com o editor focado, o bloco onde está o cursor (ou a seleção) fica de fora;
 * sem foco, a nota inteira aparece renderizada. Um bloco maior que `MAX_RENDERED_LINES` ou `MAX_RENDERED_CHARS` também.
 */
export function renderedBlocks(state: EditorState, focused: boolean, tree: Tree = fullTree(state)): RenderedBlock[] {
  const out: RenderedBlock[] = [];
  let covered = -1;
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    // A linha recuada de uma definição de uma palavra só, que o parser lê como bloco de código: já foi com a nota.
    if (n.from < covered) continue;
    // `[^1]: Palavra` (uma palavra só, ou um endereço) é um link de referência para o parser: é a nota de rodapé (T6377).
    const footnoteDef = n.name === "LinkReference" && /^ {0,3}\[\^/.test(state.doc.sliceString(n.from, n.from + 6));
    if (!RENDERED.has(n.name) && !footnoteDef) continue;
    const from = state.doc.lineAt(n.from).from;
    let to = state.doc.lineAt(n.to).to;
    if (footnoteDef) {
      // As linhas recuadas logo abaixo continuam a nota: vão no mesmo bloco, e lá viram parágrafo (`toRenderable`).
      const def = footnotesOf(state).defs.find((d) => d.from === from);
      if (def && def.to > to) {
        to = def.to;
        // O bloco de código que o parser fez com a continuação pode seguir depois de uma linha em branco: vai inteiro.
        for (let m = n.nextSibling; m && m.from < to; m = m.nextSibling) to = Math.max(to, state.doc.lineAt(m.to).to);
        covered = to;
      }
    }
    if (focused && touches(state, from, to)) continue;
    if (to - from > MAX_RENDERED_CHARS || state.doc.lineAt(to).number - state.doc.lineAt(from).number + 1 > MAX_RENDERED_LINES) continue;
    const source = state.doc.sliceString(from, to);
    if (!source.trim() || keepsRaw(n, source)) continue;
    out.push({ from, to, source });
  }
  return out;
}

// ---------------------------------------------------------------- o Markdown que vai para a lib

/** Os endereços próprios dos links que a lib desenha: a janela trata o clique (`linkAction`). */
export const NOTE_LINK = "kiwi-note:";
export const MISSING_LINK = "kiwi-note-missing:";
export const TAG_LINK = "kiwi-tag:";
/** A imagem que é um anexo do vault (`![[foto.png]]` no meio do texto): a janela lê pelo engine (`attachments.read`). */
export const ATTACHMENT_LINK = "kiwi-attachment:";
/** O cartão da imagem de fora: o clique nele carrega a imagem na nota (só então o app pede ela à internet). */
export const LOAD_IMAGE_LINK = "kiwi-load-image:";
/**
 * As notas de rodapé (T6377): a chamada `[^x]` (com a definição, ou sem ela ainda), o rótulo da definição embaixo e a
 * nota em linha `^[…]`, pelo número dela. O hover mostra o texto, e o clique anda entre a chamada e a definição.
 */
export const FOOTNOTE_LINK = "kiwi-footnote:";
export const FOOTNOTE_MISSING_LINK = "kiwi-footnote-missing:";
export const FOOTNOTE_DEF_LINK = "kiwi-footnote-def:";
export const FOOTNOTE_INLINE_LINK = "kiwi-footnote-inline:";

export type LinkStatusOf = (target: string) => "ok" | "missing" | "unknown";

const escapeLabel = (s: string) => s.replace(/([\\[\]*_`~<>])/g, "\\$1");

const NO_TAG = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "URL", "Link", "Autolink", "HTMLBlock", "Comment", "WikiLink"]);

function inAny(tree: Tree, pos: number, names: Set<string>): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) if (names.has(n.name)) return true;
  return false;
}

/**
 * O texto do bloco como a lib vai ler: `[[nota|apelido]]` vira `[apelido](kiwi-note:nota)` (ou `kiwi-note-missing:`
 * quando a nota ainda não existe) e `#tag` vira `[#tag](kiwi-tag:tag)`, como as menções do Channels. Fora de código.
 * As notas de rodapé (`notes`, da nota inteira) viram o número em sobrescrito, como link (`kiwi-footnote:`).
 * `offset` é onde o bloco começa no documento (para olhar a árvore).
 */
export function toRenderable(source: string, offset: number, tree: Tree, status: LinkStatusOf, notes?: Footnotes): string {
  const edits: { from: number; to: number; insert: string }[] = [];
  const end = offset + source.length;
  // T8046: tudo aqui é linear no tamanho do bloco. Um parágrafo de 12 mil linhas com um [[link]] cada (uma reunião longa,
  // um diário) tinha 12 mil trocas, e cada uma copiava o texto inteiro: ~12 s no WebKit ao ir para o fim da nota.
  for (const m of notes?.marks ?? []) {
    if (m.from < offset || m.to > end || inAny(tree, m.from + 1, CODE_INLINE)) continue;
    const url = m.kind === "inline" ? `${FOOTNOTE_INLINE_LINK}${m.n}` : `${notes!.def(m.label) ? FOOTNOTE_LINK : FOOTNOTE_MISSING_LINK}${labelUrl(m.label)}`;
    edits.push({ from: m.from - offset, to: m.to - offset, insert: `[${superscript(m.n)}](${url})` });
  }
  for (const d of notes?.defs ?? []) {
    const marker = d.markerTo - `[^${d.label}]:`.length;
    if (marker < offset || d.markerTo > end) continue;
    edits.push({ from: marker - offset, to: d.markerTo - offset, insert: `[${escapeLabel(footnoteLabel(notes!, d.label))}](${FOOTNOTE_DEF_LINK}${labelUrl(d.label)})` });
  }
  // Só as trocas das notas de rodapé (poucas); as da linha de agora ficam à parte, para a #tag não olhar o bloco inteiro.
  const footnoteEdits = [...edits];
  const inFootnote = (a: number) => footnoteEdits.some((e) => a >= e.from && a < e.to);
  let lineStart = 0;
  for (const line of source.split("\n")) {
    const lineFirst = edits.length;
    for (const link of parseLinks(line)) {
      const a = lineStart + link.from;
      if (inAny(tree, offset + a + 2, CODE_INLINE)) continue;
      // O link dentro de uma nota em linha some com ela: aparece no hover.
      if (inFootnote(a)) continue;
      const shown = link.alias || link.target || link.heading || "";
      const embed = line[link.from - 1] === "!";
      if (embed && isAttachmentName(link.target)) {
        // `![[foto.png]]` no meio do texto: a imagem, lida do vault.
        const name = link.target.split("/").at(-1)!;
        edits.push({ from: a - 1, to: lineStart + link.to, insert: `![${escapeLabel(name)}](${ATTACHMENT_LINK}${encodeURIComponent(link.target)})` });
        continue;
      }
      // `![[Nota]]` (a nota embutida, do Obsidian) aparece como o link para ela.
      const scheme = link.target && status(link.target) === "missing" ? MISSING_LINK : NOTE_LINK;
      const destination = link.target + (link.heading ? `#${link.heading}` : "");
      edits.push({ from: embed ? a - 1 : a, to: lineStart + link.to, insert: `[${escapeLabel(shown)}](${scheme}${encodeURIComponent(destination)})` });
    }
    // O `^id` de bloco no fim da linha (T6594): é a âncora do Obsidian para `![[nota#^id]]`, e só aparece editando.
    const block = /\s\^[A-Za-z0-9-]+[ \t]*$/.exec(line);
    if (block && !inAny(tree, offset + lineStart + block.index + 1, CODE_INLINE)) {
      edits.push({ from: lineStart + block.index, to: lineStart + line.length, insert: "" });
    }
    for (const t of tagsInLine(line)) {
      const a = lineStart + t.from;
      if (inAny(tree, offset + a, NO_TAG)) continue;
      if (inFootnote(a) || edits.slice(lineFirst).some((e) => a >= e.from && a < e.to)) continue;
      edits.push({ from: a, to: lineStart + t.to, insert: `[${escapeLabel(line.slice(t.from, t.to))}](${TAG_LINK}${encodeURIComponent(t.tag)})` });
    }
    lineStart += line.length + 1;
  }
  // De uma vez, do começo ao fim: os pedaços entre as trocas e as trocas, num join só.
  edits.sort((x, y) => x.from - y.from);
  const parts: string[] = [];
  let at = 0;
  for (const e of edits) {
    parts.push(source.slice(at, e.from), e.insert);
    at = e.to;
  }
  parts.push(source.slice(at));
  return parts.join("");
}

const CODE_INLINE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

/** O rótulo no endereço do link: o `encodeURIComponent` deixa o `(` e o `)`, que fecham o `(…)` do Markdown antes da hora. */
const labelUrl = (label: string) => encodeURIComponent(label).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));

export type LinkAction =
  | { kind: "note"; target: string }
  | { kind: "tag"; tag: string }
  | { kind: "url"; url: string }
  | { kind: "loadImage"; url: string }
  | { kind: "footnote"; label: string }
  | { kind: "footnoteDef"; label: string }
  | { kind: "footnoteInline"; n: number };

/** O que fazer com o clique num link desenhado pela lib. */
export function linkAction(url: string): LinkAction | null {
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  for (const scheme of [MISSING_LINK, NOTE_LINK]) {
    if (url.startsWith(scheme)) {
      const target = decode(url.slice(scheme.length));
      return target ? { kind: "note", target } : null;
    }
  }
  if (url.startsWith(LOAD_IMAGE_LINK)) {
    const image = decode(url.slice(LOAD_IMAGE_LINK.length));
    return image && /^https:\/\//i.test(image) ? { kind: "loadImage", url: image } : null;
  }
  if (url.startsWith(TAG_LINK)) {
    const tag = decode(url.slice(TAG_LINK.length));
    return tag ? { kind: "tag", tag } : null;
  }
  for (const scheme of [FOOTNOTE_MISSING_LINK, FOOTNOTE_LINK]) {
    if (url.startsWith(scheme)) {
      const label = decode(url.slice(scheme.length));
      return label ? { kind: "footnote", label } : null;
    }
  }
  if (url.startsWith(FOOTNOTE_DEF_LINK)) {
    const label = decode(url.slice(FOOTNOTE_DEF_LINK.length));
    return label ? { kind: "footnoteDef", label } : null;
  }
  if (url.startsWith(FOOTNOTE_INLINE_LINK)) {
    const n = Number(url.slice(FOOTNOTE_INLINE_LINK.length));
    return Number.isInteger(n) && n > 0 ? { kind: "footnoteInline", n } : null;
  }
  return { kind: "url", url };
}

// ---------------------------------------------------------------- as imagens

export type ImageSource = { kind: "attachment"; target: string } | { kind: "data" } | { kind: "remote"; url: string } | { kind: "none" };

/**
 * De onde vem a imagem de um `![alt](endereço)`. Anexo: `kiwi-attachment:` ou um caminho relativo (`anexos/foto.png`),
 * lidos do vault pelo engine. `data:` aparece como está. `http(s)://` é de fora: nunca carrega sozinha.
 */
export function imageSource(url: string): ImageSource {
  const u = url.trim();
  if (u.startsWith(ATTACHMENT_LINK)) {
    try {
      return { kind: "attachment", target: decodeURIComponent(u.slice(ATTACHMENT_LINK.length)) };
    } catch {
      return { kind: "none" };
    }
  }
  if (/^data:image\//i.test(u)) return { kind: "data" };
  if (/^https?:\/\//i.test(u)) return { kind: "remote", url: u };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("/") || u.startsWith("//")) return { kind: "none" };
  let path = u;
  try {
    path = decodeURIComponent(u);
  } catch {
    // Um % solto: fica como foi escrito.
  }
  return isAttachmentName(path) ? { kind: "attachment", target: path } : { kind: "none" };
}

// ---------------------------------------------------------------- os diagramas

/** Os blocos ```mermaid onde está o cursor: o código fica cru, e o diagrama continua à vista logo abaixo. */
export function mermaidUnderCursor(state: EditorState, focused: boolean, tree: Tree = fullTree(state)): { to: number; source: string }[] {
  if (!focused) return [];
  const out: { to: number; source: string }[] = [];
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (n.name !== "FencedCode") continue;
    const from = state.doc.lineAt(n.from).from;
    const to = state.doc.lineAt(n.to).to;
    if (!touches(state, from, to)) continue;
    out.push({ to, source: state.doc.sliceString(from, to) });
  }
  return out;
}

// ---------------------------------------------------------------- as imagens do bloco do cursor

/**
 * As imagens do bloco onde está o cursor (`![](foto.png)`, `![[foto.png]]` no meio do texto, a de fora): o bloco fica
 * cru para editar, e as imagens continuam à vista logo abaixo dele, no Markdown que a lib desenha. O anexo sozinho na
 * linha não entra: ele já tem o widget dele (`attachmentPreview`).
 */
export function imagesUnderCursor(state: EditorState, focused: boolean, tree: Tree = fullTree(state)): { to: number; markdown: string }[] {
  if (!focused) return [];
  const out: { to: number; markdown: string }[] = [];
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (!RENDERED.has(n.name) || CODE.has(n.name)) continue;
    const from = state.doc.lineAt(n.from).from;
    const to = state.doc.lineAt(n.to).to;
    if (!touches(state, from, to)) continue;
    const pics: string[] = [];
    tree.iterate({
      from: n.from,
      to: n.to,
      enter: (c) => {
        if (c.name !== "Image") return;
        const text = state.doc.sliceString(c.from, c.to);
        if (!text.startsWith("![[")) pics.push(text);
        else if (!embedLine(state.doc.lineAt(c.from).text)) {
          const link = parseLinks(text.slice(1))[0];
          if (link && isAttachmentName(link.target)) pics.push(`![${escapeLabel(link.target.split("/").at(-1)!)}](${ATTACHMENT_LINK}${encodeURIComponent(link.target)})`);
        }
        return false;
      },
    });
    if (pics.length) out.push({ to, markdown: pics.join(" ") });
  }
  return out;
}

// ---------------------------------------------------------------- as tarefas

/** Onde está o caractere de dentro do `[ ]` de cada tarefa do bloco, na ordem: o mesmo índice que a lib dá. */
export function taskMarks(tree: Tree, from: number, to: number): number[] {
  const out: number[] = [];
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === "TaskMarker") out.push(n.from + 1);
    },
  });
  return out;
}

// ---------------------------------------------------------------- o clique

/**
 * Onde cai no `.md` o caractere `at` do texto que aparece renderizado. O texto renderizado é quase uma subsequência da
 * fonte (a marcação some): anda nas duas ao mesmo tempo, pulando na fonte o que não aparece. Um caractere que só existe
 * no desenho (o número da lista, uma quebra) não anda na fonte.
 */
export function sourceOffset(source: string, rendered: string, at: number): number {
  const WINDOW = 80;
  let s = 0;
  for (let r = 0; r < Math.min(at, rendered.length); r++) {
    const c = rendered[r]!;
    const space = /\s/.test(c);
    let found = -1;
    for (let i = s; i < source.length && i - s <= WINDOW; i++) {
      if (space ? /\s/.test(source[i]!) : source[i] === c) {
        found = i;
        break;
      }
    }
    if (found >= 0) s = found + 1;
  }
  // A marcação logo antes do caractere clicado (o `**` que abre, o `- ` do item) fica antes do cursor.
  const next = rendered[at];
  if (next && !/\s/.test(next)) {
    const found = source.indexOf(next, s);
    if (found >= 0 && found - s <= WINDOW) s = found;
  }
  return Math.min(s, source.length);
}
