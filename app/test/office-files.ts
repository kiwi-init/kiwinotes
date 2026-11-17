// Arquivos de escritório inventados para os testes do agente (T17600, spec #17587): um zip feito à mão e um pptx
// mínimo. Ficam aqui para os testes das ferramentas e o da pasta inteira usarem os mesmos.

import { deflateRawSync } from "node:zlib";

/** Um zip feito à mão (T17600): `deflate` comprime; `declara` mente o tamanho aberto no diretório, como um zip bomba. */
export function zipBytes(files: Record<string, string | Uint8Array>, opts: { deflate?: boolean; declara?: number } = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let at = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const data = opts.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const n = enc.encode(name);
    const crc = Bun.hash.crc32(raw);
    const size = opts.declara ?? raw.length;
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, opts.deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, opts.deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, at, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    at += local.length;
  }
  const dirSize = centrals.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, at, true);
  const out = new Uint8Array(at + dirSize + 22);
  let o = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
/** Um pptx mínimo: um slide por item, cada um com os parágrafos; os pedaços de um parágrafo vêm em `<a:t>` separados. */
export function pptxBytes(slides: string[][][]): Uint8Array {
  const files: Record<string, string> = { "[Content_Types].xml": "<Types/>", "ppt/presentation.xml": "<p:presentation/>" };
  slides.forEach((paras, i) => {
    const body = paras.map((runs) => `<a:p>${runs.map((r) => `<a:r><a:rPr lang="pt-BR"/><a:t>${r}</a:t></a:r>`).join("")}</a:p>`).join("");
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0"?><p:sld><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zipBytes(files, { deflate: true });
}
