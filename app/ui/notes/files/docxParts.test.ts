import { describe, expect, test } from "bun:test";
import { partBytes, readZip, writeZip } from "../../../src/shared/sheet/zip.ts";
import { canonicalXml, keepUntouchedParts } from "./docxParts.ts";

const enc = (s: string) => new TextEncoder().encode(s);

/** Um zip mínimo com estas partes, pelo mesmo escritor do Kiwi. */
const zipOf = (parts: Record<string, string>): Uint8Array =>
  writeZip(new Uint8Array(0), [], new Map(Object.entries(parts).map(([n, t]) => [n, enc(t)])));

const text = (zip: Uint8Array, name: string) => new TextDecoder().decode(partBytes(zip, readZip(zip).find((p) => p.name === name)!));

describe("canonicalXml", () => {
  test("ignora o que o motor muda só de forma", () => {
    const a = `<?xml version="1.0" encoding="UTF-8"?><w:r a="1" b='2' mc:Ignorable="w14 w15"><w:p w14:paraId="1A"><w:t xml:space="preserve">Ana</w:t></w:p><x></x></w:r>`;
    const b = `<w:r mc:Ignorable="w15 w14" b="2" a="1"><w:p><w:t>Ana</w:t></w:p><x/></w:r>`;
    expect(canonicalXml(a)).toBe(canonicalXml(b));
  });

  test("o que muda o conteúdo conta", () => {
    expect(canonicalXml(`<w:t xml:space="preserve"> Ana</w:t>`)).not.toBe(canonicalXml(`<w:t>Ana</w:t>`));
    expect(canonicalXml(`<w:t>Ana</w:t>`)).not.toBe(canonicalXml(`<w:t>Bruno</w:t>`));
    expect(canonicalXml(`<w:b w:val="1"/>`)).not.toBe(canonicalXml(`<w:b w:val="0"/>`));
  });
});

describe("keepUntouchedParts", () => {
  test("a parte que só mudou de forma volta com os bytes de antes; a editada fica", () => {
    const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles a="1" b="2"/>`;
    const original = zipOf({ "word/document.xml": "<w:t>Ana</w:t>", "word/styles.xml": styles });
    const saved = zipOf({ "word/document.xml": "<w:t>Ana e Bruno</w:t>", "word/styles.xml": `<w:styles b="2" a="1"></w:styles>` });
    const out = keepUntouchedParts(saved, original);
    expect(text(out, "word/styles.xml")).toBe(styles);
    expect(text(out, "word/document.xml")).toBe("<w:t>Ana e Bruno</w:t>");
  });

  test("nada a devolver: os mesmos bytes; zip que não abre: como veio", () => {
    const z = zipOf({ "word/document.xml": "<w:t>Ana</w:t>" });
    expect(keepUntouchedParts(z, z)).toBe(z);
    const junk = new Uint8Array([1, 2, 3]);
    expect(keepUntouchedParts(junk, z)).toBe(junk);
  });
});
