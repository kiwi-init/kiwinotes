// O filtro do Calendário (T32408, spec #32129): esconder tipos (os botões da legenda) e projetos (as pastas de primeiro
// nível das Notas). Guarda o que está escondido, não o que está à mostra: um projeto novo aparece sozinho. O item sem
// projeto fica sempre à mostra pelo filtro de projeto. A tela (Calendar.tsx) e o painel do Kiwi usam o `passes`.

import { type CalendarItem, type CalendarKind, isCalendarKind } from "../../src/shared/calendar.ts";

export interface CalendarFilter {
  /** Os tipos escondidos. */
  kinds: CalendarKind[];
  /** Os projetos escondidos. */
  projects: string[];
}

export const NO_FILTER: CalendarFilter = { kinds: [], projects: [] };
export const FILTER_STORAGE_KEY = "kn.calendar.filter";

/** O item fica à mostra com o filtro. */
export const passes = (f: CalendarFilter, i: Pick<CalendarItem, "kind" | "project">): boolean =>
  !f.kinds.includes(i.kind) && (i.project === null || !f.projects.includes(i.project));

/** Mostra ou esconde um tipo. */
export const toggleKind = (f: CalendarFilter, k: CalendarKind): CalendarFilter => ({
  ...f,
  kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k],
});

/** Mostra ou esconde um projeto. */
export const toggleProject = (f: CalendarFilter, p: string): CalendarFilter => ({
  ...f,
  projects: f.projects.includes(p) ? f.projects.filter((x) => x !== p) : [...f.projects, p],
});

/** O "Todos": com algum escondido, mostra todos; com todos à mostra, esconde todos. */
export const toggleAllProjects = (f: CalendarFilter, all: readonly string[]): CalendarFilter => ({
  ...f,
  projects: all.some((p) => f.projects.includes(p)) ? [] : [...all],
});

/** Quantos dos projetos que existem estão à mostra (um escondido que sumiu das Notas não conta). */
export const shownProjects = (f: CalendarFilter, all: readonly string[]): number => all.filter((p) => !f.projects.includes(p)).length;

type Store = Pick<Storage, "getItem" | "setItem">;

/** O filtro guardado no aparelho; um valor estragado volta ao sem filtro. */
export function readFilter(storage: Store | null): CalendarFilter {
  try {
    const raw = JSON.parse(storage?.getItem(FILTER_STORAGE_KEY) ?? "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_FILTER;
    const { kinds, projects } = raw as Record<string, unknown>;
    return {
      kinds: Array.isArray(kinds) ? [...new Set(kinds.filter(isCalendarKind))] : [],
      projects: Array.isArray(projects) ? [...new Set(projects.filter((p): p is string => typeof p === "string"))] : [],
    };
  } catch {
    return NO_FILTER;
  }
}

export function writeFilter(storage: Store | null, f: CalendarFilter): void {
  try {
    storage?.setItem(FILTER_STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Sem o armazenamento, o filtro vale só até recarregar a tela.
  }
}

/** O `localStorage`, quando existe (os testes do bun não têm). */
export const filterStorage = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
