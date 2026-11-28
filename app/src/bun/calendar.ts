// Os dados do Calendário (spec #32129, T32154): ler os itens das notas e das reuniões, criar e mudar, e os avisos. A
// tela (`calendar.*` do AppEngine, T32155) e as ferramentas do agente (T32156) chamam este serviço, e nada mais mexe
// nos itens.
//
// - **A fonte é o que já está no Mac:** as linhas `- [ ] … @ 2026-11-27 10:00` das notas (o mesmo leitor de linhas das
//   Pendências da Início, `listItems`), as notas com `agenda:` no frontmatter e as reuniões gravadas (`listMeetings`).
// - **Tudo volta para a nota:** criar escreve uma linha (ou uma nota), e mover, esticar ou concluir muda só aquela
//   linha, pelo `save` com a versão, como o editor. Uma linha que mudou de lugar é achada pelo hash do texto dela; uma
//   que sumiu ou mudou dá `E_CONFLICT`, e quem chamou lê de novo.
// - **Os projetos são as pastas de primeiro nível das Notas.**
// - Nada aqui chama o agente nem a rede.
import { createHash } from "node:crypto";

import {
  addDays,
  blockEndOf,
  bodyStartOf,
  CALENDAR_LIMITS,
  type CalendarCreate,
  type CalendarDelete,
  type CalendarItem,
  type CalendarItems,
  type CalendarKind,
  type CalendarNotify,
  type CalendarRepeat,
  type CalendarSource,
  type CalendarUndo,
  type CalendarUpdate,
  DEFAULT_NOTIFY,
  dayOf,
  formatWhen,
  isCalendarKind,
  isCalendarNotify,
  isCalendarRepeat,
  isDay,
  isDayTime,
  notifyAt,
  parseAgenda,
  parseWhen,
  rewriteWhen,
  sortedDays,
  titleProblem,
  toMs,
} from "../shared/calendar.ts";
import { isMeetingNote } from "../shared/meeting-note.ts";
import { frontmatterOf } from "../shared/meetings.ts";
import type { Note, NoteMeta, SaveResult } from "../notes/vault.ts";
import { excerptOf, type HomeNotes } from "./home.ts";
import { isMinutes, listItems, plain } from "./home-pending.ts";
import { listMeetings } from "./meetings.ts";

/** O pedaço do vault que o Calendário usa: o que a Início lê, mais as pastas, gravar e criar. */
export interface CalendarVault extends HomeNotes {
  list(opts: { lazy: true }): { notes: NoteMeta[]; folders?: string[] };
  save(path: string, content: string, baseVersion: string): Promise<SaveResult>;
  create(folder: string, title: string, content: string): Promise<Note>;
}

export interface CalendarSources {
  /** As Notas da pessoa: onde os itens moram e para onde os novos vão. */
  notes: CalendarVault;
  /** A pasta das reuniões gravadas; pode ser a mesma de `notes`. Só se lê dela. */
  meetings: HomeNotes;
  /** O `session` da gravação de agora: ela entra no calendário quando terminar. */
  liveSession: string | null;
  /** A língua das tags que o Kiwi escreve (`#lembrete` ou `#reminder`). */
  locale: "pt" | "en";
}

export type CalendarErrorCode = "E_BAD_ARGS" | "E_NOT_FOUND" | "E_CONFLICT" | "E_READONLY";
export class CalendarError extends Error {
  constructor(
    readonly code: CalendarErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Onde vai um item criado: a nota de pendências do projeto, ou o `Calendário.md` na raiz (spec #32129). */
export const PROJECT_NOTE = "Pendências"; // i18n-ok: nome de arquivo na pasta da pessoa, o mesmo em qualquer língua (spec #32129)
export const ROOT_NOTE = "Calendário"; // i18n-ok: nome de arquivo na pasta da pessoa, o mesmo em qualquer língua (spec #32129)

const lineHash = (raw: string) => createHash("sha256").update(raw.trim()).digest("hex").slice(0, 8);
/** A pasta de primeiro nível de um caminho; `null` na raiz. */
const projectOf = (path: string) => (path.includes("/") ? path.split("/")[0]! : null);
/** A linha de lista: o começo (recuo, citação, marcador), a caixa e o texto. */
const LIST_LINE = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+)(\[([ xX])\]\s+)?(.*)$/;

interface Located {
  vault: HomeNotes;
  internal: boolean;
}

/** O dia de hoje (AAAA-MM-DD, na hora local); os testes passam um fixo. */
export type CalendarToday = () => string;

export function calendarService(sources: () => Promise<CalendarSources>, today: CalendarToday = () => dayOf(Date.now())) {
  /** As pastas onde ler: as Notas, e a das reuniões se for outra. */
  const vaults = (src: CalendarSources): Located[] =>
    src.meetings === src.notes ? [{ vault: src.notes, internal: false }] : [{ vault: src.notes, internal: false }, { vault: src.meetings, internal: true }];

  function projectsOf(src: CalendarSources): string[] {
    const l = src.notes.list({ lazy: true });
    const set = new Set<string>();
    for (const f of l.folders ?? []) {
      const top = f.split("/")[0];
      if (top && !top.startsWith(".")) set.add(top);
    }
    for (const n of l.notes) {
      const top = projectOf(n.path);
      if (top && !top.startsWith(".")) set.add(top);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  /** Os itens de uma nota (linhas e `agenda:`), com e sem data. */
  function itemsOfNote(note: Note, where: Located): { dated: CalendarItem[]; undated: CalendarItem[] } {
    const dated: CalendarItem[] = [];
    const undated: CalendarItem[] = [];
    if (isMeetingNote(note.content)) return { dated, undated };
    const project = where.internal ? null : projectOf(note.path);
    const source = (line: number | null) => ({ path: note.path, line, internal: where.internal });
    const agenda = parseAgenda(frontmatterOf(note.content)?.agenda);
    if (agenda) {
      const fm = frontmatterOf(note.content)!;
      dated.push({
        id: `f:${note.path}`,
        kind: "note",
        title: note.title,
        project,
        ...agenda,
        notify: noteNotify(fm.aviso) ?? DEFAULT_NOTIFY.note,
        detail: excerptOf(note.content, note.title),
        readOnly: false,
        source: source(null),
      });
    }
    const raw = note.content.split("\n");
    for (const it of listItems(note.content, isMinutes(note.content))) {
      const id = `n:${note.path}#${it.line}:${lineHash(raw[it.line] ?? "")}`;
      const when = parseWhen(it.rest);
      if (!when) {
        // Sem data: só a pendência aberta entra, no "sem data" do painel.
        if (it.box === " " || (it.box === null && it.inNextSteps)) {
          const title = plain(it.rest);
          if (title) undated.push({ id, kind: "task", title, project, start: "", end: null, allDay: true, done: false, notify: "none", readOnly: false, source: source(it.line) });
        }
        continue;
      }
      // Sem tag de tipo, só a caixa (ou um próximo passo da ata) faz um item: um tópico qualquer com uma data não.
      const kind: CalendarKind | null = when.kind ?? (it.box !== null || it.inNextSteps ? "task" : null);
      if (!kind) continue;
      const title = plain(when.title);
      if (!title) continue;
      dated.push({
        id,
        kind,
        title,
        project,
        start: when.start,
        end: when.end,
        allDay: when.allDay,
        ...(it.box !== null || kind === "task" ? { done: it.box === "x" } : {}),
        notify: when.notify ?? DEFAULT_NOTIFY[kind],
        ...(when.repeat ? { repeat: when.repeat } : {}),
        ...(when.repeat && when.skip.length ? { skip: when.skip } : {}),
        readOnly: false,
        source: source(it.line),
      });
    }
    return { dated, undated };
  }

  /**
   * Os itens já lidos de cada nota, pela versão do índice (#486). A conferência dos avisos roda a cada 30 s e lia do disco
   * toda nota com uma caixa aberta; agora só lê a que mudou desde a última vez. O `save` e o vigia de arquivos trocam a
   * versão no índice, então a nota mudada (no app ou fora dele) é relida na conferência seguinte.
   */
  const parsed = new Map<string, { version: string; got: { dated: CalendarItem[]; undated: CalendarItem[] } }>();

  /** Todas as notas que podem ter um item: uma data na linha, uma caixa aberta ou o `agenda:`. */
  async function readAll(src: CalendarSources): Promise<{ dated: CalendarItem[]; undated: CalendarItem[] }> {
    const dated: CalendarItem[] = [];
    const undated: CalendarItem[] = [];
    const seen = new Set<string>();
    for (const where of vaults(src)) {
      const candidates = new Map<string, NoteMeta>();
      for (const needle of ["@ 1", "@ 2", "@1", "@2", "[ ]", "agenda:", "reuniao:"]) for (const m of where.vault.notesContaining(needle)) candidates.set(m.path, m);
      for (const meta of candidates.values()) {
        const key = `${where.internal}:${meta.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let cached = parsed.get(key);
        if (cached?.version !== meta.version) {
          const note = await where.vault.get(meta.path).catch(() => null);
          if (!note) {
            parsed.delete(key);
            continue; // sumiu entre o índice e a leitura
          }
          // A versão da leitura, não a do índice: se o arquivo mudou no meio, a próxima conferência relê.
          cached = { version: note.version, got: itemsOfNote(note, where) };
          parsed.set(key, cached);
        }
        // Cópias: quem recebe os itens pode mudá-los, e o guardado tem de ficar como a nota está.
        dated.push(...cached.got.dated.map((it) => structuredClone(it)));
        undated.push(...cached.got.undated.map((it) => structuredClone(it)));
      }
    }
    // A nota que saiu das candidatas (apagada, ou sem caixa nem data) sai do guardado.
    for (const key of parsed.keys()) if (!seen.has(key)) parsed.delete(key);
    for (const m of await listMeetings(src.meetings, src.liveSession)) {
      if (m.live) continue;
      const startMs = m.start ? Date.parse(m.start) : Number.NaN;
      const endMs = m.end ? Date.parse(m.end) : Number.NaN;
      const timed = !Number.isNaN(startMs);
      dated.push({
        id: `m:${m.path}`,
        kind: "meeting",
        title: m.title,
        project: src.meetings === src.notes ? projectOf(m.path) : null,
        start: timed ? dayTimeOfMs(startMs) : m.date,
        end: timed && !Number.isNaN(endMs) && endMs > startMs ? dayTimeOfMs(endMs) : null,
        allDay: !timed,
        notify: "none",
        ...(m.participants.length ? { people: m.participants } : {}),
        readOnly: true,
        source: { path: m.path, line: null, internal: src.meetings !== src.notes },
      });
    }
    return { dated, undated };
  }

  async function items(args: { from: string; to: string }): Promise<CalendarItems> {
    if (!isDay(args.from) || !isDay(args.to) || args.to <= args.from) throw new CalendarError("E_BAD_ARGS", "from and to must be days (AAAA-MM-DD), from before to");
    if (args.to > addDays(args.from, CALENDAR_LIMITS.rangeDays)) throw new CalendarError("E_BAD_ARGS", `at most ${CALENDAR_LIMITS.rangeDays} days`);
    const src = await sources();
    const { dated, undated } = await readAll(src);
    const out: CalendarItem[] = [];
    for (const it of dated) out.push(...occurrences(it, args.from, args.to));
    out.sort((a, b) => toMs(a.start) - toMs(b.start) || a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id));
    undated.sort((a, b) => a.id.localeCompare(b.id));
    return { items: out, undated: undated.slice(0, CALENDAR_LIMITS.undated), projects: projectsOf(src) };
  }

  /** Acha a nota e a linha do item pelo id; a linha que mudou de lugar, pelo hash. */
  async function locate(src: CalendarSources, id: string) {
    const m = /^n:(.+)#(\d+):([0-9a-f]{8})(?:~(\d{4}-\d{2}-\d{2}))?$/.exec(id);
    if (!m) return null;
    const [, path, lineStr, hash, occurrence] = m as unknown as [string, string, string, string, string | undefined];
    for (const where of vaults(src)) {
      const note = await where.vault.get(path).catch(() => null);
      if (!note) continue;
      const raw = note.content.split("\n");
      // Só as linhas que o leitor das Pendências conta como item: nunca uma cópia num bloco de código, num `%% … %%` ou
      // no frontmatter (revisão #32219).
      const itemLines = listItems(note.content, isMinutes(note.content)).map((it) => it.line);
      let line = Number(lineStr);
      if (!itemLines.includes(line) || lineHash(raw[line] ?? "") !== hash) {
        line = itemLines.find((n) => lineHash(raw[n] ?? "") === hash) ?? -1;
        if (line < 0) throw new CalendarError("E_CONFLICT", "the item changed in the note; read again");
      }
      return { note, where, raw, line, occurrence: occurrence ?? null };
    }
    throw new CalendarError("E_NOT_FOUND", `no note ${path}`);
  }

  async function update(u: CalendarUpdate): Promise<CalendarItem> {
    checkUpdate(u);
    const src = await sources();
    if (u.id.startsWith("m:")) throw new CalendarError("E_READONLY", "a recorded meeting can't change");
    if (u.text !== undefined) return setText(src, u);
    if (u.project !== undefined) {
      if (u.id.startsWith("f:")) throw new CalendarError("E_BAD_ARGS", "calendar.update: a note with agenda changes folder in Notes");
      return moveToProject(src, u);
    }
    if (u.id.startsWith("f:")) return updateNote(src, u);
    // Duas tentativas: se a nota mudou entre ler e gravar, lê de novo e acha a linha pelo hash.
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = await locate(src, u.id);
      if (!at) throw new CalendarError("E_BAD_ARGS", "unknown id");
      if (at.where.internal) throw new CalendarError("E_READONLY", "the meetings folder is read-only here");
      const raw = at.raw[at.line]!;
      const cr = raw.endsWith("\r") ? "\r" : "";
      const parts = LIST_LINE.exec(raw.slice(0, raw.length - cr.length));
      if (!parts) throw new CalendarError("E_CONFLICT", "the item changed in the note; read again");
      const [, lead, , box, rest] = parts as unknown as [string, string, string | undefined, string | undefined, string];
      const cur = parseWhen(rest);
      if (u.only) {
        if (!cur?.repeat || !at.occurrence) throw new CalendarError("E_BAD_ARGS", "calendar.update: only is for one time of a repetition");
        const content = onlyThisTime(at.raw, at.line, { lead, box, rest, cr }, cur, at.occurrence, u, src.locale);
        const fresh = itemsOfNote({ ...at.note, content }, at.where);
        const item = [...fresh.dated, ...fresh.undated].find((i) => i.source?.line === at.line + 1);
        if (!item) throw new CalendarError("E_CONFLICT", "the item left the calendar");
        const res = await src.notes.save(at.note.path, content, at.note.version);
        if (!res.saved) continue;
        return item;
      }
      let patch: Parameters<typeof rewriteWhen>[1] = {};
      let newBox = box === undefined ? null : box === " " ? " " : "x";
      if (u.title !== undefined) patch.title = u.title;
      if (u.kind !== undefined) {
        patch.kind = u.kind;
        // A caixa acompanha o tipo, como no `create` (#529): pendência e lembrete têm, reunião e foco não. Sem a caixa, a
        // pendência (que não tem tag) deixaria de ser item.
        newBox = u.kind === "task" || u.kind === "reminder" ? (newBox ?? " ") : null;
      }
      if (u.notify !== undefined) patch.notify = u.notify === DEFAULT_NOTIFY[u.kind ?? cur?.kind ?? "task"] && !cur?.notify ? null : u.notify;
      if (u.repeat !== undefined) patch.repeat = u.repeat;
      if (u.start !== undefined || u.end !== undefined || u.allDay !== undefined) {
        // Mover uma vez de uma repetição move a série inteira pelo mesmo tanto.
        const shift = at.occurrence && cur && u.start !== undefined ? toMs(u.start) - toMs(at.occurrence === cur.start.slice(0, 10) ? cur.start : `${at.occurrence}${cur.start.slice(10)}`) : 0;
        const start = u.start !== undefined ? (at.occurrence && cur ? shiftBy(cur.start, shift) : u.start) : undefined;
        const asked = u.end !== undefined ? (u.end && at.occurrence && cur?.end ? shiftBy(cur.end, toMs(u.end) - toMs(occurrenceOf(cur.end, cur.start, at.occurrence))) : u.end) : undefined;
        // Só o start: o fim anda junto, e a duração fica, como no arrastar da tela (#449).
        const timed = u.allDay !== true && !!cur && !isDay(cur.start);
        const end = asked === undefined && start !== undefined && timed && cur?.end && !isDay(start) ? shiftBy(cur.end, toMs(start) - toMs(cur.start)) : asked;
        // Só um dos dois: o outro vem da linha, e o par passa pela mesma régua do checkTimes.
        const from = start ?? cur?.start;
        if (timed && typeof end === "string" && from && !isDay(from)) {
          if (toMs(end) <= toMs(from)) throw new CalendarError("E_BAD_ARGS", "calendar.update: end must be after start");
          if (toMs(end) - toMs(from) > CALENDAR_LIMITS.spanHours * 3_600_000) throw new CalendarError("E_BAD_ARGS", "calendar.update: at most 24 h");
        }
        patch = { ...patch, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), ...(u.allDay !== undefined ? { allDay: u.allDay } : {}) };
        if (!cur && start === undefined) throw new CalendarError("E_BAD_ARGS", "an undated item needs start");
      }
      // Mover a série leva junto as vezes já feitas (`⏭`), pelos mesmos dias.
      if (cur?.skip.length && patch.start !== undefined) {
        const days = Math.round((toMs(patch.start.slice(0, 10)) - toMs(cur.start.slice(0, 10))) / 86_400_000);
        if (days) patch.skip = cur.skip.map((d) => addDays(d, days));
      }
      if (u.done !== undefined) {
        if (u.done && cur?.repeat && at.occurrence) {
          const step = cur.repeat === "daily" ? 1 : 7;
          // A 1ª vez em aberto. Num lembrete, a vez que já passou sem o Feito não segura a série (#483): conta de hoje,
          // ou da vez marcada, se ela for antes. Numa pendência, a vez atrasada continua segurando.
          const from = cur.kind === "reminder" ? (at.occurrence < today() ? at.occurrence : today()) : "";
          let first = cur.start.slice(0, 10);
          while (first < from || cur.skip.includes(first)) first = addDays(first, step);
          if (at.occurrence !== first) {
            // Uma vez depois da 1ª em aberto: só ela sai da agenda (`⏭`), e as de antes seguem abertas (#450).
            patch = { ...patch, skip: [...cur.skip, at.occurrence] };
          } else {
            // O Feito na 1ª vez em aberto passa a série para a próxima (pulando as já feitas), e a caixa continua aberta.
            let next = addDays(first, step);
            while (cur.skip.includes(next)) next = addDays(next, step);
            const start = `${next}${cur.start.slice(10)}`;
            patch = { ...patch, start, ...(cur.end ? { end: shiftBy(cur.end, toMs(start) - toMs(cur.start)) } : {}), skip: cur.skip.filter((d) => d > next) };
          }
        } else newBox = u.done ? "x" : " ";
      }
      const newRest = Object.keys(patch).length ? rewriteWhen(rest, patch, src.locale) : rest;
      const line = `${lead}${newBox ? `[${newBox}] ` : ""}${newRest}${cr}`;
      const lines = [...at.raw];
      lines[at.line] = line;
      const content = lines.join("\n");
      // Confere antes de gravar: a linha nova ainda é um item (senão, nada muda na nota).
      const fresh = itemsOfNote({ ...at.note, content }, at.where);
      const item = [...fresh.dated, ...fresh.undated].find((i) => i.source?.line === at.line);
      if (!item) throw new CalendarError("E_CONFLICT", "the item left the calendar");
      const res = await src.notes.save(at.note.path, content, at.note.version);
      if (!res.saved) continue;
      return item;
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  /** O item de uma nota inteira (`agenda:`): muda o frontmatter, e o título não (é o nome do arquivo). */
  async function updateNote(src: CalendarSources, u: CalendarUpdate): Promise<CalendarItem> {
    const path = u.id.slice(2);
    if (u.title !== undefined || u.done !== undefined || u.kind !== undefined || u.repeat !== undefined)
      throw new CalendarError("E_BAD_ARGS", "a note item only changes start, end, allDay and notify");
    for (let attempt = 0; attempt < 2; attempt++) {
      const note = await src.notes.get(path).catch(() => null);
      if (!note) throw new CalendarError("E_NOT_FOUND", `no note ${path}`);
      const cur = parseAgenda(frontmatterOf(note.content)?.agenda);
      if (!cur) throw new CalendarError("E_CONFLICT", "the note has no agenda anymore; read again");
      const allDay = u.allDay ?? cur.allDay;
      const start = u.start ?? cur.start;
      // Como nas linhas (#449, #484): só o start leva o fim junto, e a duração fica.
      const timed = !allDay && !cur.allDay && !isDay(cur.start) && !isDay(start);
      const moved = u.end === undefined && u.start !== undefined && timed && cur.end ? shiftBy(cur.end, toMs(start) - toMs(cur.start)) : undefined;
      const end = allDay ? null : (moved ?? (u.end !== undefined ? u.end : cur.end));
      // Só um dos dois: o outro vem da nota, e o par passa pela mesma régua do checkTimes.
      if ((u.start !== undefined || u.end !== undefined) && !allDay && typeof end === "string" && !isDay(start)) {
        if (toMs(end) <= toMs(start)) throw new CalendarError("E_BAD_ARGS", "calendar.update: end must be after start");
        if (toMs(end) - toMs(start) > CALENDAR_LIMITS.spanHours * 3_600_000) throw new CalendarError("E_BAD_ARGS", "calendar.update: at most 24 h");
      }
      let content = setFrontmatter(note.content, "agenda", agendaValue(start, end, allDay));
      if (u.notify !== undefined) content = setFrontmatter(content, "aviso", u.notify === DEFAULT_NOTIFY.note ? null : NOTE_NOTIFY_OF[u.notify]);
      const res = await src.notes.save(path, content, note.version);
      if (!res.saved) continue;
      const item = itemsOfNote({ ...note, ...res.meta, content }, { vault: src.notes, internal: false }).dated.find((i) => i.id === u.id);
      if (!item) throw new CalendarError("E_CONFLICT", "the item left the calendar");
      return item;
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  async function create(c: CalendarCreate): Promise<CalendarItem> {
    checkCreate(c);
    const src = await sources();
    const project = c.project ?? null;
    if (project !== null && !projectsOf(src).includes(project)) throw new CalendarError("E_NOT_FOUND", `no project ${project}`);
    const allDay = c.allDay ?? isDay(c.start);
    const start = allDay ? c.start.slice(0, 10) : c.start;
    const end = allDay ? null : (c.end ?? null);
    const notify = c.notify === undefined || c.notify === DEFAULT_NOTIFY[c.kind] ? null : c.notify;
    if (c.kind === "note") {
      const fm = [`agenda: "${agendaValue(start, end, allDay)}"`, ...(notify ? [`aviso: "${NOTE_NOTIFY_OF[notify]}"`] : [])];
      const note = await src.notes.create(project ?? "", c.title.trim(), `---\n${fm.join("\n")}\n---\n\n# ${c.title.trim()}\n`);
      return itemsOfNote(note, { vault: src.notes, internal: false }).dated[0]!;
    }
    const text = formatWhen({ title: c.title, kind: c.kind, start, end, allDay, notify, repeat: c.repeat ?? null }, src.locale);
    const line = `- ${c.kind === "task" || c.kind === "reminder" ? "[ ] " : ""}${text}`;
    const got = await appendBlock(src, project, [line]);
    const item = got && itemsOfNote(got.saved, { vault: src.notes, internal: false }).dated.find((i) => i.source?.line === got.line);
    if (item) return item;
    throw new CalendarError("E_CONFLICT", "the note changed while saving; try again");
  }

  /**
   * Põe as linhas no fim da nota do projeto (`<projeto>/Pendências.md`, ou `Calendário.md` na raiz), criando-a se não
   * existe. Devolve a nota gravada e a linha (0-based) da primeira; `null` se a nota mudou nas três tentativas.
   */
  async function appendBlock(src: CalendarSources, project: string | null, block: string[]): Promise<{ saved: Note; line: number } | null> {
    const name = project ? PROJECT_NOTE : ROOT_NOTE;
    const path = `${project ? `${project}/` : ""}${name}.md`;
    const text = block.join("\n");
    for (let attempt = 0; attempt < 3; attempt++) {
      const note = await src.notes.get(path).catch(() => null);
      let saved: Note;
      if (!note) {
        const made = await src.notes.create(project ?? "", name, `# ${name}\n\n${text}\n`);
        // Outro criou a nota no meio: o vault deu "Pendências 2"; tenta de novo na de verdade.
        if (made.path !== path) continue;
        saved = made;
      } else {
        const body = note.content.length && !note.content.endsWith("\n") ? `${note.content}\n` : note.content;
        const content = `${body}${text}\n`;
        const res = await src.notes.save(path, content, note.version);
        if (!res.saved) continue;
        saved = { ...note, ...res.meta, content };
      }
      const lines = saved.content.split("\n");
      return { saved, line: lines.length - 1 - block.length };
    }
    return null;
  }

  const blockEnd = blockEndOf;

  /**
   * O texto do item (T34745): numa linha, troca as linhas embaixo dela pelas do texto, com o recuo da linha mais dois
   * espaços (as em branco saem: acabariam o bloco); numa nota com `agenda:`, troca o corpo e deixa o frontmatter.
   */
  async function setText(src: CalendarSources, u: CalendarUpdate): Promise<CalendarItem> {
    const text = u.text!.replace(/\r\n?/g, "\n");
    for (let attempt = 0; attempt < 2; attempt++) {
      if (u.id.startsWith("f:")) {
        const path = u.id.slice(2);
        const note = await src.notes.get(path).catch(() => null);
        if (!note) throw new CalendarError("E_NOT_FOUND", `no note ${path}`);
        const lines = note.content.split("\n");
        const head = lines.slice(0, bodyStartOf(lines));
        const content = `${head.length ? `${head.join("\n")}\n\n` : ""}${text.replace(/\n+$/, "")}\n`;
        const res = await src.notes.save(path, content, note.version);
        if (!res.saved) continue;
        const item = itemsOfNote({ ...note, ...res.meta, content }, { vault: src.notes, internal: false }).dated.find((i) => i.id === u.id);
        if (!item) throw new CalendarError("E_CONFLICT", "the item left the calendar");
        return item;
      }
      const at = await locate(src, u.id);
      if (!at) throw new CalendarError("E_BAD_ARGS", "unknown id");
      if (at.where.internal) throw new CalendarError("E_READONLY", "the meetings folder is read-only here");
      const raw = at.raw[at.line]!;
      const cr = raw.endsWith("\r") ? "\r" : "";
      const pad = `${/^[ \t]*/.exec(raw)![0]}  `;
      const kids = text.split("\n").filter((l) => l.trim()).map((l) => `${pad}${l.trimEnd()}${cr}`);
      const lines = [...at.raw];
      lines.splice(at.line + 1, blockEnd(at.raw, at.line) - at.line - 1, ...kids);
      const content = lines.join("\n");
      const res = await src.notes.save(at.note.path, content, at.note.version);
      if (!res.saved) continue;
      const fresh = itemsOfNote({ ...at.note, ...res.meta, content }, at.where);
      const series = u.id.replace(/~\d{4}-\d{2}-\d{2}$/, "");
      const item = [...fresh.dated, ...fresh.undated].find((i) => i.id === series || i.source?.line === at.line);
      if (!item) throw new CalendarError("E_CONFLICT", "the item left the calendar");
      return item;
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  /** O projeto de um item de linha (T34745): o bloco sai da nota dele e vai para o fim da nota do outro projeto. */
  async function moveToProject(src: CalendarSources, u: CalendarUpdate): Promise<CalendarItem> {
    const target = u.project ?? null;
    if (target !== null && !projectsOf(src).includes(target)) throw new CalendarError("E_NOT_FOUND", `no project ${target}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = await locate(src, u.id);
      if (!at) throw new CalendarError("E_BAD_ARGS", "unknown id");
      if (at.where.internal) throw new CalendarError("E_READONLY", "the meetings folder is read-only here");
      const series = u.id.replace(/~\d{4}-\d{2}-\d{2}$/, "");
      if (projectOf(at.note.path) === target) {
        const same = itemsOfNote(at.note, at.where);
        const item = [...same.dated, ...same.undated].find((i) => i.id === series);
        if (item) return item;
        throw new CalendarError("E_CONFLICT", "the item changed in the note; read again");
      }
      const end = blockEnd(at.raw, at.line);
      // O bloco vai sem o recuo da linha do item (um item dentro de outro vira um item da lista nova), e sem o `\r`.
      const cut = /^[ \t]*/.exec(at.raw[at.line]!)![0].length;
      const block = at.raw.slice(at.line, end).map((l) => l.replace(/\r$/, "").slice(Math.min(cut, /^[ \t]*/.exec(l)![0].length)));
      const rest = [...at.raw];
      rest.splice(at.line, end - at.line);
      // Primeiro tira da nota de onde sai, pela versão: se ela mudou, nada foi escrito em lugar nenhum e tenta de novo.
      const res = await src.notes.save(at.note.path, rest.join("\n"), at.note.version);
      if (!res.saved) continue;
      const got = await appendBlock(src, target, block);
      const item = got && [...itemsOfNote(got.saved, { vault: src.notes, internal: false }).dated, ...itemsOfNote(got.saved, { vault: src.notes, internal: false }).undated].find((i) => i.source?.line === got.line);
      if (item) return item;
      // A nota do projeto não aceitou: o bloco volta para onde estava, para nada se perder.
      await restore(undoOf(at.note.path, at.raw, rest)).catch(() => undefined);
      throw new CalendarError("E_CONFLICT", "the project's note changed while saving; try again");
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  /**
   * Apaga um item (T34745): a linha e o texto embaixo dela, ou só uma vez da repetição (`only`, um `⏭`), ou o `agenda:`
   * de uma nota (a nota fica). Devolve o Desfazer para o `restore`.
   */
  async function remove(d: CalendarDelete): Promise<CalendarUndo> {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !d.id) throw new CalendarError("E_BAD_ARGS", "calendar.delete: id is required");
    if (d.only !== undefined && typeof d.only !== "boolean") throw new CalendarError("E_BAD_ARGS", "calendar.delete: only must be true or false");
    const src = await sources();
    if (d.id.startsWith("m:")) throw new CalendarError("E_READONLY", "a recorded meeting can't change");
    if (d.id.startsWith("f:")) {
      if (d.only) throw new CalendarError("E_BAD_ARGS", "calendar.delete: only is for one time of a repetition");
      const path = d.id.slice(2);
      for (let attempt = 0; attempt < 2; attempt++) {
        const note = await src.notes.get(path).catch(() => null);
        if (!note) throw new CalendarError("E_NOT_FOUND", `no note ${path}`);
        if (!parseAgenda(frontmatterOf(note.content)?.agenda)) throw new CalendarError("E_CONFLICT", "the note has no agenda anymore; read again");
        const content = setFrontmatter(setFrontmatter(note.content, "agenda", null), "aviso", null);
        const res = await src.notes.save(path, content, note.version);
        if (res.saved) return undoOf(path, note.content.split("\n"), content.split("\n"));
      }
      throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const at = await locate(src, d.id);
      if (!at) throw new CalendarError("E_BAD_ARGS", "unknown id");
      if (at.where.internal) throw new CalendarError("E_READONLY", "the meetings folder is read-only here");
      const lines = [...at.raw];
      if (d.only) {
        const raw = at.raw[at.line]!;
        const cr = raw.endsWith("\r") ? "\r" : "";
        const parts = LIST_LINE.exec(raw.slice(0, raw.length - cr.length));
        const cur = parts ? parseWhen(parts[4]!) : null;
        if (!parts || !cur?.repeat || !at.occurrence) throw new CalendarError("E_BAD_ARGS", "calendar.delete: only is for one time of a repetition");
        lines[at.line] = `${parts[1]}${parts[2] ?? ""}${rewriteWhen(parts[4]!, { skip: sortedDays([...cur.skip, at.occurrence]) }, src.locale)}${cr}`;
      } else lines.splice(at.line, blockEnd(at.raw, at.line) - at.line);
      const res = await src.notes.save(at.note.path, lines.join("\n"), at.note.version);
      if (res.saved) return undoOf(at.note.path, at.raw, lines);
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  /** O Desfazer de um apagar: o trecho que mudou volta, se ainda está lá (achado pela linha de cima, se a nota andou). */
  async function restore(u: CalendarUndo): Promise<true> {
    const strs = (v: unknown) => Array.isArray(v) && v.length <= 500 && v.every((s) => typeof s === "string" && !s.includes("\n"));
    if (!u || typeof u !== "object" || typeof u.path !== "string" || !u.path || !Number.isInteger(u.at) || u.at < 0 || !strs(u.removed) || !strs(u.added) || (u.prev !== null && typeof u.prev !== "string"))
      throw new CalendarError("E_BAD_ARGS", "calendar.restore: give the undo from calendar.delete");
    const src = await sources();
    for (let attempt = 0; attempt < 2; attempt++) {
      const note = await src.notes.get(u.path).catch(() => null);
      if (!note) throw new CalendarError("E_NOT_FOUND", `no note ${u.path}`);
      const lines = note.content.split("\n");
      const fits = (i: number) => i <= lines.length && (u.prev === null ? i === 0 : lines[i - 1] === u.prev) && u.added.every((l, k) => lines[i + k] === l);
      let i = fits(u.at) ? u.at : -1;
      if (i < 0) {
        // A nota andou: o lugar mais perto do de antes onde o trecho e a linha de cima ainda batem.
        const all = lines.map((_, k) => k).concat(lines.length).filter(fits);
        i = all.sort((a, b) => Math.abs(a - u.at) - Math.abs(b - u.at))[0] ?? -1;
      }
      if (i < 0) throw new CalendarError("E_CONFLICT", "the note changed there; can't undo");
      lines.splice(i, u.added.length, ...u.removed);
      const res = await src.notes.save(u.path, lines.join("\n"), note.version);
      if (res.saved) return true;
    }
    throw new CalendarError("E_CONFLICT", "the note changed while saving; read again");
  }

  /** A nota de onde o item veio, para a aba "Nota" do painel (#32193): também a reunião da pasta interna. */
  async function source(id: unknown): Promise<CalendarSource> {
    if (typeof id !== "string" || !id) throw new CalendarError("E_BAD_ARGS", "calendar.source: id is required");
    const src = await sources();
    const bare = id.replace(/~\d{4}-\d{2}-\d{2}$/, "");
    if (bare.startsWith("n:")) {
      const at = await locate(src, bare);
      if (!at) throw new CalendarError("E_BAD_ARGS", "unknown id");
      return { path: at.note.path, internal: at.where.internal, text: at.note.content, line: at.line };
    }
    const kind = bare.slice(0, 2);
    if (kind !== "f:" && kind !== "m:") throw new CalendarError("E_BAD_ARGS", "unknown id");
    const path = bare.slice(2);
    const order = kind === "m:" ? [...vaults(src)].reverse() : vaults(src);
    for (const where of order) {
      const note = await where.vault.get(path).catch(() => null);
      if (note) return { path, internal: where.internal, text: note.content, line: null };
    }
    throw new CalendarError("E_NOT_FOUND", `no note ${path}`);
  }

  return { items, create, update, source, remove, restore };
}


export type CalendarService = ReturnType<typeof calendarService>;

// ---------------------------------------------------------------- repetições e avisos

/** As vezes de um item dentro de `[from, to)`: ele mesmo, ou cada vez de uma repetição (com `~AAAA-MM-DD` no id). */
export function occurrences(it: CalendarItem, from: string, to: string): CalendarItem[] {
  const day = it.start.slice(0, 10);
  const endDay = (it.end ?? it.start).slice(0, 10);
  if (!it.repeat) return day < to && endDay >= from ? [it] : [];
  // Uma repetição concluída (a caixa marcada) acabou: só a primeira vez aparece, feita.
  if (it.done) return day < to && endDay >= from ? [it] : [];
  const step = it.repeat === "daily" ? 1 : 7;
  const out: CalendarItem[] = [];
  let d = day;
  // Pula até perto do `from` sem andar dia a dia por anos.
  if (d < from) {
    const gap = Math.floor((toMs(from) - toMs(d)) / 86_400_000 / step) * step;
    d = addDays(d, Math.max(0, gap - step));
  }
  for (let i = 0; d < to && i < 400; i++, d = addDays(d, step)) {
    if (d < day || it.skip?.includes(d)) continue;
    const shift = toMs(d) - toMs(day);
    const s = shiftBy(it.start, shift);
    const e = it.end ? shiftBy(it.end, shift) : null;
    if ((e ?? s).slice(0, 10) < from) continue;
    out.push({ ...it, id: `${it.id}~${d}`, start: s, end: e });
  }
  return out;
}

export interface CalendarAlert {
  item: CalendarItem;
  /** Quando avisar, em epoch ms. */
  at: number;
  /**
   * Para o agendador guardar o que já avisou: o caminho, o título e a hora do aviso. Não muda quando entra uma linha
   * acima nem quando o `🔔` é gravado na linha (#32185).
   */
  key: string;
}

/** Os avisos que caem em `[fromMs, toMs)`: sem os feitos, os sem aviso e as reuniões gravadas. */
export function alertsBetween(items: readonly CalendarItem[], fromMs: number, toMs_: number): CalendarAlert[] {
  const out: CalendarAlert[] = [];
  for (const item of items) {
    if (item.done || item.readOnly || item.notify === "none" || !item.start) continue;
    const at = notifyAt(item);
    if (at === null || at < fromMs || at >= toMs_) continue;
    out.push({ item, at, key: `${item.source?.path ?? ""}|${item.title}|${at}` });
  }
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------- miúdos

function dayTimeOfMs(ms: number): string {
  const t = new Date(ms);
  return `${dayOf(ms)}T${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** Um `start`/`end` andado `ms`, no mesmo formato (com ou sem hora). */
function shiftBy(v: string, ms: number): string {
  const moved = toMs(v) + ms;
  return v.length === 10 ? dayOf(moved) : dayTimeOfMs(moved);
}

/**
 * O "só esta vez" (#485): a série ganha o `⏭` da vez, e uma linha avulsa logo abaixo leva a vez para o `start` novo,
 * com a mesma duração e sem a repetição. A série, a hora dela e as outras vezes não mudam.
 */
function onlyThisTime(
  raw: readonly string[],
  at: number,
  l: { lead: string; box: string | undefined; rest: string; cr: string },
  cur: NonNullable<ReturnType<typeof parseWhen>>,
  occurrence: string,
  u: CalendarUpdate,
  locale: "pt" | "en",
): string {
  const start = u.start!;
  const allDay = u.allDay ?? isDay(start);
  const timed = !allDay && !isDay(start) && !isDay(cur.start);
  const end = allDay ? null : u.end !== undefined ? u.end : timed && cur.end ? shiftBy(cur.end, toMs(start) - toMs(cur.start)) : null;
  if (typeof end === "string") {
    if (toMs(end) <= toMs(start)) throw new CalendarError("E_BAD_ARGS", "calendar.update: end must be after start");
    if (toMs(end) - toMs(start) > CALENDAR_LIMITS.spanHours * 3_600_000) throw new CalendarError("E_BAD_ARGS", "calendar.update: at most 24 h");
  }
  const box = l.box === undefined ? "" : "[ ] ";
  const series = `${l.lead}${l.box === undefined ? "" : `[${l.box === " " ? " " : "x"}] `}${rewriteWhen(l.rest, { skip: [...cur.skip, occurrence] }, locale)}${l.cr}`;
  const once = `${l.lead}${box}${rewriteWhen(l.rest, { start, end, allDay, repeat: null }, locale)}${l.cr}`;
  const lines = [...raw];
  lines.splice(at, 1, series, once);
  return lines.join("\n");
}

/** O `end` de uma vez da repetição (o fim da série andado até aquela vez). */
function occurrenceOf(end: string, start: string, day: string): string {
  return shiftBy(end, toMs(day) - toMs(start.slice(0, 10)));
}

function agendaValue(start: string, end: string | null, allDay: boolean): string {
  const [day, s] = start.split("T") as [string, string | undefined];
  if (allDay || !s) return day;
  const e = end?.split("T")[1];
  return e ? `${day} ${s}-${e}` : `${day} ${s}`;
}

const NOTE_NOTIFY_OF: Record<CalendarNotify, string> = { none: "nenhum", atTime: "0", "10m": "10m", "30m": "30m", dayBefore: "1d" };
function noteNotify(v: unknown): CalendarNotify | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : null;
  if (s === null) return null;
  const hit = Object.entries(NOTE_NOTIFY_OF).find(([, t]) => t === s || (s === "none" && t === "nenhum"));
  return hit ? (hit[0] as CalendarNotify) : null;
}

/** Troca (ou põe, ou tira com `null`) uma chave de uma linha só no frontmatter, sem mexer no resto. */
/**
 * O Desfazer de uma troca de `before` por `after` (T34745): o menor trecho que mudou, sem as linhas iguais do começo e
 * do fim, e a linha logo acima dele.
 */
export function undoOf(path: string, before: string[], after: string[]): CalendarUndo {
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  let z = 0;
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++;
  return { path, at: a, removed: before.slice(a, before.length - z), added: after.slice(a, after.length - z), prev: a > 0 ? before[a - 1]! : null };
}

export function setFrontmatter(content: string, key: string, value: string | null): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  const line = value === null ? null : `${key}: "${value}"`;
  if (!fm) return line ? `---\n${line}\n---\n\n${content}` : content;
  const lines = fm[1]!.split(/\r?\n/);
  const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (i >= 0) {
    if (line) lines[i] = line;
    else lines.splice(i, 1);
  } else if (line) lines.push(line);
  return `---\n${lines.join("\n")}\n---${fm[2]}${content.slice(fm[0].length)}`;
}

function checkTimes(start: unknown, end: unknown, allDay: unknown, cap: string) {
  if (start !== undefined && !isDay(start) && !isDayTime(start)) throw new CalendarError("E_BAD_ARGS", `${cap}: start must be AAAA-MM-DD or AAAA-MM-DDTHH:MM`);
  if (end !== undefined && end !== null && !isDayTime(end)) throw new CalendarError("E_BAD_ARGS", `${cap}: end must be AAAA-MM-DDTHH:MM or null`);
  if (allDay !== undefined && typeof allDay !== "boolean") throw new CalendarError("E_BAD_ARGS", `${cap}: allDay must be true or false`);
  if (typeof start === "string" && typeof end === "string" && toMs(end) <= toMs(start)) throw new CalendarError("E_BAD_ARGS", `${cap}: end must be after start`);
  if (typeof start === "string" && typeof end === "string" && toMs(end) - toMs(start) > CALENDAR_LIMITS.spanHours * 3_600_000) throw new CalendarError("E_BAD_ARGS", `${cap}: at most 24 h`);
}

/** Um título vai numa linha da nota: sem quebra, sem os pedaços que a linha lê (`@ data`, `🔔`, `🔁`). */
function checkTitle(title: unknown, cap: string): void {
  if (typeof title !== "string" || !title.trim() || title.length > CALENDAR_LIMITS.title || /[\r\n]/.test(title))
    throw new CalendarError("E_BAD_ARGS", `${cap}: title must be one line, 1 to ${CALENDAR_LIMITS.title} characters`);
  if (titleProblem(title))
    throw new CalendarError("E_BAD_ARGS", `${cap}: title can't have a date, a kind tag, 🔔, 🔕, 🔁 or ⏭`);
}

function checkCreate(c: CalendarCreate): void {
  if (!c || typeof c !== "object") throw new CalendarError("E_BAD_ARGS", "calendar.create: give an object");
  if (!isCalendarKind(c.kind)) throw new CalendarError("E_BAD_ARGS", "calendar.create: unknown kind");
  checkTitle(c.title, "calendar.create");
  if (c.start === undefined) throw new CalendarError("E_BAD_ARGS", "calendar.create: start is required");
  checkTimes(c.start, c.end, c.allDay, "calendar.create");
  if (c.allDay === false && isDay(c.start)) throw new CalendarError("E_BAD_ARGS", "calendar.create: a timed item needs AAAA-MM-DDTHH:MM");
  if (c.notify !== undefined && !isCalendarNotify(c.notify)) throw new CalendarError("E_BAD_ARGS", "calendar.create: unknown notify");
  if (c.repeat !== undefined && c.repeat !== null && !isCalendarRepeat(c.repeat)) throw new CalendarError("E_BAD_ARGS", "calendar.create: repeat is daily, weekly or null");
  if (c.repeat && c.kind === "note") throw new CalendarError("E_BAD_ARGS", "calendar.create: a note doesn't repeat");
  if (c.project !== undefined && c.project !== null && (typeof c.project !== "string" || !c.project || c.project.includes("/")))
    throw new CalendarError("E_BAD_ARGS", "calendar.create: project is a top-level folder name or null");
}

function checkUpdate(u: CalendarUpdate): void {
  if (!u || typeof u !== "object" || typeof u.id !== "string" || !u.id) throw new CalendarError("E_BAD_ARGS", "calendar.update: id is required");
  if (u.title !== undefined) checkTitle(u.title, "calendar.update");
  checkTimes(u.start, u.end, u.allDay, "calendar.update");
  if (u.done !== undefined && typeof u.done !== "boolean") throw new CalendarError("E_BAD_ARGS", "calendar.update: done must be true or false");
  if (u.notify !== undefined && !isCalendarNotify(u.notify)) throw new CalendarError("E_BAD_ARGS", "calendar.update: unknown notify");
  if (u.kind !== undefined && (!isCalendarKind(u.kind) || u.kind === "note")) throw new CalendarError("E_BAD_ARGS", "calendar.update: kind is meeting, reminder, task or focus");
  if (u.repeat !== undefined && u.repeat !== null && !isCalendarRepeat(u.repeat)) throw new CalendarError("E_BAD_ARGS", "calendar.update: repeat is daily, weekly or null");
  if (u.text !== undefined) {
    if (typeof u.text !== "string" || u.text.length > CALENDAR_LIMITS.text) throw new CalendarError("E_BAD_ARGS", `calendar.update: text is a string up to ${CALENDAR_LIMITS.text} characters`);
    if (Object.keys(u).some((k) => k !== "id" && k !== "text")) throw new CalendarError("E_BAD_ARGS", "calendar.update: text goes alone");
  }
  if (u.project !== undefined) {
    if (u.project !== null && (typeof u.project !== "string" || !u.project || u.project.includes("/")))
      throw new CalendarError("E_BAD_ARGS", "calendar.update: project is a top-level folder name or null");
    if (Object.keys(u).some((k) => k !== "id" && k !== "project")) throw new CalendarError("E_BAD_ARGS", "calendar.update: project goes alone");
  }
  if (u.only !== undefined) {
    if (typeof u.only !== "boolean") throw new CalendarError("E_BAD_ARGS", "calendar.update: only must be true or false");
    const extra = Object.keys(u).filter((k) => !["id", "only", "start", "end", "allDay"].includes(k));
    if (u.only && (u.start === undefined || extra.length)) throw new CalendarError("E_BAD_ARGS", "calendar.update: only takes start (and end, allDay)");
  }
  const keys = Object.keys(u).filter((k) => k !== "id");
  if (!keys.length) throw new CalendarError("E_BAD_ARGS", "calendar.update: nothing to change");
}

export type { CalendarRepeat };
