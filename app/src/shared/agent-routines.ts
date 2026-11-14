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

export type AgentRoutines = Record<RoutineKind, AgentRoutine>;

export const DEFAULT_ROUTINES_FOLDER = "Rotinas";

export const DEFAULT_AGENT_ROUTINES: AgentRoutines = {
  daily: { on: false, time: "18:00", folder: DEFAULT_ROUTINES_FOLDER, lastRun: null, armedAt: null },
  weekly: { on: false, time: "09:00", weekday: 1, folder: DEFAULT_ROUTINES_FOLDER, lastRun: null, armedAt: null },
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

export function sanitizeAgentRoutines(input: unknown): AgentRoutines {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { daily: sanitizeRoutine("daily", o.daily), weekly: sanitizeRoutine("weekly", o.weekly) };
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
  return { daily: { ...r.daily, on: false }, weekly: { ...r.weekly, on: false } };
}

/** O horário da rotina no dia de `now` (no relógio local), ou null se hoje não é o dia dela. */
export function slotToday(kind: RoutineKind, r: AgentRoutine, now: Date): Date | null {
  if (kind === "weekly" && now.getDay() !== r.weekday) return null;
  const [h, m] = r.time.split(":").map(Number) as [number, number];
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
}

/** A rotina está na hora: ligada, o horário de hoje já passou, e ela não rodou (nem foi armada) depois dele. */
export function routineDue(kind: RoutineKind, r: AgentRoutine, now: Date): boolean {
  if (!r.on) return false;
  const slot = slotToday(kind, r, now);
  if (!slot || now.getTime() < slot.getTime()) return false;
  const after = Math.max(r.lastRun ? Date.parse(r.lastRun) : -Infinity, r.armedAt ? Date.parse(r.armedAt) : -Infinity);
  return after < slot.getTime();
}

/** A data do dia, `dd/mm/aaaa`, no relógio local: o nome da nota do resumo. */
export function routineDay(now: Date): string {
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}
