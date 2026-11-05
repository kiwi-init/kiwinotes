// Pure Markdown operations shared by the meeting writer and the editor. No platform API or filesystem.
export const MEETING_FIELDS = [
  "participants",
  "meeting_speakers",
  "end",
  "duration",
  // R3: how far each channel is saved (the recovery after a crash).
  "meeting_progress",
] as const;
const FM = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;
export function splitMeetingNote(content: string) {
  const match = FM.exec(content);
  return {
    frontmatter: match?.[0] ?? "",
    body: content.slice(match?.[0].length ?? 0),
  };
}
export function isMeetingNote(content: string): boolean {
  return /^type:[ \t]*(?:meeting|"meeting"|'meeting')[ \t]*\r?$/m.test(
    splitMeetingNote(content).frontmatter,
  );
}
export function meetingField(
  frontmatter: string,
  key: string,
): string | undefined {
  return new RegExp(`^${key}:[ \\t]*(.*)\\r?$`, "m")
    .exec(frontmatter)?.[1]
    ?.trim();
}
export function setMeetingField(
  content: string,
  key: string,
  value: unknown,
): string {
  const { frontmatter, body } = splitMeetingNote(content);
  if (!frontmatter) return content;
  // Only owned metadata is changed; unknown fields, comments and the person's body remain byte-for-byte.
  const re = new RegExp(
    `^${key}:[^\\n]*(?:\\n(?:[ \\t]+[^\\n]*|-[ \\t]+[^\\n]*))*`,
    "m",
  );
  const line = `${key}: ${JSON.stringify(value)}`;
  const next = re.test(frontmatter)
    ? frontmatter.replace(re, () => line)
    : frontmatter.replace(
        /\r?\n---([^\S\r\n]*)(\r?\n|$)$/,
        `\n${line}\n---$1$2`,
      );
  return next + body;
}

/** The real ## Transcrição section, not a heading inside a fenced code example. */
export function transcriptSection(
  body: string,
): { from: number; to: number } | null {
  let fence = "",
    from = -1,
    offset = 0;
  for (const line of body.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
    } else if (!fence) {
      if (/^## Transcrição[ \t]*\r?\n?$/.test(line) && from < 0)
        from = offset + line.length;
      else if (from >= 0 && /^#{1,2}\s/.test(line)) return { from, to: offset };
    }
    offset += line.length;
  }
  return from < 0 ? null : { from, to: body.length };
}
export function appendMeetingTranscript(
  content: string,
  block: string,
): string {
  const { frontmatter, body } = splitMeetingNote(content);
  const section = transcriptSection(body);
  if (!section)
    return `${content}${content.endsWith("\n") ? "" : "\n"}\n## Transcrição\n\n${block}\n`;
  const prefix = body.slice(0, section.to);
  return (
    frontmatter +
    prefix +
    (prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n") +
    block +
    "\n\n" +
    body.slice(section.to)
  );
}

/** A narrow three-way merge: only the meeting writer's append + owned metadata may change on disk. Any other
 * concurrent edit keeps the normal conflict flow. The person's edited body is never replaced by a stale snapshot. */
export function rebaseMeetingEdit(
  base: string,
  edited: string,
  current: string,
): string | null {
  if (![base, edited, current].every(isMeetingNote)) return null;
  const b = splitMeetingNote(base),
    e = splitMeetingNote(edited),
    c = splitMeetingNote(current);
  const session = meetingField(b.frontmatter, "session");
  if (
    !session ||
    meetingField(c.frontmatter, "session") !== session ||
    meetingField(e.frontmatter, "session") !== session
  )
    return null;
  const strip = (fm: string) =>
    MEETING_FIELDS.reduce(
      (s, key) =>
        s.replace(
          new RegExp(
            `^${key}:[^\\n]*(?:\\n(?:[ \\t]+[^\\n]*|-[ \\t]+[^\\n]*))*\\n?`,
            "m",
          ),
          "",
        ),
      fm,
    );
  if (strip(b.frontmatter) !== strip(c.frontmatter)) return null;
  const bs = transcriptSection(b.body),
    cs = transcriptSection(c.body),
    es = transcriptSection(e.body);
  if (
    !bs ||
    !cs ||
    !es ||
    b.body.slice(0, bs.from) !== c.body.slice(0, cs.from) ||
    b.body.slice(bs.to) !== c.body.slice(cs.to)
  )
    return null;
  const before = b.body.slice(bs.from, bs.to),
    after = c.body.slice(cs.from, cs.to);
  if (!after.startsWith(before)) return null;
  const added = after.slice(before.length);
  const extra =
    added && e.body.slice(es.from, es.to).includes(added) ? "" : added;
  let merged =
    e.frontmatter + e.body.slice(0, es.to) + extra + e.body.slice(es.to);
  for (const key of MEETING_FIELDS) {
    const old = meetingField(b.frontmatter, key),
      mine = meetingField(e.frontmatter, key),
      theirs = meetingField(c.frontmatter, key);
    if (mine !== old && mine !== theirs) return null;
    if (theirs !== undefined) {
      try {
        merged = setMeetingField(merged, key, JSON.parse(theirs));
      } catch {
        return null;
      }
    }
  }
  return merged;
}
