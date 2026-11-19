// O zip de um xlsx, para gravar sem perda (T21107, spec #21065): ler as partes e escrever um zip novo em que as partes
// que não mudaram saem com os mesmos bytes compactados do original (o registro local copiado inteiro, sem descompactar
// e compactar de novo), e só as trocadas são compactadas aqui. Sem dependência além do pako, que o app já tem.

import { deflateRaw, inflateRaw } from "pako";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const DESCRIPTOR = 0x08074b50;

/** Uma parte do zip, como o diretório central diz. */
export interface ZipPart {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressed: number;
  size: number;
  /** O registro do diretório central, inteiro (para copiar com o offset novo). */
  central: Uint8Array;
  /** Onde começa o registro local e onde ele acaba (com o descritor, se houver). */
  start: number;
  end: number;
  /** Onde começam os dados compactados. */
  data: number;
}

/** Um zip que não dá para ler com segurança: o xlsx abre só para leitura. */
export class ZipError extends Error {}

/** As partes, na ordem do diretório central. */
export function readZip(bytes: Uint8Array): ZipPart[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("no end of central directory");
  const count = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);
  // ZIP64 (partes acima de 4 GB): nenhuma planilha normal tem, e o formato pede outro leitor.
  if (count === 0xffff || offset === 0xffffffff) throw new ZipError("zip64 is not supported");
  const parts: ZipPart[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL) throw new ZipError("bad central directory");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const length = 46 + nameLength + extra + comment;
    if (at + length > eocd) throw new ZipError("bad central directory");
    if (flags & 1) throw new ZipError("encrypted part");
    if (method !== 0 && method !== 8) throw new ZipError(`compression method ${method}`);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new ZipError(`bad local header for ${name}`);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    let end = data + compressed;
    if (end > bytes.length) throw new ZipError(`truncated part ${name}`);
    // O descritor depois dos dados (bit 3): 12 bytes, ou 16 com a assinatura opcional.
    if (flags & 8) end += end + 4 <= bytes.length && view.getUint32(end, true) === DESCRIPTOR ? 16 : 12;
    parts.push({ name, method, flags, crc, compressed, size, central: bytes.slice(at, at + length), start: local, end, data });
    at += length;
  }
  return parts;
}

/** Os bytes abertos de uma parte. */
export function partBytes(bytes: Uint8Array, part: ZipPart): Uint8Array {
  const raw = bytes.subarray(part.data, part.data + part.compressed);
  const out = part.method === 0 ? raw.slice() : inflateRaw(raw);
  if (out.length !== part.size || crc32(out) !== part.crc) throw new ZipError(`part ${part.name} does not match its checksum`);
  return out;
}

export function partText(bytes: Uint8Array, part: ZipPart): string {
  return new TextDecoder().decode(partBytes(bytes, part));
}

/**
 * O zip novo: cada parte do original na mesma ordem, copiada crua, menos as de `changed` (o conteúdo novo, compactado
 * aqui), as de `removed` (fora) e as novas de `changed` que o original não tinha (no fim).
 */
export function writeZip(bytes: Uint8Array, parts: ZipPart[], changed: Map<string, Uint8Array>, removed: Set<string> = new Set()): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let at = 0;
  const seen = new Set<string>();
  for (const part of parts) {
    if (removed.has(part.name)) continue;
    seen.add(part.name);
    const next = changed.get(part.name);
    if (!next) {
      const local = bytes.subarray(part.start, part.end);
      chunks.push(local);
      const central = part.central.slice();
      new DataView(central.buffer).setUint32(42, at, true);
      centrals.push(central);
      at += local.length;
      continue;
    }
    const entry = entryFor(part.name, next, part);
    chunks.push(entry.header);
    new DataView(entry.central.buffer).setUint32(42, at, true);
    centrals.push(entry.central);
    at += entry.header.length;
  }
  for (const [name, content] of changed) {
    if (seen.has(name) || removed.has(name)) continue;
    const entry = entryFor(name, content, null);
    chunks.push(entry.header);
    new DataView(entry.central.buffer).setUint32(42, at, true);
    centrals.push(entry.central);
    at += entry.header.length;
  }
  const centralStart = at;
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  const out = new Uint8Array(centralStart + centralSize + 22);
  let o = 0;
  for (const c of [...chunks, ...centrals, end]) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Um registro local e o do diretório central para um conteúdo novo; `like` dá a data e as permissões da original. */
function entryFor(name: string, content: Uint8Array, like: ZipPart | null): { header: Uint8Array; central: Uint8Array } {
  const nameBytes = new TextEncoder().encode(name);
  const data = deflateRaw(content);
  const crc = crc32(content);
  const likeView = like ? new DataView(like.central.buffer, like.central.byteOffset, like.central.byteLength) : null;
  // A hora e a data do DOS: as da parte original, ou 1980-01-01 numa nova (o zip fica igual a cada gravação).
  const time = likeView?.getUint16(12, true) ?? 0;
  const date = likeView?.getUint16(14, true) ?? 0x21;
  // UTF-8 no nome (bit 11) só se ele não é ASCII.
  const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : 0x800;
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, LOCAL, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, flags, true);
  lv.setUint16(8, 8, true);
  lv.setUint16(10, time, true);
  lv.setUint16(12, date, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, content.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, CENTRAL, true);
  cv.setUint16(4, likeView?.getUint16(4, true) ?? 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, flags, true);
  cv.setUint16(10, 8, true);
  cv.setUint16(12, time, true);
  cv.setUint16(14, date, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, content.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(38, likeView?.getUint32(38, true) ?? 0, true);
  central.set(nameBytes, 46);
  return { header: local, central };
}

let table: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
