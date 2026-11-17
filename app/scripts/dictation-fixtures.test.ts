import { expect, test } from "bun:test";

import { cutAtRelease, loadSpoken, missingVoices, PRECISE_CASES, synthWav, withNoise } from "./dictation-fixtures.ts";

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

test("#7082: o WAV com ruído sai mais baixo, com chiado no silêncio, e igual a cada rodada", () => {
  const w = wav(500, 500);
  const noisy = withNoise(w, 0.25, 450);
  expect(noisy.length).toBe(w.length);
  expect(noisy.subarray(0, 44).equals(w.subarray(0, 44))).toBe(true);
  const rms = (b: Buffer, from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += b.readInt16LE(44 + i * 2) ** 2;
    return Math.sqrt(sum / (to - from));
  };
  // A voz: 8000 × 0,25 = 2000, mais o ruído. O silêncio: só o ruído, de desvio 450.
  expect(Math.abs(rms(noisy, 0, 8000) - Math.hypot(2000, 450))).toBeLessThan(40);
  expect(Math.abs(rms(noisy, 8000, 16_000) - 450)).toBeLessThan(25);
  expect(withNoise(w, 0.25, 450).equals(noisy)).toBe(true);
  expect(withNoise(w, 0.25, 450, 2).equals(noisy)).toBe(false);
});

test("#7082: os casos do modo preciso têm um ditado longo (de arquivo) com ruído", () => {
  const cases = loadSpoken(PRECISE_CASES);
  const long = cases.filter((c) => c.sayFile?.startsWith("longos/") && typeof c.noise === "number");
  expect(long.length).toBeGreaterThanOrEqual(1);
  expect(() => loadSpoken(PRECISE_CASES)).not.toThrow();
});

test("T7454: o synth gera o som sem fala na hora, e o caso é validado", () => {
  // O zumbido do achado: pico de ~7200 (a média dos dois senos chega a ~0,88 da amplitude).
  const w = synthWav({ hz: [120, 240], seconds: 3, amplitude: 0.25 });
  expect(w.length).toBe(44 + 3 * 16_000 * 2);
  expect(w.readUInt32LE(40)).toBe(3 * 16_000 * 2);
  let peak = 0;
  for (let i = 0; i < 3 * 16_000; i++) peak = Math.max(peak, Math.abs(w.readInt16LE(44 + i * 2)));
  expect(peak).toBeGreaterThan(7000);
  expect(peak).toBeLessThan(7400);
  const beep = synthWav({ hz: [440], seconds: 2, amplitude: 0.3 });
  let beepPeak = 0;
  for (let i = 0; i < 2 * 16_000; i++) beepPeak = Math.max(beepPeak, Math.abs(beep.readInt16LE(44 + i * 2)));
  expect(Math.abs(beepPeak - 0.3 * 32767)).toBeLessThan(50);
  const synth = loadSpoken(PRECISE_CASES).filter((c) => c.synth);
  expect(synth.length).toBeGreaterThanOrEqual(2);
  for (const c of synth) expect(c.expect).toEqual({ text: "" });
  expect(missingVoices(synth)).toEqual([]);
});
