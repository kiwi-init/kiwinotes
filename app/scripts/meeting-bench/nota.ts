// A última etapa do banco das reuniões (T20237, spec #20181): o texto que fica na nota. Os `segment` de uma rodada do
// `kiwi-helper --meeting-live` passam pelo `MeetingNotes` de verdade (o mesmo do app), num cofre de mentira num tmp; o
// texto da seção Transcrição volta como linhas `word`, que o `score.ts` lê como as do helper.
//
//   bun scripts/meeting-bench/nota.ts <rodada.live.jsonl> > <rodada.nota.jsonl>
//
// A diferença entre o `live` e o `nota` é o que a escrita da nota muda: os pedaços juntados, os vazios e os repetidos
// que saem, o escape do markdown.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MeetingNotes, type MeetingSegment } from "../../src/notes/meetings.ts";
import { Vault } from "../../src/notes/vault.ts";
import { splitMeetingNote } from "../../src/shared/meeting-note.ts";

const [input] = process.argv.slice(2);
if (!input) {
  console.error("uso: bun nota.ts <rodada.live.jsonl>");
  process.exit(2);
}
const segments = readFileSync(input, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.type === "segment");

const dir = mkdtempSync(join(tmpdir(), "kiwi-meeting-bench-"));
try {
  const vault = new Vault({ root: join(dir, "Cofre"), trash: async (abs) => rmSync(abs, { recursive: true, force: true }) });
  await vault.open();
  const start = new Date("2026-01-05T09:00:00Z");
  const notes = new MeetingNotes(vault, { flushMs: 50, now: () => start.getTime() });
  const session = "bench";
  const note = await notes.start(session, "Reunião", start);
  for (const s of segments) {
    const seg: MeetingSegment = { start: s.start, end: s.end, speaker: s.speaker, text: s.text, final: true, channel: s.channel, words: s.words };
    await notes.segment(session, seg);
  }
  const lastEnd = segments.reduce((m, s) => Math.max(m, s.end), 0);
  await notes.finish(session, new Date(start.getTime() + (lastEnd + 1) * 1000));
  const content = (await vault.get(note.path)).content;
  const transcript = splitMeetingNote(content).body;
  let lines = 0;
  for (const line of transcript.split("\n")) {
    const m = line.match(/^\*\*[^*]*?:\*\* (.*?) ?%%meeting-segment:[0-9a-f]{24} (\{.*?\})%%\s*$/);
    if (!m) continue;
    const where = JSON.parse(m[2]!) as { s: number; e: number; c: "mine" | "system" };
    const text = m[1]!.replace(/\\(.)/g, "$1");
    const words = text.split(/\s+/).filter(Boolean);
    const step = (where.e - where.s) / Math.max(1, words.length);
    // As palavras espalhadas pelo tempo do pedaço, como o `--meeting-live` faz.
    words.forEach((w, i) => {
      const at = where.s + i * step;
      console.log(JSON.stringify({ type: "word", channel: where.c === "mine" ? "voce" : "sistema", start: +at.toFixed(3), end: +(at + step).toFixed(3), text: w }));
    });
    lines++;
  }
  console.log(JSON.stringify({ type: "stats", asr: "nota", segments: segments.length, lines }));
  vault.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
