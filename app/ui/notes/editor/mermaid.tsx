// Os diagramas Mermaid das notas (T2984, spec #2973), como no Channels (ui/src/chat/mermaid.tsx do kiwi-init/channels):
// o mesmo mermaid, o mesmo tema "base" com as cores do tema da janela, `securityLevel: "strict"` e o layout dagre. O
// mermaid é carregado só quando aparece o primeiro diagrama. Mudanças: os tokens das Notas, os textos em português,
// sem o botão Copiar (o app não escreve no clipboard por conta própria), links pelo `externalUrl` das Notas.

import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { externalUrl } from "../links.ts";

type Mermaid = (typeof import("mermaid"))["default"];
export type Drawn = { kind: "svg"; svg: string } | { kind: "error"; message: string } | null;

let mermaid: Promise<Mermaid> | undefined;
const load = () => (mermaid ??= import("mermaid").then((m) => m.default));

const CSS = [
  "* { filter: none !important; }",
  ".node rect, .node polygon, .node path, rect.actor, rect.note, .labelBox { stroke-width: 1px; }",
  ".node rect, rect.actor, rect.note { rx: 8px; ry: 8px; }",
  ".flowchart-link, .messageLine0, .messageLine1, .actor-line { stroke-width: 1px; }",
].join("\n");

let queue: Promise<unknown> = Promise.resolve();
let next = 0;

const MIN_SCALE = 0.7;

/** As cores do tema de agora, como o mermaid quer (rgb), lidas dos tokens da janela. */
function resolver(): { color: (token: string) => string; font: string; done: () => void } {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.fontFamily = "var(--font)";
  document.body.append(probe);
  const ctx = document.createElement("canvas").getContext("2d");
  return {
    color: (token) => {
      probe.style.color = `var(--${token})`;
      const computed = getComputedStyle(probe).color;
      if (!ctx) return computed;
      ctx.fillStyle = "#000";
      ctx.fillStyle = computed;
      return String(ctx.fillStyle);
    },
    font: getComputedStyle(probe).fontFamily || "system-ui, sans-serif",
    done: () => probe.remove(),
  };
}

function theme(): { variables: Record<string, string>; font: string } {
  const { color: c, font, done } = resolver();
  const variables = {
    background: c("surface-2"),
    mainBkg: c("bg"),
    primaryColor: c("bg"),
    primaryTextColor: c("text"),
    primaryBorderColor: c("text-3"),
    secondaryColor: c("accent-soft"),
    secondaryTextColor: c("text"),
    secondaryBorderColor: c("accent"),
    tertiaryColor: c("surface-2"),
    tertiaryTextColor: c("text"),
    tertiaryBorderColor: c("border-strong"),
    nodeBorder: c("text-3"),
    nodeTextColor: c("text"),
    textColor: c("text-2"),
    lineColor: c("text-3"),
    edgeLabelBackground: c("surface-2"),
    clusterBkg: c("surface"),
    clusterBorder: c("border-strong"),
    titleColor: c("text"),
    actorBkg: c("bg"),
    actorBorder: c("text-3"),
    actorTextColor: c("text"),
    actorLineColor: c("text-3"),
    signalColor: c("text-2"),
    signalTextColor: c("text"),
    labelBoxBkgColor: c("bg"),
    labelBoxBorderColor: c("text-3"),
    labelTextColor: c("text"),
    loopTextColor: c("text-2"),
    noteBkgColor: c("accent-soft"),
    noteBorderColor: c("accent"),
    noteTextColor: c("text"),
    activationBkgColor: c("bg"),
    activationBorderColor: c("text-3"),
    sequenceNumberColor: c("on-accent"),
    fontFamily: font,
    fontSize: "13px",
  };
  done();
  return { variables, font };
}

/** A primeira linha do erro do mermaid, sem os dois-pontos do fim. */
export function errorLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return (
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim()
      .replace(/:\s*$/, "") || "não é um Mermaid válido"
  );
}

const ADDRESS = /\s(?:xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

const unescaped = (value: string): string =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

const keeping = (attrs: string, kept: (address: string) => boolean): string =>
  attrs.replace(ADDRESS, (all: string, double?: string, single?: string, bare?: string) => (kept(unescaped(double ?? single ?? bare ?? "")) ? all : ""));

/** Link no diagrama só para o que abre fora (http, https, mailto), e nunca navega a janela. */
export function linksApart(svg: string): string {
  return svg.replace(/<a\b([^>]*?)(\/?)>/g, (_, attrs: string, close: string) => {
    const opened = keeping(attrs.replace(/\s(?:target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, ""), (url) => !!externalUrl(url));
    return `<a${opened} target="_blank" rel="noopener noreferrer"${close}>`;
  });
}

/** Imagem dentro do diagrama só se for `data:`: nada é baixado. */
export function picturesOff(svg: string): string {
  return svg.replace(/<(image|img)\b([^>]*?)(\/?)>/gi, (_, tag: string, attrs: string, close: string) => `<${tag}${keeping(attrs, (url) => /^data:/i.test(url))}${close}>`);
}

function draw(source: string): Promise<Drawn> {
  const run = queue.then(async (): Promise<Drawn> => {
    const m = await load();
    const { variables, font } = theme();
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: variables,
      fontFamily: font,
      look: "classic",
      layout: "dagre",
      themeCSS: CSS,
      state: { layout: "dagre" },
      flowchart: { useMaxWidth: false, curve: "basis", padding: 8, nodeSpacing: 24, rankSpacing: 28, diagramPadding: 4 },
      sequence: {
        useMaxWidth: false,
        actorMargin: 24,
        width: 112,
        height: 36,
        boxMargin: 6,
        boxTextMargin: 4,
        noteMargin: 6,
        messageMargin: 26,
        diagramMarginX: 4,
        diagramMarginY: 4,
        mirrorActors: false,
        actorFontFamily: font,
        actorFontSize: 13,
        messageFontFamily: font,
        messageFontSize: 13,
        messageFontWeight: 400,
        noteFontFamily: font,
        noteFontSize: 13,
      },
    });
    try {
      await m.parse(source);
      const { svg } = await m.render(`kiwi-mermaid-${next++}`, source);
      return { kind: "svg", svg: picturesOff(linksApart(svg)) };
    } catch (e) {
      return { kind: "error", message: errorLine(e) };
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

const MAX_SOURCE = 20_000;
const MAX_DRAWN = 100;
const drawings = new Map<string, Promise<Drawn>>();

export function drawCached(source: string, scheme: string, render: (source: string) => Promise<Drawn> = draw): Promise<Drawn> {
  const key = `${scheme}\u0000${source}`;
  const held = drawings.get(key);
  if (held) {
    drawings.delete(key);
    drawings.set(key, held);
    return held;
  }
  const fresh =
    source.length > MAX_SOURCE ? Promise.resolve<Drawn>({ kind: "error", message: `grande demais para desenhar (mais de ${MAX_SOURCE.toLocaleString("pt-BR")} caracteres)` }) : render(source);
  drawings.set(key, fresh);
  const oldest = drawings.keys().next();
  if (drawings.size > MAX_DRAWN && !oldest.done) drawings.delete(oldest.value);
  return fresh;
}

/** O tema da janela agora: muda o desenho quando o tema, a fonte ou o claro/escuro mudam. */
function useScheme(): string {
  const read = () => {
    const root = document.documentElement;
    return `${root.dataset.theme ?? ""}:${root.dataset.themeId ?? ""}:${root.dataset.font ?? ""}:${matchMedia("(prefers-color-scheme: dark)").matches}:${root.style.cssText}`;
  };
  const [scheme, setScheme] = useState("");
  useEffect(() => {
    const update = () => setScheme(read());
    update();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    const watch = new MutationObserver(update);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-id", "data-font", "style"] });
    return () => {
      media.removeEventListener("change", update);
      watch.disconnect();
    };
  }, []);
  return scheme;
}

/** O código do bloco ```mermaid, ou nada se o bloco não for Mermaid (ou estiver vazio). */
export function mermaidCode(source: string): string | null {
  const m = /^\s*(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n([\s\S]*?)(?:\n[ \t]*\1[`~]*[ \t]*)?$/i.exec(source);
  if (!m || !m[2]!.trim()) return null;
  return m[2]!;
}

const linkOf = (a: Element): string | null => a.getAttribute("href") ?? a.getAttribute("xlink:href");

/**
 * O diagrama. `code` é o bloco de código desenhado (aparece enquanto o diagrama não sai, com o botão Código, ou com o
 * erro). `onShown` avisa o editor que a altura mudou.
 */
export function MermaidBlock({ source, code, onLink, onShown }: { source: string; code: ReactNode; onLink: (url: string) => void; onShown?: () => void }) {
  const scheme = useScheme();
  const [drawn, setDrawn] = useState<Drawn>(null);
  const [showCode, setShowCode] = useState(false);
  const box = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = box.current;
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  };
  useLayoutEffect(() => {
    onShown?.();
    const el = box.current;
    const svg = el?.querySelector("svg");
    if (!el || !svg) return;
    const natural = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width;
    const fit = () => {
      const room = el.clientWidth - 24;
      const scale = Math.max(MIN_SCALE, Math.min(1, room / natural));
      svg.style.width = `${natural * scale}px`;
      svg.style.height = "auto";
      measure();
      onShown?.();
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn, showCode]);
  useEffect(() => {
    if (!scheme) return;
    let live = true;
    void drawCached(source, scheme).then((d) => live && setDrawn(d));
    return () => {
      live = false;
    };
  }, [source, scheme]);

  const clicked = (e: MouseEvent<HTMLElement>) => {
    const a = e.target instanceof Element ? e.target.closest("a") : null;
    if (!a) return;
    e.preventDefault();
    const url = linkOf(a);
    if (url) onLink(url);
  };

  if (drawn?.kind === "error") {
    return (
      <div className="kn-mermaid">
        {code}
        <p className="kn-mermaid-error">Não deu para desenhar este diagrama: {drawn.message}</p>
      </div>
    );
  }
  if (!drawn || showCode) {
    return (
      <div className="kn-mermaid">
        {code}
        {drawn && (
          <div className="kn-mermaid-tools">
            <button type="button" onClick={() => setShowCode(false)}>
              Diagrama
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="kn-mermaid">
      <figure ref={box} onScroll={measure} onClick={clicked} className={more ? "kn-mermaid-drawn is-more" : "kn-mermaid-drawn"}>
        {/* SVG do mermaid em `securityLevel: "strict"` (passa pelo DOMPurify dele), sem link nem imagem de fora. */}
        <div role="img" aria-label="Diagrama Mermaid" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      </figure>
      <div className="kn-mermaid-tools">
        <button type="button" onClick={() => setShowCode(true)}>
          Código
        </button>
      </div>
    </div>
  );
}
