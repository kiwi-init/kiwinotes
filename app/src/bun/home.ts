// Os dados da tela de Início (spec #15728, T15847): o `home.today` junta, das notas, do histórico do ditado e das
// reuniões, o que a tela mostra (os tipos em `shared/home.ts`). Tudo lido no Mac, nada chama o agente. O `HomeChanges`
// avisa a tela (`home.changed`) quando algo disso muda, com um debounce para uma rajada virar um aviso só.
import { HOME_LIMITS, type HomeContinue, type HomeDictation, type HomeMeeting, type HomeNote, type HomeToday } from "../shared/home.ts";
import { frontmatterOf } from "../shared/meetings.ts";
import { isMeetingNote, splitMeetingNote } from "../shared/meeting-note.ts";
import type { HistoryEntry, HistoryPage } from "../store/history.ts";
import { localDate, type Note, type NoteMeta } from "../notes/vault.ts";
import { listMeetings } from "./meetings.ts";

/** O pedaço do vault que a tela usa: a lista, uma nota e a busca no texto (o índice em memória). */
export interface HomeNotes {
  list(opts: { lazy: true }): { notes: NoteMeta[] };
  get(path: string): Promise<Note>;
  notesContaining(text: string): NoteMeta[];
}

export interface HomeSources {
  /** As notas da pasta aberta: o "continuar" e as editadas hoje. */
  notes: HomeNotes;
  /** As notas onde as reuniões são gravadas (a pasta interna do app). Pode ser a mesma de `notes`. */
  meetings: HomeNotes;
  history: { search(p: { limit?: number; before?: string }): Promise<HistoryPage> };
  /** O `session` da gravação de agora, ou null: essa reunião não é a "última". */
  liveSession: string | null;
  now: number;
}

/** Quantos ditados o histórico devolve por página, para achar os 3 de hoje que deram certo. */
const HISTORY_PAGE = 30;

export async function homeToday(src: HomeSources): Promise<HomeToday> {
  const [notes, dictationsToday, lastMeeting] = await Promise.all([recentNotes(src), dictations(src), meeting(src)]);
  return { ...notes, dictationsToday, lastMeeting };
}

/** A pasta onde a nota está, só o último nome; `null` na raiz. */
const folderOf = (m: NoteMeta) => m.folder.split("/").filter(Boolean).at(-1) ?? null;

const homeNote = (m: NoteMeta): HomeNote => ({ path: m.path, title: m.title, folder: folderOf(m), editedAt: Date.parse(m.mtime) });

async function recentNotes(src: HomeSources): Promise<Pick<HomeToday, "continue" | "editedToday">> {
  const today = localDate(src.now);
  // Só as que têm `type:` no texto podem ser de reunião; o resto nem é lido.
  const maybeMeeting = new Set(src.notes.notesContaining("type:").map((m) => m.path));
  const byDate = [...src.notes.list({ lazy: true }).notes].sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  let first: { meta: NoteMeta; content: string } | null = null;
  const editedToday: HomeNote[] = [];
  for (const meta of byDate) {
    const mtime = Date.parse(meta.mtime);
    if (Number.isNaN(mtime)) continue;
    // Já tem o "continuar" e a nota é de outro dia: as próximas também são.
    if (first && localDate(mtime) !== today) break;
    let content: string | null = null;
    if (!first || maybeMeeting.has(meta.path)) {
      content = (await src.notes.get(meta.path).catch(() => null))?.content ?? null;
      if (content === null) continue; // sumiu entre a lista e a leitura
      if (isMeetingNote(content)) continue;
    }
    if (!first) first = { meta, content: content! };
    else editedToday.push(homeNote(meta));
    if (editedToday.length >= HOME_LIMITS.editedToday) break;
  }
  const cont: HomeContinue | null = first ? { ...homeNote(first.meta), excerpt: excerptOf(first.content, first.meta.title) } : null;
  return { continue: cont, editedToday };
}

/** O começo do texto, sem frontmatter, títulos nem marcação, numa linha só, até ~140 caracteres. */
/** O carimbo que a nota rápida põe embaixo do ditado (`*🎙 ditado às 14:30*`, `notes/fromDictation.ts`), já sem o itálico. */
const DICTATION_STAMP = /^🎙\s*ditado às \d{1,2}:\d{2}$/;

export function excerptOf(content: string, title = ""): string {
  const body = splitMeetingNote(content).body
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/%%[\s\S]*?%%/g, " ");
  // Os títulos ficam de fora: o trecho é o texto da nota, não "Resumo Decisões".
  const lines = body.split(/\r?\n/).filter((l) => !/^\s{0,3}#{1,6}(\s|$)/.test(l)).map((l) =>
    l
      .replace(/^\s{0,3}(>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~|==|`)/g, "")
      .replace(/(^|[\s(])[*_]([^*_]+)[*_]/g, "$1$2")
      .trim(),
  ).filter((l) => l && !/^[-*_]{3,}$/.test(l) && !/^\|.*\|$/.test(l) && !DICTATION_STAMP.test(l));
  // A 1ª linha que só repete o título (sem `#`) também sai.
  if (lines[0] && title && lines[0].toLowerCase() === title.trim().toLowerCase()) lines.shift();
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const max = HOME_LIMITS.excerpt;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

async function dictations(src: HomeSources): Promise<HomeDictation[]> {
  const today = localDate(src.now);
  const out: HomeDictation[] = [];
  let before: string | undefined;
  // O histórico vem do mais novo para o mais velho: para no primeiro de outro dia.
  for (let page = 0; page < 5; page++) {
    const got = await src.history.search({ limit: HISTORY_PAGE, before });
    for (const e of got.entries) {
      const at = Date.parse(e.at);
      if (Number.isNaN(at)) continue;
      if (localDate(at) !== today) return out;
      if (!usable(e)) continue;
      out.push({ id: e.id, text: e.text.trim(), app: e.app?.name?.trim() || null, at });
      if (out.length >= HOME_LIMITS.dictationsToday) return out;
    }
    if (!got.nextBefore) break;
    before = got.nextBefore;
  }
  return out;
}

/** Um ditado que deu texto: nem o que ficou na recuperação (falhou), nem o vazio. */
const usable = (e: HistoryEntry) => !e.recoveryError && e.text.trim().length > 0;

async function meeting(src: HomeSources): Promise<HomeMeeting | null> {
  const list = await listMeetings(src.meetings, src.liveSession);
  const m = list.find((x) => !x.live);
  if (!m) return null;
  const startedAt = Date.parse(m.start ?? `${m.date}T00:00:00`);
  const minutes = await minutesOf(m.path, src);
  return {
    path: m.path,
    title: m.title,
    startedAt,
    durationMin: m.duration === null ? null : Math.max(1, Math.round(m.duration / 60)),
    people: m.participants,
    summary: minutes ? summaryOf(minutes.content) : [],
    minutesPath: minutes?.path ?? null,
    minutesInternal: minutes?.internal ?? false,
  };
}

/** A ata da reunião: a nota (na pasta aberta ou na das reuniões) cujo `reuniao:` aponta para ela; a mais nova. */
async function minutesOf(meetingPath: string, src: HomeSources): Promise<{ path: string; content: string; internal: boolean } | null> {
  const target = meetingPath.replace(/\.md$/i, "");
  // Com uma pasta só (a aberta é a interna), a ata está na interna.
  const same = src.notes === src.meetings;
  const vaults = same ? [{ v: src.notes, internal: true }] : [{ v: src.notes, internal: false }, { v: src.meetings, internal: true }];
  const found: { path: string; content: string; mtime: number; internal: boolean }[] = [];
  for (const { v, internal } of vaults) {
    for (const meta of v.notesContaining(`[[${target}`)) {
      const note = await v.get(meta.path).catch(() => null);
      if (!note) continue;
      const link = frontmatterOf(note.content)?.reuniao;
      if (typeof link !== "string" || linkTarget(link) !== target) continue;
      found.push({ path: note.path, content: note.content, mtime: Date.parse(note.mtime), internal });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ?? null;
}

/** `[[Reuniões/x|Nome]]` → `Reuniões/x`. */
const linkTarget = (link: string) => /^\s*\[\[([^\]|#]*)/.exec(link)?.[1]?.trim().replace(/\.md$/i, "") ?? null;

/** Até 3 itens do "Resumo" da ata (em tópicos ou em frases), ou das "Decisões" quando não há resumo. */
export function summaryOf(content: string): string[] {
  const body = splitMeetingNote(content).body;
  for (const title of ["Resumo", "Decisões"]) { // i18n-ok: os títulos que a ata da reunião tem no vault
    const items = itemsOf(sectionText(body, title));
    if (items.length) return items.slice(0, HOME_LIMITS.summary);
  }
  return [];
}

/** O texto de uma seção `## Título` (com ou sem número, `## 1. Título`), até o próximo título do mesmo nível ou maior. */
function sectionText(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+(\\d+\\.\\s+)?${title}\\s*$`, "i").test(l.trim()));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function itemsOf(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^([-*+]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "").trim());
  if (bullets.length) return bullets.filter(Boolean);
  const prose = lines.join(" ").replace(/\s+/g, " ").trim();
  // Corta no espaço depois da pontuação: o ponto de "R$ 1.500", "2.0" ou "17.11" não é fim de frase.
  return prose ? prose.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * O aviso `home.changed`: cada `poke()` (uma nota, um ditado, uma reunião que mudou) adia o aviso; ele sai uma vez,
 * `delayMs` depois da última. `stop()` cancela o que estava para sair.
 */
export class HomeChanges {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly send: () => void, private readonly delayMs = 500) {}
  poke(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send();
    }, this.delayMs);
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
