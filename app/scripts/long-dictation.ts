// A medida do ditado longo (T6580, L13, issue 164): o FluidAudio corta o áudio em janelas de 15 s, e a doc dele avisa
// que a emenda pode perder palavra. Cada texto de test/dictation/longos/ vira um WAV com o `say` (60 a 135 s), é
// transcrito inteiro e também frase a frase pelo `kiwi-helper --transcribe`, e o relatório diz as palavras perdidas e
// trocadas só no longo, e a que distância da emenda de 15 s mais perto elas ficam. Sem mic: só áudio sintético.
//
//   bun scripts/long-dictation.ts [--rate 175] [--vad] [--out pasta]
//
// Pegue `kiwi lock bench` antes (AGENTS.md). O helper vem de KIWI_HELPER ou de native/.build/release.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const WINDOW_S = 15;

export type Op = { kind: "ok" | "sub" | "del" | "ins"; ref: number; word: string; heard: string | null };

export const words = (text: string): string[] =>
  text
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** O alinhamento palavra a palavra (Levenshtein), com o caminho: o que casou, trocou, sumiu ou sobrou. */
export function align(ref: readonly string[], hyp: readonly string[]): { errors: number; ops: Op[] } {
  const n = ref.length;
  const m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ kind: ref[i - 1] === hyp[j - 1] ? "ok" : "sub", ref: i - 1, word: ref[i - 1]!, heard: hyp[j - 1]! });
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      ops.push({ kind: "del", ref: i - 1, word: ref[i - 1]!, heard: null });
      i--;
    } else {
      ops.push({ kind: "ins", ref: i, word: "", heard: hyp[j - 1]! });
      j--;
    }
  }
  return { errors: d[n]![m]!, ops: ops.reverse() };
}

export interface SeamReport {
  words: number;
  seconds: number;
  errors: number;
  baselineErrors: number;
  /** As palavras perdidas no longo que o frase a frase não perdeu, com o segundo aproximado e a distância da emenda. */
  lost: { word: string; at: number; fromSeam: number }[];
}

/**
 * O que o longo errou e o frase a frase não: isso é o que a emenda (ou o contexto longo) causou. O segundo de cada
 * palavra é proporcional à posição no texto (o `say` fala num ritmo quase constante).
 */
export function seamReport(reference: string, long: string, baseline: string, seconds: number): SeamReport {
  const ref = words(reference);
  const l = align(ref, words(long));
  const b = align(ref, words(baseline));
  const missedByBaseline = new Set(b.ops.filter((o) => o.kind === "del" || o.kind === "sub").map((o) => o.ref));
  const lost = l.ops
    .filter((o) => o.kind === "del" && !missedByBaseline.has(o.ref))
    .map((o) => {
      const at = (o.ref / Math.max(ref.length, 1)) * seconds;
      return { word: o.word, at: Math.round(at * 10) / 10, fromSeam: Math.round(Math.abs(at - Math.round(at / WINDOW_S) * WINDOW_S) * 10) / 10 };
    });
  return { words: ref.length, seconds: Math.round(seconds), errors: l.errors, baselineErrors: b.errors, lost };
}

export const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

function main(): void {
  const args = process.argv.slice(2);
  const rate = args.includes("--rate") ? Number(args[args.indexOf("--rate") + 1]) : 175;
  const vad = args.includes("--vad");
  const helper = process.env.KIWI_HELPER ?? path.resolve(import.meta.dirname, "..", "..", "native", ".build", "release", "kiwi-helper");
  if (!existsSync(helper)) throw new Error(`no kiwi-helper at ${helper}: run \`swift build -c release\` in native/`);
  const textsDir = path.resolve(import.meta.dirname, "..", "test", "dictation", "longos");
  const out = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]!) : mkdtempSync(path.join(tmpdir(), "kiwi-longos-"));
  mkdirSync(out, { recursive: true });
  const wav = (name: string, text: string): string => {
    const aiff = path.join(out, `${name}.aiff`);
    const file = path.join(out, `${name}.wav`);
    execFileSync("say", ["-v", "Luciana", "-r", String(rate), "-o", aiff, text]);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, file]);
    rmSync(aiff);
    return file;
  };
  const texts = readdirSync(textsDir).filter((f) => f.endsWith(".txt")).sort();
  const jobs = texts.map((f) => {
    const text = readFileSync(path.join(textsDir, f), "utf8").trim();
    const name = f.replace(/\.txt$/, "");
    return { name, text, long: wav(name, text), parts: sentences(text).map((s, i) => wav(`${name}-${String(i).padStart(2, "0")}`, s)) };
  });
  const files = jobs.flatMap((j) => [j.long, ...j.parts]);
  const lines = execFileSync(helper, ["--transcribe", ...files, ...(vad ? ["--vad"] : [])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as { file: string; text: string; durationMs: number });
  const byFile = new Map(lines.map((l) => [l.file, l]));
  const reports = jobs.map((j) => {
    const long = byFile.get(path.basename(j.long))!;
    const baseline = j.parts.map((p) => byFile.get(path.basename(p))?.text ?? "").join(" ");
    return { name: j.name, ...seamReport(j.text, long.text, baseline, long.durationMs / 1000) };
  });
  console.log(JSON.stringify({ rate, vad, window: WINDOW_S, reports }, null, 2));
}

if (import.meta.main) main();
