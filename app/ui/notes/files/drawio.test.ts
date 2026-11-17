import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { checkDrawio, DRAWIO_LIMITS } from "./drawio.ts";

/** Uma página comprimida como o draw.io grava: deflate cru do XML (passado pelo encodeURIComponent), em base64. */
const packed = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64");
const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Oi" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>';

test("o diagrama de exemplo (test/fixtures/files/fluxo.drawio) passa, com as páginas", () => {
  const text = readFileSync(new URL("../../../test/fixtures/files/fluxo.drawio", import.meta.url), "utf8");
  expect(checkDrawio(text)).toEqual({ ok: true, pages: 2 });
});

test("páginas em XML, comprimidas, e o mxGraphModel solto do formato antigo", () => {
  expect(checkDrawio(`<mxfile><diagram id="a" name="P1">${model}</diagram></mxfile>`)).toEqual({ ok: true, pages: 1 });
  expect(checkDrawio(`<?xml version="1.0"?>\n<mxfile host="x"><diagram name="A">${packed(model)}</diagram><diagram name="B">${model}</diagram></mxfile>`)).toEqual({ ok: true, pages: 2 });
  expect(checkDrawio(model)).toEqual({ ok: true, pages: 1 });
});

test("o que não é diagrama é recusado: html, svg, texto, base64 quebrado", () => {
  for (const bad of ["<html><script>alert(1)</script>", "<svg/>", "texto qualquer", "", '<mxfile><diagram>%%%não-base64%%%</diagram></mxfile>']) {
    expect(checkDrawio(bad)).toEqual({ ok: false, reason: "not-drawio" });
  }
});

test("a página comprimida que é uma bomba (poucos KB, 30 MB abertos) é recusada sem abrir tudo", () => {
  const bomb = `<mxfile><diagram>${deflateRawSync(Buffer.alloc(30 * 1024 * 1024, 0x61)).toString("base64")}</diagram></mxfile>`;
  expect(bomb.length).toBeLessThan(100 * 1024);
  const started = performance.now();
  expect(checkDrawio(bomb)).toEqual({ ok: false, reason: "too-large" });
  expect(performance.now() - started).toBeLessThan(2000);
  // Páginas demais também.
  const many = `<mxfile>${`<diagram>${model}</diagram>`.repeat(DRAWIO_LIMITS.pages + 1)}</mxfile>`;
  expect(checkDrawio(many)).toEqual({ ok: false, reason: "too-large" });
});

describe("o viewer que vai no pack (T7112)", () => {
  test("é o da versão fixada: o sha256 do viewer e da licença batem", async () => {
    const { checkDrawio: checkVendored } = await import("../../../scripts/drawio-viewer.ts");
    expect(checkVendored()).toEqual([]);
  });
});
