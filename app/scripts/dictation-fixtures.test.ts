import { expect, test } from "bun:test";

import { cutAtRelease } from "./dictation-fixtures.ts";

/** Um WAV de 16 kHz, mono, 16 bits: `voiceMs` de som e `silenceMs` de silêncio no fim. */
function wav(voiceMs: number, silenceMs: number): Buffer {
  const n = ((voiceMs + silenceMs) * 16_000) / 1000;
  const voice = (voiceMs * 16_000) / 1000;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16_000, 24);
  b.writeUInt32LE(32_000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < voice; i++) b.writeInt16LE(i % 2 ? 8000 : -8000, 44 + i * 2);
  return b;
}
const ms = (w: Buffer) => (w.readUInt32LE(40) / 2 / 16_000) * 1000;

test("T5456: o WAV para onde a gravação pararia: o fim da fala, menos o que veio antes de soltar, mais o rabo", () => {
  const w = wav(1000, 300);
  expect(ms(cutAtRelease(w, 450, 250))).toBe(800);
  expect(ms(cutAtRelease(w, 450, 0))).toBe(550);
  // Soltou quando a fala acabou: a fala inteira e o rabo (do silêncio do `say`), sem passar do arquivo.
  expect(ms(cutAtRelease(w, 0, 250))).toBe(1250);
  expect(ms(cutAtRelease(w, 0, 0))).toBe(1000);
  expect(ms(cutAtRelease(w, -1000, 250))).toBe(1300);
  expect(cutAtRelease(w, 450, 250).readUInt32LE(4)).toBe(cutAtRelease(w, 450, 250).length - 8);
});
