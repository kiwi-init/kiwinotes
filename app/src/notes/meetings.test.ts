import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { MeetingNotes, type MeetingSegment } from "./meetings.ts";
import { Vault } from "./vault.ts";
import { rebaseMeetingEdit, setMeetingField } from "../shared/meeting-note.ts";
import { MeetingNoteSession } from "../bun/meeting-notes.ts";
import type { Event } from "../shared/ipc.ts";
import { tempDir } from "../../test/tmp.ts";
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
  const root = tempDir("kiwi-meeting-note-");
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

// T7938: o helper cai com a reunião gravando e não manda o meeting.stopped. A nota ganha o fim na hora da queda, e a fala
// que o helper novo recupera do spool depois continua entrando nela.
test("meeting bridge: o helper caiu (interrupted) fecha a nota, e a fala recuperada depois entra nela", async () => {
  const { notes, vault } = await rig();
  const listeners = new Map<string, Function[]>();
  const source = { on(type: string, fn: Function) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); return () => {}; } };
  let time = at.getTime();
  const errors: unknown[] = [];
  const bridge = new MeetingNoteSession(source as any, notes, () => time, (e) => errors.push(e));
  bridge.attach();
  const emit = (e: Event) => { for (const fn of listeners.get(e.type) ?? []) fn({ ...e, v: 1 }); };
  emit({ type: "meeting.started", session: "s1", app: "Teams", sampleRate: 16000, output: "speaker" });
  emit({ type: "meeting.segment", session: "s1", ...segment(1, "Pessoa 1", "Antes da queda.") });
  time += 42_000;
  bridge.interrupted();
  bridge.interrupted(); // a segunda queda (ou o stop do app) não fecha de novo
  await notes.flush();
  const path = vault.list().notes[0]!.path;
  let c = (await vault.get(path)).content;
  expect(metadata(c).duration).toBe(42);
  expect(metadata(c).end).toBe(new Date(at.getTime() + 42_000).toISOString());
  // O helper novo transcreve o que sobrou no spool, com o mesmo session.
  emit({ type: "meeting.segment", session: "s1", ...segment(30, "Pessoa 1", "Recuperada do spool.") });
  await notes.flush();
  c = (await vault.get(path)).content;
  expect(c).toContain("Antes da queda.");
  expect(c).toContain("Recuperada do spool.");
  expect(metadata(c).duration).toBe(42);
  expect(vault.list().notes.length).toBe(1);
  await bridge.detach();
  expect(errors).toEqual([]);
});

// R3 (T4943, option B of #5131): the VBx corrects the speakers after the meeting, over the saved blocks.
const turn = (speaker: number, start: number, end: number) => ({ speaker, start, end });

test("meeting relabel: renamed during the meeting, then the VBx moved segments: the person's name stays", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s9", "Teams", at);
  await notes.segment("s9", segment(1, "Pessoa 1", "Primeiro ponto."));
  await notes.segment("s9", segment(5, "Pessoa 2", "Eu acho que sim."));
  await notes.segment("s9", segment(9, "Pessoa 2", "Sem dúvida."));
  await notes.segment("s9", segment(13, "Você", "Fechado então."));
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana");
  const mine = await vault.get(n.path);
  await vault.save(n.path, mine.content.replace("## Minhas notas\n", "## Minhas notas\nLevar o laudo.\n"), mine.version);
  // The VBx: cluster 4 spoke at 1 s and 5 s (Ana, after all); cluster 8 at 9 s.
  const r = await notes.relabel("s9", [turn(4, 0.5, 3.5), turn(4, 4.5, 7.5), turn(8, 8.5, 11.5)]);
  expect(r.changed).toBe(1); // only the block at 5 s moves: cluster 4 is "Pessoa 1" (Ana), cluster 8 stays "Pessoa 2"
  const after = (await vault.get(n.path)).content;
  expect(after).toContain("Levar o laudo.");
  expect(after).toMatch(/\*\*14:30 · Ana:\*\* Eu acho que sim\./);
  expect(after).toMatch(/\*\*14:30 · Pessoa 2:\*\* Sem dúvida\./);
  expect(after).toMatch(/\*\*14:30 · Você:\*\* Fechado então\./);
  expect(metadata(after).participants).toEqual(["Ana", "Pessoa 2", "Você"]);
  expect(metadata(after).meeting_speakers).toMatchObject({ "Pessoa 1": "Ana" });
  // Idempotent: a replay of the moved segment with its new label adds nothing; the same VBx again changes nothing.
  await notes.segment("s9", segment(5, "Pessoa 1", "Eu acho que sim."));
  await notes.flush();
  expect((await vault.get(n.path)).content.match(/Eu acho que sim/g)?.length).toBe(1);
  expect((await notes.relabel("s9", [turn(4, 0.5, 3.5), turn(4, 4.5, 7.5), turn(8, 8.5, 11.5)])).changed).toBe(0);
});

test("meeting relabel (#5168): finds the saved block even when the replay cut it differently", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s12", "Teams", at);
  await notes.segment("s12", segment(1, "Pessoa 1", "Primeiro."));
  await notes.segment("s12", segment(5, "Pessoa 2", "Antes da queda."));
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana");
  // The crash: the replay cuts [4.8, 6.9] and the progress skips it (it ends before 7).
  await notes.segment("s12", { ...segment(4.8, "Pessoa 1", "Antes da queda."), end: 6.9, words: [{ start: 4.8, end: 6.9, text: "Antes da queda." }] });
  await notes.flush();
  // The VBx says the speaker at 5 s is the one at 1 s.
  expect((await notes.relabel("s12", [turn(0, 0.8, 3.2), turn(0, 4.8, 6.9)])).changed).toBe(1);
  const after = (await vault.get(n.path)).content;
  expect(after).toMatch(/· Ana:\*\* Antes da queda\./);
  expect(after).not.toContain("· Pessoa 2:");
  expect(after.match(/Antes da queda/g)?.length).toBe(1);
});

test("meeting relabel: pending finals are written first, bad turns are refused", async () => {
  const { notes, vault } = await rig(60_000);
  const n = await notes.start("s10", "Zoom", at);
  await notes.segment("s10", segment(1, "Pessoa 2", "Ainda no lote."));
  await notes.segment("s10", segment(5, "Pessoa 1", "Outra pessoa."));
  expect((await notes.relabel("s10", [turn(3, 1, 3), turn(3, 5, 7)])).changed).toBe(1);
  expect((await vault.get(n.path)).content.match(/· Pessoa 1:/g)?.length).toBe(2);
  await expect(notes.relabel("s10", [{ speaker: 1.5, start: 0, end: 1 }])).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  await expect(notes.relabel("nope", [])).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("meeting relabel (#5176): the VBx failed twice: live labels stay, and one discreet line says so", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s13", "Teams", at);
  await notes.segment("s13", segment(1, "Pessoa 1", "Oi."));
  await notes.flush();
  expect((await notes.relabel("s13", [], { failed: true })).changed).toBe(1);
  expect((await notes.relabel("s13", [], { failed: true })).changed).toBe(0);
  const after = (await vault.get(n.path)).content;
  expect(after.match(/não puderam ser revisados/g)?.length).toBe(1);
  expect(after).toMatch(/· Pessoa 1:\*\* Oi\./);
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

test("meeting recovery (#5168): a replay that crosses the saved progress goes in from the word after it, once", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s14", "Teams", at);
  await notes.segment("s14", segment(1, "Pessoa 1", "Antes da queda."));
  await notes.flush();
  await notes.renameSpeaker(n.path, "Pessoa 1", "Ana");
  const words = [
    { start: 0.8, end: 1.4, text: "Antes" }, { start: 1.5, end: 1.8, text: "da" }, { start: 1.9, end: 2.9, text: "queda." },
    { start: 3.3, end: 3.6, text: "Depois" }, { start: 3.6, end: 3.8, text: "da" }, { start: 3.8, end: 4.2, text: "queda." },
  ];
  await notes.segment("s14", { ...segment(0.8, "Pessoa 1", "Antes da queda. Depois da queda."), end: 4.2, words });
  await notes.flush();
  const after = (await vault.get(n.path)).content;
  expect(after.match(/Antes da queda/g)?.length).toBe(1);
  expect(after).toMatch(/· Ana:\*\* Depois da queda\./);
});

// T7439: a nota da reunião some no meio da gravação (apagada, ou com o `type` mudado nas propriedades). A gravação
// segue, e a fala que vem depois não pode sumir calada: ela vai para uma nota no cofre.
const allText = async (vault: Vault) =>
  (await Promise.all(vault.list().notes.map((n) => vault.get(n.path).then((x) => x.content, () => "")))).join("\n");
test("meeting: a nota apagada no meio da gravação não leva a fala que vem depois", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", segment(1, "Pessoa 1", "Antes."));
  await notes.flush();
  await vault.delete(n.path);
  await notes.segment("s1", segment(5, "Pessoa 1", "Depois de apagar.")).catch(() => {});
  await notes.finish("s1", new Date(at.getTime() + 60_000)).catch(() => {});
  await notes.flush().catch(() => {});
  expect(await allText(vault)).toContain("Depois de apagar.");
});
test("meeting: o type mudado nas propriedades no meio da gravação não leva a fala que vem depois", async () => {
  const { notes, vault } = await rig();
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", segment(1, "Pessoa 1", "Antes."));
  await notes.flush();
  const base = await vault.get(n.path);
  await notes.saveEdit(n.path, base.content.replace(/^type: .*$/m, 'type: "reunião"'), base.version, base.content);
  await notes.segment("s1", segment(5, "Pessoa 1", "Depois do type.")).catch(() => {});
  await notes.finish("s1", new Date(at.getTime() + 60_000)).catch(() => {});
  await notes.flush().catch(() => {});
  expect(await allText(vault)).toContain("Depois do type.");
});
test("meeting: a nota recriada (T7723) avisa uma vez, segue recebendo a fala, e a de antes não é mais mexida", async () => {
  const { notes, vault } = await rig();
  const recreated: { session: string; path: string }[] = [];
  notes.onRecreated((session, path) => recreated.push({ session, path }));
  const n = await notes.start("s1", "Teams", at);
  await notes.segment("s1", segment(1, "Pessoa 1", "Antes."));
  await notes.flush();
  const base = await vault.get(n.path);
  await notes.saveEdit(n.path, base.content.replace(/^type: .*$/m, 'type: "reunião"'), base.version, base.content);
  const old = (await vault.get(n.path)).content;
  await notes.segment("s1", segment(5, "Pessoa 1", "Primeira depois."));
  await notes.segment("s1", segment(9, "Pessoa 1", "Segunda depois."));
  await notes.finish("s1", new Date(at.getTime() + 60_000));
  await notes.flush();
  expect(recreated.length).toBe(1);
  expect(recreated[0]!.session).toBe("s1");
  // O mesmo nome, com " 2": a de antes ainda ocupa o nome.
  expect(recreated[0]!.path).not.toBe(n.path);
  const fresh = (await vault.get(recreated[0]!.path)).content;
  expect(fresh).toContain('type: "meeting"');
  expect(fresh).toContain('session: "s1"');
  expect(fresh).toContain("Primeira depois.");
  expect(fresh).toContain("Segunda depois.");
  expect((await vault.get(n.path)).content).toBe(old);
});
