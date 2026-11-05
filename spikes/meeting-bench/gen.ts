// Gerador da reunião sintética (T4926, R0 do spec #4823). Lê o dialogo.txt, fala cada linha pelo `say -o` direto em
// arquivo (nunca toca som) e monta um WAV de dois canais a 16 kHz: canal 0 = "você" (o mic), canal 1 = "sistema" (os
// outros, como o áudio da reunião). Junto sai o gabarito em JSON: quem disse o quê, de quando a quando.
// A fala vem do tts.swift (AVSpeechSynthesizer em arquivo, nunca no alto-falante): as vozes "novelty" do `say` (Eddy,
// Flo…) saem robóticas demais em PT, e a Siri natural não está aberta a apps. Sobram duas vozes naturais, a Luciana
// (pt-BR) e a Joana (pt-PT); as outras pessoas são elas com o "trato vocal" esticado ou encolhido (reamostragem: muda o
// tom e os formantes juntos, como a aumentação de dados dos modelos de falante). É o caso difícil para a diarização
// (vozes da mesma família), de propósito: na reunião de verdade as vozes diferem mais.
//
//   bun spikes/meeting-bench/gen.ts            # as três: curta, curta-eco e longa
//   bun spikes/meeting-bench/gen.ts curta      # só uma
//
// Determinístico: a mesma semente dá as mesmas pausas e sobreposições. As falas do `say` ficam num cache por texto e
// voz (audio/cache/), então rodar de novo é rápido. Tudo em audio/, que o git ignora.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const OUT = join(HERE, "audio");
const CACHE = join(OUT, "cache");
const RATE = 16_000;

type Role = "A" | "B" | "C" | "D" | "E" | "F";
interface Line { part: 1 | 2; role: Role; text: string }
export interface Turn { start: number; end: number; channel: "voce" | "sistema"; speaker: string; voice: string; text: string }

const LUCIANA = "com.apple.voice.compact.pt-BR.Luciana";
const JOANA = "com.apple.voice.super-compact.pt-PT.Joana";
/** As pessoas da reunião: a voz, a velocidade da fala e o `shift` (abaixo de 1, mais grave e com o trato vocal maior;
 * acima, mais agudo). A velocidade compensa o shift, que também estica o tempo. */
const PEOPLE: Record<string, { voice: string; pitch: number; rate: number; shift: number }> = {
  voce: { voice: LUCIANA, pitch: 1, rate: 0.5, shift: 1 },
  joana: { voice: JOANA, pitch: 1, rate: 0.5, shift: 1 },
  luiz: { voice: LUCIANA, pitch: 1, rate: 0.56, shift: 0.8 },
  tiago: { voice: JOANA, pitch: 1, rate: 0.56, shift: 0.78 },
  bia: { voice: LUCIANA, pitch: 1, rate: 0.46, shift: 1.14 },
  rita: { voice: JOANA, pitch: 1, rate: 0.46, shift: 1.16 },
};

/** Estica (shift < 1) ou encolhe a fala por reamostragem linear: tom e formantes mudam juntos. */
function reshape(x: Float32Array, shift: number): Float32Array {
  if (shift === 1) return x;
  const n = Math.floor(x.length / shift);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * shift, k = Math.floor(p), f = p - k;
    y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f;
  }
  return y;
}

/** Os papéis de cada reunião (o nome é uma pessoa de PEOPLE). "A" é sempre você. */
const MEETINGS: Record<string, { parts: (1 | 2)[][]; voices: Record<Role, string>[]; echo: boolean; seed: number }> = {
  // ~9 min, 3 outros falantes (E e F viram B e C): cabe no limite de 4 do Sortformer.
  curta: { parts: [[1]], voices: [{ A: "voce", B: "joana", C: "luiz", D: "tiago", E: "joana", F: "luiz" }], echo: false, seed: 7 },
  // A mesma, com o som da reunião vazando no mic (alto-falante, sem fone).
  "curta-eco": { parts: [[1]], voices: [{ A: "voce", B: "joana", C: "luiz", D: "tiago", E: "joana", F: "luiz" }], echo: true, seed: 7 },
  // ~30 min, 5 outros falantes: passa do limite do Sortformer. A 2ª volta troca quem diz cada fala.
  longa: {
    parts: [[1, 2], [1, 2]],
    voices: [
      { A: "voce", B: "joana", C: "luiz", D: "tiago", E: "bia", F: "rita" },
      { A: "voce", B: "rita", C: "bia", D: "joana", E: "luiz", F: "tiago" },
    ],
    echo: false,
    seed: 11,
  },
};

function parse(): Line[] {
  let part: 1 | 2 = 1;
  const lines: Line[] = [];
  for (const raw of readFileSync(join(HERE, "dialogo.txt"), "utf8").split("\n")) {
    if (raw.startsWith("# --- Segunda parte")) part = 2;
    const m = raw.match(/^([A-F]): (.+)$/);
    if (m) lines.push({ part, role: m[1] as Role, text: m[2].trim() });
  }
  return lines;
}

/** Um gerador pseudo-aleatório pequeno (mulberry32): a mesma semente, a mesma reunião. */
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

/** Lê um WAV PCM 16-bit mono e devolve as amostras em Float. */
function readWav(path: string): Float32Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`sem bloco data: ${path}`);
}

function cachePath(person: string, text: string) {
  const p = PEOPLE[person];
  const key = createHash("sha1").update(`${p.voice}|${p.pitch}|${p.rate}\n${text}`).digest("hex").slice(0, 16);
  return join(CACHE, `${key}.wav`);
}

/** Fala, de uma vez, tudo o que ainda não está no cache (o tts.swift em arquivo; nunca toca som). */
function synthesize(items: { person: string; text: string }[]) {
  const jobs = items
    .map(({ person, text }) => ({ ...PEOPLE[person], text, out: cachePath(person, text) }))
    .filter((j, i, all) => !existsSync(j.out) && all.findIndex((k) => k.out === j.out) === i);
  if (!jobs.length) return;
  const tts = join(OUT, "tts");
  if (!existsSync(tts)) {
    const b = Bun.spawnSync(["swiftc", "-O", join(HERE, "tts.swift"), "-o", tts]);
    if (b.exitCode !== 0) throw new Error(`swiftc tts.swift: ${b.stderr.toString()}`);
  }
  console.log(`falando ${jobs.length} linhas…`);
  const r = Bun.spawnSync([tts], { stdin: Buffer.from(JSON.stringify(jobs)) });
  if (r.exitCode !== 0) throw new Error(`tts falhou: ${r.stderr.toString()}`);
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

export function build(name: string) {
  const cfg = MEETINGS[name];
  if (!cfg) throw new Error(`reunião desconhecida: ${name} (${Object.keys(MEETINGS).join(", ")})`);
  const all = parse();
  synthesize(cfg.parts.flatMap((parts, round) => all.filter((l) => parts.includes(l.part)).map((l) => ({ person: (cfg.voices[round] ?? cfg.voices[0])[l.role], text: l.text }))));
  const rand = rng(cfg.seed);
  const turns: Turn[] = [];
  const clips: { at: number; ch: 0 | 1; pcm: Float32Array }[] = [];
  let t = 0.6;
  let prev: Turn | undefined;
  cfg.parts.forEach((parts, round) => {
    const voices = cfg.voices[round] ?? cfg.voices[0];
    for (const line of all.filter((l) => parts.includes(l.part))) {
      const voice = voices[line.role];
      const pcm = reshape(readWav(cachePath(voice, line.text)), PEOPLE[voice].shift);
      const channel = line.role === "A" ? "voce" : "sistema";
      // Pausa de 0,25 a 0,9 s; às vezes (8%) a fala entra 0,3 s antes da anterior acabar, como numa conversa.
      let start = t + 0.25 + rand() * 0.65;
      if (prev && prev.voice !== voice && rand() < 0.08) start = Math.max(prev.start + 0.5, prev.end - 0.3);
      const end = start + pcm.length / RATE;
      const turn: Turn = { start: +start.toFixed(3), end: +end.toFixed(3), channel, speaker: voice, voice, text: line.text };
      turns.push(turn);
      clips.push({ at: start, ch: channel === "voce" ? 0 : 1, pcm });
      t = Math.max(t, end);
      prev = turn;
    }
  });
  const total = Math.ceil((t + 1) * RATE);
  const ch = [new Float32Array(total), new Float32Array(total)];
  for (const c of clips) {
    const o = Math.round(c.at * RATE);
    for (let i = 0; i < c.pcm.length && o + i < total; i++) ch[c.ch][o + i] += c.pcm[i] * 0.8;
  }
  if (cfg.echo) {
    // Alto-falante sem fone: a reunião vaza no mic, 40 ms depois e a 20% do volume.
    const d = Math.round(0.04 * RATE);
    for (let i = d; i < total; i++) ch[0][i] += ch[1][i - d] * 0.2;
  }
  writeStereoWav(join(OUT, `${name}.wav`), ch[0], ch[1]);
  writeFileSync(join(OUT, `${name}.truth.json`), JSON.stringify({ name, seconds: +(total / RATE).toFixed(1), turns }, null, 1));
  const speakers = new Set(turns.filter((x) => x.channel === "sistema").map((x) => x.speaker));
  console.log(`${name}: ${(total / RATE / 60).toFixed(1)} min, ${turns.length} falas, ${speakers.size} outros falantes${cfg.echo ? ", com eco" : ""}`);
}

if (import.meta.main) {
  mkdirSync(CACHE, { recursive: true });
  const which = process.argv.slice(2);
  for (const name of which.length ? which : Object.keys(MEETINGS)) build(name);
}
