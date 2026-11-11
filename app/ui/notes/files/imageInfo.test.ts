import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";

import { fitScale, imageInfo, imageProblem, MAX_PIXELS, stepImageZoom } from "./imageInfo.ts";

/** Um png válido, de `w` × `h`, de uma cor só. */
function png(w: number, h: number): Uint8Array {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x55)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

test("o tipo pelos bytes e o tamanho pelo cabeçalho: png, jpeg, gif, webp, bmp, heic e svg", () => {
  expect(imageInfo(png(60, 30))).toEqual({ type: "png", mime: "image/png", width: 60, height: 30 });
  // jpeg: SOI, um APP0 curto e o SOF0 com 480 de altura e 640 de largura.
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]);
  expect(imageInfo(jpeg)).toMatchObject({ type: "jpeg", width: 640, height: 480 });
  expect(imageInfo(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x08, 0x00]))).toMatchObject({ type: "gif", width: 16, height: 8 });
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
  webp.set([0x3f, 0x01, 0x00, 0xc7, 0x00, 0x00], 24); // 320 × 200
  expect(imageInfo(webp)).toMatchObject({ type: "webp", width: 320, height: 200 });
  const bmp = new Uint8Array(30);
  bmp.set([0x42, 0x4d]);
  new DataView(bmp.buffer).setInt32(18, 100, true);
  new DataView(bmp.buffer).setInt32(22, -50, true); // altura negativa: a imagem de cima para baixo
  expect(imageInfo(bmp)).toMatchObject({ type: "bmp", width: 100, height: 50 });
  expect(imageInfo(heicWith([[4032, 3024]]))).toMatchObject({ type: "heic", mime: "image/heic", width: 4032, height: 3024 });
  for (const svg of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '﻿  <?xml version="1.0"?>\n<svg width="10">', "<!-- logo -->\n<svg>"]) {
    expect(imageInfo(new TextEncoder().encode(svg))).toMatchObject({ type: "svg", mime: "image/svg+xml", width: null });
  }
});

test("o nome não engana: o que não começa como imagem não é imagem", () => {
  expect(imageInfo(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  expect(imageInfo(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
  expect(imageInfo(new Uint8Array(0))).toBeNull();
  expect(imageProblem(null)).toBe("unknown");
});

test("a bomba de pixels: poucos KB, mas pixels demais, é recusada antes de decodificar", () => {
  // Só o cabeçalho de um png de 30.000 × 30.000 (900 MP): o resto nem precisa existir.
  const head = png(1, 1);
  new DataView(head.buffer).setUint32(16, 30_000);
  new DataView(head.buffer).setUint32(20, 30_000);
  expect(imageProblem(imageInfo(head))).toBe("tooLarge");
  // 48 MP do iPhone passa; o limite é exato.
  expect(imageProblem({ type: "heic", mime: "image/heic", width: 8064, height: 6048 })).toBeNull();
  expect(imageProblem({ type: "png", mime: "image/png", width: MAX_PIXELS, height: 1 })).toBeNull();
  expect(imageProblem({ type: "png", mime: "image/png", width: MAX_PIXELS + 1, height: 1 })).toBe("tooLarge");
  // O SVG não tem pixels.
  expect(imageProblem({ type: "svg", mime: "image/svg+xml", width: null, height: null })).toBeNull();
});

test("o zoom anda pelos degraus, e o ajuste cabe a imagem inteira sem passar do tamanho real", () => {
  expect(stepImageZoom(1, 1)).toBe(1.5);
  expect(stepImageZoom(1, -1)).toBe(0.75);
  expect(stepImageZoom(0.33, 1)).toBe(0.5);
  expect(stepImageZoom(8, 1)).toBe(8);
  expect(stepImageZoom(0.1, -1)).toBe(0.1);
  expect(fitScale(4000, 3000, 1000, 600)).toBe(0.2);
  expect(fitScale(100, 50, 1000, 600)).toBe(1);
  expect(fitScale(0, 50, 1000, 600)).toBe(1);
});

/** Um jpeg com `extra` bytes de metadados (APP1 e APP2) antes do SOF de `w` × `h`. */
function jpegWithMeta(extra: number, w: number, h: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (let left = extra; left > 0; ) {
    const n = Math.min(left, 65_000);
    parts.push(0xff, 0xe1, ((n + 2) >> 8) & 0xff, (n + 2) & 0xff, ...new Array(n).fill(0x41));
    left -= n;
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03);
  return Uint8Array.from(parts);
}

/** Um HEIC com `ftyp`, um `meta` com as caixas `ispe` dadas, e um `mdat` com "ispe" por acaso no meio dos bytes. */
function heicWith(sizes: [number, number][], mdatTrap = false): Uint8Array {
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    return out;
  };
  const ispe = ([w, h]: [number, number]) => {
    const body = new Uint8Array(12);
    new DataView(body.buffer).setUint32(4, w);
    new DataView(body.buffer).setUint32(8, h);
    return box("ispe", body);
  };
  const cat = (...p: Uint8Array[]) => {
    const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of p) {
      out.set(x, at);
      at += x.length;
    }
    return out;
  };
  const trap = new Uint8Array(32);
  trap.set(new TextEncoder().encode("ispe"), 4);
  new DataView(trap.buffer).setUint32(12, 90_000);
  new DataView(trap.buffer).setUint32(16, 90_000);
  return cat(box("ftyp", new TextEncoder().encode("heic\0\0\0\0mif1heic")), box("meta", cat(new Uint8Array(4), ...sizes.map(ispe))), ...(mdatTrap ? [box("mdat", trap)] : []));
}

test("revisão do T7113: o jpeg com 74 KB de metadados antes do SOF tem o tamanho achado, e a bomba é recusada", () => {
  expect(imageInfo(jpegWithMeta(74 * 1024, 30_000, 30_000))).toMatchObject({ type: "jpeg", width: 30_000, height: 30_000 });
  expect(imageProblem(imageInfo(jpegWithMeta(74 * 1024, 30_000, 30_000)))).toBe("tooLarge");
  expect(imageProblem(imageInfo(jpegWithMeta(200 * 1024, 4032, 3024)))).toBeNull();
});

test("revisão do T7113: no HEIC vale o maior ispe do meta, e o mdat não engana", () => {
  expect(imageInfo(heicWith([[512, 512], [40_000, 40_000], [320, 240]]))).toMatchObject({ type: "heic", width: 40_000, height: 40_000 });
  expect(imageProblem(imageInfo(heicWith([[512, 512], [40_000, 40_000]])))).toBe("tooLarge");
  // A grade do iPhone: tiles de 512 e a imagem inteira de 4032 × 3024; e "ispe" solto no mdat não conta.
  expect(imageInfo(heicWith([[512, 512], [4032, 3024], [320, 240]], true))).toMatchObject({ width: 4032, height: 3024 });
  // O último ispe terminando exatamente no fim do meta (e do arquivo) também conta.
  expect(imageInfo(heicWith([[4032, 3024]]))).toMatchObject({ width: 4032, height: 3024 });
});

test("revisão do T7113: imagem de pixels sem tamanho achado é recusada; o SVG passa", () => {
  // Um jpeg sem SOF, um heic sem meta, um webp de chunk desconhecido.
  expect(imageProblem(imageInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0, 0, 0])))).toBe("unknown");
  expect(imageProblem(imageInfo(heicWith([]).subarray(0, 28)))).toBe("unknown");
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBPXXXX"), 8);
  expect(imageProblem(imageInfo(webp))).toBe("unknown");
  expect(imageProblem(imageInfo(new TextEncoder().encode("<svg/>")))).toBeNull();
});
