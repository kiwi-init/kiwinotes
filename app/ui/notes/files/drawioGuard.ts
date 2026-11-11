// A trava do viewer do draw.io (T7112): o diagrama não tenta buscar nada fora do app. A CSP das views já recusa
// qualquer pedido para fora; isto tira o pedido antes, para que nem a tentativa aconteça (e para valer também no Vite
// do dev, onde a CSP não está). Cobre:
// - os caminhos que o viewer usaria na internet, que passam a apontar para o pack (`pointViewerAtPack`);
// - os rótulos em HTML (um gancho no DOMPurify que vem no viewer);
// - as imagens das formas (`image=`, `indicatorImage=`), a imagem de fundo da página e qualquer outra que o viewer
//   desenhe no SVG;
// - as fontes de fora (`fontSource`, `extFonts`, Google Fonts) e o MathJax das fórmulas (`math="1"`), que não carregam.

/** Só a imagem que já vem dentro do arquivo (`data:image/…`) é desenhada. */
export const isEmbeddedImage = (value: unknown): boolean => typeof value === "string" && /^data:image\//i.test(value.trim());

/**
 * Todo caminho ou endereço que o viewer lê de `window` (conferido contra o `viewer-static.min.js` no teste). Os que
 * o viewer preenche com `viewer.diagrams.net`, `app.diagrams.net` e afins passam a apontar para o pack: o que ele
 * pedir fica no app e dá 404. O do log fica vazio, que é o "sem log" dele.
 */
export const VIEWER_PATHS = [
  "CSS_PATH", "DRAW_MATH_URL", "DRAWIO_BASE_URL", "DRAWIO_GITHUB_API_URL", "DRAWIO_GITHUB_URL", "DRAWIO_GITLAB_URL",
  "DRAWIO_LIGHTBOX_URL", "DRAWIO_SERVER_URL", "DRAWIO_VIEWER_URL", "EXPORT_URL", "GENERATE_URL", "GRAPH_IMAGE_PATH",
  "ICON_SERVICE_PATH", "ICONSEARCH_PATH", "IMAGE_PATH", "mxBasePath", "mxImageBasePath", "NEW_DIAGRAM_CATS_PATH",
  "NOTIFICATIONS_URL", "OPEN_URL", "PLUGINS_BASE_PATH", "PROXY_URL", "REALTIME_URL", "RESOURCES_PATH",
  "RT_WEBSOCKET_URL", "SAVE_URL", "SHAPES_PATH", "STENCIL_PATH", "STYLE_PATH", "TEMPLATE_PATH",
] as const;
export const VIEWER_OFF = ["DRAWIO_LOG_URL"] as const;

/** Antes do `<script>` do viewer: os caminhos no pack, e sem os textos e o CSS que ele baixaria. */
export function pointViewerAtPack(w: Record<string, unknown>, home = "./drawio"): void {
  for (const key of VIEWER_PATHS) w[key] = home;
  for (const key of VIEWER_OFF) w[key] = "";
  w.mxLoadResources = false;
  w.mxLoadStylesheet = false;
}

const URL_ATTRS = /^(src|srcset|background|poster|xlink:href|data)$/i;
const URL_ELEMENTS = /^(image|use|feimage|img|video|audio|source|track|object|embed|iframe)$/i;
const CSS_URL = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;
/** As chaves de estilo de uma forma que são o endereço de uma imagem. */
const IMAGE_STYLE_KEYS = ["image", "indicatorImage"] as const;

/**
 * O que fazer com um atributo de um rótulo: `null` mantém, `""` tira e um texto troca o valor.
 * Um link (`<a href>`) fica: clicar abre no navegador padrão, como numa nota, e nada é baixado sozinho.
 */
export function guardAttribute(element: string, attr: string, value: string): string | null {
  if (URL_ATTRS.test(attr) || (/^href$/i.test(attr) && URL_ELEMENTS.test(element))) return isEmbeddedImage(value) ? null : "";
  if (/^style$/i.test(attr) && /url\s*\(/i.test(value)) {
    const next = value.replace(CSS_URL, (whole: string, _q: string, url: string) => (isEmbeddedImage(url) ? whole : "none"));
    return next === value ? null : next;
  }
  return null;
}

interface Purify {
  addHook(name: "uponSanitizeAttribute", hook: (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => void): void;
}

type Style = Record<string, unknown>;
interface DrawioRuntime {
  DOMPurify?: Purify;
  Graph?: { prototype: { postProcessCellStyle(this: unknown, cell: unknown, style: Style | null): Style | null }; isValidFontUrl?: (url: unknown) => boolean };
  mxGraph?: { prototype: { setBackgroundImage(this: unknown, image: { src?: unknown } | null): void } };
  mxSvgCanvas2D?: { prototype: { image(this: unknown, ...args: unknown[]): void } };
  Editor?: { MathJaxRender?: (node: unknown) => void; loadMath?: (done?: () => void) => void; onMathJaxDone?: () => void };
}

/** Põe a trava no viewer carregado. Roda uma vez. */
export function installDrawioGuard(w: DrawioRuntime): void {
  w.DOMPurify?.addHook("uponSanitizeAttribute", (node, data) => {
    const next = guardAttribute(node.nodeName, data.attrName, data.attrValue);
    if (next === "") data.keepAttr = false;
    else if (next !== null) data.attrValue = next;
  });

  const graph = w.Graph?.prototype;
  if (graph) {
    const original = graph.postProcessCellStyle;
    graph.postProcessCellStyle = function (cell, style) {
      const out = original.call(this, cell, style);
      if (out) for (const key of IMAGE_STYLE_KEYS) if (out[key] != null && !isEmbeddedImage(out[key])) delete out[key];
      return out;
    };
  }

  // A imagem de fundo da página (`backgroundImage` do `mxGraphModel`).
  const model = w.mxGraph?.prototype;
  if (model) {
    const original = model.setBackgroundImage;
    model.setBackgroundImage = function (image) {
      original.call(this, image && !isEmbeddedImage(image.src) ? null : image);
    };
  }

  // O último ponto antes do SVG: toda imagem que o viewer desenha passa aqui (o 5º argumento é o endereço).
  const canvas = w.mxSvgCanvas2D?.prototype;
  if (canvas) {
    const original = canvas.image;
    canvas.image = function (...args) {
      if (isEmbeddedImage(args[4])) original.apply(this, args);
    };
  }

  // Fontes: só as do sistema. Uma fonte de fora (`fontSource`, `extFonts`, Google Fonts) não vira `<link>` nem `@font-face`.
  if (w.Graph) w.Graph.isValidFontUrl = () => false;

  // Fórmulas: o MathJax viria de fora. Sem ele, o viewer segue como se o script tivesse falhado: o texto da fórmula
  // aparece como está.
  const editor = w.Editor;
  if (editor) {
    editor.loadMath = (done) => done?.();
    editor.MathJaxRender = () => editor.onMathJaxDone?.();
  }
}
