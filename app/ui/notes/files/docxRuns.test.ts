import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { partBytes, partText, readZip, writeZip } from "../../../src/shared/sheet/zip.ts";
import { mergeRuns, tidyDocx } from "./docxRuns.ts";

const run = (text: string, rpr = "", attrs = "") => `<w:r${attrs}>${rpr}<w:t${/^\s|\s$/.test(text) ? ' xml:space="preserve"' : ""}>${text}</w:t></w:r>`;
const letters = (text: string, rpr = "") => [...text].map((c) => run(c, rpr)).join("");
const BOLD = "<w:rPr><w:b/></w:rPr>";

describe("mergeRuns", () => {
  test("uma letra por trecho vira um trecho só, com os espaços guardados", () => {
    const xml = `<w:p>${letters("Linha nova da Ana.")}</w:p>`;
    // Os espaços vinham com o xml:space, e o trecho junto o guarda.
    expect(mergeRuns(xml)).toBe('<w:p><w:r><w:t xml:space="preserve">Linha nova da Ana.</w:t></w:r></w:p>');
  });

  test("o espaço na ponta pede o xml:space", () => {
    expect(mergeRuns(`<w:p>${letters("ok ")}</w:p>`)).toBe('<w:p><w:r><w:t xml:space="preserve">ok </w:t></w:r></w:p>');
  });

  test("a mesma formatação junta; outra formatação separa", () => {
    const xml = `<w:p>${letters("ab", BOLD)}${letters("cd")}${letters("ef", BOLD)}</w:p>`;
    expect(mergeRuns(xml)).toBe(`<w:p>${run("ab", BOLD)}${run("cd")}${run("ef", BOLD)}</w:p>`);
  });

  test("atributos diferentes no trecho separam", () => {
    const xml = `<w:p>${run("a", "", ' w:rsidR="00A1"')}${run("b", "", ' w:rsidR="00B2"')}</w:p>`;
    expect(mergeRuns(xml)).toBe(xml);
  });

  test("uma inserção, um comentário ou outro elemento no meio separam", () => {
    const ins = `<w:ins w:id="1" w:author="Bruno"><w:r><w:t>x</w:t></w:r></w:ins>`;
    const xml = `<w:p>${letters("ab")}${ins}${letters("cd")}<w:commentRangeStart w:id="0"/>${letters("ef")}</w:p>`;
    expect(mergeRuns(xml)).toBe(`<w:p>${run("ab")}${ins}${run("cd")}<w:commentRangeStart w:id="0"/>${run("ef")}</w:p>`);
  });

  test("trecho com tabulação, quebra ou campo fica como está", () => {
    const xml = `<w:p>${run("a")}<w:r><w:tab/><w:t>b</w:t></w:r>${run("c")}<w:r><w:t>d</w:t><w:br/></w:r></w:p>`;
    expect(mergeRuns(xml)).toBe(xml);
  });

  test("as entidades passam como estão", () => {
    expect(mergeRuns(`<w:p>${run("&amp;")}${run("&lt;b&gt;")}</w:p>`)).toBe(`<w:p>${run("&amp;&lt;b&gt;")}</w:p>`);
  });

  test("sem nada a juntar, o mesmo texto; e juntar duas vezes dá o mesmo", () => {
    const plain = `<w:body><w:p>${run("Proposta")}</w:p><w:p>${BOLD}</w:p></w:body>`;
    expect(mergeRuns(plain)).toBe(plain);
    const once = mergeRuns(`<w:p>${letters("Loja de exemplo", BOLD)}</w:p>`);
    expect(mergeRuns(once)).toBe(once);
  });

  test("o rPr vazio conta como formatação igual só ao outro vazio", () => {
    const xml = `<w:p>${run("a", "<w:rPr/>")}${run("b", "<w:rPr/>")}${run("c")}</w:p>`;
    expect(mergeRuns(xml)).toBe(`<w:p>${run("ab", "<w:rPr/>")}${run("c")}</w:p>`);
  });
});

describe("tidyDocx", () => {
  const fixture = new Uint8Array(readFileSync(join(import.meta.dir, "../../../test/fixtures/files/proposta.docx")));
  const parts = readZip(fixture);
  const docPart = parts.find((p) => p.name === "word/document.xml")!;

  test("junta no document.xml e deixa as outras partes com os mesmos bytes", () => {
    const xml = partText(fixture, docPart).replace("</w:body>", `<w:p>${letters("Linha nova da Ana.")}</w:p></w:body>`);
    const edited = writeZip(fixture, parts, new Map([["word/document.xml", new TextEncoder().encode(xml)]]));
    const tidy = tidyDocx(edited);
    const after = readZip(tidy);
    const text = partText(tidy, after.find((p) => p.name === "word/document.xml")!);
    expect(text).toContain('<w:p><w:r><w:t xml:space="preserve">Linha nova da Ana.</w:t></w:r></w:p>');
    expect(text.match(/<w:r[ >]/g)!.length).toBeLessThan(xml.match(/<w:r[ >]/g)!.length);
    expect(after.map((p) => p.name)).toEqual(parts.map((p) => p.name));
    for (const p of after) if (p.name !== "word/document.xml") expect(partBytes(tidy, p)).toEqual(partBytes(fixture, parts.find((q) => q.name === p.name)!));
  });

  test("sem nada a juntar, os mesmos bytes; e o que não é zip volta como veio", () => {
    expect(tidyDocx(fixture)).toBe(fixture);
    const junk = new TextEncoder().encode("não é um docx");
    expect(tidyDocx(junk)).toBe(junk);
  });
});
