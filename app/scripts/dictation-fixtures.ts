// Os WAV da bateria do ditado (T1908): cada caso de test/dictation/falados.jsonl vira um áudio sintético, com o `say`
// do macOS (Luciana em pt-BR, Samantha em en-US), numa pasta temporária, e um .jsonl pronto para o
// `cli dictate --batch`, com o `wav` no lugar do `say`. Áudio nunca vai para o repo (AGENTS.md): a pasta é de quem
// chama, fora do worktree.
//
//   bun scripts/dictation-fixtures.ts <pasta-de-saída> [falados.jsonl]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SPOKEN_CASES = path.resolve(import.meta.dir, "../test/dictation/falados.jsonl");
/** Frases sem termo nenhum, separadas das que calibram as travas do boosting (T1973). */
export const FALSE_POSITIVE_CASES = path.resolve(import.meta.dir, "../test/dictation/falsos-positivos.jsonl");
/** Os casos do modo preciso (Whisper small, #7082): rodam à parte, com o modelo já baixado. */
export const PRECISE_CASES = path.resolve(import.meta.dir, "../test/dictation/precisos.jsonl");
const CASES_DIR = path.resolve(import.meta.dir, "../test/dictation");
const VOICES = new Set(["Luciana", "Samantha"]);

/**
 * O quanto o helper ainda grava depois de soltar o atalho (T5456, issue #155): o mesmo `AudioCapture.releaseTail` do
 * Swift (0,25 s). `KIWI_RELEASE_TAIL_MS=0` refaz o caso como era antes, para ver o que o rabo salva.
 */
export const RELEASE_TAIL_MS = Number(process.env.KIWI_RELEASE_TAIL_MS ?? 250);

/**
 * Um caso com `soltouAntesMs` (T5456): a pessoa soltou o atalho esse tanto antes de a fala acabar, a última palavra
 * colada ao soltar. A bateria não usa o mic (AGENTS.md); então o WAV do `say` é cortado onde a gravação de verdade
 * pararia: no fim da fala, menos o que veio antes de soltar, mais o rabo.
 */
export function cutAtRelease(wav: Buffer, soltouAntesMs: number, tailMs = RELEASE_TAIL_MS): Buffer {
  let at = 12;
  while (at + 8 <= wav.length && wav.toString("ascii", at, at + 4) !== "data") at += 8 + wav.readUInt32LE(at + 4);
  if (at + 8 > wav.length) throw new Error("WAV sem o bloco data");
  const start = at + 8;
  const size = wav.readUInt32LE(at + 4);
  const samples = Math.floor(Math.min(size, wav.length - start) / 2);
  // O fim da fala: a última amostra acima do silêncio do `say`.
  let end = samples;
  while (end > 0 && Math.abs(wav.readInt16LE(start + (end - 1) * 2)) < 300) end--;
  const keep = Math.max(0, Math.min(samples, end - Math.round(((soltouAntesMs - tailMs) * 16_000) / 1000)));
  const out = Buffer.from(wav.subarray(0, start + keep * 2));
  out.writeUInt32LE(keep * 2, at + 4);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

/**
 * O WAV mais baixo e com chiado (#7082): cada amostra vezes `volume`, mais ruído branco gaussiano de desvio `noise`
 * (em unidades de 16 bits). É o mic longe da boca numa sala com ventilador: com ele, um ditado de mais de 30 s perdia
 * um bloco no modo preciso, e com o áudio limpo do `say`, não. A semente é fixa: o mesmo WAV a cada rodada.
 */
export function withNoise(wav: Buffer, volume: number, noise: number, seed = 1): Buffer {
  let at = 12;
  while (at + 8 <= wav.length && wav.toString("ascii", at, at + 4) !== "data") at += 8 + wav.readUInt32LE(at + 4);
  if (at + 8 > wav.length) throw new Error("WAV sem o bloco data");
  const start = at + 8;
  const samples = Math.floor(Math.min(wav.readUInt32LE(at + 4), wav.length - start) / 2);
  // mulberry32 e Box-Muller: um gerador pequeno e igual em qualquer máquina.
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  const out = Buffer.from(wav);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(wav.readInt16LE(start + i * 2) * volume + gauss() * noise);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), start + i * 2);
  }
  return out;
}

export interface SpokenCase {
  name: string;
  /** O que o `say` fala; ou `sayFile`, um texto de test/dictation (os longos). */
  say?: string;
  sayFile?: string;
  voice: string;
  /** Com `noise`, o áudio sai mais baixo e com chiado (`withNoise`). */
  volume?: number;
  noise?: number;
  [field: string]: unknown;
}

/** Lê o .jsonl dos casos falados (linhas `//` são comentário). Um caso torto diz a linha. */
export function loadSpoken(file = SPOKEN_CASES): SpokenCase[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, n) => [line.trim(), n + 1] as const)
    .filter(([line]) => line && !line.startsWith("//"))
    .map(([line, n]) => {
      const c = JSON.parse(line) as SpokenCase;
      const said = typeof c.say === "string" && c.say.trim() !== "";
      const fromFile = typeof c.sayFile === "string" && existsSync(path.join(CASES_DIR, c.sayFile));
      if (typeof c.name !== "string" || said === fromFile) throw new Error(`${file}:${n}: precisa de name e de say ou sayFile (um arquivo de test/dictation)`);
      if (!VOICES.has(c.voice)) throw new Error(`${file}:${n}: voice é Luciana ou Samantha (veio ${c.voice})`);
      if ("wav" in c || "text" in c) throw new Error(`${file}:${n}: o caso falado tem say, não wav nem text`);
      return c;
    });
}

/** As vozes que faltam neste Mac (Ajustes › Acessibilidade › Conteúdo falado › Voz do sistema › Gerenciar vozes). */
export function missingVoices(cases: SpokenCase[]): string[] {
  const r = spawnSync("say", ["-v", "?"], { encoding: "utf8" });
  if (r.status !== 0) return [...new Set(cases.map((c) => c.voice))];
  const have = new Set(r.stdout.split("\n").map((l) => l.split(/\s{2,}|\s\(/)[0]!.trim()));
  return [...new Set(cases.map((c) => c.voice))].filter((v) => !have.has(v));
}

/** Gera um WAV por caso (16 kHz, mono, 16 bits) e o .jsonl do batch. Devolve o caminho do .jsonl. */
export function makeFixtures(outDir: string, cases: SpokenCase[]): string {
  mkdirSync(outDir, { recursive: true });
  const lines = cases.map((c, i) => {
    const wav = path.join(outDir, `${String(i + 1).padStart(2, "0")}.wav`);
    const what = c.sayFile ? ["-f", path.join(CASES_DIR, c.sayFile)] : [c.say!];
    const r = spawnSync("say", ["-v", c.voice, "-o", wav, "--file-format=WAVE", "--data-format=LEI16@16000", ...what], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`say (${c.voice}) falhou em "${c.name}": ${(r.stderr || "").trim()}`);
    if (typeof c.soltouAntesMs === "number") writeFileSync(wav, cutAtRelease(readFileSync(wav), c.soltouAntesMs));
    if (typeof c.noise === "number") writeFileSync(wav, withNoise(readFileSync(wav), c.volume ?? 1, c.noise));
    // O `known` é da bateria (scripts/test-dictation.ts), não do pedido do dictate.
    const { say: _say, sayFile: _file, voice: _voice, known: _known, soltouAntesMs: _solta, volume: _volume, noise: _noise, ...request } = c;
    return JSON.stringify({ ...request, wav });
  });
  const batch = path.join(outDir, "falados.batch.jsonl");
  writeFileSync(batch, `${lines.join("\n")}\n`);
  return batch;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: bun scripts/dictation-fixtures.ts <pasta-de-saída> [falados.jsonl]");
    process.exit(2);
  }
  const cases = loadSpoken(process.argv[3] ? path.resolve(process.argv[3]) : SPOKEN_CASES);
  const missing = missingVoices(cases);
  if (missing.length) {
    console.error(`faltam as vozes ${missing.join(", ")} do say`);
    process.exit(1);
  }
  console.log(makeFixtures(path.resolve(out), cases));
}
