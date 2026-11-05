// Nota de uma rodada do `kiwi-helper --meeting` (T4926) contra o gabarito do gen.ts.
//
//   bun spikes/meeting-bench/score.ts audio/curta.truth.json results/curta.stream.sortformer.jsonl [...]
//
// Mede, por arquivo de resultado:
// - WER por canal: as palavras do ASR contra o texto do gabarito, em minúsculas e sem pontuação, com os números
//   escritos por extenso (o `say` fala "dez ponto vinte"; o ASR pode escrever "10.20");
// - erro de falante por palavra (WDER) no canal do sistema: cada palavra do ASR recebe o falante da diarização no seu
//   meio, e o rótulo da diarização é casado com o falante real pelo melhor par um-para-um;
// - quantos falantes a diarização achou contra os reais;
// - eco: palavras no canal "você" que caem só dentro de falas do sistema (o som da reunião vazando no mic);
// - atraso até o texto firme (`firmAt - end`), quando a rodada foi em tempo real.
import { readFileSync } from "node:fs";
import type { Turn } from "./gen.ts";

interface Word { type: "word"; channel: "voce" | "sistema"; start: number; end: number; text: string; firmAt?: number }
interface Spk { type: "spk"; speaker: string; start: number; end: number }

const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
  "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0 a 9999 por extenso, no português do Brasil. */
export function extenso(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` e ${UNITS[n % 10]}` : "");
  if (n === 100) return "cem";
  if (n < 1000) return HUNDREDS[Math.floor(n / 100)] + (n % 100 ? ` e ${extenso(n % 100)}` : "");
  const mil = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = mil === 1 ? "mil" : `${extenso(mil)} mil`;
  return rest ? `${head}${rest < 100 || rest % 100 === 0 ? " e" : ""} ${extenso(rest)}` : head;
}

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d+),(\d+)/g, "$1 vírgula $2")
    .replace(/%/g, " por cento")
    .replace(/(\d+)\.(?=\d)/g, "$1 ponto ")
    .replace(/\d+/g, (d) => (d.length <= 4 ? extenso(Number(d)) : d.split("").map((c) => UNITS[+c]).join(" ")))
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Distância de edição em palavras: substituições, apagadas e inseridas. */
export function wer(ref: string[], hyp: string[]) {
  const m = hyp.length;
  let prev = new Uint32Array(m + 1).map((_, j) => j);
  let cur = new Uint32Array(m + 1);
  for (let i = 1; i <= ref.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return { errors: prev[m], ref: ref.length, rate: ref.length ? prev[m] / ref.length : 0 };
}

function at<T extends { start: number; end: number }>(items: T[], t: number): T | undefined {
  return items.find((x) => x.start <= t && t <= x.end);
}

function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function score(truthPath: string, resultPath: string) {
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as { turns: Turn[]; seconds: number };
  const lines = readFileSync(resultPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const words = lines.filter((l) => l.type === "word") as Word[];
  const spks = lines.filter((l) => l.type === "spk") as Spk[];
  const stats = lines.find((l) => l.type === "stats") ?? {};
  const out: Record<string, unknown> = { result: resultPath.split("/").pop(), asr: stats.asr, diarizer: stats.diarizer };

  for (const ch of ["voce", "sistema"] as const) {
    const ref = truth.turns.filter((t) => t.channel === ch).flatMap((t) => normalize(t.text));
    const hyp = words.filter((w) => w.channel === ch).flatMap((w) => normalize(w.text));
    if (hyp.length) out[`wer_${ch}`] = +(wer(ref, hyp).rate * 100).toFixed(1);
  }

  // Falante por palavra, no canal do sistema.
  const sys = truth.turns.filter((t) => t.channel === "sistema");
  if (spks.length) {
    const pairs: [string, string][] = [];
    for (const w of words.filter((w) => w.channel === "sistema")) {
      const mid = (w.start + w.end) / 2;
      const real = at(sys, mid);
      const said = at(spks, mid);
      if (real && said) pairs.push([real.speaker, said.speaker]);
    }
    // O melhor casamento um-para-um, guloso pela contagem (poucos falantes: o guloso basta).
    const counts = new Map<string, number>();
    for (const [r, s] of pairs) counts.set(`${r}|${s}`, (counts.get(`${r}|${s}`) ?? 0) + 1);
    const usedR = new Set<string>(), usedS = new Set<string>();
    let right = 0;
    for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      const [r, s] = k.split("|");
      if (usedR.has(r) || usedS.has(s)) continue;
      usedR.add(r); usedS.add(s); right += n;
    }
    const sysWords = words.filter((w) => w.channel === "sistema").length;
    out.wder = pairs.length ? +((1 - right / pairs.length) * 100).toFixed(1) : null;
    out.words_without_speaker = sysWords ? +((1 - pairs.length / sysWords) * 100).toFixed(1) : null;
    out.speakers_real = new Set(sys.map((t) => t.speaker)).size;
    out.speakers_found = new Set(spks.map((s) => s.speaker)).size;
  }

  // Eco: palavras do canal "você" que só caem dentro de falas do sistema.
  const mine = truth.turns.filter((t) => t.channel === "voce");
  const voceWords = words.filter((w) => w.channel === "voce");
  const leaked = voceWords.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return !at(mine, mid) && at(sys, mid);
  }).length;
  if (voceWords.length) out.echo_words = leaked;

  const lags = words.filter((w) => w.firmAt !== undefined).map((w) => w.firmAt! - w.end);
  if (stats.realtime && lags.length) {
    out.lag_p50 = +quantile(lags, 0.5).toFixed(1);
    out.lag_p90 = +quantile(lags, 0.9).toFixed(1);
  }
  out.audio_min = +(truth.seconds / 60).toFixed(1);
  out.rtf = stats.wallSeconds && !stats.realtime ? +(stats.wallSeconds / stats.audioSeconds).toFixed(3) : undefined;
  out.cpu_pct = stats.cpuSeconds ? +((stats.cpuSeconds / stats.wallSeconds) * 100).toFixed(0) : undefined;
  out.peak_mb = stats.peakFootprintMB ? Math.round(stats.peakFootprintMB) : undefined;
  return out;
}

if (import.meta.main) {
  const [truth, ...results] = process.argv.slice(2);
  if (!truth || !results.length) {
    console.error("uso: bun score.ts <gabarito.truth.json> <resultado.jsonl>…");
    process.exit(2);
  }
  for (const r of results) console.log(JSON.stringify(score(truth, r)));
}
