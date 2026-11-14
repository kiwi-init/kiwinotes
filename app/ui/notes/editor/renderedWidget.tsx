// O desenho dos blocos renderizados (T2983, spec #2973): a mesma lib e o mesmo STYLE das mensagens do Channels
// (`ui/src/chat/markdown.tsx` do kiwi-init/channels), com os tokens das Notas. Cada bloco fora do cursor vira um
// widget do CodeMirror com uma raiz React; clicar nele põe o cursor no ponto do `.md` que corresponde ao clique.
// O parser (md4c em WASM) vem embutido na lib como base64: nada é baixado.

// Antes da lib: o `__DEV__` que ela lê.
import { CalloutIcon } from "./calloutIcons.tsx";
import "./enrichedEnv.ts";
import katex from "katex";
import { HIGHLIGHT_BACKGROUND } from "./highlight.ts";

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MarkdownStyle } from "react-native-enriched-markdown/lib/module/index.web.js";
import { normalizeMarkdownStyle } from "react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js";
import { ENRM_TEXT_CLASS } from "react-native-enriched-markdown/lib/module/web/globalStyles.js";
import { parseMarkdown } from "react-native-enriched-markdown/lib/module/web/parseMarkdown.js";
import { RenderNode } from "react-native-enriched-markdown/lib/module/web/renderers/index.js";
import { buildStyles, zeroTrailingMargins } from "react-native-enriched-markdown/lib/module/web/styles.js";
import { indexTaskItems, markInlineImages } from "react-native-enriched-markdown/lib/module/web/utils.js";
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types";

import { externalUrl, parseLinks } from "../links.ts";
import type { AttachmentFile, AttachmentSource } from "./attachments.ts";
import { editorFocused, focusEditorNow, type LinkResolver, linksChanged } from "./livePreview.ts";
import { MermaidBlock, mermaidCode } from "./mermaid.tsx";
import { COPIED_MS } from "./code-copy.ts";
import { type Callout, parseCallout } from "./callouts.ts";
import { footnoteJump, footnotesOf, footnoteText } from "./footnotes.ts";
import { hiddenTitle } from "./titleHeading.ts";
import {
  FOOTNOTE_DEF_LINK,
  FOOTNOTE_INLINE_LINK,
  FOOTNOTE_LINK,
  FOOTNOTE_MISSING_LINK,
  fullTree,
  imageSource,
  linkAction,
  LOAD_IMAGE_LINK,
  MISSING_LINK,
  imagesUnderCursor,
  mermaidUnderCursor,
  NOTE_LINK,
  renderedBlocks,
  sourceOffset,
  TAG_LINK,
  taskMarks,
  toRenderable,
} from "./rendered.ts";

// ---------------------------------------------------------------- o estilo do Channels, com os tokens das Notas

// O corpo no tamanho do editor (14 px, entrelinha 1.65): o bloco não muda de altura ao virar texto para editar.
const TEXT = { fontSize: 14, fontFamily: "var(--font)", color: "var(--text)", lineHeight: 23, marginTop: 0, marginBottom: 0 };
const HEAD = { fontFamily: "var(--font)", fontWeight: "600", color: "var(--text)", marginTop: 0, marginBottom: 0 };

const STYLE: MarkdownStyle = {
  math: { color: "var(--text)", backgroundColor: "var(--surface-2)", fontSize: 16, padding: 12, marginTop: 0, marginBottom: 0, textAlign: "center" },
  inlineMath: { color: "var(--text)" },
  highlight: { backgroundColor: HIGHLIGHT_BACKGROUND, color: "var(--text)" },
  paragraph: TEXT,
  h1: { ...HEAD, fontSize: 19, lineHeight: 26 },
  h2: { ...HEAD, fontSize: 17, lineHeight: 24 },
  h3: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h4: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h5: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--text-2)" },
  h6: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--text-2)" },
  blockquote: {
    ...TEXT,
    color: "var(--text-2)",
    borderColor: "var(--border-strong)",
    borderWidth: 2,
    gapWidth: 12,
    backgroundColor: "transparent",
    padding: 0,
    admonitions: {
      note: { color: "var(--accent-text)", backgroundColor: "var(--accent-soft)" },
      tip: { color: "var(--accent-text)", backgroundColor: "var(--surface-2)" },
      important: { color: "var(--text)", backgroundColor: "var(--surface-2)" },
      warning: { color: "var(--danger)", backgroundColor: "var(--surface-2)" },
      caution: { color: "var(--danger)", backgroundColor: "var(--surface-2)" },
    },
  },
  list: { ...TEXT, bulletColor: "var(--text-3)", bulletSize: 5, markerColor: "var(--text-3)", markerFontWeight: "500", gapWidth: 6, marginLeft: 22, itemSpacing: 2 },
  codeBlock: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    color: "var(--text)",
    lineHeight: 19,
    marginTop: 0,
    marginBottom: 0,
    backgroundColor: "var(--surface-2)",
    borderColor: "transparent",
    borderWidth: 0,
    borderRadius: 10,
    padding: 12,
  },
  link: { color: "var(--accent-text)", underline: false },
  linkVariants: {
    [`^${MISSING_LINK}`]: { color: "var(--text-3)", underline: false },
    [`^${NOTE_LINK}`]: { color: "var(--accent-text)", underline: false },
    [`^${TAG_LINK}`]: { color: "var(--accent-text)", backgroundColor: "var(--accent-soft)", underline: false },
    [`^${LOAD_IMAGE_LINK}`]: { color: "var(--text-2)", backgroundColor: "var(--surface-2)", underline: false },
    // As notas de rodapé (T6377): o número no tom do link; a chamada sem texto ainda, apagada.
    [`^${FOOTNOTE_MISSING_LINK}`]: { color: "var(--text-3)", underline: false },
    [`^${FOOTNOTE_LINK}`]: { color: "var(--accent-text)", underline: false },
    [`^${FOOTNOTE_DEF_LINK}`]: { color: "var(--accent-text)", underline: false },
    [`^${FOOTNOTE_INLINE_LINK}`]: { color: "var(--accent-text)", underline: false },
  },
  strong: { color: "var(--text)" },
  em: { color: "var(--text)" },
  strikethrough: { color: "var(--text-3)" },
  code: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-2)", backgroundColor: "var(--surface-2)", borderColor: "transparent" },
  thematicBreak: { color: "var(--border)", height: 1, marginTop: 11, marginBottom: 11 },
  image: { maxHeight: 480, borderRadius: 10, marginTop: 2, marginBottom: 2, resizeMode: "contain" },
  // A imagem no meio do texto: uma miniatura da altura de três linhas (a largura segue a proporção, no tema abaixo).
  inlineImage: { size: 69 },
  taskList: { checkedColor: "var(--accent)", borderColor: "var(--border-strong)", checkmarkColor: "var(--on-accent)", checkedTextColor: "var(--text-3)" },
};

// Um bloco por widget: sem margem embaixo (o CodeMirror mede o bloco sem a margem; o espaço é a linha em branco).
const NORMAL = zeroTrailingMargins(normalizeMarkdownStyle(STYLE));
const STYLES = buildStyles(NORMAL);
const CAPABILITIES = { katex, enableTaskListItemToggle: true };
// KaTeX ships locally; the renderer emits MathML with trust:false and throwOnError:false.
const FLAGS = { latexMath: true, highlight: true, underline: false, hardSoftBreaks: true };

// ---------------------------------------------------------------- o parse, com cache

const LIMIT = 800;
const parsed = new Map<string, ASTNode>();
const parsing = new Map<string, Promise<ASTNode>>();

function parse(markdown: string): Promise<ASTNode> {
  const done = parsed.get(markdown);
  if (done) return Promise.resolve(done);
  const pending = parsing.get(markdown);
  if (pending) return pending;
  const next = parseMarkdown(markdown, FLAGS)
    .then((ast) => {
      indexTaskItems(ast);
      // Imagem no meio do texto fica na linha, como no Channels; sozinha no parágrafo, ocupa o bloco.
      markInlineImages(ast);
      parsed.set(markdown, ast);
      if (parsed.size > LIMIT) parsed.delete(parsed.keys().next().value!);
      return ast;
    })
    .finally(() => parsing.delete(markdown));
  parsing.set(markdown, next);
  return next;
}

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("");

// ---------------------------------------------------------------- as imagens (T2984)

/** Os anexos já lidos pelo engine (`attachments.read`), por alvo; `null` é o que não está no vault. */
const files = new Map<string, AttachmentFile | null>();
const reading = new Set<string>();
const waiting = new Set<() => void>();
/** Sobe a cada anexo que chega: um bloco que desenhou antes e só se inscreveu depois não perde a chegada. */
let arrivals = 0;
/**
 * As imagens de fora que a pessoa mandou carregar (com um clique no cartão), nesta janela: o engine baixa e devolve um
 * `data:` (`images.remote`); a janela mesma não carrega nada da internet (a CSP não tem `https:`). `null`: não deu.
 */
const remote = new Map<string, AttachmentFile | null | "loading">();

function arrived(): void {
  arrivals++;
  for (const wake of [...waiting]) wake();
}

function loadRemote(url: string, source: AttachmentSource | undefined): void {
  if (remote.get(url) === "loading") return;
  if (!source?.remote) {
    remote.set(url, null);
    return arrived();
  }
  remote.set(url, "loading");
  arrived();
  const settle = (f: AttachmentFile | null) => {
    remote.set(url, f);
    arrived();
  };
  source.remote(url).then(settle, () => settle(null));
}

function readImage(source: AttachmentSource | undefined, target: string): AttachmentFile | null | undefined {
  const key = target.toLocaleLowerCase("pt-BR");
  if (files.has(key)) return files.get(key);
  if (!source) return null;
  if (!reading.has(key)) {
    reading.add(key);
    const settle = (f: AttachmentFile | null) => {
      reading.delete(key);
      files.set(key, f);
      arrivals++;
      for (const wake of [...waiting]) wake();
    };
    source.read(target).then(settle, () => settle(null));
  }
  return undefined;
}

const text = (content: string): ASTNode => ({ type: "Text", content });

/**
 * A árvore com as imagens prontas para desenhar: o anexo vira o `data:` que o engine leu. A imagem de fora (https)
 * vira um cartão, e só carrega depois do clique nele (decisão do jow no #3039); `http:` nunca carrega, só abre fora.
 * O que não dá para mostrar fica como o texto dela.
 */
function withImages(node: ASTNode, source: AttachmentSource | undefined): ASTNode {
  if (node.type === "Image") {
    const alt = textOf(node);
    const from = imageSource(node.attributes?.url ?? "");
    if (from.kind === "data") return node;
    if (from.kind === "remote") {
      const got = remote.get(from.url);
      if (got && got !== "loading") return { ...node, attributes: { ...node.attributes, url: got.dataUrl } };
      let host = from.url;
      try {
        host = new URL(from.url).host;
      } catch {
        // Fica o endereço inteiro.
      }
      const label = `🖼 ${alt || "imagem"} · ${host}`;
      // https: o clique carrega aqui. http: só abre no navegador (a CSP não deixa carregar sem TLS).
      if (got === "loading") return text(`${label} · carregando…`);
      const load = got === null ? "não deu para carregar · tentar de novo" : "carregar";
      if (/^https:/i.test(from.url)) return { type: "Link", attributes: { url: `${LOAD_IMAGE_LINK}${encodeURIComponent(from.url)}` }, children: [text(`${label} · ${load}`)] };
      return { type: "Link", attributes: { url: from.url }, children: [text(label)] };
    }
    if (from.kind === "attachment") {
      const name = from.target.split("/").at(-1)!;
      const file = readImage(source, from.target);
      if (file === undefined) return text(alt || name);
      if (file === null) return text(`${name} não está no vault`);
      if (!file.mime.startsWith("image/")) return text(`${name} (${file.mime === "application/pdf" ? "PDF" : "arquivo"})`);
      return { ...node, attributes: { ...node.attributes, url: file.dataUrl } };
    }
    return text(alt);
  }
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => withImages(c, source)) };
}

const hasImage = (node: ASTNode): boolean => node.type === "Image" || (node.children ?? []).some(hasImage);

/** Redesenha quando chega uma imagem que o bloco esperava. */
function useImagesArriving(active: boolean): void {
  const [, arrived] = useState(0);
  const seen = arrivals;
  useEffect(() => {
    if (!active) return;
    const wake = () => arrived((n) => n + 1);
    waiting.add(wake);
    // Chegou alguma entre o desenho e agora: desenha de novo.
    if (arrivals !== seen) wake();
    return () => {
      waiting.delete(wake);
    };
  }, [active, seen]);
}

const isMermaid = (node: ASTNode) => node.type === "CodeBlock" && node.attributes?.language?.trim().toLowerCase() === "mermaid" && !!textOf(node).trim();

// ---------------------------------------------------------------- o widget

export interface RenderedActions {
  onOpenLink(target: string): void;
  onOpenTag?(tag: string): void;
  onOpenUrl(url: string): void;
  /** Os anexos do vault, para as imagens (T2984). */
  attachments?: AttachmentSource;
  /** O botão Copiar dos blocos de código (T6379); sem ele, o bloco fica sem o botão. */
  copy?(text: string): Promise<unknown>;
}

interface BlockProps {
  markdown: string;
  source: string;
  callbacks: Parameters<typeof RenderNode>[0]["callbacks"];
  attachments?: AttachmentSource;
  copy?(text: string): Promise<unknown>;
  onShown(): void;
}

/** O Copiar no canto do bloco de código desenhado (T6379): aparece com o mouse em cima, e diz "Copiado" por um instante. */
function CodeCopyButton({ text, copy }: { text: string; copy(text: string): Promise<unknown> }) {
  const [state, setState] = useState<"done" | "failed" | null>(null);
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className="kn-code-copy"
      title="Copiar o código"
      data-state={state ?? undefined}
      // Nem o cursor nem o foco saem do lugar: só copia.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        void copy(text).then(() => setState("done"), () => setState("failed"));
      }}
    >
      {state === "done" ? "Copiado" : state === "failed" ? "Não copiou" : "Copiar"}
    </button>
  );
}

/**
 * O callout do Obsidian (T6383): o cabeçalho é nosso (o ícone, o título em PT ou o da nota, e a seta quando tem `+`/`-`),
 * e o corpo é desenhado pela lib como o resto. Recolher muda só a vista, como no Obsidian: o `.md` não muda.
 */
function CalloutBox({ callout, markdown, callbacks, attachments, copy, onShown }: Omit<BlockProps, "source"> & { callout: Callout }) {
  const [open, setOpen] = useState(callout.fold !== "-");
  const body = parseCallout(markdown)?.body ?? callout.body;
  useLayoutEffect(onShown, [open]);
  return (
    <div className={`kn-callout kn-callout-${callout.kind.tone}`} data-callout={callout.kind.id} data-open={open ? "true" : "false"}>
      <div className="kn-callout-head">
        <CalloutIcon kind={callout.kind.id} />
        <span className="kn-callout-title">{callout.title}</span>
        {callout.fold ? (
          <button
            type="button"
            className="kn-callout-fold"
            aria-expanded={open}
            aria-label={open ? "Recolher" : "Abrir"}
            onClick={() => setOpen((o) => !o)}
          >
            ›
          </button>
        ) : null}
      </div>
      {open && body.trim() ? (
        <div className="kn-callout-body">
          <Block markdown={body} source={callout.body} callbacks={callbacks} attachments={attachments} copy={copy} onShown={onShown} />
        </div>
      ) : null}
    </div>
  );
}

/** O bloco desenhado, também fora do editor (o nó do quadro branco, T6600). */
export { Block as RenderedBlock };

function Block({ markdown, source, callbacks, attachments, copy, onShown }: BlockProps) {
  const callout = parseCallout(source);
  if (callout) return <CalloutBox callout={callout} markdown={markdown} callbacks={callbacks} attachments={attachments} copy={copy} onShown={onShown} />;
  return <PlainBlock markdown={markdown} source={source} callbacks={callbacks} attachments={attachments} copy={copy} onShown={onShown} />;
}

function PlainBlock({ markdown, source, callbacks, attachments, copy, onShown }: BlockProps) {
  const [, parsedNow] = useState(0);
  const current = parsed.get(markdown) ?? null;
  useLayoutEffect(() => {
    if (current) return;
    let live = true;
    parse(markdown).then(
      () => live && parsedNow((n) => n + 1),
      () => {
        // Não deu para ler: o texto cru continua.
      },
    );
    return () => {
      live = false;
    };
  }, [markdown, current]);
  const pictures = !!current && hasImage(current);
  useImagesArriving(pictures);
  const ast = current && pictures ? withImages(current, attachments) : current;
  useLayoutEffect(onShown);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // O link de URL abre só com ⌘-clique (#3044): a dica aparece no hover.
    for (const a of box.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []) {
      if (opensOutside(a.getAttribute("href") ?? "")) a.title = `${a.getAttribute("href")} · ⌘-clique para abrir`;
    }
  });
  // Até o parse chegar (só na primeira vez de cada bloco), o texto cru, do mesmo tamanho.
  if (!ast) return <div className="cm-rendered-raw">{source}</div>;
  return (
    <div ref={box} className={ENRM_TEXT_CLASS} style={{ display: "flex", flexDirection: "column" }} onLoadCapture={onShown} onErrorCapture={onShown}>
      {(ast.children ?? []).map((child, i) => {
        const code = <RenderNode key={`${child.type}-${i}`} node={child} style={NORMAL} styles={STYLES} callbacks={callbacks} capabilities={CAPABILITIES} />;
        if (child.type === "CodeBlock" && !isMermaid(child) && copy) {
          return (
            <div key={`code-${i}`} className="kn-code">
              {code}
              <CodeCopyButton text={textOf(child).replace(/\n$/, "")} copy={copy} />
            </div>
          );
        }
        if (!isMermaid(child)) return code;
        return <MermaidBlock key={`mermaid-${i}`} source={textOf(child)} code={code} onLink={(url) => callbacks.onLinkPress?.({ url })} onShown={onShown} />;
      })}
    </div>
  );
}

/**
 * O Markdown de outra nota, desenhado como o resto (T6594, os embeds): os links abrem como no texto, sem o "só posicionar
 * o cursor", porque o embed não é editável aqui.
 */
export function EmbeddedMarkdown({ markdown, actions, onShown }: { markdown: string; actions: RenderedActions; onShown(): void }) {
  const callbacks = {
    onLinkPress: ({ url }: { url: string }) => {
      const act = linkAction(url);
      if (act?.kind === "loadImage") loadRemote(act.url, actions.attachments);
      else if (act?.kind === "note") actions.onOpenLink(act.target);
      else if (act?.kind === "tag") actions.onOpenTag?.(act.tag);
      else if (act?.kind === "url") {
        const safe = externalUrl(act.url);
        if (safe) actions.onOpenUrl(safe);
      }
    },
  };
  return <Block markdown={markdown} source={markdown} callbacks={callbacks} attachments={actions.attachments} onShown={onShown} />;
}

const roots = new WeakMap<HTMLElement, Root>();
const sizes = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * O bloco muda de altura depois de desenhado (uma imagem que carrega ou falha, o diagrama, a fonte): o editor mede de
 * novo, senão o mapa de alturas fica velho e o clique de depois cai na linha errada.
 */
function watchSize(dom: HTMLElement, view: EditorView): void {
  if (typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => view.requestMeasure());
  ro.observe(dom);
  sizes.set(dom, ro);
}

function unmount(dom: HTMLElement): void {
  sizes.get(dom)?.disconnect();
  sizes.delete(dom);
  const root = roots.get(dom);
  roots.delete(dom);
  // Fora do ciclo do React: desmontar no meio de um render dele dá aviso.
  if (root) queueMicrotask(() => root.unmount());
}
/** O widget de agora de cada DOM: o CodeMirror reaproveita o DOM (`updateDOM`) com outro widget, de outro texto. */
const widgets = new WeakMap<HTMLElement, RenderedWidget>();

/**
 * O clique que só põe o cursor num link desenhado (o ⌥-clique, ou o clique simples num link de URL, que abre só com
 * ⌘, decisão do lead no #3044): o `click` que vem depois não abre.
 */
let placingOnly = false;

/** Link para fora (http, https, mailto): abre só com ⌘-clique, como no editor. */
const opensOutside = (href: string) => /^(?:https?:|mailto:)/i.test(href);

class RenderedWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly source: string,
    readonly actions: RenderedActions,
  ) {
    super();
  }

  eq(other: RenderedWidget) {
    return other.markdown === this.markdown && other.source === this.source;
  }

  get estimatedHeight() {
    return this.source.split("\n").length * 23;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-rendered";
    const root = createRoot(dom);
    roots.set(dom, root);
    widgets.set(dom, this);
    this.draw(root, view, dom);
    watchSize(dom, view);
    // Lê o widget pelo DOM: depois de um `updateDOM`, o `this` daqui é o de antes.
    dom.addEventListener("mousedown", (e) => widgets.get(dom)?.place(e, view, dom));
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    const root = roots.get(dom);
    if (!root) return false;
    widgets.set(dom, this);
    this.draw(root, view, dom);
    return true;
  }

  private draw(root: Root, view: EditorView, dom: HTMLElement) {
    const at = () => view.posAtDOM(dom);
    const callbacks = {
      onLinkPress: ({ url }: { url: string }) => {
        if (placingOnly) {
          placingOnly = false;
          return;
        }
        const act = linkAction(url);
        if (act?.kind === "footnote" || act?.kind === "footnoteDef" || act?.kind === "footnoteInline") {
          // Da chamada para a definição e de volta (T6377): o cursor vai para lá, e aquele bloco vira texto.
          focusEditorNow(view);
          const tr = footnoteJump(view.state, act);
          if (tr) view.dispatch(tr);
        } else if (act?.kind === "loadImage") loadRemote(act.url, this.actions.attachments);
        else if (act?.kind === "note") this.actions.onOpenLink(act.target);
        else if (act?.kind === "tag") this.actions.onOpenTag?.(act.tag);
        else if (act?.kind === "url") {
          // Só o que pode abrir fora (http, https, mailto); o resto não faz nada, como no editor.
          const safe = externalUrl(act.url);
          if (safe) this.actions.onOpenUrl(safe);
        }
      },
      onTaskListItemPress: ({ index }: { index: number }) => {
        const from = at();
        const marks = taskMarks(fullTree(view.state), from, from + this.source.length);
        const pos = marks[index];
        if (pos == null) return;
        const checked = /x/i.test(view.state.doc.sliceString(pos, pos + 1));
        view.dispatch({ changes: { from: pos, to: pos + 1, insert: checked ? " " : "x" } });
      },
    };
    root.render(<Block markdown={this.markdown} source={this.source} callbacks={callbacks} attachments={this.actions.attachments} copy={this.actions.copy} onShown={() => view.requestMeasure()} />);
  }

  /** Clique fora de link e de caixa: o cursor vai para o ponto do `.md` onde a pessoa clicou, e o bloco vira texto. */
  /**
   * O clique fora de link e de caixa (ou um ⌥-clique num link): o cursor vai para o ponto do `.md` onde a pessoa
   * clicou e o bloco vira texto. Com ⇧, estende a seleção; arrastando, seleciona como no resto do editor.
   */
  place(e: MouseEvent, view: EditorView, dom: HTMLElement) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const link = target.closest("a");
    const href = link?.getAttribute("href") ?? "";
    // Link de nota, de tag ou o cartão da imagem: o clique abre (ou carrega). URL: só com ⌘. Com ⌥, nenhum abre.
    placingOnly = !!link && (e.altKey || (opensOutside(href) && !e.metaKey));
    // Só vale para o `click` deste clique: se o bloco sair do DOM, esse `click` nem chega no link (review do T2983).
    if (placingOnly) document.addEventListener("mouseup", () => setTimeout(() => (placingOnly = false)), { once: true });
    if (target.closest("input, button") || (link && !placingOnly)) return;
    e.preventDefault();
    const at = view.posAtDOM(dom) + this.offsetAt(dom, e.clientX, e.clientY);
    const anchor = e.shiftKey ? view.state.selection.main.anchor : at;
    // O foco antes da seleção: focado depois, o navegador põe o cursor dele e o editor lê esse no lugar do nosso.
    view.focus();
    view.dispatch({ selection: EditorSelection.single(anchor, at), userEvent: "select.pointer" });
    // O bloco já é texto: arrastar daqui em diante usa a posição de verdade do editor.
    const move = (m: MouseEvent) => {
      const head = view.posAtCoords({ x: m.clientX, y: m.clientY }, false);
      if (head !== view.state.selection.main.head) view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent: "select.pointer" });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  /** Quantos caracteres do `.md` do bloco ficam antes do ponto clicado. */
  private offsetAt(dom: HTMLElement, x: number, y: number): number {
    try {
      const caret = document.caretRangeFromPoint?.(x, y);
      if (!caret || !dom.contains(caret.startContainer)) return 0;
      const before = document.createRange();
      before.setStart(dom, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      const shown = before.toString();
      return sourceOffset(this.source, shown, shown.length);
    } catch {
      // Um ponto que não dá para medir (dentro de um desenho): o começo do bloco.
      return 0;
    }
  }

  destroy(dom: HTMLElement) {
    unmount(dom);
  }

  ignoreEvent() {
    // O widget cuida dos próprios cliques (link, caixa, pôr o cursor).
    return true;
  }
}

/** O diagrama de um bloco ```mermaid com o cursor dentro: o código fica cru em cima, e o desenho continua embaixo. */
class MermaidUnderWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly actions: RenderedActions,
  ) {
    super();
  }
  eq(other: MermaidUnderWidget) {
    return other.code === this.code;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-mermaid-under";
    const root = createRoot(dom);
    roots.set(dom, root);
    root.render(
      <MermaidBlock
        source={this.code}
        code={null}
        onLink={(url) => {
          const safe = externalUrl(url);
          if (safe) this.actions.onOpenUrl(safe);
        }}
        onShown={() => view.requestMeasure()}
      />,
    );
    watchSize(dom, view);
    return dom;
  }
  destroy(dom: HTMLElement) {
    unmount(dom);
  }
  ignoreEvent() {
    return true;
  }
}

/** As imagens do bloco onde está o cursor, logo abaixo da fonte crua (`imagesUnderCursor`). */
class ImagesUnderWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly actions: RenderedActions,
  ) {
    super();
  }
  eq(other: ImagesUnderWidget) {
    return other.markdown === this.markdown;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-rendered cm-images-under";
    // O clique aqui não mexe no cursor (que está no texto de cima): o navegador nem chega a mudar a seleção.
    dom.addEventListener("mousedown", (e) => e.preventDefault());
    const root = createRoot(dom);
    roots.set(dom, root);
    const callbacks = {
      onLinkPress: ({ url }: { url: string }) => {
        const act = linkAction(url);
        if (act?.kind === "loadImage") loadRemote(act.url, this.actions.attachments);
        else if (act?.kind === "url") {
          const safe = externalUrl(act.url);
          if (safe) this.actions.onOpenUrl(safe);
        }
      },
    };
    root.render(<Block markdown={this.markdown} source={this.markdown} callbacks={callbacks} attachments={this.actions.attachments} onShown={() => view.requestMeasure()} />);
    watchSize(dom, view);
    return dom;
  }
  destroy(dom: HTMLElement) {
    unmount(dom);
  }
  ignoreEvent() {
    return true;
  }
}

function buildRendered(state: EditorState, resolver: LinkResolver, actions: RenderedActions): DecorationSet {
  const focused = state.field(editorFocused, false) ?? false;
  const tree = fullTree(state);
  const out: Range<Decoration>[] = [];
  const notes = footnotesOf(state);
  const title = hiddenTitle(state);
  for (const b of renderedBlocks(state, focused, tree)) {
    // O H1 igual ao título está escondido (spec #12626): o bloco dele não se desenha.
    if (title && b.from >= title.from && b.to <= title.to) continue;
    const markdown = toRenderable(b.source, b.from, tree, (t) => resolver.status(t), notes);
    out.push(Decoration.replace({ widget: new RenderedWidget(markdown, b.source, actions), block: true }).range(b.from, b.to));
  }
  for (const m of imagesUnderCursor(state, focused, tree)) {
    out.push(Decoration.widget({ widget: new ImagesUnderWidget(m.markdown, actions), block: true, side: 1 }).range(m.to));
  }
  for (const m of mermaidUnderCursor(state, focused, tree)) {
    const code = mermaidCode(m.source);
    if (code) out.push(Decoration.widget({ widget: new MermaidUnderWidget(code, actions), block: true, side: 1 }).range(m.to));
  }
  return Decoration.set(out, true);
}

/**
 * Os blocos fora do cursor aparecem renderizados pela lib do Channels. Vem de um StateField porque um bloco de várias
 * linhas esconde quebras de linha. Precisa do `commentPreview` (que guarda se o editor está com foco).
 */
export function renderedPreview(resolver: LinkResolver, actions: RenderedActions) {
  return [
    StateField.define<DecorationSet>({
      create: (state) => buildRendered(state, resolver, actions),
      update(value, tr) {
        const changed =
          tr.docChanged ||
          tr.selection ||
          tr.effects.some((e) => e.is(linksChanged)) ||
          syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
          tr.startState.field(editorFocused, false) !== tr.state.field(editorFocused, false) ||
          hiddenTitle(tr.startState) !== hiddenTitle(tr.state);
        return changed ? buildRendered(tr.state, resolver, actions) : value;
      },
      provide: (f) => EditorView.decorations.from(f),
    }),
    footnoteHover(actions),
    renderedTheme,
  ];
}

// ---------------------------------------------------------------- o hover das notas de rodapé (T6377)

/** O número desenhado pela lib (`<a href="kiwi-footnote…">`) e o do bloco do cursor (`livePreview`, `.cm-footnote`). */
const FOOTNOTE_TARGET = `a[href^="${FOOTNOTE_LINK}"], a[href^="${FOOTNOTE_MISSING_LINK}"], a[href^="${FOOTNOTE_INLINE_LINK}"], .cm-footnote[data-footnote], .cm-footnote[data-footnote-n]`;

function footnoteOf(el: HTMLElement): { label: string } | { n: number } | null {
  if (el.dataset.footnote) return { label: el.dataset.footnote };
  if (el.dataset.footnoteN) return { n: Number(el.dataset.footnoteN) };
  const act = linkAction(el.getAttribute("href") ?? "");
  if (act?.kind === "footnote") return { label: act.label };
  if (act?.kind === "footnoteInline") return { n: act.n };
  return null;
}

/** O texto da nota no hover, como Markdown: os `[[links]]` viram links que abrem a nota, como no resto do editor. */
function tipMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      for (const l of [...parseLinks(line)].reverse()) {
        if (line[l.from - 1] === "!") continue;
        const shown = (l.alias || l.target || l.heading || "").replace(/([\\[\]*_`~<>])/g, "\\$1");
        out = out.slice(0, l.from) + `[${shown}](${NOTE_LINK}${encodeURIComponent(l.target + (l.heading ? `#${l.heading}` : ""))})` + out.slice(l.to);
      }
      return out;
    })
    .join("\n");
}

/**
 * Passar o mouse no número mostra o texto da nota logo abaixo dele, num popover das Notas. Ele fica aberto com o mouse
 * em cima (para clicar num link de dentro) e some ao sair, ao clicar ou ao editar.
 */
function footnoteHover(actions: RenderedActions) {
  return ViewPlugin.fromClass(
    class {
      tip: HTMLDivElement | null = null;
      root: Root | null = null;
      anchor: HTMLElement | null = null;
      showTimer: ReturnType<typeof setTimeout> | undefined;
      hideTimer: ReturnType<typeof setTimeout> | undefined;
      /** O clique no link de dentro veio com ⌘: o link para fora (http, https, mailto) só abre assim, como no editor. */
      meta = false;

      constructor(readonly view: EditorView) {
        view.dom.addEventListener("mouseover", this.over);
        view.dom.addEventListener("mouseout", this.out);
        view.dom.addEventListener("mousedown", this.mousedown, true);
        // A nota rolou, ou o Esc: o hover sai, como um tooltip do sistema.
        addEventListener("scroll", this.away, true);
        addEventListener("keydown", this.escape, true);
      }

      update(u: { docChanged: boolean; selectionSet: boolean }) {
        if (u.docChanged || u.selectionSet) this.hide();
      }

      away = () => {
        if (this.tip) this.hide();
      };

      escape = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !this.tip) return;
        // O Esc fecha só o hover, não a janela ou o painel de trás.
        e.stopPropagation();
        this.hide();
      };

      over = (e: MouseEvent) => {
        const t = e.target as HTMLElement;
        if (this.tip?.contains(t)) return clearTimeout(this.hideTimer);
        const el = t.closest<HTMLElement>(FOOTNOTE_TARGET);
        if (!el || !this.view.dom.contains(el)) return;
        clearTimeout(this.hideTimer);
        if (el === this.anchor && this.tip) return;
        clearTimeout(this.showTimer);
        this.showTimer = setTimeout(() => this.show(el), this.tip ? 0 : 180);
      };

      out = (e: MouseEvent) => {
        const to = e.relatedTarget as Node | null;
        if (to && (this.tip?.contains(to) || this.anchor?.contains(to))) return;
        clearTimeout(this.showTimer);
        if (this.tip) this.hideTimer = setTimeout(() => this.hide(), 160);
      };

      mousedown = (e: MouseEvent) => {
        if (!this.tip?.contains(e.target as Node)) return this.hide();
        this.meta = e.metaKey;
        // No link, o foco fica no editor: sem foco, a nota inteira é redesenhada antes do clique. No texto, não: dá para
        // selecionar e copiar.
        if ((e.target as Element).closest?.("a")) e.preventDefault();
      };

      show(el: HTMLElement) {
        const of = footnoteOf(el);
        const note = of && footnoteText(footnotesOf(this.view.state), of);
        if (!note || !el.isConnected) return this.hide();
        this.hide();
        const host = this.view.dom;
        const tip = document.createElement("div");
        tip.className = `kn-pop kn-footnote-tip${note.missing ? " is-missing" : ""}`;
        tip.setAttribute("role", "tooltip");
        const box = host.getBoundingClientRect();
        const at = el.getBoundingClientRect();
        tip.style.top = `${Math.round(at.bottom - box.top + 6)}px`;
        tip.style.left = `${Math.round(Math.max(0, Math.min(at.left - box.left - 12, box.width - 360)))}px`;
        host.appendChild(tip);
        this.tip = tip;
        this.anchor = el;
        if (note.missing) {
          tip.textContent = note.text;
          return;
        }
        const root = createRoot(tip);
        this.root = root;
        const markdown = tipMarkdown(note.text);
        const callbacks = {
          onLinkPress: ({ url }: { url: string }) => {
            const act = linkAction(url);
            if (act?.kind === "note") {
              this.hide();
              actions.onOpenLink(act.target);
            } else if (act?.kind === "tag" && actions.onOpenTag) {
              this.hide();
              actions.onOpenTag(act.tag);
            } else if (act?.kind === "url" && this.meta) {
              // Fonte com endereço (`[IBGE](https://…)`): abre com ⌘-clique, como a dica do link diz.
              const safe = externalUrl(act.url);
              if (safe) {
                this.hide();
                actions.onOpenUrl(safe);
              }
            }
          },
        };
        root.render(<Block markdown={markdown} source={note.text} callbacks={callbacks} attachments={actions.attachments} onShown={() => {}} />);
      }

      hide() {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        const root = this.root;
        if (root) queueMicrotask(() => root.unmount());
        this.tip?.remove();
        this.tip = null;
        this.root = null;
        this.anchor = null;
      }

      destroy() {
        this.hide();
        this.view.dom.removeEventListener("mouseover", this.over);
        this.view.dom.removeEventListener("mouseout", this.out);
        this.view.dom.removeEventListener("mousedown", this.mousedown, true);
        removeEventListener("scroll", this.away, true);
        removeEventListener("keydown", this.escape, true);
      }
    },
  );
}

const renderedTheme = EditorView.theme({
  // Sem margem (o CodeMirror mede sem ela); `cursor: text` porque o clique edita.
  ".cm-rendered": { cursor: "text", padding: "0", minWidth: "0", overflowWrap: "anywhere" },
  // T5299 (#212): o bloco de código não quebra; ele rola dentro dele, nunca a nota.
  ".cm-rendered pre": { maxWidth: "100%", overflowX: "auto", overflowWrap: "normal" },
  // O Copiar do bloco de código (T6379): no canto, fora do que rola, e só com o mouse em cima (ou depois de copiar).
  ".kn-code": { position: "relative", minWidth: "0" },
  ".kn-code-copy": {
    position: "absolute",
    top: "6px",
    right: "6px",
    border: "0",
    borderRadius: "6px",
    padding: "0 8px",
    background: "var(--surface)",
    color: "var(--text-3)",
    font: "500 11px/1.9 var(--font)",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms",
  },
  ".kn-code:hover .kn-code-copy, .kn-code-copy:focus-visible, .kn-code-copy[data-state]": { opacity: "1" },
  ".kn-code-copy:hover": { background: "var(--surface-hover)", color: "var(--text)" },
  ".kn-code-copy[data-state=done]": { color: "var(--accent-text)" },
  ".kn-code-copy[data-state=failed]": { color: "var(--danger)" },
  ".cm-rendered-raw": { whiteSpace: "pre-wrap" },
  ".cm-rendered a": { cursor: "pointer" },
  ".cm-rendered a[href^='kiwi-tag:']": { borderRadius: "4px", padding: "0 3px" },
  ".cm-rendered a[href^='kiwi-load-image:']": { borderRadius: "6px", padding: "1px 6px", fontSize: "13px" },
  // As notas de rodapé (T6377): o número em sobrescrito, com um respiro para o dedo e o mouse.
  ".cm-rendered a[href^='kiwi-footnote']": { padding: "0 1px", fontWeight: "500" },
  ".kn-footnote-tip": { maxWidth: "360px", padding: "8px 12px", cursor: "default", whiteSpace: "normal" },
  ".kn-footnote-tip.is-missing": { color: "var(--text-3)", fontSize: "13px", lineHeight: "1.5" },
  ".cm-rendered input[type=checkbox]": { cursor: "pointer" },
  ".cm-rendered img": { display: "block", maxWidth: "100%" },
  ".cm-rendered img[style*='inline']": { display: "inline", width: "auto !important", borderRadius: "6px" },
  // Os callouts (T6383): o ícone no tom do tipo, o fundo suave, e a seta que gira quando abre. Uma caixa de fio de 1px
  // no tom do tipo, sem a faixa à esquerda (spec #12626).
  ".kn-callout": {
    border: "1px solid color-mix(in srgb, var(--kn-callout-ink) 28%, transparent)",
    borderRadius: "8px",
    background: "color-mix(in srgb, var(--kn-callout-ink) 6%, transparent)",
    padding: "6px 12px",
    margin: "2px 0",
  },
  ".kn-callout-accent": { "--kn-callout-ink": "var(--accent-text)", background: "var(--accent-soft)" },
  ".kn-callout-danger": { "--kn-callout-ink": "var(--danger)" },
  ".kn-callout-neutral": { "--kn-callout-ink": "var(--text-3)" },
  ".kn-callout-head": { display: "flex", alignItems: "center", gap: "8px", minHeight: "23px", color: "var(--kn-callout-ink)", fontWeight: "600" },
  ".kn-callout-icon": { flex: "none", width: "16px", height: "16px" },
  ".kn-callout-title": { flex: "1", minWidth: "0", fontSize: "14px" },
  ".kn-callout-fold": {
    border: "0",
    borderRadius: "6px",
    width: "22px",
    height: "22px",
    padding: "0",
    background: "none",
    color: "var(--text-3)",
    cursor: "pointer",
    fontSize: "15px",
    transition: "transform var(--fast) var(--ease)",
  },
  ".kn-callout-fold:hover": { background: "var(--surface-hover)", color: "var(--text)" },
  ".kn-callout[data-open='true'] .kn-callout-fold": { transform: "rotate(90deg)" },
  ".kn-callout-body": { marginTop: "2px", color: "var(--text)" },
  // Os diagramas (T2984), como no Channels: o desenho rola de lado quando não cabe; os botões ficam discretos.
  ".kn-mermaid": { padding: "2px 0" },
  ".cm-images-under": { padding: "6px 0 2px", cursor: "default" },
  ".cm-mermaid-under": { padding: "6px 0 2px", cursor: "default" },
  ".kn-mermaid-drawn": { margin: "0", padding: "12px", overflowX: "auto", borderRadius: "10px", background: "var(--surface-2)" },
  ".kn-mermaid-drawn svg": { display: "block", maxWidth: "none" },
  ".kn-mermaid-tools": { display: "flex", gap: "4px", marginTop: "4px" },
  ".kn-mermaid-tools button": {
    border: "0",
    borderRadius: "6px",
    padding: "2px 8px",
    background: "none",
    color: "var(--text-3)",
    font: "500 11px/1.6 var(--font)",
    cursor: "pointer",
  },
  ".kn-mermaid-tools button:hover": { background: "var(--surface-hover)", color: "var(--text)" },
  ".kn-mermaid-error": { margin: "4px 0 0", fontSize: "12px", color: "var(--danger)" },
});
