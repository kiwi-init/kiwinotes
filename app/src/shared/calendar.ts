// O Calendário (spec #32129, T32154): o item, os tipos, o aviso e a linha da nota que o guarda. A tela (T32155), o Kiwi
// (T32156) e o main leem daqui. Tudo é texto nas notas: o item vive numa linha (`- [ ] … @ 2026-11-27 10:00`) ou no
// frontmatter de uma nota (`agenda:`), e a reunião gravada vem da nota dela. Nada fica num banco escondido.
//
// A linha, de ponta a ponta (contrato no #32175):
//   - [ ] Revisar o orçamento @ 2026-11-27 10:00-11:30 #lembrete 🔔 30m 🔁 semana
// - `@ AAAA-MM-DD`, com ` HH:MM` ou ` HH:MM-HH:MM`; sem hora, o dia todo.
// - O tipo pela tag: `#lembrete`/`#reminder`, `#reuniao`/`#meeting`, `#foco`/`#focus`. Sem tag e com caixa: pendência.
// - O aviso: `🔔 0` (na hora), `🔔 10m`, `🔔 50m`, `🔔 2h`, `🔔 1d` (na véspera), `🔔 3d`, ou `🔕` (nenhum). Sem ele, o
//   padrão do tipo. Qualquer antecedência em minutos, horas ou dias, até 30 dias (spec #34706, T34753).
// - A repetição: `🔁 dia`/`🔁 daily` ou `🔁 semana`/`🔁 weekly`.
// - Uma vez feita da repetição, fora da primeira em aberto: `⏭ AAAA-MM-DD`, um por vez, em ordem de dia (#450).

export const CALENDAR_KINDS = ["meeting", "reminder", "task", "note", "focus"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const isCalendarKind = (v: unknown): v is CalendarKind => (CALENDAR_KINDS as readonly unknown[]).includes(v);

/**
 * Os avisos prontos da tela: nunca, na hora, 10 ou 30 min antes, ou na véspera (no mesmo horário, um dia antes). O
 * aviso em si é livre (spec #34706, T34753): qualquer antecedência em minutos, horas ou dias (`50m`, `2h`, `3d`).
 */
export const CALENDAR_NOTIFY = ["none", "atTime", "10m", "30m", "dayBefore"] as const;
export type CalendarNotifyPreset = (typeof CALENDAR_NOTIFY)[number];
/** O aviso: um dos prontos, ou a antecedência livre (`50m`, `2h`, `3d`), sempre na forma de `normalNotify`. */
export type CalendarNotify = CalendarNotifyPreset | `${number}m` | `${number}h` | `${number}d`;

/** A antecedência mais longa: 30 dias. */
export const NOTIFY_MAX_MINUTES = 30 * 24 * 60;

const FREE_NOTIFY = /^(\d{1,6})\s*(m|min|mins|minutos?|minutes?|h|hrs?|horas?|hours?|d|dias?|days?)$/i;
const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 24 * 60 };

/** Os minutos antes do começo de um aviso escrito à mão (`50m`, `2h`, `3d`, `50 min`); `null` se não for um. */
function freeMinutes(v: string): number | null {
  const m = FREE_NOTIFY.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]) * UNIT_MINUTES[m[2]!.toLowerCase()[0]!]!;
  return n <= NOTIFY_MAX_MINUTES ? n : null;
}

/** O aviso de uma antecedência em minutos, na forma curta: 0 é na hora, um dia é a véspera, `90m`, `2h`, `3d`. */
export function notifyOfMinutes(min: number): CalendarNotify {
  if (min === 0) return "atTime";
  if (min === 24 * 60) return "dayBefore";
  if (min % (24 * 60) === 0) return `${min / (24 * 60)}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}

/**
 * Lê um aviso: um dos prontos, ou a antecedência livre (`50m`, `2h`, `3d`, `50 min`, `2 horas`, ou um número, em
 * minutos), e devolve a forma curta (`60m` vira `1h`, `24h` vira `dayBefore`). `null` se não for um aviso ou passar de
 * 30 dias.
 */
export function normalNotify(v: unknown): CalendarNotify | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= NOTIFY_MAX_MINUTES ? notifyOfMinutes(v) : null;
  if (typeof v !== "string") return null;
  if ((CALENDAR_NOTIFY as readonly string[]).includes(v)) return v as CalendarNotifyPreset;
  const min = freeMinutes(v);
  return min === null ? null : notifyOfMinutes(min);
}

/** Um aviso já na forma curta (o que o item e o contrato levam). */
export const isCalendarNotify = (v: unknown): v is CalendarNotify => normalNotify(v) === v;

/** O aviso de cada tipo quando a linha não diz (spec #32129): 10 min antes das reuniões, na hora dos lembretes. */
export const DEFAULT_NOTIFY: Record<CalendarKind, CalendarNotify> = { meeting: "10m", reminder: "atTime", task: "none", note: "none", focus: "none" };

/** Quantos minutos antes do começo o aviso sai; `null` sem aviso (ou um aviso que não vale). */
export function notifyMinutes(n: CalendarNotify): number | null {
  if (n === "none") return null;
  if (n === "atTime") return 0;
  if (n === "dayBefore") return 24 * 60;
  return freeMinutes(n);
}

/** Como a tela diz um aviso: a chave do texto e o número (`10 min antes`, `2 h antes`, `3 dias antes`). */
export function notifyText(n: CalendarNotify): { key: "calendar.notify.none" | "calendar.notify.atTime" | "calendar.notify.dayBefore" | "calendar.notify.minutes" | "calendar.notify.hours" | "calendar.notify.days"; params: { n?: number } } {
  // A forma curta antes: "1d" e "24h" são a véspera, "0m" é na hora.
  const v = normalNotify(n) ?? "none";
  if (v === "none" || v === "atTime" || v === "dayBefore") return { key: `calendar.notify.${v}`, params: {} };
  const min = notifyMinutes(v);
  if (min === null) return { key: "calendar.notify.none", params: {} };
  if (min % (24 * 60) === 0) return { key: "calendar.notify.days", params: { n: min / (24 * 60) } };
  if (min % 60 === 0) return { key: "calendar.notify.hours", params: { n: min / 60 } };
  return { key: "calendar.notify.minutes", params: { n: min } };
}

export const CALENDAR_REPEATS = ["daily", "weekly"] as const;
export type CalendarRepeat = (typeof CALENDAR_REPEATS)[number];
export const isCalendarRepeat = (v: unknown): v is CalendarRepeat => (CALENDAR_REPEATS as readonly unknown[]).includes(v);

export interface CalendarItem {
  /**
   * Estável entre leituras: `n:<caminho>#<linha>:<hash>` (uma linha de nota), `f:<caminho>` (uma nota com `agenda:`) ou
   * `m:<caminho>` (uma reunião gravada). Numa repetição, cada vez leva `~AAAA-MM-DD` no fim, e mudar uma muda a série.
   */
  id: string;
  kind: CalendarKind;
  title: string;
  /** A pasta de primeiro nível das Notas; `null` na raiz (e nas reuniões gravadas na pasta interna). */
  project: string | null;
  /** Hora local, `2026-11-27T10:00`; no dia todo, só `2026-11-27`. */
  start: string;
  /** O fim, no mesmo formato; `null` sem fim (a tela usa 30 min). No dia todo, `null`. */
  end: string | null;
  allDay: boolean;
  /** Só a pendência (e o que tem caixa) marca feito. */
  done?: boolean;
  notify: CalendarNotify;
  /** A pauta ou a descrição: o resto da nota de um item `f:`, ou nada. */
  detail?: string;
  /** Quem estava na reunião gravada. */
  people?: string[];
  repeat?: CalendarRepeat;
  /** As vezes da repetição já feitas (`⏭ AAAA-MM-DD`), fora da primeira em aberto: a agenda as pula (#450). */
  skip?: string[];
  /** Não se arrasta nem se estica: a reunião gravada. */
  readOnly: boolean;
  /** A nota de onde veio; `line` 0-based (null no item da nota inteira). `internal`: a pasta interna das reuniões. */
  source: { path: string; line: number | null; internal: boolean } | null;
}

/** O que o `calendar.items` devolve: os itens do período, as pendências abertas sem data e os projetos. */
export interface CalendarItems {
  items: CalendarItem[];
  /** As pendências abertas sem data, para o "sem data" do painel (até `CALENDAR_LIMITS.undated`). */
  undated: CalendarItem[];
  /** As pastas de primeiro nível das Notas, em ordem. */
  projects: string[];
}

export const CALENDAR_LIMITS = {
  /** O período mais longo de um `calendar.items` (a vista do Mês com as bordas e a Agenda cabem). */
  rangeDays: 62,
  undated: 50,
  title: 300,
  /** A duração mais longa de um item com hora: o `calendar.create` e o `calendar.update` recusam mais, e o esticar
   *  da tela para nela (#480). */
  spanHours: 24,
} as const;

/** O que o `calendar.source` devolve: o texto da nota e a linha do item (0-based; `null` na nota inteira). */
export interface CalendarSource {
  path: string;
  internal: boolean;
  text: string;
  line: number | null;
}

/** O que o `calendar.create` recebe. */
export interface CalendarCreate {
  kind: CalendarKind;
  title: string;
  project?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  notify?: CalendarNotify;
  repeat?: CalendarRepeat | null;
}

/** O que o `calendar.delete` devolve (T34753): o item que saiu e a nota que mudou. */
export interface CalendarDeleted {
  id: string;
  path: string;
}

/** O que o `calendar.update` muda: arrastar (start/end), esticar (end), Feito (done), o aviso e o resto. */
export interface CalendarUpdate {
  id: string;
  title?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  done?: boolean;
  notify?: CalendarNotify;
  kind?: CalendarKind;
  repeat?: CalendarRepeat | null;
  /**
   * Só esta vez (#485): numa vez de uma repetição, com o `start`, a vez ganha um `⏭` e uma linha avulsa logo abaixo
   * leva a vez para o `start` novo. A série e a hora dela não mudam. É o Sim da sugestão "atrasada".
   */
  only?: boolean;
}

// ---------------------------------------------------------------- datas

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** `AAAA-MM-DD` de uma data que existe (não 2026-02-30). */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

/** `AAAA-MM-DDTHH:MM` com dia e hora que existem. */
export function isDayTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DAY_TIME.exec(v);
  return !!m && isDay(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60;
}

/** Um `start`/`end` do item em epoch ms, na hora local. */
export function toMs(v: string): number {
  const [d, t] = v.split("T") as [string, string | undefined];
  const [y, mo, da] = d.split("-").map(Number) as [number, number, number];
  const [h, mi] = t ? (t.split(":").map(Number) as [number, number]) : [0, 0];
  return new Date(y, mo - 1, da, h, mi).getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (ms: number) => {
  const t = new Date(ms);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
export const dayTimeOf = (ms: number) => {
  const t = new Date(ms);
  return `${dayOf(ms)}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};

/** `n` dias depois de `day`, pelo calendário (o horário de verão não pula dia). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return dayOf(new Date(y, m - 1, d + n, 12).getTime());
}

/** Quando o aviso de um item sai, em epoch ms; `null` sem aviso. No dia todo, conta a partir das 9h. */
export function notifyAt(item: Pick<CalendarItem, "start" | "allDay" | "notify">): number | null {
  const min = notifyMinutes(item.notify);
  if (min === null) return null;
  const start = item.allDay ? toMs(`${item.start}T09:00`) : toMs(item.start);
  return start - min * 60_000;
}

// ---------------------------------------------------------------- a linha

const KIND_TAGS: Record<string, CalendarKind> = {
  lembrete: "reminder",
  reminder: "reminder",
  reuniao: "meeting",
  reunião: "meeting",
  meeting: "meeting",
  foco: "focus",
  focus: "focus",
};
/** A tag que o Kiwi escreve, na língua do app. */
const TAG_OF: Record<"pt" | "en", Partial<Record<CalendarKind, string>>> = {
  pt: { reminder: "lembrete", meeting: "reuniao", focus: "foco" },
  en: { reminder: "reminder", meeting: "meeting", focus: "focus" },
};
/** O aviso de um `🔔`: `0` é na hora, `1d` é a véspera, o resto é a antecedência livre. */
const notifyOfToken = (tok: string): CalendarNotify | null => (tok === "0" ? "atTime" : normalNotify(tok));
/** O `🔔` de um aviso: `0` na hora, `1d` na véspera, a antecedência livre como ela é. */
const tokenOf = (n: Exclude<CalendarNotify, "none">) => (n === "atTime" ? "0" : n === "dayBefore" ? "1d" : n);
const REPEAT_TOKEN: Record<string, CalendarRepeat> = { dia: "daily", daily: "daily", semana: "weekly", weekly: "weekly" };
const REPEAT_OF: Record<"pt" | "en", Record<CalendarRepeat, string>> = { pt: { daily: "dia", weekly: "semana" }, en: { daily: "daily", weekly: "weekly" } };

const WHEN = /(^|\s)@\s?(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?)?(?=\s|$)/;
const TAG = /(^|\s)#([\p{L}]+)(?=\s|$|[.,;!?])/gu;
const BELL = /(^|\s)🔔\s?(0|\d{1,6}[mhd])(?=\s|$)/;
const MUTE = /(^|\s)🔕(?=\s|$)/;
const REPEAT = /(^|\s)🔁\s?(dia|daily|semana|weekly)(?=\s|$)/;
/** Uma vez feita: `⏭` (com ou sem o seletor de emoji U+FE0F, que o teclado do Mac põe) e o dia. */
const SKIP = /(^|\s)⏭\uFE0F?\s?(\d{4}-\d{2}-\d{2})(?=\s|$)/g;
/** O texto sem os `⏭ AAAA-MM-DD`: a Início mostra a pendência sem eles. */
export const withoutSkips = (s: string) => s.replace(SKIP, "$1");

/** O que a linha de um item diz, sem o texto da caixa: o título ainda com a marcação (links, ênfase). */
export interface LineWhen {
  /** O título cru: o resto da linha sem a data, a tag do tipo, o aviso e a repetição. */
  title: string;
  kind: CalendarKind | null;
  start: string;
  end: string | null;
  allDay: boolean;
  /** `null`: a linha não diz, vale o padrão do tipo. */
  notify: CalendarNotify | null;
  repeat: CalendarRepeat | null;
  /** As vezes feitas da repetição (`⏭ AAAA-MM-DD`), sem repetir e em ordem de dia. */
  skip: string[];
}

/** Os dias, sem repetir e em ordem: a linha fica igual seja qual for a ordem dos cliques. */
export const sortedDays = (days: readonly string[]) => [...new Set(days)].sort();

const hhmm = (h: string, m: string) => (Number(h) < 24 && Number(m) < 60 ? `${pad(Number(h))}:${m}` : null);

/** Lê a data, o tipo, o aviso e a repetição do texto de um item (depois da caixa). `null` sem `@ data` válida. */
export function parseWhen(rest: string): LineWhen | null {
  const w = WHEN.exec(rest);
  if (!w || !isDay(w[2])) return null;
  const day = w[2]!;
  let start = day;
  let end: string | null = null;
  let allDay = true;
  if (w[3] !== undefined) {
    const s = hhmm(w[3], w[4]!);
    if (!s) return null;
    start = `${day}T${s}`;
    allDay = false;
    if (w[5] !== undefined) {
      const e = hhmm(w[5], w[6]!);
      if (!e) return null;
      // O fim antes do começo passa da meia-noite.
      end = e > s ? `${day}T${e}` : `${addDays(day, 1)}T${e}`;
    }
  }
  let kind: CalendarKind | null = null;
  let title = rest.replace(WHEN, "$1");
  title = title.replace(TAG, (all, sp: string, tag: string) => {
    const k = KIND_TAGS[tag.toLowerCase()];
    if (!k || kind) return all;
    kind = k;
    return sp;
  });
  const bell = BELL.exec(title);
  const notify: CalendarNotify | null = MUTE.test(title) ? "none" : bell ? notifyOfToken(bell[2]!) : null;
  const rep = REPEAT.exec(title);
  const skip = sortedDays([...title.matchAll(SKIP)].map((m) => m[2]!).filter(isDay));
  title = title.replace(BELL, "$1").replace(MUTE, "$1").replace(REPEAT, "$1").replace(SKIP, "$1").replace(/\s+/g, " ").trim();
  return { title, kind, start, end, allDay, notify, repeat: rep ? REPEAT_TOKEN[rep[2]!]! : null, skip };
}

/**
 * O pedaço do título que a linha da nota leria como outra coisa (#493): a tag do tipo (`#foco`, `#reminder`…), `🔔`,
 * `🔕`, `🔁`, `⏭` ou uma data com `@`. `null` quando o título pode ir. O `calendar.create`/`update` recusa com ele, e o
 * "+ Novo" o mostra antes de criar.
 */
export function titleProblem(title: string): string | null {
  const mark = /🔔|🔕|🔁|⏭/u.exec(title)?.[0] ?? /(?:^|\s)(@\s?\d[\d-]*(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?)/.exec(title)?.[1];
  if (mark) return mark;
  for (const m of title.matchAll(TAG)) if (KIND_TAGS[m[2]!.toLowerCase()]) return `#${m[2]}`;
  // Outro pedaço que a leitura tira do título (a regra de antes, inteira): devolve o título todo.
  return parseWhen(`${title} @ 2026-01-01`)?.title === title.replace(/\s+/g, " ").trim() ? null : title.trim();
}

/** O pedaço `@ …` de uma data. */
export function whenToken(start: string, end: string | null, allDay: boolean): string {
  const [day, s] = start.split("T") as [string, string | undefined];
  if (allDay || !s) return `@ ${day}`;
  const e = end?.split("T")[1];
  return e ? `@ ${day} ${s}-${e}` : `@ ${day} ${s}`;
}

/** Os pedaços de uma linha nova ou mudada, na ordem que o Kiwi escreve: título, data, tipo, aviso, repetição. */
export function formatWhen(
  o: { title: string; kind: CalendarKind; start: string; end: string | null; allDay: boolean; notify: CalendarNotify | null; repeat: CalendarRepeat | null; skip?: readonly string[] },
  locale: "pt" | "en",
): string {
  const parts = [o.title.trim(), whenToken(o.start, o.end, o.allDay)];
  const tag = TAG_OF[locale][o.kind];
  if (tag) parts.push(`#${tag}`);
  if (o.notify === "none") parts.push("🔕");
  else if (o.notify) parts.push(`🔔 ${tokenOf(o.notify)}`);
  if (o.repeat) parts.push(`🔁 ${REPEAT_OF[locale][o.repeat]}`);
  if (o.repeat) for (const d of sortedDays(o.skip ?? [])) parts.push(`⏭ ${d}`);
  return parts.join(" ");
}

/**
 * Troca, no texto de um item, só o que mudou: a data, o tipo, o aviso ou a repetição. O resto da linha (links, ênfase,
 * outras tags) fica como estava. Um pedaço que a linha não tinha vai no fim.
 */
export function rewriteWhen(
  rest: string,
  patch: { title?: string; start?: string; end?: string | null; allDay?: boolean; kind?: CalendarKind; notify?: CalendarNotify | null; repeat?: CalendarRepeat | null; skip?: readonly string[] },
  locale: "pt" | "en",
): string {
  const cur = parseWhen(rest);
  let out = rest;
  const add = (s: string) => {
    out = `${out.replace(/\s+$/, "")} ${s}`;
  };
  if (patch.title !== undefined) {
    // Um título novo troca o texto todo: os pedaços do item voltam do zero.
    const base = cur ?? { kind: null, start: patch.start ?? "", end: null, allDay: true, notify: null, repeat: null, skip: [] };
    return formatWhen(
      {
        title: patch.title,
        kind: patch.kind ?? base.kind ?? "task",
        start: patch.start ?? base.start,
        end: patch.end !== undefined ? patch.end : base.end,
        allDay: patch.allDay ?? base.allDay,
        notify: patch.notify !== undefined ? patch.notify : base.notify,
        repeat: patch.repeat !== undefined ? patch.repeat : base.repeat,
        skip: patch.skip ?? base.skip,
      },
      locale,
    );
  }
  if (patch.start !== undefined || patch.end !== undefined || patch.allDay !== undefined) {
    const allDay = patch.allDay ?? cur?.allDay ?? true;
    const start = patch.start ?? cur?.start ?? "";
    const end = allDay ? null : patch.end !== undefined ? patch.end : (cur?.end ?? null);
    const token = whenToken(start, end, allDay);
    if (WHEN.test(out)) out = out.replace(WHEN, (_a, sp: string) => `${sp}${token}`);
    else add(token);
  }
  if (patch.kind !== undefined) {
    let had = false;
    out = out.replace(TAG, (all, sp: string, tag: string) => {
      if (!KIND_TAGS[tag.toLowerCase()] || had) return all;
      had = true;
      const t = TAG_OF[locale][patch.kind!];
      return t ? `${sp}#${t}` : sp;
    });
    const t = TAG_OF[locale][patch.kind];
    if (!had && t) add(`#${t}`);
  }
  if (patch.notify !== undefined) {
    out = out.replace(BELL, "$1").replace(MUTE, "$1");
    if (patch.notify === "none") add("🔕");
    else if (patch.notify) add(`🔔 ${tokenOf(patch.notify)}`);
  }
  if (patch.repeat !== undefined) {
    out = out.replace(REPEAT, "$1");
    if (patch.repeat) add(`🔁 ${REPEAT_OF[locale][patch.repeat]}`);
  }
  if (patch.skip !== undefined || patch.repeat !== undefined) {
    // Os `⏭` vão depois do `🔁`, em ordem de dia; sem repetição, saem.
    const repeat = patch.repeat !== undefined ? patch.repeat : (cur?.repeat ?? null);
    const skip = patch.skip ?? cur?.skip ?? [];
    out = out.replace(SKIP, "$1");
    if (repeat) for (const d of sortedDays(skip)) add(`⏭ ${d}`);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+$/, "");
}

/** O valor do `agenda:` de uma nota (tipo nota): `2026-11-27`, `2026-11-27 10:00` ou `2026-11-27 10:00-11:00`. */
export function parseAgenda(v: unknown): Pick<LineWhen, "start" | "end" | "allDay"> | null {
  if (typeof v !== "string") return null;
  const w = parseWhen(`@ ${v.trim()}`);
  return w && !w.title ? { start: w.start, end: w.end, allDay: w.allDay } : null;
}
