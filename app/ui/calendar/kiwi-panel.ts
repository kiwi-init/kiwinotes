// O lado puro do painel do Kiwi no Calendário (T32156, spec #32129): o período que ele lê, o Hoje, o "Agora não"
// guardado e a hora de onde a pendência sem data cai. O painel (KiwiPanel.tsx) só desenha o que sai daqui.

import { addDays, type CalendarItem } from "../../src/shared/calendar.ts";
import { DEADLINE_DAYS } from "../../src/shared/calendar-kiwi.ts";
import { onDay, SNAP_MIN } from "./model.ts";

/** Quantos dias para trás o painel procura a atrasada. */
export const OVERDUE_DAYS = 14;

/**
 * O período que o painel lê, à parte da vista: as atrasadas das duas últimas semanas, hoje, e os prazos e a reunião
 * de amanhã das regras (o `to` não entra).
 */
export const panelRange = (today: string) => ({ from: addDays(today, -OVERDUE_DAYS), to: addDays(today, DEADLINE_DAYS + 2) });

/** O Hoje: os itens do dia, os de dia todo primeiro, depois pela hora. */
export function todayItems(items: readonly CalendarItem[], today: string): CalendarItem[] {
  return items
    .filter((i) => onDay(i, today))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** A hora de uma pendência solta na grade: `minutes` desde a meia-noite, em passos de 15 min; sem eles, o dia todo. */
export function dropStart(day: string, minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return day;
  const m = Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.round(minutes / SNAP_MIN) * SNAP_MIN));
  return `${day}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** O que o arrasto grava: o `allDay` vai sempre, senão a pendência sem data vira "dia todo" mesmo com a hora. */
export const dropUpdate = (id: string, start: string) => ({ id, start, allDay: start.length === 10 });

/** Quanto tempo o "Agora não" vale: depois, a sugestão pode voltar. */
export const DISMISS_KEEP_MS = 7 * 86_400_000;
export const DISMISS_STORAGE_KEY = "kn.calendar.kiwi.dismissed";

type Store = Pick<Storage, "getItem" | "setItem">;

/** As sugestões dispensadas, guardadas no aparelho pela chave (não pelo id, que muda com uma linha nova acima). */
export function dismissedStore(storage: Store | null, now: () => number = Date.now) {
  const read = (): Record<string, number> => {
    try {
      const raw = JSON.parse(storage?.getItem(DISMISS_STORAGE_KEY) ?? "{}") as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const fresh: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && now() - v < DISMISS_KEEP_MS) fresh[k] = v;
      return fresh;
    } catch {
      return {};
    }
  };
  return {
    keys: (): Set<string> => new Set(Object.keys(read())),
    add(key: string): void {
      const all = { ...read(), [key]: now() };
      try {
        storage?.setItem(DISMISS_STORAGE_KEY, JSON.stringify(all));
      } catch {
        // Sem o armazenamento, a sugestão some só até recarregar a tela.
      }
    },
  };
}
