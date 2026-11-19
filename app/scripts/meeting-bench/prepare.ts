// O banco de teste das reuniões (T20237, spec #20181): baixa e prepara as falas, sempre FORA do repo.
//
//   bun scripts/meeting-bench/prepare.ts [say] [mls] [coraa]     # sem nada, os três
//
// A pasta é `~/Library/Caches/kiwinotes-bench/meetings` (ou `KIWI_MEETING_BENCH`). Cada fonte vira WAVs de 16 kHz mono
// e um `clips.jsonl` ({ source, id, speaker, group, text, wav, seconds }), que o `build.ts` junta em reuniões.
// - say: o `roteiro.txt` (inventado) falado pelo `say -o`, direto em arquivo, sem tocar som. Fala lida e sintética.
// - mls: o Multilingual LibriSpeech em português (CC BY 4.0), parte de teste: leitura de livros, gente de verdade.
// - coraa: o CORAA v1.1 (CC BY-NC-ND 4.0), parte de teste: fala espontânea (entrevistas e conversas). Decisão do harry
//   (#20392): só para medir, sem redistribuir nem treinar, e nenhum áudio ou transcrição dele vai para commit, print,
//   PR ou thread (o relatório mostra o ID do arquivo e as palavras erradas).
// Nada aqui manda dado da pessoa para fora: só baixa arquivos públicos.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const BENCH = resolve(process.env.KIWI_MEETING_BENCH ?? join(homedir(), "Library/Caches/kiwinotes-bench/meetings"));
const REPO = resolve(import.meta.dir, "../../..");
if (BENCH === REPO || BENCH.startsWith(`${REPO}/`)) throw new Error(`o banco não pode ficar dentro do repo: ${BENCH}`);

export interface Clip { source: string; id: string; speaker: string; group: string; text: string; wav: string; seconds: number }

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`${cmd} falhou: ${r.stderr?.toString().slice(-400)}`);
};
/** Qualquer áudio → WAV 16 kHz mono 16-bit (o que o helper lê). */
const toWav16k = (src: string, out: string) => run("ffmpeg", ["-v", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out]);
const seconds = (wav: string) => (statSync(wav).size - 44) / 32_000;
const save = (dir: string, clips: Clip[]) => {
  writeFileSync(join(dir, "clips.jsonl"), clips.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const min = clips.reduce((s, c) => s + c.seconds, 0) / 60;
  console.log(`${dir.split("/").pop()}: ${clips.length} falas, ${min.toFixed(1)} min, ${new Set(clips.map((c) => c.speaker)).size} falantes`);
};

// ---------------------------------------------------------------- say: o roteiro inventado

/**
 * As pessoas do roteiro. As vozes "novelty" do `say` (Reed, Eddy, Shelley…) saem com sotaque inglês e o ASR erra quase
 * tudo (84% no 1º teste): mediriam a voz, não o app. Sobram as naturais, a Luciana (pt-BR) e a Joana (pt-PT); as outras
 * pessoas são a Luciana com o trato vocal esticado ou encolhido (`shift`: abaixo de 1, mais grave), como no bench do
 * T4926. A velocidade (`rate`, palavras por minuto) compensa o `shift`, que também estica o tempo.
 */
const SAY_PEOPLE: Record<string, { voice: string; rate: number; shift: number }> = {
  A: { voice: "Luciana", rate: 180, shift: 1 },
  B: { voice: "Luciana", rate: 220, shift: 0.8 },
  C: { voice: "Joana", rate: 180, shift: 1 },
  D: { voice: "Luciana", rate: 160, shift: 1.15 },
};

export function roteiro(): { role: string; text: string }[] {
  return readFileSync(join(import.meta.dir, "roteiro.txt"), "utf8").split("\n").flatMap((l) => {
    const m = l.match(/^([A-D]): (.+)$/);
    return m ? [{ role: m[1]!, text: m[2]!.trim() }] : [];
  });
}

function prepareSay() {
  const dir = join(BENCH, "say");
  mkdirSync(dir, { recursive: true });
  const clips = roteiro().map(({ role, text }, i) => {
    const wav = join(dir, `${String(i).padStart(3, "0")}-${role}.wav`);
    if (!existsSync(wav)) {
      const p = SAY_PEOPLE[role]!;
      const said = join(dir, "dl", `${String(i).padStart(3, "0")}.wav`);
      mkdirSync(dirname(said), { recursive: true });
      run("say", ["-v", p.voice, "-r", String(p.rate), "--file-format=WAVE", "--data-format=LEI16@16000", "-o", said, text]);
      run("ffmpeg", ["-v", "error", "-y", "-i", said, "-af", `asetrate=${16_000 * p.shift},aresample=16000`, "-ac", "1", "-c:a", "pcm_s16le", wav]);
    }
    return { source: "say", id: `say-${i}`, speaker: role, group: "roteiro", text, wav, seconds: seconds(wav) };
  });
  save(dir, clips);
}

// ---------------------------------------------------------------- mls: leitura, CC BY 4.0

const MLS_ROWS = "https://datasets-server.huggingface.co/rows?dataset=facebook%2Fmultilingual_librispeech&config=portuguese&split=test";

async function prepareMls(speakers = 4, perSpeaker = 8) {
  const dir = join(BENCH, "mls");
  const raw = join(dir, "dl");
  mkdirSync(raw, { recursive: true });
  type Row = { id: string; speaker_id: string | number; transcript: string; audio: { src: string }[] };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${MLS_ROWS}&offset=${offset}&length=100`);
    if (!r.ok) throw new Error(`mls: ${r.status} em offset ${offset}`);
    const page = (await r.json()) as { rows: { row: Row }[]; num_rows_total: number };
    rows.push(...page.rows.map((x) => x.row));
    if (offset + 100 >= page.num_rows_total) break;
  }
  // Os falantes com mais falas, e as falas de cada um em ordem de ID: a mesma escolha toda vez.
  const by = new Map<string, Row[]>();
  for (const row of rows) by.set(String(row.speaker_id), [...(by.get(String(row.speaker_id)) ?? []), row]);
  const chosen = [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, speakers);
  const clips: Clip[] = [];
  for (const [speaker, list] of chosen) {
    for (const row of [...list].sort((a, b) => a.id.localeCompare(b.id)).slice(0, perSpeaker)) {
      const wav = join(dir, `${row.id}.wav`);
      if (!existsSync(wav)) {
        const audio = await fetch(row.audio[0]!.src);
        if (!audio.ok) throw new Error(`mls: áudio ${row.id}: ${audio.status}`);
        const tmp = join(raw, `${row.id}.audio`);
        writeFileSync(tmp, Buffer.from(await audio.arrayBuffer()));
        toWav16k(tmp, wav);
      }
      clips.push({ source: "mls", id: row.id, speaker, group: speaker, text: row.transcript, wav, seconds: seconds(wav) });
    }
  }
  save(dir, clips);
}

// ---------------------------------------------------------------- coraa: fala espontânea, CC BY-NC-ND 4.0, só medir

const CORAA = "https://huggingface.co/datasets/gabrielrstan/CORAA-v1.1/resolve/main";

/** CSV com aspas (o texto do CORAA tem vírgulas). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

/** A gravação de onde saiu cada pedaço: a pasta no NURC, o sufixo no C-ORAL, a sequência de números no SP2010 e no ALIP. */
function recordingOf(file: string, prev?: { file: string; group: string }): string {
  const parts = file.split("/");
  if (file.includes("/NURC_RE/")) return parts[parts.length - 2]!;
  const coral = file.match(/\/\d+_CO_(\w+)\.wav$/);
  if (coral) return coral[1]!;
  const n = Number(file.match(/\/(\d+)_\w+_\.wav$/)?.[1]);
  const p = prev && Number(prev.file.match(/\/(\d+)_\w+_\.wav$/)?.[1]);
  return p && n - p > 0 && n - p <= 3 && dirname(prev!.file) === dirname(file) ? prev!.group : `${parts[1]}-${n}`;
}

/** As fontes de fala espontânea do pt-BR, e quantas gravações de cada (cada uma, até ~4 min de pedaços seguidos). */
const CORAA_PICK: Record<string, number> = { SP2010: 2, "NURC-Recife": 2, ALIP: 2, "C-ORAL-BRASIL I": 2 };

async function prepareCoraa(maxSeconds = 240) {
  const dir = join(BENCH, "coraa");
  const dl = join(dir, "dl");
  const raw = join(dir, "raw");
  mkdirSync(dl, { recursive: true });
  mkdirSync(raw, { recursive: true });
  const meta = join(dl, "metadata_test_final.csv");
  if (!existsSync(meta)) run("curl", ["-fsSL", "-o", meta, `${CORAA}/metadata_test_final.csv`]);
  const zip = join(dl, "test.zip");
  if (!existsSync(zip)) {
    console.log("coraa: baixando o test.zip (2,4 GB)…");
    run("curl", ["-fsSL", "-C", "-", "-o", `${zip}.part`, `${CORAA}/test.zip`]);
    renameSync(`${zip}.part`, zip);
  }
  const rows = parseCsv(readFileSync(meta, "utf8")).filter((r) => r.variety === "pt_br" && /Spontaneous/.test(r.speech_style ?? ""));
  // Os pedaços de cada gravação, na ordem do arquivo; uma gravação boa tem pelo menos 12 pedaços.
  const recordings = new Map<string, { dataset: string; rows: Record<string, string>[] }>();
  let prev: { file: string; group: string } | undefined;
  for (const r of rows) {
    const group = recordingOf(r.file_path!, prev);
    prev = { file: r.file_path!, group };
    const g = recordings.get(group) ?? { dataset: r.dataset!, rows: [] };
    g.rows.push(r);
    recordings.set(group, g);
  }
  const picked: [string, Record<string, string>[]][] = [];
  for (const [dataset, n] of Object.entries(CORAA_PICK)) {
    const all = [...recordings].filter(([, g]) => g.dataset === dataset && g.rows.length >= 12).sort((a, b) => a[0].localeCompare(b[0]));
    // Espalhadas pela lista, e não as primeiras: falantes diferentes.
    for (let i = 0; i < n && all.length; i++) picked.push([all[Math.floor((i * all.length) / n)]![0], all[Math.floor((i * all.length) / n)]![1].rows]);
  }
  const members = picked.flatMap(([, rs]) => rs.map((r) => r.file_path!)).filter((f) => !existsSync(join(raw, f.split("/").pop()!)));
  for (let i = 0; i < members.length; i += 200) run("unzip", ["-o", "-j", "-qq", zip, ...members.slice(i, i + 200), "-d", raw]);
  const clips: Clip[] = [];
  for (const [group, rs] of picked) {
    let total = 0;
    for (const r of rs) {
      if (total >= maxSeconds) break;
      const name = r.file_path!.split("/").pop()!;
      const wav = join(dir, name);
      if (!existsSync(wav)) toWav16k(join(raw, name), wav);
      const s = seconds(wav);
      total += s;
      clips.push({ source: "coraa", id: name.replace(/\.wav$/, ""), speaker: group, group, text: r.text!, wav, seconds: s });
    }
  }
  save(dir, clips);
}

if (import.meta.main) {
  const which = process.argv.slice(2);
  const want = (s: string) => !which.length || which.includes(s);
  mkdirSync(BENCH, { recursive: true });
  if (want("say")) prepareSay();
  if (want("mls")) await prepareMls();
  if (want("coraa")) await prepareCoraa();
  console.log(`pronto em ${BENCH}`);
}
