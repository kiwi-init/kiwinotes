// As imagens das Notas (T7113, spec #7079), a parte pura: o tipo de verdade (pelos primeiros bytes, não pelo nome) e
// o tamanho em pixels, lido do cabeçalho sem decodificar. Uma imagem pequena em bytes pode ter dezenas de milhares de
// pixels de lado (a "bomba de pixels"): decodificada, ocupa gigabytes e derruba a janela. Acima de `MAX_PIXELS`, a
// tela recusa antes de mostrar, como o docx e o xlsx recusam o zip que abre grande demais.

export type ImageType = "png" | "jpeg" | "gif" | "webp" | "bmp" | "heic" | "svg";

export interface ImageInfo {
  type: ImageType;
  mime: string;
  /** Largura e altura do cabeçalho; `null` quando o formato não diz (o SVG, que é desenho e não pixels). */
  width: number | null;
  height: number | null;
}

/** 100 megapixels: uma foto de 48 MP do iPhone passa; uma bomba de 30.000 × 30.000 (900 MP) não. */
export const MAX_PIXELS = 100_000_000;

const MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  svg: "image/svg+xml",
};

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** As dimensões de um jpeg: o primeiro marcador SOF (início de quadro) diz a altura e a largura. */
function jpegSize(b: Uint8Array): [number, number] | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = (b[at + 2]! << 8) | b[at + 3]!;
    // SOF0 a SOF15, fora o DHT (C4), o JPG (C8) e o DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(b[at + 7]! << 8) | b[at + 8]!, (b[at + 5]! << 8) | b[at + 6]!];
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * As dimensões de um HEIC: a maior caixa `ispe` (o tamanho de cada imagem) dentro da caixa `meta`. O HEIC do iPhone é
 * uma grade: os tiles de 512 × 512 e a miniatura também têm `ispe`, e o primeiro raramente é o da imagem inteira
 * (revisão do T7113). A busca fica dentro do `meta`: no `mdat`, os bytes da imagem podem formar "ispe" por acaso.
 */
function heicSize(b: Uint8Array, view: DataView): [number, number] | null {
  let at = 0;
  let meta: [number, number] | null = null;
  // As caixas do topo: tamanho (32 bits, 1 = 64 bits, 0 = até o fim) e tipo.
  while (at + 8 <= b.length) {
    let size = view.getUint32(at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > b.length) return null;
      size = Number(view.getBigUint64(at + 8));
      head = 16;
    } else if (size === 0) size = b.length - at;
    if (size < head) return null;
    if (ascii(b, at + 4, 4) === "meta") {
      meta = [at + head, Math.min(b.length, at + size)];
      break;
    }
    at += size;
  }
  if (!meta) return null;
  let best: [number, number] | null = null;
  // `ispe`, 4 bytes de versão e flags, a largura e a altura: 16 bytes a partir do tipo. O último pode terminar
  // exatamente no fim do `meta`.
  for (let i = meta[0]; i + 16 <= meta[1]; i++) {
    if (b[i] !== 0x69 || ascii(b, i, 4) !== "ispe") continue;
    const w = view.getUint32(i + 8);
    const h = view.getUint32(i + 12);
    if (!best || w * h > best[0] * best[1]) best = [w, h];
  }
  return best;
}

/** O tipo e o tamanho da imagem, ou `null` quando os bytes não são de nenhuma imagem que as Notas mostram. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const make = (type: ImageType, size: [number, number] | null): ImageInfo => ({ type, mime: MIME[type], width: size?.[0] ?? null, height: size?.[1] ?? null });
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return make("png", [view.getUint32(16), view.getUint32(20)]);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return make("jpeg", jpegSize(b));
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return make("gif", [view.getUint16(6, true), view.getUint16(8, true)]);
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return make("webp", [1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))]);
    if (chunk === "VP8 ") return make("webp", [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]);
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return make("webp", [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]);
    }
    return make("webp", null);
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return make("bmp", [Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true))]);
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp" && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(ascii(b, 8, 4))) return make("heic", heicSize(b, view));
  // O SVG é texto: o começo, sem o BOM e os espaços, é `<svg`, `<?xml` ou um comentário, e há um `<svg` perto.
  const head = new TextDecoder().decode(b.subarray(0, 4096)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml|<!--|<!doctype svg|<svg)/i.test(head) && /<svg[\s/>]/i.test(head)) return make("svg", null);
  return null;
}

/**
 * Se a imagem pode ser mostrada: o tipo é conhecido e os pixels cabem. Uma imagem de pixels cujo tamanho não se acha
 * também é recusada (revisão do T7113): sem o tamanho, o teto não vale. Só o SVG, que é desenho, passa sem tamanho.
 */
export function imageProblem(info: ImageInfo | null): "unknown" | "tooLarge" | null {
  if (!info) return "unknown";
  if (info.width === null || info.height === null) return info.type === "svg" ? null : "unknown";
  if (info.width * info.height > MAX_PIXELS) return "tooLarge";
  return null;
}

/** Os degraus do zoom da imagem; "ajustar" fica fora deles. */
export const IMAGE_ZOOM = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8] as const;

export function stepImageZoom(scale: number, direction: 1 | -1): number {
  if (direction === 1) return IMAGE_ZOOM.find((z) => z > scale + 0.001) ?? IMAGE_ZOOM.at(-1)!;
  return [...IMAGE_ZOOM].reverse().find((z) => z < scale - 0.001) ?? IMAGE_ZOOM[0];
}

/** A escala que faz a imagem caber inteira na área, sem passar do tamanho real. */
export function fitScale(width: number, height: number, areaWidth: number, areaHeight: number): number {
  if (!(width > 0 && height > 0 && areaWidth > 0 && areaHeight > 0)) return 1;
  return Math.min(1, areaWidth / width, areaHeight / height);
}
