import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { checkDrawio, DRAWIO_LIMITS, drawioPages } from "./drawio.ts";

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

describe("o texto do diagrama (T22217)", () => {
  test("os rótulos de cada página, com o nome e o id, em XML e comprimida", () => {
    const text = readFileSync(new URL("../../../test/fixtures/files/fluxo.drawio", import.meta.url), "utf8");
    const pages = drawioPages(text)!;
    expect(pages.map((p) => p.name)).toEqual(["Fluxo", "Outra"]);
    expect(pages[0]!.labels.map((l) => l.text)).toContain("Tem estoque?");
    expect(pages[1]!.labels).toEqual([{ id: "a", text: "Segunda página" }]);
    const html = '<mxGraphModel><root><mxCell id="c" value="&lt;b&gt;Caixa&lt;/b&gt;&lt;br&gt;de &amp;amp; frutas&lt;div&gt;maduras&lt;/div&gt;" style="rounded=0;html=1;" vertex="1"/><mxCell id="p" value="a &lt; b" style="rounded=0" vertex="1"/><UserObject label="Objeto A" id="u"><mxCell style="x"/></UserObject><mxCell id="s" value="" vertex="1"/></root></mxGraphModel>';
    expect(drawioPages(`<mxfile><diagram name="Z">${packed(html)}</diagram></mxfile>`)).toEqual([
      { name: "Z", labels: [{ id: "c", text: "Caixa\nde & frutas\nmaduras" }, { id: "p", text: "a < b" }, { id: "u", text: "Objeto A" }] },
    ]);
    // O formato antigo, o mxGraphModel solto: uma página sem nome.
    expect(drawioPages(html)![0]!.labels.length).toBe(3);
    // Uma aba sem nome no arquivo fica sem nome (T30631): nada de "Página 2" inventado em português; quem mostra põe o rótulo.
    expect(drawioPages(`<mxfile><diagram>${packed(html)}</diagram></mxfile>`)!.map((p) => p.name)).toEqual([""]);
  });

  test("o que não é diagrama, ou a bomba, dá null sem abrir", () => {
    expect(drawioPages("<html></html>")).toBeNull();
    const bomb = `<mxfile><diagram>${deflateRawSync(Buffer.alloc(30 * 1024 * 1024, 0x61)).toString("base64")}</diagram></mxfile>`;
    expect(drawioPages(bomb)).toBeNull();
  });
});
