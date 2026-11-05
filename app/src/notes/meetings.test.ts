import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MeetingNotes, type MeetingSegment } from "./meetings.ts";
import { Vault } from "./vault.ts";
import { rebaseMeetingEdit, setMeetingField } from "../shared/meeting-note.ts";
import { MeetingNoteSession } from "../bun/meeting-notes.ts";
import type { Event } from "../shared/ipc.ts";
const at = new Date(2026, 10, 5, 14, 30);
const segment = (
  start = 1,
  speaker = "Pessoa 1",
  text = "Vamos validar o PACS.",
): MeetingSegment => ({
  start,
  end: start + 2,
  speaker,
  text,
  final: true,
  channel: speaker === "Você" ? "mine" : "system",
});
const rigs: { root: string; vault: Vault; notes: MeetingNotes }[] = [];
async function rig(flushMs = 5000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kiwi-meeting-note-"));
  const vault = new Vault({ root, watch: false });
  const notes = new MeetingNotes(vault, { flushMs });
  const r = { root, vault, notes };
  rigs.push(r);
  return r;
}
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.notes.flush().catch(() => {});
    r.vault.close();
    await rm(r.root, { recursive: true, force: true });
  }
});
const metadata = (s: string) =>
  Bun.YAML.parse(s.split("---")[1]!) as Record<string, any>;

test("meeting: local timestamp, sections, metadata and idempotent start", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  expect(n.path).toBe("Reuniões/2026-11-05 14h30 Reunião do Teams.md");
  expect(n.content).toContain("## Minhas notas\n\n\n## Transcrição");
  expect(metadata(n.content)).toMatchObject({
    type: "meeting",
    session: "s1",
    date: "2026-11-05",
    start: at.toISOString(),
    duration: 0,
    participants: [],
  });
  expect(metadata(n.content).end).toBeUndefined();
  expect((await notes.start("s1", "Teams", at)).path).toBe(n.path);
  expect(vault.list().notes.length).toBe(1);
});
test("meeting: only finals, chronological batch and replay deduplication", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", { ...segment(), text: "provisório", final: false });
  await notes.segment("s1", segment(8, "Pessoa 2", "Segunda fala."));
  await notes.segment("s1", segment(1, "Você", "Primeira fala."));
  expect((await vault.get(n.path)).content).not.toContain("Primeira fala");
  await Promise.all([notes.flush(), notes.flush()]);
  await notes.segment("s1", segment(1, "Você", "Primeira fala."));
  await notes.flush();
  const c = (await vault.get(n.path)).content;
  expect(c).not.toContain("provisório");
  expect(c.indexOf("Primeira fala")).toBeLessThan(c.indexOf("Segunda fala"));
  expect(c.match(/Primeira fala/g)?.length).toBe(1);
  expect(metadata(c).participants).toEqual(["Você", "Pessoa 2"]);
  expect(c).toContain("**14:30 · Você:**");
});
test("meeting: conditional write rebases an external edit between temp write and replace", async () => {
  const { notes, vault, root } = await rig();
  const n = await notes.start("s1", "Teams", at);
  const human = n.content.replace(
    "## Minhas notas\n",
    "## Minhas notas\n\nNão apagar a VM.\n",
  );
  (vault as any).beforeReplace = () => {
    (vault as any).beforeReplace = undefined;
    writeFileSync(path.join(root, n.path), human);
  };
  await notes.segment("s1", segment());
  await notes.flush();
  const c = (await vault.get(n.path)).content;
  expect(c).toContain("Não apagar a VM.");
  expect(c).toContain("validar o PACS");
});
test("meeting: timer batches live speech, stop flushes final tail and duration in seconds", async () => {
  const { notes, vault } = await rig(20);
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", segment());
  for (
    let i = 0;
    i < 50 && !(await vault.get(n.path)).content.includes("validar");
    i++
  )
    await Bun.sleep(10);
  expect((await vault.get(n.path)).content).toContain("validar");
  await notes.segment("s1", segment(20, "Você", "Fim da conversa."));
  await notes.finish("s1", new Date(at.getTime() + 35_500));
  const c = (await vault.get(n.path)).content;
  expect(c).toContain("Fim da conversa");
  expect(metadata(c)).toMatchObject({
    duration: 35.5,
    end: new Date(at.getTime() + 35_500).toISOString(),
  });
});
test("meeting: speaker rename follows future speech and file rename without changing personal text", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await vault.save(
    n.path,
    n.content.replace(
      "## Minhas notas\n",
      "## Minhas notas\n\nLembrar de Pessoa 1.\n",
    ),
    n.version,
  );
  await notes.segment("s1", segment());
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana");
  await vault.rename(n.path, "Projetos/Reunião com Ana.md");
  await notes.segment("s1", segment(12, "Pessoa 1", "A VM foi aprovada."));
  await notes.flush();
  const c = (await vault.get("Projetos/Reunião com Ana.md")).content;
  expect(c).toContain("Lembrar de Pessoa 1.");
  expect(c.match(/· Ana:\*\*/g)?.length).toBe(2);
  expect(metadata(c)).toMatchObject({
    participants: ["Ana"],
    meeting_speakers: { "Pessoa 1": "Ana" },
  });
});
test("meeting: append respects a following section and ignores headings in fenced examples", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  const edited =
    n.content.replace(
      "## Minhas notas\n",
      "## Minhas notas\n\n```md\n## Transcrição\nfalso\n```\n",
    ) + "## Pendências\n\nManter intacto.\n";
  await vault.save(n.path, edited, n.version);
  await notes.segment("s1", segment());
  await notes.flush();
  const c = (await vault.get(n.path)).content;
  expect(c.indexOf("validar")).toBeGreaterThan(c.indexOf("falso"));
  expect(c.indexOf("validar")).toBeLessThan(c.indexOf("## Pendências"));
  expect(c.endsWith("## Pendências\n\nManter intacto.\n")).toBe(true);
});
test("meeting: a failed write retains pending speech for a later retry", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  const save = vault.save.bind(vault);
  vault.save = async () => {
    throw new Error("disk full");
  };
  await notes.segment("s1", segment());
  await expect(notes.flush()).rejects.toThrow("disk full");
  vault.save = save;
  await notes.flush();
  expect(
    (await vault.get(n.path)).content.match(/validar o PACS/g)?.length,
  ).toBe(1);
});
test("meeting: a restarted writer finds a moved note and does not duplicate replay", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", segment());
  await notes.flush();
  await vault.rename(n.path, "Trabalho/Reunião.md");
  const restarted = new MeetingNotes(vault);
  await restarted.segment("s1", segment());
  await restarted.flush();
  expect(
    (await vault.get("Trabalho/Reunião.md")).content.match(/validar o PACS/g)
      ?.length,
  ).toBe(1);
});
test("meeting: unsaved personal edits rebase over live append, including an already received append", async () => {
  const { notes, vault } = await rig();
  const base = await notes.start("s1", "Teams", at);
  const mine = base.content.replace(
    "## Minhas notas\n",
    "## Minhas notas\n\nDecisão da pessoa.\n",
  );
  await notes.segment("s1", segment());
  await notes.flush();
  const disk = await vault.get(base.path);
  const merged = rebaseMeetingEdit(base.content, mine, disk.content)!;
  expect(merged).toContain("Decisão da pessoa.");
  expect(merged).toContain("validar o PACS");
  expect(
    rebaseMeetingEdit(base.content, merged, disk.content)?.match(
      /validar o PACS/g,
    )?.length,
  ).toBe(1);
  const saved = await notes.saveEdit(
    base.path,
    mine,
    base.version,
    base.content,
  );
  expect(saved.saved).toBe(true);
  expect(saved.content).toContain("Decisão da pessoa.");
  expect((await vault.get(base.path)).content).toContain("validar o PACS");
});
test("meeting: unrelated edits keep normal conflicts; forged edit bases are refused", async () => {
  const { notes, vault } = await rig();
  const base = await notes.start("s1", "Teams", at);
  const mine = base.content.replace(
    "## Minhas notas\n",
    "## Minhas notas\n\nMinha edição.\n",
  );
  const external = base.content.replace(
    "## Minhas notas\n",
    "## Minhas notas\n\nEdição externa.\n",
  );
  await vault.save(base.path, external, base.version);
  expect(
    (await notes.saveEdit(base.path, mine, base.version, base.content)).saved,
  ).toBe(false);
  expect(rebaseMeetingEdit(base.content, mine, external)).toBeNull();
  await expect(
    notes.saveEdit(base.path, mine, base.version, "forged"),
  ).rejects.toThrow();
  expect((await vault.get(base.path)).content).toBe(external);
});
test("meeting: unknown frontmatter/comments survive; speaker punctuation is literal", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await vault.save(
    n.path,
    n.content.replace("---\n", "---\n# comentário da pessoa\nproject: PACS\n"),
    n.version,
  );
  await notes.segment("s1", segment());
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana [PACS] $1");
  const c = (await vault.get(n.path)).content;
  expect(c).toContain("# comentário da pessoa\nproject: PACS\n");
  expect(c).toContain("· Ana \\[PACS\\] $1:**");
  expect(setMeetingField(c, "duration", 3)).toContain("project: PACS");
});
test("meeting: fake helper events create, append and finish a note without capture commands", async () => {
  const { notes, vault } = await rig();
  const listeners = new Map<string, Function[]>();
  const source = {
    on(type: string, fn: Function) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      return () =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn),
        );
    },
  };
  let time = at.getTime();
  const errors: unknown[] = [];
  const bridge = new MeetingNoteSession(
    source as any,
    notes,
    () => time,
    (e) => errors.push(e),
  );
  bridge.attach();
  const emit = (e: Event) => {
    for (const fn of listeners.get(e.type) ?? []) fn({ ...e, v: 1 });
  };
  emit({
    type: "meeting.started",
    session: "s1",
    app: "Teams",
    sampleRate: 16000,
    output: "speaker",
  });
  emit({ type: "meeting.segment", ...segment() });
  time += 30_000;
  emit({ type: "meeting.stopped", session: "s1", pendingChunks: 1 });
  await bridge.detach();
  expect(errors).toEqual([]);
  expect(vault.list().notes.length).toBe(1);
  const c = (await vault.get(vault.list().notes[0]!.path)).content;
  expect(c).toContain("validar o PACS");
  expect(metadata(c).duration).toBe(30);
});

// R3 (T4943, option B of #5131): the VBx corrects the speakers after the meeting.
test("meeting relabel: renamed during the meeting, then the VBx moved a segment: the person's name stays", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s9", "Teams", at);
  await notes.segment("s9", segment(1, "Pessoa 1", "Primeiro ponto."));
  await notes.segment("s9", segment(5, "Pessoa 2", "Eu acho que sim."));
  await notes.segment("s9", segment(9, "Pessoa 2", "Sem dúvida."));
  await notes.segment("s9", segment(13, "Você", "Fechado então."));
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana");
  // The person writes in her own section meanwhile.
  const mine = await vault.get(n.path);
  await vault.save(n.path, mine.content.replace("## Minhas notas\n", "## Minhas notas\nLevar o laudo.\n"), mine.version);
  // The VBx: the segment at 5 s was Ana's after all; the one at 9 s goes to a third person.
  const r = await notes.relabel("s9", [
    { start: 5, end: 7, channel: "system", from: "Pessoa 2", to: "Pessoa 1" },
    { start: 9, end: 11, channel: "system", from: "Pessoa 2", to: "Pessoa 3" },
    { start: 99, end: 100, channel: "system", from: "Pessoa 2", to: "Pessoa 1" },
  ]);
  expect(r.changed).toBe(2);
  const after = (await vault.get(n.path)).content;
  expect(after).toContain("Levar o laudo.");
  expect(after).toMatch(/\*\*14:30 · Ana:\*\* Eu acho que sim\./);
  expect(after).toMatch(/\*\*14:30 · Pessoa 3:\*\* Sem dúvida\./);
  expect(after).not.toContain("· Pessoa 2:");
  expect(metadata(after).participants).toEqual(["Ana", "Você", "Pessoa 3"]);
  expect(metadata(after).meeting_speakers).toMatchObject({ "Pessoa 1": "Ana", "Pessoa 3": "Pessoa 3" });
  // Idempotent: a replay of the corrected segment doesn't add a line; the same relabel again changes nothing.
  await notes.segment("s9", segment(5, "Pessoa 1", "Eu acho que sim."));
  await notes.flush();
  expect((await vault.get(n.path)).content.match(/Eu acho que sim/g)?.length).toBe(1);
  expect((await notes.relabel("s9", [{ start: 5, end: 7, channel: "system", from: "Pessoa 2", to: "Pessoa 1" }])).changed).toBe(0);
});

test("meeting relabel: pending finals are written first, and bad changes are refused", async () => {
  const { notes, vault } = await rig(60_000);
  const n = await notes.start("s10", "Zoom", at);
  await notes.segment("s10", segment(1, "Pessoa 2", "Ainda no lote."));
  expect((await notes.relabel("s10", [{ start: 1, end: 3, channel: "system", from: "Pessoa 2", to: "Pessoa 1" }])).changed).toBe(1);
  expect((await vault.get(n.path)).content).toMatch(/· Pessoa 1:\*\* Ainda no lote\./);
  await expect(notes.relabel("s10", [{ start: 1, end: 3, channel: "system", from: "Pessoa 1", to: "a\nb" }])).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  await expect(notes.relabel("nope", [])).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("meeting recovery (R3): finals already saved before a crash count as saved and aren't written twice", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s11", "Teams", at);
  const committed: number[] = [];
  notes.onCommitted((_, batch) => committed.push(...batch.map((s) => s.start)));
  await notes.segment("s11", segment(1, "Pessoa 1", "Antes da queda."));
  await notes.segment("s11", segment(4, "Você", "Eu também."));
  await notes.flush();
  expect(metadata((await vault.get(n.path)).content).meeting_progress).toEqual({ system: 3, mine: 6 });
  // The helper restarts and transcribes the spool again, cut differently.
  await notes.segment("s11", { ...segment(0.8, "Pessoa 1", "Antes da queda."), end: 2.9 });
  await notes.segment("s11", segment(7, "Pessoa 1", "Depois da queda."));
  await notes.flush();
  await new Promise((r) => setTimeout(r, 0));
  const content = (await vault.get(n.path)).content;
  expect(content.match(/Antes da queda/g)?.length).toBe(1);
  expect(content).toContain("Depois da queda.");
  expect(committed.sort((a, b) => a - b)).toEqual([0.8, 1, 4, 7]);
});
