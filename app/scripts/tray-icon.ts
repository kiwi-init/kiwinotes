// Gera assets/trayTemplate@2x.png: cinco barras de onda arredondadas (36×36,
// 18pt @2x), preto com alfa, para o macOS pintar como template na barra de menu.
//   bun scripts/tray-icon.ts
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 36;
const BAR_W = 4;
const GAP = 3;
const HEIGHTS = [10, 20, 28, 20, 10];

const rgba = new Uint8Array(SIZE * SIZE * 4);
const totalW = HEIGHTS.length * BAR_W + (HEIGHTS.length - 1) * GAP;
const left = (SIZE - totalW) / 2;

// Cobertura de um retângulo arredondado (bordas suaves por supersampling 4×4).
function coverage(px: number, py: number, x0: number, y0: number, w: number, h: number): number {
  const r = w / 2;
  let inside = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const x = px + (sx + 0.5) / 4;
      const y = py + (sy + 0.5) / 4;
      if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) continue;
      const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
      const dx = x - (x0 + r);
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) inside++;
    }
  }
  return inside / 16;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let a = 0;
    HEIGHTS.forEach((h, i) => {
      a = Math.max(a, coverage(x, y, left + i * (BAR_W + GAP), (SIZE - h) / 2, BAR_W, h));
    });
    rgba[(y * SIZE + x) * 4 + 3] = Math.round(a * 255);
  }
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) raw.set(rgba.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (SIZE * 4 + 1) + 1);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", new Uint8Array()),
]);
const out = path.resolve(import.meta.dirname, "..", "assets", "trayTemplate@2x.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out}`);
