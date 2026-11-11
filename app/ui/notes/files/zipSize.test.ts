import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { checkZip, ZIP_LIMITS, zipEntries } from "./zipSize.ts";

/** Um zip mínimo, escrito à mão: cada parte comprimida com deflate, o diretório central e o fim dele. */
function zip(files: Record<string, Uint8Array | string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const packed = deflateRawSync(data, { level: 9 });
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}

test("lê o tamanho descompactado de cada parte, sem descompactar", () => {
  const z = zip({ "word/document.xml": "<w:document/>", "word/media/a.png": new Uint8Array(1000) });
  expect(zipEntries(z)).toEqual([
    { name: "word/document.xml", size: 13 },
    { name: "word/media/a.png", size: 1000 },
  ]);
  expect(checkZip(z)).toEqual({ ok: true });
});

test("a bomba de zip: poucos KB compactados, muitos MB de XML, é recusada antes de abrir", () => {
  // 30 MB de XML repetido comprimem para uns 30 KB.
  const bomb = zip({ "word/document.xml": "<w:p>" + "a".repeat(30 * 1024 * 1024) + "</w:p>" });
  expect(bomb.length).toBeLessThan(100 * 1024);
  expect(checkZip(bomb)).toMatchObject({ ok: false, reason: "too-large" });
  // As imagens contam no total, não no limite do XML.
  expect(checkZip(zip({ "word/document.xml": "<w:document/>", "word/media/foto.png": new Uint8Array(30 * 1024 * 1024) }))).toEqual({ ok: true });
  expect(checkZip(zip({ "word/document.xml": "x", "word/media/foto.png": new Uint8Array(ZIP_LIMITS.total + 1) }))).toMatchObject({ ok: false, reason: "too-large" });
});

test("muitas partes, ou o que não é zip, também é recusado", () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}.xml`, "x"]));
  expect(checkZip(zip(many), { ...ZIP_LIMITS, entries: 10 })).toMatchObject({ ok: false, reason: "too-large" });
  expect(checkZip(new TextEncoder().encode("%PDF-1.4 não é zip"))).toEqual({ ok: false, reason: "not-zip" });
  expect(checkZip(new Uint8Array(0))).toEqual({ ok: false, reason: "not-zip" });
  // Um diretório central que aponta para fora do arquivo.
  const broken = zip({ "a.xml": "x" });
  new DataView(broken.buffer).setUint32(broken.length - 6, 0x7fffffff, true);
  expect(checkZip(broken)).toEqual({ ok: false, reason: "not-zip" });
});

test("o docx de exemplo passa", () => {
  const docx = new Uint8Array(readFileSync(new URL("../../../test/fixtures/files/proposta.docx", import.meta.url)));
  const entries = zipEntries(docx);
  expect(entries?.map((e) => e.name)).toContain("word/document.xml");
  expect(checkZip(docx)).toEqual({ ok: true });
});
