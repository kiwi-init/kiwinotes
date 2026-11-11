import { expect, test } from "bun:test";

import { findInPage, findInPages, fitWidth, itemRect, pageText, type PdfTextItem, stepMatch, stepZoom } from "./pdfSearch.ts";

/** Um pedaço de texto deitado, de 10 pt, começando em (x, y): cada letra com 5 pt de largura. */
const run = (str: string, x: number, y: number, hasEOL = false): PdfTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, hasEOL });

test("o texto da página junta os pedaços, com um espaço na quebra de linha", () => {
  const p = pageText([run("Relatório de ", 50, 700), run("vendas", 115, 700, true), run("", 0, 0), run("do mês", 50, 680)]);
  expect(p.text).toBe("Relatório de vendas do mês");
  expect(p.spans).toEqual([
    { start: 0, end: 13, item: 0 },
    { start: 13, end: 19, item: 1 },
    { start: 20, end: 26, item: 3 },
  ]);
});

test("acha sem acento nem maiúscula, e o retângulo cobre só o trecho", () => {
  const p = pageText([run("Relatório de vendas", 50, 700)]);
  const [m] = findInPage(p, "RELATORIO", 3);
  expect(m?.page).toBe(3);
  // 9 letras de 5 pt a partir de x=50; a altura vai da perna (−2) ao topo (+8,5).
  expect(m?.rects).toEqual([[50, 698, 95, 708.5]]);
  const [v] = findInPage(p, "vendas");
  expect(v?.rects[0]?.[0]).toBe(50 + 13 * 5);
  expect(v?.rects[0]?.[2]).toBe(50 + 19 * 5);
  expect(findInPage(p, "  ")).toEqual([]);
  expect(findInPage(p, "nada")).toEqual([]);
});

test("um termo que atravessa dois pedaços, ou a quebra de linha, tem um retângulo por pedaço", () => {
  const p = pageText([run("fim da", 50, 700, true), run("linha e vendas", 50, 680)]);
  const [m] = findInPage(p, "da linha");
  expect(m?.rects.length).toBe(2);
  expect(m?.rects[0]).toEqual([70, 698, 80, 708.5]);
  expect(m?.rects[1]).toEqual([50, 678, 75, 688.5]);
});

test("vários achados na página, sem sobrepor, e no documento inteiro em ordem", () => {
  const a = pageText([run("ana banana", 0, 100)]);
  expect(findInPage(a, "ana").map((m) => m.rects[0]![0])).toEqual([0, 25]);
  expect(findInPage(pageText([run("aaaa", 0, 0)]), "aa").length).toBe(2);
  const all = findInPages([a, pageText([run("nada aqui", 0, 100)]), pageText([run("Ana", 0, 100)])], "ana");
  expect(all.map((m) => m.page)).toEqual([1, 1, 3]);
});

test("texto girado: o retângulo segue a direção do pedaço", () => {
  // 90°: o eixo x da matriz aponta para cima.
  const up: PdfTextItem = { str: "abcd", transform: [0, 10, -10, 0, 100, 200], width: 20, height: 10 };
  const [x1, y1, x2, y2] = itemRect(up, 0, 2);
  expect([y1, y2]).toEqual([200, 210]);
  expect(x2 - x1).toBeCloseTo(10.5, 5);
  expect(x1).toBeLessThan(100);
});

test("o achado seguinte e o anterior dão a volta", () => {
  expect(stepMatch(0, 3, 1)).toBe(1);
  expect(stepMatch(2, 3, 1)).toBe(0);
  expect(stepMatch(0, 3, -1)).toBe(2);
  expect(stepMatch(-1, 3, 1)).toBe(0);
  expect(stepMatch(0, 0, 1)).toBe(-1);
});

test("o zoom anda pelos degraus a partir de qualquer escala, e o ajuste à largura respeita os limites", () => {
  expect(stepZoom(1, 1)).toBe(1.25);
  expect(stepZoom(1, -1)).toBe(0.75);
  expect(stepZoom(1.1, 1)).toBe(1.25);
  expect(stepZoom(1.1, -1)).toBe(1);
  expect(stepZoom(3, 1)).toBe(3);
  expect(stepZoom(0.5, -1)).toBe(0.5);
  expect(fitWidth(600, 900)).toBe(1.5);
  expect(fitWidth(600, 6000)).toBe(3);
  expect(fitWidth(600, 60)).toBe(0.5);
  expect(fitWidth(0, 900)).toBe(1);
});

test("linhas sem a marca de quebra: a mudança da linha de base também separa as palavras", () => {
  const p = pageText([run("Relatório de vendas", 72, 760), run("Novembro de 2026", 72, 732)]);
  expect(p.text).toBe("Relatório de vendas Novembro de 2026");
  expect(findInPage(p, "vendasNovembro")).toEqual([]);
  expect(findInPage(p, "vendas novembro")[0]?.rects.length).toBe(2);
  // Na mesma linha, os pedaços seguem colados (o pdf parte uma palavra em duas corridas).
  expect(pageText([run("rela", 72, 760), run("tório", 92, 760)]).text).toBe("relatório");
});

test("o pdf de exemplo (test/fixtures/files/relatorio.pdf) pelo pdf.js: 3 páginas, e a busca acha o termo com acento", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { readFileSync } = await import("node:fs");
  const data = new Uint8Array(readFileSync(new URL("../../../test/fixtures/files/relatorio.pdf", import.meta.url)));
  const task = getDocument({ data, useSystemFonts: true, useWorkerFetch: false, useWasm: false, verbosity: 0 });
  const pdf = await task.promise;
  expect(pdf.numPages).toBe(3);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(pageText(content.items.filter((i): i is typeof i & PdfTextItem => "str" in i)));
  }
  expect(pages[0]!.text).toContain("Relatório de vendas Novembro de 2026");
  const found = findInPages(pages, "RELATORIO");
  expect(found.map((m) => m.page)).toEqual([1, 1, 2, 3]);
  // O título da página 1 começa em x=72, na linha de base y=760 (20 pt).
  expect(found[0]!.rects[0]![0]).toBeCloseTo(72, 3);
  expect(found[0]!.rects[0]![1]).toBeCloseTo(756, 3);
  expect(findInPages(pages, "ação: repor").map((m) => m.page)).toEqual([2]);
  await task.destroy();
});
