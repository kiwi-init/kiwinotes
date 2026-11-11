import { describe, expect, test } from "bun:test";

import { guardAttribute, installDrawioGuard, isEmbeddedImage, pointViewerAtPack, VIEWER_OFF, VIEWER_PATHS } from "./drawioGuard.ts";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("a trava do draw.io (T7112): nada de fora é pedido", () => {
  test("só a imagem embutida no arquivo passa", () => {
    expect(isEmbeddedImage(PNG)).toBe(true);
    expect(isEmbeddedImage(" DATA:image/svg+xml,<svg/>")).toBe(true);
    for (const v of ["https://exemplo.invalid/a.png", "x", "//cdn/a.png", "data:text/html,<b>", "javascript:alert(1)", null, 3]) expect(isEmbeddedImage(v)).toBe(false);
  });

  test("os atributos dos rótulos: imagem de fora sai, link fica, CSS com url() de fora vira none", () => {
    expect(guardAttribute("IMG", "src", "https://exemplo.invalid/r.png")).toBe("");
    expect(guardAttribute("IMG", "src", "x")).toBe("");
    expect(guardAttribute("IMG", "srcset", "https://a/1.png 1x")).toBe("");
    expect(guardAttribute("IMG", "src", PNG)).toBeNull();
    expect(guardAttribute("image", "xlink:href", "https://a/b.png")).toBe("");
    expect(guardAttribute("image", "href", "https://a/b.png")).toBe("");
    expect(guardAttribute("A", "href", "https://exemplo.invalid/")).toBeNull();
    expect(guardAttribute("DIV", "style", "color: red")).toBeNull();
    expect(guardAttribute("DIV", "style", "background: url('https://a/b.png') no-repeat; color: red")).toBe("background: none no-repeat; color: red");
    expect(guardAttribute("DIV", "style", `background-image: url("${PNG}")`)).toBeNull();
  });

  test("instala nos ganchos do viewer: rótulos, formas, fundo, SVG, fontes e fórmulas", () => {
    let hook: ((node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => void) | undefined;
    const proto = { postProcessCellStyle: (_c: unknown, s: Record<string, unknown> | null) => s };
    const backgrounds: unknown[] = [];
    const drawn: unknown[] = [];
    let mathDone = 0;
    const w = {
      DOMPurify: { addHook: (_n: "uponSanitizeAttribute", h: typeof hook) => (hook = h) },
      Graph: { prototype: proto, isValidFontUrl: (_u: unknown) => true },
      mxGraph: { prototype: { setBackgroundImage: (img: unknown) => void backgrounds.push(img) } },
      mxSvgCanvas2D: { prototype: { image: (...args: unknown[]) => void drawn.push(args[4]) } },
      Editor: { MathJaxRender: (_n: unknown) => { throw new Error("buscaria o MathJax"); }, loadMath: (_d?: () => void) => { throw new Error("buscaria o MathJax"); }, onMathJaxDone: () => void mathDone++ },
    };
    installDrawioGuard(w);

    const data = { attrName: "src", attrValue: "https://a/b.png", keepAttr: true };
    hook!({ nodeName: "IMG" } as Element, data);
    expect(data.keepAttr).toBe(false);

    expect(proto.postProcessCellStyle(null, { image: "https://a/foto.png", shape: "image" })).toEqual({ shape: "image" });
    expect(proto.postProcessCellStyle(null, { indicatorImage: "https://a/ind.png", shape: "label" })).toEqual({ shape: "label" });
    expect(proto.postProcessCellStyle(null, { image: PNG, indicatorImage: PNG })).toEqual({ image: PNG, indicatorImage: PNG });
    expect(proto.postProcessCellStyle(null, null)).toBeNull();

    w.mxGraph.prototype.setBackgroundImage({ src: "https://a/fundo.png" });
    w.mxGraph.prototype.setBackgroundImage({ src: PNG });
    w.mxGraph.prototype.setBackgroundImage(null);
    expect(backgrounds).toEqual([null, { src: PNG }, null]);

    w.mxSvgCanvas2D.prototype.image(0, 0, 10, 10, "https://a/x.png");
    w.mxSvgCanvas2D.prototype.image(0, 0, 10, 10, "img/local.png");
    w.mxSvgCanvas2D.prototype.image(0, 0, 10, 10, PNG);
    expect(drawn).toEqual([PNG]);

    for (const url of ["https://fonts.googleapis.com/css?family=Roboto", "https://a/f.woff2", "data:font/woff2;base64,AA=="]) expect(w.Graph.isValidFontUrl(url)).toBe(false);

    let after = 0;
    w.Editor.loadMath(() => after++);
    w.Editor.MathJaxRender({});
    expect([after, mathDone]).toEqual([1, 1]);
  });

  test("os caminhos do viewer: todos os que ele lê de window vão para o pack, e o log fica desligado", async () => {
    const min = await Bun.file(new URL("./drawio/viewer-static.min.js", import.meta.url)).text();
    const read = new Set([...min.matchAll(/window\.([A-Za-z_]+(?:_URL|_PATH|BasePath))\b/g)].map((m) => m[1]!));
    expect([...read].sort()).toEqual([...VIEWER_PATHS, ...VIEWER_OFF].sort());
    const w: Record<string, unknown> = { DRAW_MATH_URL: "https://viewer.diagrams.net/math4/es5" };
    pointViewerAtPack(w);
    for (const key of VIEWER_PATHS) expect(w[key]).toBe("./drawio");
    expect(w.DRAWIO_LOG_URL).toBe("");
    expect([w.mxLoadResources, w.mxLoadStylesheet]).toEqual([false, false]);
  });
});
