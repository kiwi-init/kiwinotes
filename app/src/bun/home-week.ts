// A Semana da aba Início (T15875, harry #15873): os 7 dias até hoje, com as notas editadas, as reuniões e os ditados
// de cada um, e os números da semana. Só lê os arquivos e o histórico do Mac: nada chama o agente.
//
// Uma nota conta no dia da sua última edição: o vault guarda só o `mtime`, não cada edição.
import { type HomeNote, type HomeWeek, type WeekDay, WEEK_LIMITS } from "../shared/home.ts";
import { isMeetingNote } from "../shared/meeting-note.ts";
import type { HistoryEntry } from "../store/history.ts";
import { localDate, type NoteMeta } from "../notes/vault.ts";
import type { HomeSources } from "./home.ts";
import { listMeetings } from "./meetings.ts";

/** Quantos ditados por página do histórico, e até quantas páginas: uma semana cheia sem varrer o histórico todo. */
const HISTORY_PAGE = 200;
const HISTORY_PAGES = 25;

export async function homeWeek(src: HomeSources): Promise<HomeWeek> {
  const days = lastDays(src.now);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const oldest = days.at(-1)!.date;
  await Promise.all([addNotes(src, byDate, oldest), addMeetings(src, byDate), addDictations(src, byDate, oldest)]);
  const totals = { notes: 0, meetings: 0, meetingMin: 0, dictations: 0, words: 0 };
  for (const d of days) {
    totals.notes += d.notes.length + d.moreNotes;
    totals.meetings += d.meetings.length;
    totals.meetingMin += d.meetings.reduce((s, m) => s + (m.durationMin ?? 0), 0);
    totals.dictations += d.dictations;
    totals.words += d.words;
  }
  return { days, totals };
}

/** Hoje e os 6 dias antes, no dia local (a conta é pelo calendário, então a troca de horário de verão não pula dia). */
function lastDays(now: number): WeekDay[] {
  const t = new Date(now);
  return Array.from({ length: WEEK_LIMITS.days }, (_, i) => ({
    date: localDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i, 12).getTime()),
    notes: [],
    moreNotes: 0,
    meetings: [],
    dictations: 0,
    words: 0,
  }));
}

async function addNotes(src: HomeSources, byDate: Map<string, WeekDay>, oldest: string): Promise<void> {
  // Só as que têm `type:` no texto podem ser de reunião; o resto nem é lido.
  const maybeMeeting = new Set(src.notes.notesContaining("type:").map((m) => m.path));
  const inWeek = src.notes
    .list({ lazy: true })
    .notes.map((meta) => ({ meta, at: Date.parse(meta.mtime) }))
    .filter((n) => !Number.isNaN(n.at) && localDate(n.at) >= oldest && byDate.has(localDate(n.at)))
    .sort((a, b) => b.at - a.at);
  for (const { meta, at } of inWeek) {
    if (maybeMeeting.has(meta.path)) {
      const note = await src.notes.get(meta.path).catch(() => null);
      if (!note || isMeetingNote(note.content)) continue;
    }
    const day = byDate.get(localDate(at))!;
    if (day.notes.length < WEEK_LIMITS.notesPerDay) day.notes.push(homeNote(meta, at));
    else day.moreNotes++;
  }
}

const homeNote = (m: NoteMeta, at: number): HomeNote => ({
  path: m.path,
  title: m.title,
  folder: m.folder.split("/").filter(Boolean).at(-1) ?? null,
  editedAt: at,
});

async function addMeetings(src: HomeSources, byDate: Map<string, WeekDay>): Promise<void> {
  for (const m of await listMeetings(src.meetings, src.liveSession)) {
    if (m.live) continue; // a que grava agora entra quando terminar
    const startedAt = Date.parse(m.start ?? `${m.date}T00:00:00`);
    if (Number.isNaN(startedAt)) continue;
    const day = byDate.get(localDate(startedAt));
    if (!day) continue;
    day.meetings.push({
      path: m.path,
      title: m.title,
      startedAt,
      durationMin: m.duration === null ? null : Math.max(1, Math.round(m.duration / 60)),
      internal: src.meetings !== src.notes,
    });
  }
  for (const d of byDate.values()) d.meetings.sort((a, b) => b.startedAt - a.startedAt);
}

async function addDictations(src: HomeSources, byDate: Map<string, WeekDay>, oldest: string): Promise<void> {
  let before: string | undefined;
  // O histórico vem do mais novo para o mais velho: para no primeiro de antes da semana.
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const got = await src.history.search({ limit: HISTORY_PAGE, before });
    for (const e of got.entries) {
      const at = Date.parse(e.at);
      if (Number.isNaN(at)) continue;
      const date = localDate(at);
      if (date < oldest) return;
      const day = byDate.get(date);
      if (!day || !usable(e)) continue;
      day.dictations++;
      day.words += wordsOf(e.text);
    }
    if (!got.nextBefore) return;
    before = got.nextBefore;
  }
}

/** Um ditado que deu texto: nem o que ficou na recuperação (falhou), nem o vazio. */
const usable = (e: HistoryEntry) => !e.recoveryError && e.text.trim().length > 0;

export const wordsOf = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
