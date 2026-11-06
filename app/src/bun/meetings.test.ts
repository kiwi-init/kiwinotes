// A aba Reuniões (R6, T4947): a lista das notas de reunião, o estado ao vivo pelos eventos do helper e as capacidades.
import { expect, test } from "bun:test";

import { DEFAULT_SHORTCUTS } from "../shared/shortcuts.ts";
import { DEFAULT_MEETING_SETTINGS, durationLabel, elapsedLabel, meetingFromNote, nextLive, NOT_RECORDING, participantsLabel, sortMeetings } from "../shared/meetings.ts";
import { FakeMeetingHost, listMeetings, MeetingLiveTracker } from "./meetings.ts";
import { type CapabilityDeps, uiCapabilities } from "./ui-capabilities.ts";

const meta = (path: string, mtime = "2026-11-05T18:00:00.000Z") => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), mtime });

const R4_NOTE = `---
type: meeting
session: 7d1c
date: "2026-11-05"
start: "2026-11-05T17:32:00.000Z"
end: "2026-11-05T18:10:00.000Z"
duration: 2280
app: "Teams"
participants: [Você, Pessoa 1, Pessoa 2]
meeting_speakers: {"Pessoa 1": "Ana"}
---
## Minhas notas
`;

test("a nota do R4 vira uma linha da lista, com o que o frontmatter diz", () => {
  expect(meetingFromNote(meta("Reuniões/2026-11-05 14h32 Reunião do Teams.md"), R4_NOTE)).toEqual({
    path: "Reuniões/2026-11-05 14h32 Reunião do Teams.md",
    title: "2026-11-05 14h32 Reunião do Teams",
    date: "2026-11-05",
    start: "2026-11-05T17:32:00.000Z",
    end: "2026-11-05T18:10:00.000Z",
    duration: 2280,
    app: "Teams",
    participants: ["Você", "Pessoa 1", "Pessoa 2"],
    live: false,
    mtime: "2026-11-05T18:00:00.000Z",
  });
});

test("só type: meeting conta; uma reunião escrita à mão aparece com o que tiver", () => {
  expect(meetingFromNote(meta("a.md"), "---\ntype: projeto\n---\n")).toBeNull();
  expect(meetingFromNote(meta("a.md"), "sem frontmatter")).toBeNull();
  expect(meetingFromNote(meta("a.md"), "---\ntype: [quebrado\n---\n")).toBeNull();
  const hand = meetingFromNote(meta("Reunião.md", "2026-10-01T12:00:00.000Z"), "---\ntype: Meeting\nparticipants: Ana\n---\n");
  expect(hand).toMatchObject({ date: "2026-10-01", start: null, end: null, duration: null, app: null, participants: [], live: false });
});

test("sem end: a gravação ainda está em andamento", () => {
  const live = meetingFromNote(meta("x.md"), '---\ntype: meeting\nstart: "2026-11-05T17:32:00.000Z"\n---\n');
  expect(live?.live).toBe(true);
});

test("a mais nova primeiro, pelo início", () => {
  const a = meetingFromNote(meta("a.md"), '---\ntype: meeting\nstart: "2026-11-04T10:00:00Z"\n---\n')!;
  const b = meetingFromNote(meta("b.md"), '---\ntype: meeting\nstart: "2026-11-05T09:00:00Z"\n---\n')!;
  const c = meetingFromNote(meta("c.md"), '---\ntype: meeting\ndate: "2026-11-03"\n---\n')!;
  expect(sortMeetings([a, c, b]).map((m) => m.path)).toEqual(["b.md", "a.md", "c.md"]);
});

test("os rótulos: duração, relógio e participantes", () => {
  expect(durationLabel(20)).toBe("menos de 1 min");
  expect(durationLabel(2280)).toBe("38 min");
  expect(durationLabel(3900)).toBe("1 h 05");
  expect(elapsedLabel(725)).toBe("12:05");
  expect(elapsedLabel(3723)).toBe("1:02:03");
  expect(participantsLabel(["Você"])).toBe("Você");
  expect(participantsLabel(["Você", "Pessoa 1", "Pessoa 2"])).toBe("Você, Pessoa 1 e Pessoa 2");
  expect(participantsLabel(["Você", "A", "B", "C", "D"])).toBe("Você, A e mais 3");
});

test("listMeetings lê só as notas com type: e devolve as de reunião", async () => {
  const files: Record<string, string> = {
    "Reuniões/a.md": R4_NOTE,
    "Projeto.md": "---\ntype: projeto\n---\n",
    "Solta.md": "nada aqui",
  };
  const read: string[] = [];
  const notes = {
    notesContaining: (text: string) => Object.keys(files).filter((p) => files[p]!.includes(text)).map((p) => ({ ...meta(p), folder: "", ctime: "", size: 0, version: "", tags: [] })),
    get: async (p: string) => {
      read.push(p);
      if (p === "Projeto.md") throw new Error("sumiu");
      return { ...meta(p), folder: "", ctime: "", size: 0, version: "", tags: [], content: files[p]! };
    },
  };
  expect((await listMeetings(notes)).map((m) => m.path)).toEqual(["Reuniões/a.md"]);
  expect(read.sort()).toEqual(["Projeto.md", "Reuniões/a.md"]);
});

test("o estado ao vivo segue os eventos do helper", () => {
  const at = new Date("2026-11-05T17:32:00.000Z");
  let live = nextLive(NOT_RECORDING, { type: "meeting.started", session: "s1", app: "Teams", sampleRate: 16000 }, at);
  expect(live).toEqual({ recording: true, session: "s1", app: "Teams", since: at.toISOString(), minePaused: false });
  live = nextLive(live, { type: "meeting.minePaused", paused: true }, at);
  expect(live).toMatchObject({ minePaused: true });
  expect(nextLive(live, { type: "meeting.stopped", session: "outra" }, at)).toBe(live);
  expect(nextLive(live, { type: "meeting.stopped", session: "s1", pendingChunks: 0 }, at)).toEqual(NOT_RECORDING);
  expect(nextLive(NOT_RECORDING, { type: "meeting.minePaused", paused: true }, at)).toEqual(NOT_RECORDING);
});

test("o rastreador avisa só quando muda, e o helper que cai leva a gravação", () => {
  const sent: unknown[] = [];
  const t = new MeetingLiveTracker(async (c) => (sent.push(c), { ok: true }));
  const seen: boolean[] = [];
  t.onChange((l) => seen.push(l.recording));
  t.feed({ type: "meeting.started", session: "s1" });
  t.feed({ type: "meeting.level", channel: "mine", rms: 0.2 });
  t.reset();
  t.reset();
  expect(seen).toEqual([true, false]);
});

function deps(meetings?: CapabilityDeps["meetings"]): CapabilityDeps {
  let settings = { meetings: { ...DEFAULT_MEETING_SETTINGS }, shortcuts: { ...DEFAULT_SHORTCUTS } } as unknown as Awaited<ReturnType<CapabilityDeps["settings"]["load"]>>;
  return {
    meetings,
    settings: {
      load: async () => settings,
      save: async (patch: object) => (settings = { ...settings, ...patch } as typeof settings),
    },
  } as unknown as CapabilityDeps;
}

test("meetings.stop e meetings.pauseMine: só com uma gravação, e mandam o comando ao helper", async () => {
  const sent: string[] = [];
  const tracker = new MeetingLiveTracker(async (c) => (sent.push(c.type), c.type === "meeting.resumeMine" ? { ok: false, error: "microphone_permission" } : { ok: true }));
  const caps = uiCapabilities(deps(tracker));
  expect(await caps["meetings.live"]({})).toEqual(NOT_RECORDING);
  await expect(Promise.resolve(caps["meetings.stop"]({}))).rejects.toMatchObject({ code: "E_NOT_RECORDING" });
  tracker.feed({ type: "meeting.started", session: "s1", app: "Teams" });
  expect(await caps["meetings.pauseMine"]({ paused: true })).toBe(true);
  await expect(Promise.resolve(caps["meetings.pauseMine"]({ paused: false }))).rejects.toMatchObject({ code: "E_HELPER", message: "microphone_permission" });
  await expect(Promise.resolve(caps["meetings.pauseMine"]({ paused: "sim" }))).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  expect(await caps["meetings.stop"]({})).toBe(true);
  expect(sent).toEqual(["meeting.pauseMine", "meeting.resumeMine", "meeting.stop"]);
});

test("sem o helper: não grava, e parar dá E_NO_HELPER", async () => {
  const caps = uiCapabilities(deps());
  expect(await caps["meetings.live"]({})).toEqual(NOT_RECORDING);
  await expect(Promise.resolve(caps["meetings.stop"]({}))).rejects.toMatchObject({ code: "E_NO_HELPER" });
});

test("o falso do headless: uma gravação que pausa e para sem helper", async () => {
  const fake = new FakeMeetingHost("Teams", 12, () => new Date("2026-11-05T18:00:00.000Z"));
  expect(fake.live()).toEqual({ recording: true, session: "fake-meeting", app: "Teams", since: "2026-11-05T17:48:00.000Z", minePaused: false });
  const caps = uiCapabilities(deps(fake));
  await caps["meetings.pauseMine"]({ paused: true });
  expect(fake.live()).toMatchObject({ minePaused: true });
  await caps["meetings.stop"]({});
  expect(fake.live()).toEqual(NOT_RECORDING);
});

test("settings.set {meetings}: só os campos dados, e um valor que não existe dá E_BAD_ARGS", async () => {
  const caps = uiCapabilities(deps());
  const saved = (await caps["settings.set"]({ meetings: { suggest: false, shortcut: null } })) as { meetings: typeof DEFAULT_MEETING_SETTINGS };
  expect(saved.meetings).toEqual({ ...DEFAULT_MEETING_SETTINGS, suggest: false, shortcut: null });
  await expect(Promise.resolve(caps["settings.set"]({ meetings: { shortcut: "q" } }))).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  await expect(Promise.resolve(caps["settings.set"]({ meetings: { apps: [{ bundleId: "x" }] } }))).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  await expect(Promise.resolve(caps["settings.set"]({ meetings: { color: "red" } }))).rejects.toMatchObject({ code: "E_BAD_ARGS" });
});
