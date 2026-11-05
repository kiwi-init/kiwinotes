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
  rebaseMeetingEdit,
  setMeetingField,
  splitMeetingNote,
  transcriptSection,
} from "../shared/meeting-note.ts";

export interface MeetingSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  final: boolean;
  channel?: "mine" | "system";
}
interface State {
  session: string;
  path: string;
  start: number;
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
export class MeetingNotes {
  private queue: Promise<unknown> = Promise.resolve();
  private states = new Map<string, State>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private committedListeners = new Set<
    (session: string, segments: MeetingSegment[]) => void
  >();

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
      const note = await this.vault.create(
        "Reuniões",
        title,
        `---\n${fm}\n---\n\n## Minhas notas\n\n\n## Transcrição\n\n`,
      );
      this.states.set(session, {
        session,
        path: note.path,
        start: at.getTime(),
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
        else this.states.set(session, { session, path, start, pending: [] });
        return note;
      }
    }
    return null;
  }
  segment(session: string, segment: MeetingSegment): Promise<void> {
    return this.serialize(async () => {
      validateSession(session);
      validateSegment(segment);
      if (!segment.final || !segment.text.trim()) return;
      if (!(await this.find(session)))
        throw new VaultError("E_NOT_FOUND", "meeting note not found");
      this.states.get(session)!.pending.push({ ...segment });
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
      if (!(await this.find(session)))
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
    const note = await this.find(state.session);
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
        const ref = `%%meeting-segment:${idOf(state.session, s)}%%`;
        if (content.includes(ref)) continue;
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
    this.options.onCommitted?.(state.session, batch);
    for (const listener of this.committedListeners) {
      try {
        listener(state.session, batch);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
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
  /** Optional base content enables a safe append-only rebase; ordinary notes retain their normal conflict behavior. */
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
          : rebaseMeetingEdit(baseContent, content, current.content);
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
