// A nota de uma rodada do banco das reuniões (T20237, spec #20181) contra o gabarito do `build.ts`. Vem do score.ts do
// T4926 (commit 2d5493a2): o WER por canal, com os números por extenso, e o eco. Novo: o alinhamento palavra a palavra,
// para achar as falas que mais erram e quais palavras, e os termos do roteiro (nomes, números, palavras de padaria).
//
//   bun scripts/meeting-bench/score.ts <reuniao.truth.json> <resultado.jsonl>…
//
// O resultado são as linhas do `kiwi-helper` (`word`, `segment`, `stats`) ou do `nota.ts` (`word`, do texto da nota).
// Do CORAA, o relatório só mostra o ID do arquivo e as palavras erradas, nunca a fala inteira (#20392).
import { readFileSync } from "node:fs";

import type { Truth, Turn } from "./build.ts";

interface Word { type: "word"; channel: "voce" | "sistema"; start: number; end: number; text: string; firmAt?: number }

const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
  "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0 a 999 999 por extenso, no português do Brasil. */
export function extenso(n: number): string {
  if (n < 20) return UNITS[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? ` e ${UNITS[n % 10]}` : "");
  if (n === 100) return "cem";
  if (n < 1000) return HUNDREDS[Math.floor(n / 100)]! + (n % 100 ? ` e ${extenso(n % 100)}` : "");
  const mil = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = mil === 1 ? "mil" : `${extenso(mil)} mil`;
  return rest ? `${head}${rest < 100 || rest % 100 === 0 ? " e" : ""} ${extenso(rest)}` : head;
}

/** Minúsculas, sem pontuação, números por extenso, "catorze" = "quatorze": o ASR e o gabarito escrevem diferente. */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d+),(\d+)/g, "$1 vírgula $2")
    .replace(/%/g, " por cento")
    .replace(/r\$\s*/g, "")
    .replace(/(\d+)h(\d+)?/g, (_, h, m) => `${h} ${m ?? ""}`)
    .replace(/\d+/g, (d) => (d.length <= 6 ? extenso(Number(d)) : d.split("").map((c) => UNITS[+c]).join(" ")))
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "catorze" ? "quatorze" : w));
}

export type Op = { kind: "ok" | "sub" | "del" | "ins"; ref?: string; hyp?: string };

/** Distância de edição em palavras, com o caminho (para dizer quais palavras erraram). */
export function align(ref: string[], hyp: string[]): { errors: number; ops: Op[] } {
  const n = ref.length, m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => new Uint32Array(m + 1).map((_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const ops: Op[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push(ref[i - 1] === hyp[j - 1] ? { kind: "ok", ref: ref[i - 1] } : { kind: "sub", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) { ops.push({ kind: "del", ref: ref[i - 1] }); i--; }
    else { ops.push({ kind: "ins", hyp: hyp[j - 1] }); j--; }
  }
  return { errors: d[n]![m]!, ops: ops.reverse() };
}

/** Só a contagem, em memória linear (as reuniões inteiras têm milhares de palavras). */
export function wer(ref: string[], hyp: string[]) {
  const m = hyp.length;
  let prev = new Uint32Array(m + 1).map((_, j) => j);
  let cur = new Uint32Array(m + 1);
  for (let i = 1; i <= ref.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return { errors: prev[m]!, ref: ref.length, rate: ref.length ? prev[m]! / ref.length : 0 };
}

/** Os termos do roteiro inventado: onde um ASR genérico costuma errar (nomes, números, palavras de fora). */
export const TERMS = ["Ana", "Carla", "Bruno", "Diego", "Elisa", "Mariana", "Joana", "Vila Serena", "levain", "focaccia", "ciabatta",
  "sourdough", "centeio", "alecrim", "broa", "sova", "catorze", "dezoito", "quatro mil e duzentos", "seiscentos e cinquenta",
  "oitenta", "quarenta", "trezentos e doze", "gerador", "contêineres", "voluntários"];

const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
const inside = (t: Turn, w: Word, pad = 0.5) => w.channel === t.channel && mid(w) >= t.start - pad && mid(w) <= t.end + pad;

export interface TurnScore { id: string; source: string; channel: string; ref: number; errors: number; wrong: string[] }

export function score(truthPath: string, resultPath: string) {
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Truth;
  const lines = readFileSync(resultPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const words = lines.filter((l) => l.type === "word") as Word[];
  const stats = lines.find((l) => l.type === "stats") ?? {};
  const out: Record<string, unknown> = { result: resultPath.split("/").pop() };

  let errs = 0, refs = 0;
  for (const ch of ["voce", "sistema"] as const) {
    const ref = truth.turns.filter((t) => t.channel === ch).flatMap((t) => normalize(t.text));
    const hyp = words.filter((w) => w.channel === ch).sort((a, b) => a.start - b.start).flatMap((w) => normalize(w.text));
    const r = wer(ref, hyp);
    out[`wer_${ch}`] = +(r.rate * 100).toFixed(1);
    errs += r.errors; refs += r.ref;
  }
  out.wer = +((errs / refs) * 100).toFixed(1);
  out.errors = errs;
  out.ref = refs;

  // Por fala: as palavras do ASR cujo meio cai nela (com folga de 0,5 s). Uma palavra fica com a fala mais perto.
  const owner = new Map<Word, Turn>();
  for (const w of words) {
    const cands = truth.turns.filter((t) => inside(t, w));
    if (cands.length) owner.set(w, cands.reduce((a, b) => (Math.abs(mid(a) - mid(w)) <= Math.abs(mid(b) - mid(w)) ? a : b)));
  }
  const turns: TurnScore[] = truth.turns.map((t) => {
    const hyp = words.filter((w) => owner.get(w) === t).sort((a, b) => a.start - b.start).flatMap((w) => normalize(w.text));
    const { errors, ops } = align(normalize(t.text), hyp);
    const wrong = ops.filter((o) => o.kind !== "ok").map((o) => (o.kind === "sub" ? `${o.ref}→${o.hyp}` : o.kind === "del" ? `−${o.ref}` : `+${o.hyp}`));
    return { id: t.id, source: t.source, channel: t.channel, ref: normalize(t.text).length, errors, wrong };
  });
  out.turns = turns;

  // Eco: palavras do canal "você" que caem só dentro de falas do sistema.
  const mine = truth.turns.filter((t) => t.channel === "voce");
  const sys = truth.turns.filter((t) => t.channel === "sistema");
  const voce = words.filter((w) => w.channel === "voce");
  out.echo_words = voce.filter((w) => !mine.some((t) => mid(w) >= t.start && mid(w) <= t.end) && sys.some((t) => mid(w) >= t.start && mid(w) <= t.end)).length;

  if (truth.source === "say") {
    const ref = truth.turns.map((t) => normalize(t.text).join(" ")).join(" | ");
    const hyp = words.sort((a, b) => a.start - b.start).flatMap((w) => normalize(w.text)).join(" ");
    const count = (s: string, term: string) => s.split(` ${term} `).length - 1;
    let want = 0, got = 0;
    const missed: string[] = [];
    for (const term of TERMS) {
      const t = normalize(term).join(" ");
      const r = count(` ${ref} `, t), h = Math.min(r, count(` ${hyp} `, t));
      want += r; got += h;
      if (h < r) missed.push(term);
    }
    out.terms = want ? +((got / want) * 100).toFixed(0) : null;
    out.terms_got = got;
    out.terms_want = want;
    out.terms_missed = missed;
  }

  const lags = words.filter((w) => w.firmAt !== undefined).map((w) => w.firmAt! - w.end).sort((a, b) => a - b);
  if (stats.realtime && lags.length) out.lag_p50 = +lags[Math.floor(lags.length / 2)]!.toFixed(1);
  if (stats.wallSeconds && stats.audioSeconds && !stats.realtime) out.rtf = +(stats.wallSeconds / stats.audioSeconds).toFixed(3);
  return out;
}

if (import.meta.main) {
  const [truth, ...results] = process.argv.slice(2);
  if (!truth || !results.length) {
    console.error("uso: bun score.ts <reuniao.truth.json> <resultado.jsonl>…");
    process.exit(2);
  }
  for (const r of results) {
    const { turns: _, ...s } = score(truth, r);
    console.log(JSON.stringify(s));
  }
}
