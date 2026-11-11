// O tamanho de um zip aberto (revisão do T7110): docx e xlsx são zips, e o limite do `files.read` (25 MB) é do arquivo
// compactado. Um docx de 360 KB descompactou para 147 MB e travou a janela das Notas. E o tamanho que o zip declara não
// vale: um zip pode mentir no diretório central, e o JSZip só confere depois de descompactar tudo (rodada 2). Então
// cada parte é descompactada aqui, em pedaços pequenos, contando os bytes que saem, e a conta para no teto: nada passa
// de alguns MB na memória, nem com o tamanho declarado falso, e a tela recusa o arquivo antes do mammoth ou do SheetJS.

import { Inflate } from "pako/lib/inflate.js";

export interface ZipEntry {
  name: string;
  /** O tamanho aberto que o zip declara: só para listar, nunca para decidir. */
  size: number;
  /** Onde fica o cabeçalho local da parte, e o tamanho compactado e o método que o diretório declara. */
  offset: number;
  compressed: number;
  method: number;
}

/** O que passa: as partes de texto (o XML que a biblioteca transforma em árvore) e o total, contando as imagens. */
export const ZIP_LIMITS = { xml: 20 * 1024 * 1024, total: 60 * 1024 * 1024, entries: 5_000 } as const;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * As entradas do diretório central, ou `null` quando o arquivo não é um zip que dê para medir: sem o fim do diretório,
 * com ZIP64 (tamanhos acima de 4 GB, que nenhum documento normal tem) ou com o diretório apontando para fora.
 */
export function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // O fim do diretório central fica nos últimos 22 bytes, mais um comentário de até 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff || offset + size > eocd) return null;
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL) return null;
    const uncompressed = view.getUint32(at + 24, true);
    if (uncompressed === 0xffffffff) return null;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const local = view.getUint32(at + 42, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > eocd) return null;
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, size: uncompressed, offset: local, compressed, method });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

export type ZipCheck = { ok: true } | { ok: false; reason: "not-zip" | "too-large" };

/** Um pedaço do que entra no descompactador por vez: o que sai de um pedaço tem no máximo ~1.000 vezes isso (16 MB). */
const SLICE = 16 * 1024;

/** O começo de uma imagem (png, jpeg, gif, bmp, emf, wmf, tiff, webp): ela conta no total, não no limite do texto. */
function isImage(head: Uint8Array): boolean {
  const b = head;
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  return (
    at(0, 0x89, 0x50, 0x4e, 0x47) || at(0, 0xff, 0xd8, 0xff) || at(0, 0x47, 0x49, 0x46, 0x38) || at(0, 0x42, 0x4d) ||
    at(0, 0x01, 0x00, 0x00, 0x00) || at(0, 0xd7, 0xcd, 0xc6, 0x9a) || at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a) ||
    (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
  );
}

/**
 * Os bytes que uma parte dá de verdade, descompactando em pedaços, até `cap`: passou disso, para e devolve `cap + 1`.
 * `head` recebe os primeiros bytes que saem (para saber se é imagem). `-1`: a parte está quebrada.
 */
export function inflatedSize(data: Uint8Array, method: number, cap: number, head: Uint8Array = new Uint8Array(0)): number {
  if (method === 0) {
    head.set(data.subarray(0, head.length));
    return Math.min(data.length, cap + 1);
  }
  if (method !== 8) return -1;
  let total = 0;
  let over = false;
  const inflate = new Inflate({ raw: true, chunkSize: 64 * 1024 });
  inflate.onData = (chunk: Uint8Array) => {
    if (total < head.length) head.set(chunk.subarray(0, head.length - total), total);
    total += chunk.length;
    if (total > cap) over = true;
  };
  inflate.onEnd = () => {};
  for (let at = 0; at < data.length && !over; at += SLICE) {
    const end = Math.min(at + SLICE, data.length);
    inflate.push(data.subarray(at, end), end === data.length);
    if (inflate.err) return -1;
  }
  return over ? cap + 1 : total;
}

/**
 * Se o documento aberto cabe nos limites, descompactando de verdade (o tamanho declarado não conta). O texto (o que
 * não é imagem, qualquer que seja o nome da parte) tem o limite `xml`; tudo junto, o `total`. Um zip que não dá para
 * ler também é recusado.
 */
export function checkZip(bytes: Uint8Array, limits: { xml: number; total: number; entries: number } = ZIP_LIMITS): ZipCheck {
  const entries = zipEntries(bytes);
  if (!entries) return { ok: false, reason: "not-zip" };
  if (entries.length > limits.entries) return { ok: false, reason: "too-large" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let text = 0;
  for (const e of entries) {
    // O cabeçalho local diz onde começam os dados; o tamanho compactado nunca passa do fim do arquivo.
    if (e.offset + 30 > bytes.length || view.getUint32(e.offset, true) !== 0x04034b50) return { ok: false, reason: "not-zip" };
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    if (start > bytes.length) return { ok: false, reason: "not-zip" };
    const data = bytes.subarray(start, Math.min(bytes.length, start + e.compressed));
    const head = new Uint8Array(12);
    const size = inflatedSize(data, e.method, limits.total - total, head);
    if (size < 0) return { ok: false, reason: "not-zip" };
    total += size;
    if (total > limits.total) return { ok: false, reason: "too-large" };
    if (!isImage(head)) {
      text += size;
      if (text > limits.xml) return { ok: false, reason: "too-large" };
    }
  }
  return { ok: true };
}

/** O maior HTML que a tela monta, depois da conversão (o que o diretório do zip não pega). */
export const MAX_DOC_HTML = 20 * 1024 * 1024;
