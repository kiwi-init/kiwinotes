// O tamanho de um zip aberto (revisão do T7110): docx e xlsx são zips, e o limite do `files.read` (25 MB) é do arquivo
// compactado. Um docx de 360 KB descompactou para 147 MB e travou a janela das Notas. Aqui só o diretório central do
// zip é lido (o índice no fim do arquivo, com o tamanho descompactado de cada parte), sem descompactar nada, e a tela
// recusa o arquivo antes de entregá-lo ao mammoth ou ao SheetJS. Lógica pura.

export interface ZipEntry {
  name: string;
  size: number;
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
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > eocd) return null;
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, size: uncompressed });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

export type ZipCheck = { ok: true } | { ok: false; reason: "not-zip" | "too-large"; size?: number };

/** Se o documento aberto cabe nos limites. Um zip que não dá para medir também é recusado. */
export function checkZip(bytes: Uint8Array, limits: { xml: number; total: number; entries: number } = ZIP_LIMITS): ZipCheck {
  const entries = zipEntries(bytes);
  if (!entries) return { ok: false, reason: "not-zip" };
  if (entries.length > limits.entries) return { ok: false, reason: "too-large" };
  const total = entries.reduce((n, e) => n + e.size, 0);
  const xml = entries.filter((e) => /\.(xml|rels)$/i.test(e.name)).reduce((n, e) => n + e.size, 0);
  if (xml > limits.xml || total > limits.total) return { ok: false, reason: "too-large", size: total };
  return { ok: true };
}

/** O maior HTML que a tela monta, depois da conversão (o que o diretório do zip não pega). */
export const MAX_DOC_HTML = 20 * 1024 * 1024;
