// Monta as reuniões do banco (T20237, spec #20181) a partir das falas do `prepare.ts`: um WAV de dois canais a 16 kHz
// (0 = você, o mic; 1 = sistema, os outros), como o `kiwi-helper --meeting` e o `--meeting-live` leem, e o gabarito.
//
//   bun scripts/meeting-bench/build.ts
//
// Reuniões: `say` (o roteiro inventado; A é você), `mls` (o 1º falante é você, os outros no sistema) e `coraa-N` (duas
// gravações de conversa espontânea, uma em cada canal, se alternando). Cada uma em quatro variantes, para medir a
// captura: `limpo`; `eco` (alto-falante sem fone: o sistema vaza no mic, 40 ms depois e com um rabo de sala); `ruido`
// (um ruído de fundo a ~15 dB abaixo da fala); `baixo` (o mic e o sistema 20 dB abaixo). Tudo em `<banco>/reunioes/`.
// Determinístico: a mesma semente dá as mesmas pausas e sobreposições.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BENCH, type Clip } from "./prepare.ts";

const RATE = 16_000;
export interface Turn { start: number; end: number; channel: "voce" | "sistema"; speaker: string; id: string; source: string; text: string }
export interface Truth { name: string; source: string; variant: string; seconds: number; turns: Turn[] }
export const VARIANTS = ["limpo", "eco", "ruido", "baixo"] as const;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readWav(path: string): Float32Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const out = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`sem bloco data: ${path}`);
}

function writeStereoWav(path: string, left: Float32Array, right: Float32Array) {
  const n = Math.max(left.length, right.length);
  const data = Buffer.alloc(n * 4);
  const clip = (x: number) => Math.max(-1, Math.min(1, x));
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(clip(left[i] ?? 0) * 32767), i * 4);
    data.writeInt16LE(Math.round(clip(right[i] ?? 0) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

const rms = (x: Float32Array) => {
  let s = 0, n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > 1e-3) { s += x[i]! * x[i]!; n++; }
  return n ? Math.sqrt(s / n) : 0;
};

/** As falas em ordem, com o canal de cada uma. */
type Placed = { clip: Clip; channel: "voce" | "sistema" };

/** Põe as falas uma depois da outra: pausa de 0,25 a 0,9 s; às vezes (8%) a fala entra 0,3 s antes da outra acabar. */
function place(items: Placed[], seed: number) {
  const rand = rng(seed);
  const turns: Turn[] = [];
  const clips: { at: number; ch: 0 | 1; pcm: Float32Array }[] = [];
  let t = 0.6;
  let prev: Turn | undefined;
  for (const { clip, channel } of items) {
    const pcm = readWav(clip.wav);
    // O nível de cada fala igual (as fontes vêm em volumes diferentes), a ~-20 dBFS.
    const r = rms(pcm);
    const gain = r ? 0.1 / r : 1;
    for (let i = 0; i < pcm.length; i++) pcm[i]! *= gain;
    let start = t + 0.25 + rand() * 0.65;
    if (prev && prev.channel !== channel && rand() < 0.08) start = Math.max(prev.start + 0.5, prev.end - 0.3);
    const end = start + pcm.length / RATE;
    const turn: Turn = { start: +start.toFixed(3), end: +end.toFixed(3), channel, speaker: clip.speaker, id: clip.id, source: clip.source, text: clip.text };
    turns.push(turn);
    clips.push({ at: start, ch: channel === "voce" ? 0 : 1, pcm });
    t = Math.max(t, end);
    prev = turn;
  }
  const total = Math.ceil((t + 1) * RATE);
  const ch = [new Float32Array(total), new Float32Array(total)] as const;
  for (const c of clips) {
    const o = Math.round(c.at * RATE);
    for (let i = 0; i < c.pcm.length && o + i < total; i++) ch[c.ch][o + i]! += c.pcm[i]!;
  }
  return { turns, ch, total };
}

/** A variante de captura, sobre uma cópia dos canais. */
function variant(name: (typeof VARIANTS)[number], src: readonly [Float32Array, Float32Array], seed: number): [Float32Array, Float32Array] {
  const [mic, sys] = [Float32Array.from(src[0]), Float32Array.from(src[1])];
  const rand = rng(seed + 101);
  if (name === "eco") {
    // O som da reunião sai do alto-falante e volta pelo mic: 40 ms, 25% do volume, e duas reflexões da sala.
    for (const [ms, g] of [[40, 0.25], [75, 0.1], [130, 0.05]] as const) {
      const d = Math.round((ms / 1000) * RATE);
      for (let i = d; i < mic.length; i++) mic[i]! += src[1][i - d]! * g;
    }
  } else if (name === "ruido") {
    // Um ruído rosado aproximado (média de brancos), ~15 dB abaixo da fala, nos dois canais.
    for (const x of [mic, sys]) {
      const level = 0.1 * 10 ** (-15 / 20);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < x.length; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        x[i]! += (b0 + b1 + b2 + w * 0.1848) * level * 0.25;
      }
    }
  } else if (name === "baixo") {
    for (const x of [mic, sys]) for (let i = 0; i < x.length; i++) x[i]! *= 0.1;
  }
  return [mic, sys];
}

const load = (source: string): Clip[] => {
  const f = join(BENCH, source, "clips.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

/** As reuniões de cada fonte: o nome, a semente e as falas na ordem. */
function meetings(): { name: string; source: string; seed: number; items: Placed[] }[] {
  const out: { name: string; source: string; seed: number; items: Placed[] }[] = [];
  const say = load("say");
  if (say.length) out.push({ name: "say", source: "say", seed: 7, items: say.map((clip) => ({ clip, channel: clip.speaker === "A" ? "voce" : "sistema" })) });
  const mls = load("mls");
  if (mls.length) {
    // Um falante de cada vez, em rodízio: o primeiro é você.
    const speakers = [...new Set(mls.map((c) => c.speaker))];
    const queues = speakers.map((s) => mls.filter((c) => c.speaker === s));
    const items: Placed[] = [];
    for (let i = 0; queues.some((q) => q.length); i++) {
      const q = queues[i % queues.length]!;
      const clip = q.shift();
      if (clip) items.push({ clip, channel: clip.speaker === speakers[0] ? "voce" : "sistema" });
    }
    out.push({ name: "mls", source: "mls", seed: 11, items });
  }
  const coraa = load("coraa");
  const groups = [...new Set(coraa.map((c) => c.group))];
  // Duas gravações por reunião, uma em cada canal, se alternando pedaço a pedaço.
  for (let g = 0; g + 1 < groups.length; g += 2) {
    const a = coraa.filter((c) => c.group === groups[g]);
    const b = coraa.filter((c) => c.group === groups[g + 1]);
    const items: Placed[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) items.push({ clip: a[i]!, channel: "voce" });
      if (b[i]) items.push({ clip: b[i]!, channel: "sistema" });
    }
    out.push({ name: `coraa-${g / 2 + 1}`, source: "coraa", seed: 13 + g, items });
  }
  return out;
}

if (import.meta.main) {
  const dir = join(BENCH, "reunioes");
  mkdirSync(dir, { recursive: true });
  for (const m of meetings()) {
    const { turns, ch, total } = place(m.items, m.seed);
    for (const v of VARIANTS) {
      const name = `${m.name}.${v}`;
      const [mic, sys] = variant(v, ch, m.seed);
      writeStereoWav(join(dir, `${name}.wav`), mic, sys);
      const truth: Truth = { name, source: m.source, variant: v, seconds: +(total / RATE).toFixed(1), turns };
      writeFileSync(join(dir, `${name}.truth.json`), JSON.stringify(truth));
    }
    const words = turns.reduce((s, t) => s + t.text.split(/\s+/).length, 0);
    console.log(`${m.name}: ${(total / RATE / 60).toFixed(1)} min, ${turns.length} falas, ~${words} palavras, ×${VARIANTS.length} variantes`);
  }
  console.log(`em ${dir}`);
}
