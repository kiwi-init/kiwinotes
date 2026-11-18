import { expect, test } from "bun:test";

import { isHtmlFile, PREVIEW_CSP, previewDocument } from "./htmlPreview.ts";

const META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

test("só o .html e o .htm ganham a prévia (T19314)", () => {
  for (const p of ["site/index.html", "Projeto X/Pagina.HTM", "a.htm"]) expect(isHtmlFile(p)).toBe(true);
  for (const p of ["a.xhtml", "a.html.md", "estilo.css", "html", "a.htmlx"]) expect(isHtmlFile(p)).toBe(false);
});

test("a CSP da prévia não deixa script, rede, form, frame nem <base>", () => {
  expect(PREVIEW_CSP).toContain("default-src 'none'");
  expect(PREVIEW_CSP).not.toMatch(/script-src|https?:|'self'|views:|\*/);
  expect(PREVIEW_CSP).toContain("form-action 'none'");
  expect(PREVIEW_CSP).toContain("base-uri 'none'");
});

test("o <meta> da CSP entra no começo, depois do doctype", () => {
  expect(previewDocument("<h1>Olá, Ana</h1>")).toBe(`${META}<h1>Olá, Ana</h1>`);
  expect(previewDocument("<!DOCTYPE html>\n<html><head><style>h1{color:red}</style></head></html>")).toBe(
    `<!DOCTYPE html>${META}\n<html><head><style>h1{color:red}</style></head></html>`,
  );
  expect(previewDocument("  <!doctype html><p>x</p>")).toBe(`  <!doctype html>${META}<p>x</p>`);
  expect(previewDocument("")).toBe(META);
});
