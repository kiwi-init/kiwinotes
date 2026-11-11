import { describe, expect, test } from "bun:test";

import { guardAttribute, installDrawioGuard, isEmbeddedImage } from "./drawioGuard.ts";

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

  test("instala nos dois ganchos do viewer", () => {
    let hook: ((node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => void) | undefined;
    const proto = { postProcessCellStyle: (_c: unknown, s: Record<string, unknown> | null) => s };
    installDrawioGuard({ DOMPurify: { addHook: (_n, h) => (hook = h) }, Graph: { prototype: proto } });
    const data = { attrName: "src", attrValue: "https://a/b.png", keepAttr: true };
    hook!({ nodeName: "IMG" } as Element, data);
    expect(data.keepAttr).toBe(false);
    expect(proto.postProcessCellStyle(null, { image: "https://a/foto.png", shape: "image" })).toEqual({ shape: "image" });
    expect(proto.postProcessCellStyle(null, { image: PNG })).toEqual({ image: PNG });
    expect(proto.postProcessCellStyle(null, null)).toBeNull();
  });
});
