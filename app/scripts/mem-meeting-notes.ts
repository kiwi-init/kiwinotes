// O principal da reunião no `mem:scenarios` (spec #20953, roteiro 3): o `MeetingNotes` de verdade (o mesmo do app),
// num cofre de mentira em `<pasta>`, recebendo os `segment` do `kiwi-helper --meeting-live --realtime` pelo stdin, um
// por linha, no ritmo do WAV. Escreve "pronto" no stdout quando o cofre abre; `{"type":"finish"}` fecha a nota.
//
//   bun scripts/mem-meeting-notes.ts <pasta>

import { rmSync } from "node:fs";
import { createInterface } from "node:readline";

import { MeetingNotes } from "../src/notes/meetings.ts";
import { Vault } from "../src/notes/vault.ts";

const root = process.argv[2];
if (!root) {
  console.error("uso: bun mem-meeting-notes.ts <pasta>");
  process.exit(2);
}
const vault = new Vault({ root, trash: async (abs) => rmSync(abs, { recursive: true, force: true }) });
await vault.open();
vault.watch();
const start = Date.now();
const notes = new MeetingNotes(vault);
const session = "mem";
await notes.start(session, "Reunião", new Date(start));
process.stdout.write("pronto\n");

for await (const line of createInterface({ input: process.stdin })) {
  const l = JSON.parse(line) as { type: string; start: number; end: number; speaker: string; text: string; channel?: string; words?: unknown };
  if (l.type === "finish") {
    await notes.finish(session, new Date());
    continue;
  }
  await notes.segment(session, { start: l.start, end: l.end, speaker: l.speaker, text: l.text, final: true, channel: l.channel as never, words: l.words as never });
}
vault.close?.();
