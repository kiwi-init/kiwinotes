import { createHash } from "node:crypto";
import { clock } from "./fromDictation.ts";
import { VaultError } from "./paths.ts";
import {
  localDate,
  type Note,
  type NoteMeta,
  type SaveResult,
  type Vault,
} from "./vault.ts";
import {
  appendMeetingTranscript,
  isMeetingNote,
  setMeetingField,
  splitMeetingNote,
  transcriptSection,
} from "../shared/meeting-note.ts";
import { mergeNoteEdit } from "../shared/merge3.ts";

/** One turn of the VBx at the end of the meeting (R3): a speaker cluster, in seconds since the meeting began. */
export interface MeetingTurn {
  speaker: number;
  start: number;
  end: number;
}

/** A transcript block already in the note, with what its comment says (R3 writes the time, channel and ASR label). */
interface SavedBlock {
  lineStart: number;
  lineEnd: number;
  hash: string;
  start: number;
  end: number;
  channel: "mine" | "system";
  label: string;
}

/** A pasta das reuniões, no cofre interno (spec #9874: ela não pode ser um projeto). */
export const MEETINGS_FOLDER = "Reuniões";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/**
 * The block's comment: the replay hash and, since R3, where the segment is (seconds, channel, ASR label), so the VBx
 * correction finds the saved block even when a replay cut it differently. `%` is escaped so the JSON never closes the
 * `%%` comment.
 */
function refOf(session: string, s: MeetingSegment): string {
  const where = { s: round3(s.start), e: round3(s.end), c: s.channel ?? (s.speaker === "Você" ? "mine" : "system"), l: s.speaker };
  return `%%meeting-segment:${idOf(session, s)} ${JSON.stringify(where).replace(/%/g, "\\u0025")}%%`;
}
const refPrefix = (session: string, s: MeetingSegment) => `%%meeting-segment:${idOf(session, s)}`;

function blocksOf(transcript: string): SavedBlock[] {
  const blocks: SavedBlock[] = [];
  for (const m of transcript.matchAll(/%%meeting-segment:([0-9a-f]{24}) (\{[^\n]*?\})%%/g)) {
    try {
      const w = JSON.parse(m[2]!) as { s?: unknown; e?: unknown; c?: unknown; l?: unknown };
      if (typeof w.s !== "number" || typeof w.e !== "number" || (w.c !== "mine" && w.c !== "system") || typeof w.l !== "string") continue;
      const at = m.index!;
      const lineStart = transcript.lastIndexOf("\n", at) + 1;
      const next = transcript.indexOf("\n", at);
      blocks.push({ lineStart, lineEnd: next < 0 ? transcript.length : next, hash: m[1]!, start: w.s, end: w.e, channel: w.c, label: w.l });
    } catch {
      // a comment someone edited by hand: that block stays as it is
    }
  }
  return blocks;
}

/**
 * The VBx clusters take the saved labels they overlap most, one to one (so a label the person renamed keeps its
 * name); a cluster no saved label matches gets a new "Pessoa N". Each system block then goes to the cluster that covers
 * most of it. Returns the new label per block index (only the ones that change).
 */
export function planRelabel(blocks: { start: number; end: number; channel: string; label: string }[], turns: MeetingTurn[]): Map<number, string> {
  const out = new Map<number, string>();
  const system = blocks.map((b, i) => ({ ...b, i })).filter((b) => b.channel === "system");
  if (!system.length || !turns.length) return out;
  const overlap = (b: { start: number; end: number }, c: number) =>
    turns.filter((t) => t.speaker === c).reduce((sum, t) => sum + Math.max(0, Math.min(b.end, t.end) - Math.max(b.start, t.start)), 0);
  const labels = [...new Set(system.map((b) => b.label))];
  const clusters = [...new Set([...turns].sort((a, b) => a.start - b.start).map((t) => t.speaker))];
  const pairs: { label: string; cluster: number; seconds: number }[] = [];
  for (const label of labels)
    for (const cluster of clusters) {
      const seconds = system.filter((b) => b.label === label).reduce((sum, b) => sum + overlap(b, cluster), 0);
      if (seconds > 0) pairs.push({ label, cluster, seconds });
    }
  pairs.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label) || a.cluster - b.cluster);
  const nameOf = new Map<number, string>();
  const taken = new Set<string>();
  for (const p of pairs)
    if (!nameOf.has(p.cluster) && !taken.has(p.label)) {
      nameOf.set(p.cluster, p.label);
      taken.add(p.label);
    }
  let next = Math.max(0, ...labels.map((l) => Number(/^Pessoa (\d+)$/.exec(l)?.[1] ?? 0))) + 1;
  for (const c of clusters) if (!nameOf.has(c)) nameOf.set(c, `Pessoa ${next++}`);
  for (const b of system) {
    let best: { c: number; s: number } | null = null;
    for (const c of clusters) {
      const s = overlap(b, c);
      if (s > 0 && (!best || s > best.s)) best = { c, s };
    }
    const to = best && nameOf.get(best.c);
    if (to && to !== b.label) out.set(b.i, to);
  }
  return out;
}

/** The line the writer leaves when the VBx couldn't run, even after a second try (decision of the lead, #5176). */
export const SPEAKERS_NOT_REVIEWED = "_Os falantes desta reunião não puderam ser revisados no fim._";

export interface MeetingSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  final: boolean;
  channel?: "mine" | "system";
  /** R3: the words with their times (seconds since the meeting began), to cut a replay at the saved progress. */
  words?: { start: number; end: number; text: string }[];
}
interface State {
  session: string;
  path: string;
  start: number;
  /** O app da reunião, para recriar a nota igual se ela sumir no meio (T7723). */
  app: string;
  pending: MeetingSegment[];
  end?: number;
}
type MeetingVault = Pick<
  Vault,
  "open" | "create" | "get" | "save" | "notesContaining"
>;
const escape = (s: string) => s.replace(/[\\`*_[\]<>]/g, "\\$&");
const metaOf = ({ content: _, ...meta }: Note): NoteMeta => meta;
function dataOf(content: string): Record<string, any> {
  if (!isMeetingNote(content))
    throw new VaultError("E_BAD_ARGS", "not a meeting note");
  const fm = splitMeetingNote(content).frontmatter;
  const data = Bun.YAML.parse(fm.replace(/^---\r?\n|\r?\n---\s*$/g, ""));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new VaultError("E_BAD_ARGS", "invalid meeting metadata");
  return data as Record<string, any>;
}
const idOf = (session: string, s: MeetingSegment) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        session,
        s.channel ?? (s.speaker === "Você" ? "mine" : "system"),
        s.speaker,
        s.start,
        s.end,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
function validateSession(session: string) {
  if (typeof session !== "string" || !/^[\w-]{1,128}$/.test(session))
    throw new VaultError("E_BAD_ARGS", "invalid meeting session");
}
function validateSegment(s: MeetingSegment) {
  if (
    !s ||
    !Number.isFinite(s.start) ||
    !Number.isFinite(s.end) ||
    s.start < 0 ||
    s.end < s.start ||
    typeof s.speaker !== "string" ||
    !s.speaker.trim() ||
    s.speaker.length > 100 ||
    /[\r\n]/.test(s.speaker) ||
    typeof s.text !== "string" ||
    s.text.length > 100_000 ||
    typeof s.final !== "boolean"
  )
    throw new VaultError("E_BAD_ARGS", "invalid meeting segment");
}

/** One queue for all meeting mutations. Every retry starts from the current disk version (ADR 0007). */
/** O texto de uma nota de reunião nova: o frontmatter (`type: meeting`, o `session`) e as duas seções. */
function newMeetingNote(session: string, app: string, at: Date): string {
  const fields = {
    type: "meeting",
    date: localDate(at.getTime()),
    start: at.toISOString(),
    duration: 0,
    app,
    participants: [],
    session: session,
    meeting_speakers: {},
  };
  const fm = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return `---\n${fm}\n---\n\n## Minhas notas\n\n\n## Transcrição\n\n`;
}

export class MeetingNotes {
  private queue: Promise<unknown> = Promise.resolve();
  private states = new Map<string, State>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private committedListeners = new Set<
    (session: string, segments: MeetingSegment[]) => void
  >();
  private recreatedListeners = new Set<(session: string, path: string) => void>();

  /**
   * A nota da reunião sumiu no meio da gravação (apagada, ou com o `type` mudado) e foi recriada (T7723): a fala que vem
   * depois vai para a nota nova, e quem ouve avisa a pessoa.
   */
  onRecreated(listener: (session: string, path: string) => void): () => void {
    this.recreatedListeners.add(listener);
    return () => this.recreatedListeners.delete(listener);
  }

  /** R3 can release audio only after this notification: the batch is already persisted in the vault. */
  onCommitted(
    listener: (session: string, segments: MeetingSegment[]) => void,
  ): () => void {
    this.committedListeners.add(listener);
    return () => this.committedListeners.delete(listener);
  }
  constructor(
    private readonly vault: MeetingVault,
    private readonly options: {
      now?: () => number;
      flushMs?: number;
      onError?: (e: unknown) => void;
      onCommitted?: (session: string, segments: MeetingSegment[]) => void;
    } = {},
  ) {}
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  start(
    session: string,
    app = "Reunião",
    at = new Date(this.options.now?.() ?? Date.now()),
  ): Promise<Note> {
    return this.serialize(async () => {
      validateSession(session);
      if (
        typeof app !== "string" ||
        app.length > 200 ||
        !Number.isFinite(at.getTime())
      )
        throw new VaultError("E_BAD_ARGS", "invalid meeting start");
      await this.vault.open();
      const existing = await this.find(session);
      if (existing) return existing;
      const title = `${localDate(at.getTime())} ${clock(at).replace(":", "h")} ${app === "Reunião" ? app : `Reunião do ${app}`}`;
      const note = await this.vault.create(MEETINGS_FOLDER, title, newMeetingNote(session, app, at));
      this.states.set(session, {
        session,
        path: note.path,
        start: at.getTime(),
        app,
        pending: [],
      });
      return note;
    });
  }
  private async find(session: string): Promise<Note | null> {
    const state = this.states.get(session);
    const paths = [
      ...new Set([
        ...(state ? [state.path] : []),
        ...this.vault.notesContaining(session).map((n) => n.path),
      ]),
    ];
    for (const path of paths) {
      const note = await this.vault.get(path).catch(() => null);
      if (
        note &&
        isMeetingNote(note.content) &&
        dataOf(note.content).session === session
      ) {
        const start = Date.parse(String(dataOf(note.content).start));
        if (!Number.isFinite(start))
          throw new VaultError("E_BAD_ARGS", "invalid meeting date");
        if (state) state.path = path;
        else this.states.set(session, { session, path, start, app: typeof dataOf(note.content).app === "string" ? dataOf(note.content).app : "Reunião", pending: [] });
        return note;
      }
    }
    return null;
  }
  /**
   * A nota da reunião, recriada se ela sumiu no meio da gravação (T7723): apagada, ou que deixou de ser reconhecida (o
   * `type` ou o `session` mudados nas propriedades). Sem isso, a fala que vinha depois não ia para nota nenhuma, calada.
   * A nova tem o mesmo `session`, a mesma pasta e o mesmo nome (com " 2" se o nome ainda está ocupado); a de antes, se
   * ficou, não é mais da reunião, e o `find()` acha sempre a nova. Só com a reunião em curso neste processo (`state`).
   */
  private async noteFor(session: string): Promise<Note | null> {
    const found = await this.find(session);
    const state = this.states.get(session);
    if (found || !state) return found;
    const slash = state.path.lastIndexOf("/");
    const folder = slash < 0 ? "" : state.path.slice(0, slash);
    const title = state.path.slice(slash + 1).replace(/\.md$/i, "");
    const note = await this.vault.create(folder, title, newMeetingNote(session, state.app, new Date(state.start)));
    state.path = note.path;
    for (const listener of this.recreatedListeners) {
      try {
        listener(session, note.path);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    return note;
  }
  segment(session: string, segment: MeetingSegment): Promise<void> {
    return this.serialize(async () => {
      validateSession(session);
      validateSegment(segment);
      if (!segment.final || !segment.text.trim()) return;
      const note = await this.noteFor(session);
      if (!note) throw new VaultError("E_NOT_FOUND", "meeting note not found");
      // R3: after a crash the helper transcribes again what was left in its spool (the system channel stays whole
      // until the end, #5131). What ends before the saved progress of the channel is already in the note: it counts
      // as saved, so its audio can go, and the note doesn't get it twice.
      const progress = dataOf(note.content).meeting_progress;
      const saved = segment.channel && progress && typeof progress[segment.channel] === "number" ? progress[segment.channel] : undefined;
      let kept: MeetingSegment = { ...segment };
      if (saved !== undefined && segment.start < saved) {
        // Cut at the word: only what ends after the saved progress goes in (#5168). Without word times, a segment
        // that crosses it goes in whole, and one that ends before it counts as saved.
        const words = Array.isArray(segment.words) ? segment.words.filter((w) => w && Number.isFinite(w.end) && typeof w.text === "string") : [];
        const after = words.filter((w) => w.end > saved + 0.01);
        if (segment.end <= saved || (words.length && !after.length)) {
          const batch = [{ ...segment }];
          queueMicrotask(() => this.notify(session, batch));
          return;
        }
        if (words.length && after.length < words.length)
          kept = { ...segment, start: after[0]!.start, text: after.map((w) => w.text).join(" "), words: after };
      }
      this.states.get(session)!.pending.push(kept);
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch((e) => this.options.onError?.(e));
      }, this.options.flushMs ?? 5000);
      this.timer.unref?.();
    });
  }
  flush(): Promise<void> {
    return this.serialize(async () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      for (const state of this.states.values())
        if (state.pending.length || state.end !== undefined)
          await this.flushState(state);
    });
  }
  finish(
    session: string,
    at = new Date(this.options.now?.() ?? Date.now()),
  ): Promise<void> {
    return this.serialize(async () => {
      validateSession(session);
      if (!(await this.noteFor(session)))
        throw new VaultError("E_NOT_FOUND", "meeting note not found");
      const state = this.states.get(session)!;
      if (!Number.isFinite(at.getTime()) || at.getTime() < state.start)
        throw new VaultError("E_BAD_ARGS", "invalid meeting end");
      state.end = at.getTime();
      await this.flushState(state);
    });
  }
  private async mutate(
    path: string,
    change: (note: Note) => string,
  ): Promise<Note> {
    let note = await this.vault.get(path);
    for (let tries = 0; tries < 5; tries++) {
      const content = change(note);
      if (content === note.content) return note;
      const saved = await this.vault.save(note.path, content, note.version);
      if (saved.saved) return { ...saved.meta, content };
      note = saved.current;
    }
    throw new VaultError(
      "E_CONFLICT",
      "meeting note kept changing; pending text retained",
    );
  }
  private async flushState(state: State): Promise<void> {
    const note = await this.noteFor(state.session);
    if (!note)
      throw new VaultError(
        "E_NOT_FOUND",
        "meeting note not found; pending text retained",
      );
    const batch = [...state.pending].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    await this.mutate(note.path, (current) => {
      const data = dataOf(current.content);
      const speakers: Record<string, string> = {
        ...(data.meeting_speakers ?? {}),
      };
      const participants: string[] = Array.isArray(data.participants)
        ? data.participants.filter((v: unknown) => typeof v === "string")
        : [];
      let content = current.content;
      for (const s of batch) {
        const ref = refOf(state.session, s);
        if (content.includes(refPrefix(state.session, s))) continue;
        const name = Object.hasOwn(speakers, s.speaker)
          ? speakers[s.speaker]!
          : s.speaker;
        Object.defineProperty(speakers, s.speaker, {
          value: name,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (!participants.includes(name)) participants.push(name);
        const time = clock(new Date(state.start + s.start * 1000));
        content = appendMeetingTranscript(
          content,
          `**${time} · ${escape(name)}:** ${escape(s.text.trim().replace(/\s+/g, " "))} ${ref}`,
        );
      }
      content = setMeetingField(content, "participants", participants);
      content = setMeetingField(content, "meeting_speakers", speakers);
      // R3: how far each channel is saved, for the recovery after a crash (see `segment`).
      const progress: Record<string, number> = { ...(typeof data.meeting_progress === "object" && data.meeting_progress ? data.meeting_progress : {}) };
      for (const s of batch) if (s.channel) progress[s.channel] = Math.max(progress[s.channel] ?? 0, s.end);
      if (Object.keys(progress).length) content = setMeetingField(content, "meeting_progress", progress);
      if (state.end !== undefined) {
        content = setMeetingField(
          content,
          "end",
          new Date(state.end).toISOString(),
        );
        content = setMeetingField(
          content,
          "duration",
          (state.end - state.start) / 1000,
        );
      }
      return content;
    });
    state.pending.splice(0, batch.length);
    state.end = undefined;
    this.notify(state.session, batch);
  }
  private notify(session: string, batch: MeetingSegment[]): void {
    this.options.onCommitted?.(session, batch);
    for (const listener of this.committedListeners) {
      try {
        listener(session, batch);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
  }
  /** O caminho da nota da reunião desta sessão, ou null (spec #8360: a transcrição pronta vai ao agente por ele). */
  async pathOf(session: string): Promise<string | null> {
    validateSession(session);
    return (await this.find(session))?.path ?? null;
  }
  async speakers(path: string): Promise<string[]> {
    await this.vault.open();
    const data = dataOf((await this.vault.get(path)).content);
    return Array.isArray(data.participants)
      ? data.participants.filter(
          (v: unknown): v is string => typeof v === "string",
        )
      : [];
  }
  renameSpeaker(path: string, from: string, to: string): Promise<NoteMeta> {
    return this.serialize(async () => {
      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        !to.trim() ||
        to.length > 100 ||
        /[\r\n]/.test(to)
      )
        throw new VaultError("E_BAD_ARGS", "invalid speaker name");
      await this.vault.open();
      const note = await this.mutate(path, (current) => {
        const data = dataOf(current.content);
        const names = Array.isArray(data.participants) ? data.participants : [];
        if (!names.includes(from))
          throw new VaultError("E_BAD_ARGS", "speaker not found");
        const name = to.trim();
        if (name !== from && names.includes(name))
          throw new VaultError("E_EXISTS", "speaker name already in use");
        const mapping: Record<string, string> = {
          ...(data.meeting_speakers ?? {}),
        };
        for (const key of names)
          if (
            !Object.hasOwn(mapping, key) &&
            !Object.values(mapping).includes(key)
          )
            Object.defineProperty(mapping, key, {
              value: key,
              enumerable: true,
              writable: true,
              configurable: true,
            });
        for (const [key, value] of Object.entries(mapping))
          if (value === from) mapping[key] = name;
        const split = splitMeetingNote(current.content),
          section = transcriptSection(split.body);
        let body = split.body;
        if (section) {
          const label = escape(from);
          const re = new RegExp(
            `^(\\*\\*\\d\\d:\\d\\d · )${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:\\*\\*)`,
            "gm",
          );
          body =
            body.slice(0, section.from) +
            body
              .slice(section.from, section.to)
              .replace(re, (_, a, b) => a + escape(name) + b) +
            body.slice(section.to);
        }
        return setMeetingField(
          setMeetingField(
            split.frontmatter + body,
            "participants",
            names.map((s: string) => (s === from ? name : s)),
          ),
          "meeting_speakers",
          mapping,
        );
      });
      return metaOf(note);
    });
  }
  /**
   * R3 (T4943, option B of #5131): after the meeting, the VBx corrects who said what on the system channel. It works on
   * the blocks saved in the note (their comment says time, channel and ASR label), so it applies even when a replay
   * cut the segments differently, or a Sortformer run again after a crash numbered the speakers differently (#5168).
   * The line keeps its time and text and shows the new label's name through `meeting_speakers`: a speaker the person
   * renamed keeps that name. The block's hash follows the new label, so a replay stays idempotent.
   *
   * `failed`: the VBx couldn't run even after a second try (#5176). The live labels stay, and a discreet line says so.
   * One conditional write (ADR 0007), after the session's pending finals. Resolves when it's on disk: only then may the
   * system channel's audio be released.
   */
  relabel(session: string, turns: MeetingTurn[], options: { failed?: boolean } = {}): Promise<{ changed: number }> {
    return this.serialize(async () => {
      validateSession(session);
      if (!Array.isArray(turns) || turns.length > 100_000) throw new VaultError("E_BAD_ARGS", "invalid relabel");
      for (const t of turns)
        if (!t || !Number.isInteger(t.speaker) || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end < t.start)
          throw new VaultError("E_BAD_ARGS", "invalid relabel");
      const note = await this.find(session);
      if (!note) throw new VaultError("E_NOT_FOUND", "meeting note not found");
      const state = this.states.get(session)!;
      if (state.pending.length) await this.flushState(state);
      if (!turns.length && !options.failed) return { changed: 0 };
      let changed = 0;
      await this.mutate(state.path, (current) => {
        changed = 0;
        const data = dataOf(current.content);
        const speakers: Record<string, string> = { ...(data.meeting_speakers ?? {}) };
        const nameOf = (label: string) => (Object.hasOwn(speakers, label) ? speakers[label]! : label);
        const split = splitMeetingNote(current.content);
        const section = transcriptSection(split.body);
        if (!section) return current.content;
        let transcript = split.body.slice(section.from, section.to);
        if (options.failed) {
          if (transcript.includes(SPEAKERS_NOT_REVIEWED)) return current.content;
          transcript = `${transcript.replace(/\s*$/, "")}\n\n${SPEAKERS_NOT_REVIEWED}\n`;
          changed = 1;
        } else {
          const blocks = blocksOf(transcript);
          const plan = planRelabel(blocks, turns);
          // From the end, so the earlier offsets stay right.
          for (const [i, to] of [...plan].sort((a, b) => b[0] - a[0])) {
            const b = blocks[i]!;
            const line = transcript.slice(b.lineStart, b.lineEnd);
            if (!Object.hasOwn(speakers, to))
              Object.defineProperty(speakers, to, { value: to, enumerable: true, writable: true, configurable: true });
            const moved: MeetingSegment = { start: b.start, end: b.end, channel: b.channel, speaker: to, text: "", final: true };
            const relabeled = line
              .replace(/^(\*\*\d\d:\d\d · )(.+?)(:\*\*)/, (_, a: string, _name: string, c: string) => a + escape(nameOf(to)) + c)
              .replace(/%%meeting-segment:[0-9a-f]{24} \{[^\n]*?\}%%/, () => refOf(session, moved));
            transcript = transcript.slice(0, b.lineStart) + relabeled + transcript.slice(b.lineEnd);
            changed++;
          }
        }
        if (!changed) return current.content;
        // The participants are the names still speaking in the transcript, in the order they were, plus the new ones.
        const spoken = new Set([...transcript.matchAll(/^\*\*\d\d:\d\d · (.+?):\*\*/gm)].map((m) => m[1]!.replace(/\\(.)/g, "$1")));
        const before: string[] = Array.isArray(data.participants) ? data.participants.filter((v: unknown): v is string => typeof v === "string") : [];
        const participants = [...before.filter((n) => spoken.has(n)), ...[...spoken].filter((n) => !before.includes(n))];
        const body = split.body.slice(0, section.from) + transcript + split.body.slice(section.to);
        return setMeetingField(setMeetingField(split.frontmatter + body, "participants", participants), "meeting_speakers", speakers);
      });
      return { changed };
    });
  }
  /** Com a base, uma edição sobre uma versão velha é juntada com a de agora: o rebase da reunião, ou o merge de 3 vias (T5454); só um trecho mudado nos dois lados volta como conflito. */
  async saveEdit(
    path: string,
    content: string,
    baseVersion: string,
    baseContent?: string,
  ): Promise<SaveResult & { content?: string }> {
    if (baseContent === undefined)
      return this.vault.save(path, content, baseVersion);
    if (
      typeof baseContent !== "string" ||
      baseContent.length > 5_000_000 ||
      createHash("sha256").update(baseContent).digest("hex").slice(0, 16) !==
        baseVersion
    )
      throw new VaultError("E_BAD_ARGS", "invalid edit base");
    let current = await this.vault.get(path);
    for (let tries = 0; tries < 5; tries++) {
      const merged =
        current.version === baseVersion
          ? content
          : mergeNoteEdit(baseContent, content, current.content);
      if (merged === null) return { saved: false, current };
      const result = await this.vault.save(path, merged, current.version);
      if (result.saved)
        return {
          ...result,
          ...(merged !== content ? { content: merged } : {}),
        };
      current = result.current;
    }
    return { saved: false, current };
  }
}
