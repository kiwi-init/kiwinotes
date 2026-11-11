// A trava do viewer do draw.io (T7112): o diagrama não tenta buscar nada fora do app. A CSP das views já recusa
// qualquer imagem de fora (`img-src` sem `https:`); isto tira o pedido antes, para que nem a tentativa aconteça. Vale
// para os rótulos em HTML (um gancho no DOMPurify que vem no viewer) e para as formas de imagem (`image=` no estilo).

/** Só a imagem que já vem dentro do arquivo (`data:image/…`) é desenhada. */
export const isEmbeddedImage = (value: unknown): boolean => typeof value === "string" && /^data:image\//i.test(value.trim());

const URL_ATTRS = /^(src|srcset|background|poster|xlink:href|data)$/i;
const URL_ELEMENTS = /^(image|use|feimage|img|video|audio|source|track|object|embed|iframe)$/i;
const CSS_URL = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;

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

interface GraphProto {
  postProcessCellStyle(this: unknown, cell: unknown, style: Record<string, unknown> | null): Record<string, unknown> | null;
}

/** Põe a trava no viewer carregado: o DOMPurify dos rótulos e o estilo de cada forma. Roda uma vez. */
export function installDrawioGuard(w: { DOMPurify?: Purify; Graph?: { prototype: GraphProto } }): void {
  w.DOMPurify?.addHook("uponSanitizeAttribute", (node, data) => {
    const next = guardAttribute(node.nodeName, data.attrName, data.attrValue);
    if (next === "") data.keepAttr = false;
    else if (next !== null) data.attrValue = next;
  });
  const proto = w.Graph?.prototype;
  if (!proto) return;
  const original = proto.postProcessCellStyle;
  proto.postProcessCellStyle = function (cell, style) {
    const out = original.call(this, cell, style);
    if (out && out.image != null && !isEmbeddedImage(out.image)) delete out.image;
    return out;
  };
}
