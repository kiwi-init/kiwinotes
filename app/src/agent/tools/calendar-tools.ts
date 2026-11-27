// As ferramentas do agente no Calendário (spec #32129, T32156): `calendar_list`, `calendar_create` e `calendar_update`,
// pelo mesmo caminho da tela (o `calendarService` da T32154, pelas capacidades `calendar.*`). O agente lê e muda os
// itens como a pessoa: uma linha numa nota (`- [ ] Revisar @ 2026-11-27 10:00 🔔 30m`) ou o `agenda:` de uma nota.
//
// - **Como as outras escritas:** antes de mudar a nota, o texto de antes vai ao registro do agente (`journal.keep`), e a
//   escrita volta como `change`: a Atividade mostra, e o [Desfazer] devolve a nota. Uma escrita que falha solta a cópia.
// - **O guardrail:** o título que sai para o agente passa pelo filtro, e o que ele manda volta sem marcador de outra nota.
// - **O id:** o agente recebe o `id` do item e o manda de volta no `calendar_update`. Um `E_CONFLICT` diz "leia de novo".

import { type CalendarCreate, type CalendarItem, type CalendarItems, type CalendarUpdate, CALENDAR_KINDS, CALENDAR_NOTIFY, CALENDAR_REPEATS, CALENDAR_LIMITS } from "../../shared/calendar.ts";
import { PROJECT_NOTE, ROOT_NOTE } from "../../bun/calendar.ts";
import type { DoubtDecider, SecretGuard } from "../../guardrail/filter.ts";
import type { VaultWriter } from "./writer.ts";

/** O Calendário para o agente: o mesmo `calendarService` que a tela usa. */
export interface CalendarSink {
  items(a: { from: string; to: string }): Promise<CalendarItems>;
  create(c: CalendarCreate): Promise<CalendarItem>;
  update(u: CalendarUpdate): Promise<CalendarItem>;
}

/** O Calendário pelas capacidades da tela (`calendar.items`, `calendar.create`, `calendar.update`). */
export function calendarFromCapabilities(caps: Record<"calendar.items" | "calendar.create" | "calendar.update", (args: unknown) => unknown>): CalendarSink {
  return {
    items: async (a) => (await caps["calendar.items"](a)) as CalendarItems,
    create: async (c) => (await caps["calendar.create"](c)) as CalendarItem,
    update: async (u) => (await caps["calendar.update"](u)) as CalendarItem,
  };
}

export const KIWI_CALENDAR_TOOL_NAMES = ["calendar_list", "calendar_create", "calendar_update"] as const;
export type CalendarToolName = (typeof KIWI_CALENDAR_TOOL_NAMES)[number];

/** O período padrão do `calendar_list`, em dias, a partir de hoje. */
export const CALENDAR_LIST_DAYS = 7;
/** Quantos itens o `calendar_list` devolve de uma vez (o resto vem com um período menor). */
export const CALENDAR_LIST_MAX = 100;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const whenProp = (o: string) => ({ type: "string", description: `${o}: AAAA-MM-DDTHH:MM na hora local, ou só AAAA-MM-DD no dia todo.` });

/** As definições das três, no formato do `KIWI_TOOLS`. */
export const CALENDAR_TOOL_DEFS = [
  {
    name: "calendar_list" as const,
    title: "Ver o calendário",
    description: `Os itens do calendário da pessoa num período (de ${CALENDAR_LIST_DAYS} dias a partir de hoje, sem from e to; até ${CALENDAR_LIMITS.rangeDays} dias): reuniões, lembretes, pendências com data, notas com data e foco, das linhas das notas e das reuniões gravadas. Cada item traz o id, que o calendar_update usa. Também as pendências abertas sem data e os projetos.`,
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "O primeiro dia, AAAA-MM-DD. Sem ele, hoje." },
        to: { type: "string", description: "O último dia, AAAA-MM-DD (entra)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "calendar_create" as const,
    title: "Pôr no calendário",
    description: `Um item novo no calendário: uma linha no fim da nota "${PROJECT_NOTE}" do projeto (ou "${ROOT_NOTE}", sem projeto), ou uma nota com data (kind note). O aviso, sem notify, é o padrão do tipo (10 min antes da reunião, na hora do lembrete). Só quando a pessoa pedir. A pessoa desfaz pela Atividade.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: CALENDAR_LIMITS.title, description: "O que é, curto." },
        kind: { type: "string", enum: [...CALENDAR_KINDS], description: "meeting, reminder, task (pendência), note (uma nota com data) ou focus." },
        start: whenProp("O começo"),
        end: whenProp("O fim, no mesmo dia (opcional)"),
        project: { type: "string", description: "A pasta do projeto, como o projects_list devolve. Sem ele, na raiz." },
        notify: { type: "string", enum: [...CALENDAR_NOTIFY], description: "none, atTime, 10m, 30m ou dayBefore (na véspera)." },
        repeat: { type: "string", enum: [...CALENDAR_REPEATS] },
      },
      required: ["title", "kind", "start"],
      additionalProperties: false,
    },
    writes: true as const,
  },
  {
    name: "calendar_update" as const,
    title: "Mudar um item do calendário",
    description: "Muda um item pelo id do calendar_list: a hora (start, end, allDay), o feito (done), o aviso (notify), o título, o tipo ou a repetição. Numa repetição, mover uma vez move a série; o feito passa a série para a próxima vez. A reunião gravada não muda. Com E_CONFLICT, leia de novo. A pessoa desfaz pela Atividade.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "O id do item, como o calendar_list devolve." },
        title: { type: "string", minLength: 1, maxLength: CALENDAR_LIMITS.title },
        kind: { type: "string", enum: [...CALENDAR_KINDS] },
        start: whenProp("O começo novo"),
        end: { type: ["string", "null"], description: "O fim novo, ou null para tirar." },
        allDay: { type: "boolean" },
        done: { type: "boolean" },
        notify: { type: "string", enum: [...CALENDAR_NOTIFY] },
        repeat: { type: ["string", "null"], enum: [...CALENDAR_REPEATS, null] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    writes: true as const,
  },
];

/** O que a ferramenta precisa: o Calendário, e para escrever, o escritor e o registro. */
export interface CalendarToolDeps {
  calendar: CalendarSink;
  writer?: VaultWriter;
  journal?: { keep(path: string, before: string): Promise<string>; drop(copy: string): Promise<void> };
  guard?: SecretGuard;
  decider?: DoubtDecider;
  now: Date;
}

/** O que mudou, no formato do `ToolChange` de `tools.ts`. */
export interface CalendarChange {
  kind: "created" | "appended" | "replaced";
  path: string;
  before: number;
  after: number;
  version: string;
  copy?: string;
  folder?: string;
}

export class CalendarToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const bad = (m: string) => new CalendarToolError("E_BAD_ARGS", m);

function obj(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("os argumentos devem ser um objeto");
  const a = raw as Record<string, unknown>;
  const extra = Object.keys(a).find((k) => !allowed.includes(k));
  if (extra) throw bad(`campo desconhecido: ${extra}`);
  return a;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + n));
};

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\s_-]+/g, "");

/** O caminho da nota de um id (`n:<caminho>#…`, `f:<caminho>`); `null` na reunião gravada ou num id estranho. */
export function pathOfId(id: string): string | null {
  const bare = id.replace(/~\d{4}-\d{2}-\d{2}$/, "");
  const n = /^n:(.+)#\d+:[0-9a-f]{8}$/.exec(bare);
  if (n) return n[1]!;
  if (bare.startsWith("f:")) return bare.slice(2);
  return null;
}

/** O item como vai ao agente: sem a linha nem a pasta interna, o título pelo filtro. */
async function shown(i: CalendarItem, d: CalendarToolDeps): Promise<Record<string, unknown>> {
  const path = i.source?.path ?? "";
  const title = d.guard ? (await d.guard.decide(path, i.title, d.decider)).text : i.title;
  return {
    id: i.id,
    kind: i.kind,
    title,
    ...(i.project ? { project: i.project } : {}),
    start: i.start,
    ...(i.end ? { end: i.end } : {}),
    ...(i.allDay ? { allDay: true } : {}),
    ...(i.done !== undefined ? { done: i.done } : {}),
    notify: i.notify,
    ...(i.repeat ? { repeat: i.repeat } : {}),
    ...(i.readOnly ? { readOnly: true } : {}),
    ...(i.source && !i.source.internal ? { path: i.source.path } : {}),
  };
}

/** O título que o agente mandou, sem marcador de outra nota (o filtro devolve o segredo só da nota certa). */
const restored = (d: CalendarToolDeps, path: string, t: string) => (d.guard ? d.guard.write(path, t) : t);

export interface CalendarToolResult {
  value: Record<string, unknown>;
  target?: string;
  change?: CalendarChange;
}

/** Roda uma das três. */
export async function calendarTool(d: CalendarToolDeps, name: CalendarToolName, raw: unknown): Promise<CalendarToolResult> {
  if (name === "calendar_list") return list(d, raw);
  if (!d.writer || !d.journal) throw new CalendarToolError("E_UNKNOWN_TOOL", `o Kiwi não tem a ferramenta \`${name}\``);
  return name === "calendar_create" ? create(d, raw) : update(d, raw);
}

async function list(d: CalendarToolDeps, raw: unknown): Promise<CalendarToolResult> {
  const a = obj(raw, ["from", "to"]);
  for (const k of ["from", "to"] as const) if (a[k] !== undefined && (typeof a[k] !== "string" || !DATE.test(a[k] as string))) throw bad(`${k} é um dia, AAAA-MM-DD`);
  const from = (a.from as string | undefined) ?? localDay(d.now);
  const to = (a.to as string | undefined) ?? plusDays(from, CALENDAR_LIST_DAYS - 1);
  if (to < from) throw bad("to vem depois de from (ou no mesmo dia)");
  // O `to` do agente entra; o do Calendário, não.
  const r = await d.calendar.items({ from, to: plusDays(to, 1) });
  const items = await Promise.all(r.items.slice(0, CALENDAR_LIST_MAX).map((i) => shown(i, d)));
  const undated = await Promise.all(r.undated.map((i) => shown(i, d)));
  return {
    value: {
      from,
      to,
      items,
      ...(r.items.length > CALENDAR_LIST_MAX ? { aviso: `há ${r.items.length} itens; vieram os ${CALENDAR_LIST_MAX} primeiros. Peça um período menor.` } : {}),
      undated,
      projects: r.projects,
    },
    target: `${from} – ${to}`,
  };
}

/** O projeto pelo nome, como a pessoa fala ("projeto x" acha "Projeto X"), entre as pastas do Calendário. */
async function projectOf(d: CalendarToolDeps, wanted: string): Promise<string> {
  const day = localDay(d.now);
  const { projects } = await d.calendar.items({ from: day, to: plusDays(day, 1) });
  const hit = projects.find((p) => p === wanted) ?? projects.find((p) => fold(p) === fold(wanted));
  if (!hit) throw new CalendarToolError("E_NOT_FOUND", `não há o projeto "${wanted}"; os projetos: ${projects.join(", ") || "nenhum"}`);
  return hit;
}

/** Escreve guardando antes a cópia da nota (se ela existe): a Atividade e o [Desfazer] funcionam como nas notas. */
async function journaled(d: CalendarToolDeps, path: string | null, run: () => Promise<CalendarItem>): Promise<{ item: CalendarItem; change: CalendarChange }> {
  const writer = d.writer!;
  const journal = d.journal!;
  const before = path ? await writer.get(path).catch(() => null) : null;
  const copy = before ? await journal.keep(before.path, before.content) : undefined;
  let item: CalendarItem;
  try {
    item = await run();
  } catch (e) {
    if (copy) await journal.drop(copy).catch(() => {});
    throw e;
  }
  const at = item.source?.path ?? path;
  if (!at) throw new CalendarToolError("E_FAILED", "o item não tem nota");
  const after = await writer.get(at);
  const folder = await writer.folder().catch(() => null);
  return {
    item,
    change: {
      kind: !before ? "created" : before.path === after.path && after.content.startsWith(before.content) ? "appended" : "replaced",
      path: after.path,
      before: before && before.path === after.path ? before.content.length : 0,
      after: after.content.length,
      version: after.version,
      ...(copy && before?.path === after.path ? { copy } : {}),
      ...(folder ? { folder } : {}),
    },
  };
}

async function create(d: CalendarToolDeps, raw: unknown): Promise<CalendarToolResult> {
  const a = obj(raw, ["title", "kind", "start", "end", "project", "notify", "repeat"]);
  if (typeof a.title !== "string" || !a.title.trim()) throw bad("title é obrigatório");
  if (typeof a.kind !== "string") throw bad(`kind é um de: ${CALENDAR_KINDS.join(", ")}`);
  if (typeof a.start !== "string") throw bad("start é obrigatório: AAAA-MM-DDTHH:MM, ou AAAA-MM-DD no dia todo");
  const project = typeof a.project === "string" && a.project.trim() ? await projectOf(d, a.project.trim()) : null;
  // Um item novo não tem segredo dele: um marcador aqui é de outra nota, e o filtro recusa.
  const title = restored(d, "\u0000nova", a.title.trim());
  const c = { ...a, title, project } as unknown as CalendarCreate;
  // A nota que muda: a nova (kind note) não existe antes; a linha vai na "Pendências" do projeto, ou na da raiz.
  const path = c.kind === "note" ? null : `${project ? `${project}/` : ""}${project ? PROJECT_NOTE : ROOT_NOTE}.md`;
  const { item, change } = await journaled(d, path, () => d.calendar.create(c));
  return { value: { item: await shown(item, d), mudou: change.kind === "created" ? `criou ${change.path}` : `acrescentou uma linha em ${change.path}` }, target: change.path, change };
}

async function update(d: CalendarToolDeps, raw: unknown): Promise<CalendarToolResult> {
  const a = obj(raw, ["id", "title", "kind", "start", "end", "allDay", "done", "notify", "repeat"]);
  if (typeof a.id !== "string" || !a.id) throw bad("id é obrigatório: o id do item, como o calendar_list devolve");
  const path = pathOfId(a.id);
  if (!path) throw new CalendarToolError(a.id.startsWith("m:") ? "E_READONLY" : "E_BAD_ARGS", a.id.startsWith("m:") ? "a reunião gravada não muda" : "id desconhecido: leia de novo com calendar_list");
  const u = { ...a, ...(typeof a.title === "string" ? { title: restored(d, path, a.title.trim()) } : {}) } as unknown as CalendarUpdate;
  const { item, change } = await journaled(d, path, () => d.calendar.update(u));
  return { value: { item: await shown(item, d), mudou: `mudou o item em ${change.path}` }, target: change.path, change };
}
