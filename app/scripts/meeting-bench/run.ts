// Roda o banco das reuniões (T20237, spec #20181) etapa por etapa e escreve o relatório. Pesado: pegue o bench antes
// (`kiwi lock bench --ttl 10m --wait 30m`). Com `--lock`, o script pega o bench a cada etapa e solta no fim dela; só pede
// de novo depois que outro pegou e soltou, ou com 5 min livre e ninguém na fila (a fila nem sempre espera ativa).
//
//   bun scripts/meeting-bench/prepare.ts && bun scripts/meeting-bench/build.ts
//   bun scripts/meeting-bench/run.ts [--lock] [--only say,mls] [--force]
//
// As etapas, sobre a mesma reunião:
// - batch:   o Parakeet no arquivo inteiro de cada canal (`--meeting --asr batch`): o teto do modelo, sem streaming.
// - stream:  o streaming sozinho, como no app (janela de 11 s + 2 s + 2 s; `--meeting --asr stream`).
// - live:    o pipeline da reunião inteiro, como o app roda (`--meeting-live`): os dois streamings, o filtro de eco,
//            a diarização, os `segment` finais.
// - live48k: o mesmo, com a captura no meio: cada canal sobe a 48 kHz e volta pelo `Resampler` do app, em 10 ms.
// - livept:  o mesmo, com a língua (`--language pt`) que o app não passa.
// - livefalante: o mesmo no limpo, com o filtro de eco ligado (`--output speaker`): sem eco no áudio, o filtro não pode
//            tirar nada do canal "você" (T20750).
// - nota:    os `segment` do `live` pela escrita da nota (`nota.ts`).
// - wsmall, wturbo: os candidatos a modelo de reunião (#20494), em batch no fim, no canal inteiro (`--meeting --whisper`):
//            o Whisper small do modo preciso e o Whisper large-v3 turbo. Rodam no limpo, no eco e no ruído.
// - batchvad, wsmallvad, wturbovad: os mesmos, só na fala que o Silero acha (`--chunk-vad`), um pedaço por vez. Sem o
//            VAD, nos silêncios longos de cada canal, o Whisper pula trechos e inventa texto (no MLS, o turbo vai de 6,7% a
//            12,6%); o Parakeet em batch roda com e sem, para a diferença ser do modelo e não do VAD (#20668).
// No `limpo` rodam todas; nas variantes de captura (eco, ruído, baixo), só o caminho do app (live e nota), e o eco também
// roda o livedic (a correção fonética não pode trocar eco por um termo do dicionário, T22375). O `eco` roda
// com `--output speaker` (o filtro de eco ligado, como sem fone); o resto com `headphones`.
// - livedic, batchdic, batchvaddic: os mesmos com o dicionário da pessoa (`DICTIONARY`, `--dictionary`), só a correção
//            fonética do texto, que o app já faz na reunião (T22375).
// - batchctc, batchvadctc: e o CTC antes dela, como no ditado: os termos achados no áudio de cada pedaço (`--ctc`).
// Tudo fica em `<banco>/resultados/`, fora do repo; o relatório também (`relatorio.md`), e só ele se cola no thread.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Truth } from "./build.ts";
import { BENCH, CANDIDATES, MODELS } from "./prepare.ts";
import { DICTIONARY, score, type TurnScore } from "./score.ts";

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : null;
const HELPER = resolve(import.meta.dir, "../../../native/.build/release/kiwi-helper");
if (!existsSync(HELPER)) throw new Error(`sem o helper: cd native && swift build -c release --product kiwi-helper`);

const MEETINGS = join(BENCH, "reunioes");
const OUT = join(BENCH, "resultados");
mkdirSync(OUT, { recursive: true });

const STAGES = ["batch", "stream", "live", "live48k", "livept", "livefalante", "nota", "wsmall", "wturbo", "batchvad", "wsmallvad", "wturbovad",
  "livedic", "batchdic", "batchctc", "batchvaddic", "batchvadctc"] as const;
const VOCAB: Stage[] = ["live", "livedic", "batch", "batchdic", "batchctc", "batchvad", "batchvaddic", "batchvadctc"];
const DICT = join(BENCH, "dicionario.txt");
writeFileSync(DICT, `${DICTIONARY.join("\n")}\n`);
type Stage = (typeof STAGES)[number];
const helperArgs = (stage: Stage, wav: string, variant: string): string[] | null => {
  const output = ["--output", variant === "eco" ? "speaker" : "headphones"];
  switch (stage) {
    case "batch": return ["--meeting", wav, "--asr", "batch", "--diarizer", "none"];
    case "batchvad": return ["--meeting", wav, "--asr", "batch", "--chunk-vad", "--diarizer", "none"];
    case "stream": return ["--meeting", wav, "--asr", "stream", "--diarizer", "none"];
    case "live": return ["--meeting-live", wav, ...output];
    case "live48k": return ["--meeting-live", wav, ...output, "--capture", "48000"];
    case "livept": return ["--meeting-live", wav, ...output, "--language", "pt"];
    case "livefalante": return ["--meeting-live", wav, "--output", "speaker"];
    case "livedic": return ["--meeting-live", wav, ...output, "--dictionary", DICT];
    case "batchdic": return ["--meeting", wav, "--asr", "batch", "--diarizer", "none", "--dictionary", DICT];
    case "batchctc": return ["--meeting", wav, "--asr", "batch", "--diarizer", "none", "--dictionary", DICT, "--ctc"];
    case "batchvaddic": return ["--meeting", wav, "--asr", "batch", "--chunk-vad", "--diarizer", "none", "--dictionary", DICT];
    case "batchvadctc": return ["--meeting", wav, "--asr", "batch", "--chunk-vad", "--diarizer", "none", "--dictionary", DICT, "--ctc"];
    case "nota": return null;
    case "wsmall": case "wturbo": case "wsmallvad": case "wturbovad": {
      const m = CANDIDATES.find((c) => c.stage === stage.replace(/vad$/, ""))!;
      return ["--meeting", wav, "--whisper", join(MODELS, m.file), ...(stage.endsWith("vad") ? ["--chunk-vad"] : []), "--diarizer", "none"];
    }
  }
};
const stagesFor = (variant: string): Stage[] =>
  variant === "limpo" ? [...STAGES] : variant === "baixo" ? ["live", "nota"] : [...(variant === "eco" ? ["livedic"] as Stage[] : []), "live", "nota", "batch", "wsmall", "wturbo", "batchvad", "wsmallvad", "wturbovad"];

const names = readdirSync(MEETINGS).filter((f) => f.endsWith(".truth.json")).map((f) => f.replace(/\.truth\.json$/, ""))
  .filter((n) => !only || only.includes(n.split(".")[0]!) || only.includes(n.split(".")[0]!.replace(/-\d+$/, "")))
  .sort();

for (const name of names) {
  const variant = name.split(".")[1]!;
  for (const stage of stagesFor(variant)) {
    const out = join(OUT, `${name}.${stage}.jsonl`);
    if (existsSync(out) && !flag("--force")) continue;
    if (flag("--lock") && stage !== "nota") {
      const l = spawnSync("kiwi", ["lock", "bench", "--ttl", "10m", "--wait", "30m"], { stdio: "ignore" });
      if (l.status !== 0) throw new Error("sem o bench (kiwi lock bench)");
    }
    const began = Date.now();
    const r = stage === "nota"
      ? spawnSync("bun", [join(import.meta.dir, "nota.ts"), join(OUT, `${name}.live.jsonl`)], { maxBuffer: 1 << 28 })
      : spawnSync(HELPER, helperArgs(stage, join(MEETINGS, `${name}.wav`), variant)!, { maxBuffer: 1 << 28 });
    // Uma etapa por vez com o bench: entre elas, a vez é de quem está na fila.
    // E uma pausa antes de pedir de novo: sem ela, o próximo da fila não chega a pegar.
    if (flag("--lock") && stage !== "nota") {
      // Solta o bench e só volta para a fila quando ninguém mais espera por ele: quem pediu entra antes da próxima etapa.
      spawnSync("kiwi", ["unlock", "bench"], { stdio: "ignore" });
      // Quem está na fila nem sempre espera ativo: volta só depois que outro pegou e soltou, ou com 5 min livre e ninguém na fila.
      let other = false, free = 0;
      for (let i = 0; i < 720; i++) {
        Bun.sleepSync(10_000);
        const line = spawnSync("kiwi", ["status"]).stdout.toString().split("\n").find((l) => l.includes("bench:")) ?? "";
        const held = /bench: [a-z-]+, \d+m left/.test(line);
        if (held) { other = true; free = 0; continue; }
        free += 10;
        // Livre com fila: quem está nela ainda não pegou; espera, mas não mais que 5 min.
        if (free >= 300 || (other && !line.includes("next:"))) break;
      }
    }
    if (r.status !== 0) {
      console.error(`${name} ${stage}: falhou (${r.status}): ${r.stderr?.toString().slice(-300)}`);
      continue;
    }
    writeFileSync(out, r.stdout);
    console.error(`${name} ${stage}: ${((Date.now() - began) / 1000).toFixed(0)} s`);
  }
}

// ---------------------------------------------------------------- relatório

type Row = ReturnType<typeof score> & { errors: number; ref: number; turns: TurnScore[] };
const rows = new Map<string, Row>();
for (const name of names) for (const stage of STAGES) {
  const f = join(OUT, `${name}.${stage}.jsonl`);
  if (existsSync(f)) rows.set(`${name}.${stage}`, score(join(MEETINGS, `${name}.truth.json`), f) as Row);
}
const truthOf = (name: string) => JSON.parse(readFileSync(join(MEETINGS, `${name}.truth.json`), "utf8")) as Truth;
const sources = [...new Set(names.map((n) => truthOf(n).source))];
const meetingsOf = (source: string, variant: string) => names.filter((n) => n.endsWith(`.${variant}`) && truthOf(n).source === source);
/** WER de uma fonte numa etapa: os erros somados sobre as palavras somadas das reuniões dela. */
const werOf = (source: string, variant: string, stage: Stage, key: "errors" | "echo_words" = "errors") => {
  const rs = meetingsOf(source, variant).map((n) => rows.get(`${n}.${stage}`)).filter(Boolean) as Row[];
  if (!rs.length) return "—";
  if (key === "echo_words") return String(rs.reduce((s, r) => s + (r.echo_words as number), 0));
  return `${((rs.reduce((s, r) => s + r.errors, 0) / rs.reduce((s, r) => s + r.ref, 0)) * 100).toFixed(1)}%`;
};
const minutes = (source: string) => meetingsOf(source, "limpo").reduce((s, n) => s + truthOf(n).seconds, 0) / 60;
const LABEL: Record<string, string> = { say: "say (roteiro, sintético)", mls: "MLS (leitura)", coraa: "CORAA (espontânea)" };

const md: string[] = [];
md.push("**WER por etapa** (limpo; erros somados sobre as palavras de cada fonte)", "");
const PATH = STAGES.filter((st) => !st.startsWith("w") && !st.endsWith("vad") && !VOCAB.slice(1).includes(st) || st === "batch");
md.push(`| Fonte | min | ${PATH.join(" | ")} |`, `|---|---|${PATH.map(() => "---").join("|")}|`);
for (const s of sources) md.push(`| ${LABEL[s] ?? s} | ${minutes(s).toFixed(1)} | ${PATH.map((st) => werOf(s, "limpo", st)).join(" | ")} |`);
md.push("", "**Captura** (live → nota; e as palavras de eco no canal você)", "");
const variants = ["limpo", "eco", "ruido", "baixo"];
md.push(`| Fonte | ${variants.join(" | ")} | eco: palavras |`, `|---|${variants.map(() => "---").join("|")}|---|`);
for (const s of sources) md.push(`| ${LABEL[s] ?? s} | ${variants.map((v) => `${werOf(s, v, "live")} → ${werOf(s, v, "nota")}`).join(" | ")} | ${werOf(s, "limpo", "live", "echo_words")} → ${werOf(s, "eco", "live", "echo_words")} |`);
md.push("", "**Modelo de reunião** (batch no fim; WER limpo / eco / ruído; o tempo é o de processamento sobre o de áudio, os dois canais)", "");
const statsOf = (stage: Stage) => names.filter((n) => n.endsWith(".limpo")).map((n) => join(OUT, `${n}.${stage}.jsonl`)).filter(existsSync)
  .map((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.type === "stats")).filter(Boolean);
const cands: { stage: Stage; label: string; mb: number }[] = [
  { stage: "live", label: "Parakeet ao vivo (o de hoje)", mb: 0 },
  { stage: "batch", label: "Parakeet, batch", mb: 0 },
  { stage: "batchvad", label: "Parakeet, batch + VAD", mb: 0 },
  ...CANDIDATES.flatMap((c) => ["", "vad"].map((v) => ({ stage: `${c.stage}${v}` as Stage, label: `${c.file.replace(/\.gguf$/, "")}${v ? " + VAD" : ""}`,
    mb: existsSync(join(MODELS, c.file)) ? Bun.file(join(MODELS, c.file)).size / 1e6 : NaN }))),
];
md.push(`| Modelo | download | ${sources.map((s) => LABEL[s] ?? s).join(" | ")} | tempo/áudio | memória |`, `|---|---|${sources.map(() => "---").join("|")}|---|---|`);
for (const c of cands) {
  const st = statsOf(c.stage);
  const audio = st.reduce((a, x) => a + x.audioSeconds, 0), wall = st.reduce((a, x) => a + x.wallSeconds, 0);
  const peak = Math.max(0, ...st.map((x) => x.peakFootprintMB ?? 0));
  const cells = sources.map((s) => ["limpo", "eco", "ruido"].map((v) => werOf(s, v, c.stage)).join(" / "));
  const time = c.stage === "live" ? "ao vivo" : audio ? (wall / audio).toFixed(3) : "—";
  md.push(`| ${c.label} | ${c.mb ? `${c.mb.toFixed(0)} MB` : "já vem"} | ${cells.join(" | ")} | ${time} | ${peak ? `${peak.toFixed(0)} MB` : "—"} |`);
}
const say = STAGES.map((st) => rows.get(`say.limpo.${st}`)).filter(Boolean) as Row[];
if (say.length) {
  md.push("", "**Termos do roteiro** (nomes, números, palavras de padaria)", "");
  md.push(`| ${STAGES.join(" | ")} |`, `|${STAGES.map(() => "---").join("|")}|`);
  md.push(`| ${STAGES.map((st) => { const r = rows.get(`say.limpo.${st}`); return r ? `${r.terms}%` : "—"; }).join(" | ")} |`);
  const missed = rows.get("say.limpo.live")?.terms_missed as string[] | undefined;
  if (missed?.length) md.push("", `No live, faltaram: ${missed.join(", ")}.`);
}
// T22375: o dicionário da pessoa. WER no limpo, e quantos dos termos do dicionário saem certos no say.
if (VOCAB.some((st) => names.some((n) => rows.has(`${n}.${st}`) && st.match(/dic|ctc/)))) {
  md.push("", "**Vocabulário da pessoa** (WER no limpo; `dic` = a correção fonética que o app já faz, `ctc` = o CTC antes dela)", "");
  md.push(`| Fonte | ${VOCAB.join(" | ")} |`, `|---|${VOCAB.map(() => "---").join("|")}|`);
  for (const s of sources) md.push(`| ${LABEL[s] ?? s} | ${VOCAB.map((st) => werOf(s, "limpo", st)).join(" | ")} |`);
  md.push(`| say: termos do dicionário | ${VOCAB.map((st) => { const r = rows.get(`say.limpo.${st}`); return r?.dict != null ? `${r.dict}%` : "—"; }).join(" | ")} |`);
  for (const st of VOCAB) {
    const m = rows.get(`say.limpo.${st}`)?.dict_missed as string[] | undefined;
    if (m?.length) md.push("", `${st}, faltaram: ${m.join(", ")}.`);
  }
  // No eco (o filtro ligado, `--output speaker`), a correção não pode trocar uma palavra de eco por um termo do dicionário.
  if (names.some((n) => rows.has(`${n}.livedic`) && n.endsWith(".eco"))) {
    md.push("", "**Vocabulário no eco** (`--output speaker`; WER, palavras de eco no canal \"você\" e, no say, os termos)", "");
    md.push("| Fonte | WER live | WER livedic | palavras de eco, live | palavras de eco, livedic |", "|---|---|---|---|---|");
    for (const s of sources) md.push(`| ${LABEL[s] ?? s} | ${werOf(s, "eco", "live")} | ${werOf(s, "eco", "livedic")} | ${werOf(s, "eco", "live", "echo_words")} | ${werOf(s, "eco", "livedic", "echo_words")} |`);
    const t = (st: Stage) => { const r = rows.get(`say.eco.${st}`); return r?.dict != null ? `${r.dict}%` : "—"; };
    md.push(`| say: termos do dicionário | ${t("live")} | ${t("livedic")} | | |`);
  }
}
md.push("", "**Piores falas** (live, limpo; só o ID e as palavras erradas, `ref→asr`, `−` faltou, `+` sobrou)", "");
const worst = names.filter((n) => n.endsWith(".limpo")).flatMap((n) => rows.get(`${n}.live`)?.turns ?? [])
  .filter((t) => t.ref >= 5).sort((a, b) => b.errors / b.ref - a.errors / a.ref || b.errors - a.errors);
// Do CORAA (#20392), nada que reconstrua a fala: só falas longas (12+ palavras) e no máximo 5 palavras erradas de cada.
for (const s of sources) {
  const max = s === "coraa" ? 5 : 10;
  for (const t of worst.filter((t) => t.source === s && (s !== "coraa" || t.ref >= 12)).slice(0, 4))
    md.push(`- ${s} \`${t.id}\` (${t.channel}): ${t.errors}/${t.ref} — ${t.wrong.slice(0, max).join(", ")}${t.wrong.length > max ? ", …" : ""}`);
}
const report = md.join("\n") + "\n";
writeFileSync(join(OUT, "relatorio.md"), report);
console.log(report);
