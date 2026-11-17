// As rotinas do agente (spec #12150, T12188): o resumo do dia e os pendentes da semana, que o agente faz sozinho na hora
// marcada, só se a pessoa ligar cada uma. Aqui ficam os ajustes (saneados) e a regra pura de "está na hora": o
// agendador do serviço só pergunta a ela, com o relógio dele (falso nos testes).
//
// A regra: a rotina tem um horário por dia (o resumo) ou num dia da semana (os pendentes). Ela roda quando o horário de
// HOJE já passou e ainda não rodou depois dele. Se o app estava fechado ou o Mac dormindo na hora, ela roda uma vez ao
// abrir, no mesmo dia; no dia seguinte, o horário de ontem não conta mais, e ela pula. Ligar a rotina ou mudar a hora
// depois do horário de hoje não a faz rodar na hora: conta a partir da mudança (`armedAt`).

export const ROUTINE_KINDS = ["daily", "weekly"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];
export const isRoutineKind = (v: unknown): v is RoutineKind => (ROUTINE_KINDS as readonly unknown[]).includes(v);

export interface AgentRoutine {
  /** Ligada. As duas nascem desligadas, e desligar o agente desliga as duas. */
  on: boolean;
  /** A hora, `HH:MM`, no relógio do Mac. */
  time: string;
  /** O dia da semana dos pendentes (0 = domingo … 6 = sábado). O resumo do dia não tem. */
  weekday?: number;
  /** A pasta do cofre onde a nota vai. */
  folder: string;
  /** A última vez que rodou (ISO), ou null. */
  lastRun: string | null;
  /** A última vez que a pessoa ligou ou mudou a hora (ISO): um horário de antes disso não conta. */
  armedAt: string | null;
}

/**
 * Os dias de uma rotina criada pela pessoa (spec #12944): todo dia, os dias úteis (segunda a sexta), ou os dias escolhidos
 * (0 = domingo … 6 = sábado, em ordem e sem repetir).
 */
export type RoutineDays = "every" | "weekdays" | number[];

/** Uma rotina criada pela pessoa, pelo botão "Nova rotina" ou pela proposta do agente (spec #12944). */
export interface CustomRoutine extends AgentRoutine {
  /** `r-` e 8 letras: o que o "Rodar agora", a edição e o evento usam. */
  id: string;
  /** O nome, como a pessoa vê, até `ROUTINE_NAME_MAX` caracteres. */
  name: string;
  /** O que o agente faz, em texto, até `ROUTINE_PROMPT_MAX` caracteres. */
  prompt: string;
  days: RoutineDays;
}

/** As rotinas: as duas prontas (só se desligam) e as criadas pela pessoa, na ordem em que foram criadas. */
export interface AgentRoutines {
  daily: AgentRoutine;
  weekly: AgentRoutine;
  custom: CustomRoutine[];
}

/** O que a pessoa (ou a proposta do agente) manda para criar ou mudar uma rotina nova. */
export interface CustomRoutineInput {
  name: string;
  prompt: string;
  time: string;
  days: RoutineDays;
  folder: string;
}

export const ROUTINE_NAME_MAX = 60;
export const ROUTINE_PROMPT_MAX = 1000;
/** Quantas rotinas novas cabem: cada uma gasta um pedido do plano a cada vez. */
export const CUSTOM_ROUTINES_MAX = 20;
const ROUTINE_ID = /^r-[a-z0-9]{8}$/;
export const isCustomRoutineId = (v: unknown): v is string => typeof v === "string" && ROUTINE_ID.test(v);

export const DEFAULT_ROUTINES_FOLDER = "Rotinas";

export const DEFAULT_AGENT_ROUTINES: AgentRoutines = {
  daily: { on: false, time: "18:00", folder: DEFAULT_ROUTINES_FOLDER, lastRun: null, armedAt: null },
  weekly: { on: false, time: "09:00", weekday: 1, folder: DEFAULT_ROUTINES_FOLDER, lastRun: null, armedAt: null },
  custom: [],
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isRoutineTime = (v: unknown): v is string => typeof v === "string" && TIME.test(v);

/** Uma data ISO que vale, ou null. */
function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
}

/** Uma pasta do cofre que vale: relativa, sem `..`, sem ponto no começo de um nome, até 300 caracteres. */
export function routineFolder(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().replace(/^\/+|\/+$/g, "");
  if (!p || p.length > 300 || p.split("/").some((x) => !x.trim() || x === ".." || x.startsWith("."))) return null;
  return p;
}

function sanitizeRoutine(kind: RoutineKind, input: unknown): AgentRoutine {
  const d = DEFAULT_AGENT_ROUTINES[kind];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const weekday = typeof o.weekday === "number" && Number.isInteger(o.weekday) && o.weekday >= 0 && o.weekday <= 6 ? o.weekday : d.weekday;
  return {
    on: o.on === true,
    time: isRoutineTime(o.time) ? o.time : d.time,
    ...(kind === "weekly" ? { weekday } : {}),
    folder: routineFolder(o.folder) ?? d.folder,
    lastRun: isoOrNull(o.lastRun),
    armedAt: isoOrNull(o.armedAt),
  };
}

/** Os dias que valem, ou null: "every", "weekdays", ou de 1 a 7 dias de 0 a 6 (saem em ordem, sem repetir). */
export function routineDays(v: unknown): RoutineDays | null {
  if (v === "every" || v === "weekdays") return v;
  if (!Array.isArray(v) || !v.length || v.some((d) => typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return [...new Set(v as number[])].sort((a, b) => a - b);
}

/** Um nome ou um pedido que vale: texto sem as pontas, numa linha só no nome, até o máximo. Null se vazio ou longo. */
function routineText(v: unknown, max: number, oneLine: boolean): string | null {
  if (typeof v !== "string") return null;
  const t = (oneLine ? v.replace(/\s+/g, " ") : v.replace(/\r\n?/g, "\n")).trim();
  return t && [...t].length <= max ? t : null;
}

/** O que vale de uma rotina nova (os campos que a pessoa manda), ou o primeiro campo que não vale. */
export function customRoutineInput(v: unknown): { ok: true; value: CustomRoutineInput } | { ok: false; field: keyof CustomRoutineInput } {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = routineText(o.name, ROUTINE_NAME_MAX, true);
  if (name === null) return { ok: false, field: "name" };
  const prompt = routineText(o.prompt, ROUTINE_PROMPT_MAX, false);
  if (prompt === null) return { ok: false, field: "prompt" };
  if (!isRoutineTime(o.time)) return { ok: false, field: "time" };
  const days = routineDays(o.days);
  if (days === null) return { ok: false, field: "days" };
  const folder = routineFolder(o.folder);
  if (folder === null) return { ok: false, field: "folder" };
  return { ok: true, value: { name, prompt, time: o.time, days, folder } };
}

function sanitizeCustom(input: unknown): CustomRoutine | null {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fields = customRoutineInput(o);
  if (!isCustomRoutineId(o.id) || !fields.ok) return null;
  return { id: o.id, ...fields.value, on: o.on === true, lastRun: isoOrNull(o.lastRun), armedAt: isoOrNull(o.armedAt) };
}

export function sanitizeAgentRoutines(input: unknown): AgentRoutines {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const custom: CustomRoutine[] = [];
  for (const c of Array.isArray(o.custom) ? o.custom : []) {
    const r = sanitizeCustom(c);
    if (r && !custom.some((x) => x.id === r.id) && custom.length < CUSTOM_ROUTINES_MAX) custom.push(r);
  }
  return { daily: sanitizeRoutine("daily", o.daily), weekly: sanitizeRoutine("weekly", o.weekly), custom };
}

/** Um id novo de rotina, que não está em `taken`. */
export function newRoutineId(taken: readonly { id: string }[], random: () => string = () => crypto.randomUUID()): string {
  for (;;) {
    const id = `r-${random().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8).padEnd(8, "0")}`;
    if (!taken.some((x) => x.id === id)) return id;
  }
}

/** A rotina nova entra desligada (spec #12944), como as prontas: a pessoa liga quando quiser. */
export function createRoutine(current: AgentRoutines, input: CustomRoutineInput, id: string): AgentRoutines {
  if (current.custom.length >= CUSTOM_ROUTINES_MAX) throw new RangeError(`cabem até ${CUSTOM_ROUTINES_MAX} rotinas novas`);
  return { ...current, custom: [...current.custom, { id, ...input, on: false, lastRun: null, armedAt: null }] };
}

/**
 * Muda uma rotina nova: os campos dados (já validados por quem chama). Ligar ou mudar a hora ou os dias arma a rotina de
 * novo em `now`, como nas prontas. Null se a rotina não existe.
 */
export function updateRoutine(current: AgentRoutines, id: string, patch: Partial<CustomRoutineInput & { on: boolean }>, now: number): AgentRoutines | null {
  const i = current.custom.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const before = current.custom[i]!;
  const next: CustomRoutine = { ...before, ...patch, id: before.id, lastRun: before.lastRun, armedAt: before.armedAt };
  const rearm = (next.on && !before.on) || next.time !== before.time || JSON.stringify(next.days) !== JSON.stringify(before.days);
  const custom = current.custom.slice();
  custom[i] = rearm ? { ...next, armedAt: new Date(now).toISOString() } : next;
  return { ...current, custom };
}

/** Apaga uma rotina nova (as prontas não se apagam, só se desligam). Null se ela não existe. */
export function deleteRoutine(current: AgentRoutines, id: string): AgentRoutines | null {
  if (!current.custom.some((x) => x.id === id)) return null;
  return { ...current, custom: current.custom.filter((x) => x.id !== id) };
}

/**
 * O que a pessoa muda em Ajustes (o liga/desliga, a hora, o dia e a pasta): o `lastRun` não muda por aqui. Ligar ou
 * mudar a hora ou o dia arma a rotina de novo em `now` (um horário de antes não dispara).
 */
export function patchRoutines(current: AgentRoutines, patch: unknown, now: number): AgentRoutines {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const out = { ...current };
  for (const kind of ROUTINE_KINDS) {
    const change = p[kind];
    if (!change || typeof change !== "object") continue;
    const before = current[kind];
    const next = sanitizeRoutine(kind, { ...before, ...(change as Record<string, unknown>), lastRun: before.lastRun, armedAt: before.armedAt });
    const rearm = (next.on && !before.on) || next.time !== before.time || next.weekday !== before.weekday;
    out[kind] = rearm ? { ...next, armedAt: new Date(now).toISOString() } : next;
  }
  return out;
}

/** Todas desligadas (desligar o agente desliga as rotinas). */
export function routinesOff(r: AgentRoutines): AgentRoutines {
  return { daily: { ...r.daily, on: false }, weekly: { ...r.weekly, on: false }, custom: r.custom.map((c) => ({ ...c, on: false })) };
}

/** Os dias de uma rotina: o resumo, todo dia; os pendentes, o dia deles; uma nova, os que a pessoa escolheu. */
export function daysOf(kind: RoutineKind | "custom", r: AgentRoutine & { days?: RoutineDays }): RoutineDays {
  if (kind === "daily") return "every";
  if (kind === "weekly") return [r.weekday ?? 1];
  return r.days ?? "every";
}

/** O dia da semana `day` (0 = domingo) é um dos dias. */
export function onDay(days: RoutineDays, day: number): boolean {
  return days === "every" || (days === "weekdays" ? day >= 1 && day <= 5 : days.includes(day));
}

/** O horário da rotina no dia de `now` (no relógio local), ou null se hoje não é o dia dela. */
export function slotToday(kind: RoutineKind | "custom", r: AgentRoutine & { days?: RoutineDays }, now: Date): Date | null {
  if (!onDay(daysOf(kind, r), now.getDay())) return null;
  const [h, m] = r.time.split(":").map(Number) as [number, number];
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
}

/** A rotina está na hora: ligada, o horário de hoje já passou, e ela não rodou (nem foi armada) depois dele. */
export function routineDue(kind: RoutineKind | "custom", r: AgentRoutine & { days?: RoutineDays }, now: Date): boolean {
  if (!r.on) return false;
  const slot = slotToday(kind, r, now);
  if (!slot || now.getTime() < slot.getTime()) return false;
  const after = Math.max(r.lastRun ? Date.parse(r.lastRun) : -Infinity, r.armedAt ? Date.parse(r.armedAt) : -Infinity);
  return after < slot.getTime();
}

/** A primeira rotina na hora (as prontas antes, depois as novas na ordem): o tipo dela, e o id se é uma nova. */
export function dueRoutine(r: AgentRoutines, now: Date): RoutineRef | null {
  const kind = ROUTINE_KINDS.find((k) => routineDue(k, r[k], now));
  if (kind) return { kind };
  const c = r.custom.find((x) => routineDue("custom", x, now));
  return c ? { kind: "custom", id: c.id } : null;
}

/** Qual rotina: uma das prontas, ou uma nova pelo id. */
export type RoutineRef = { kind: RoutineKind } | { kind: "custom"; id: string };

/** A data do dia, `dd/mm/aaaa`, no relógio local: o nome da nota do resumo. */
export function routineDay(now: Date): string {
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}
