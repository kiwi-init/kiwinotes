// Os textos do balão das rotinas (spec #12150, T12190): o resultado com [Ver] [Manter] [Descartar], e por que a rotina
// não rodou. Puros, para o teste.

import type { TextKey } from "../../src/shared/i18n/index.ts";
import type { AgentRoutineEvent, RoutineKind } from "../../src/shared/ui-contract.ts";
import { appLocale, t } from "../src/i18n.ts";
import { formatTime } from "../../src/shared/i18n/index.ts";

/** A hora de um ISO, no relógio do Mac e no costume da língua (`18:40` / `6:40 PM`). */
const hour = (iso: string) => formatTime(appLocale().locale, new Date(iso));

/** O nome da nota, sem a pasta e sem o `.md`. */
export const noteName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

/**
 * As frases de cada rotina, no catálogo (spec #28171): a concordância muda com ela, o resumo (singular), os pendentes
 * (plural) e uma rotina nova (spec #12944, "A rotina “Resumo das reuniões” está pronta").
 */
const LINES: Record<RoutineKind | "custom", { ready: TextKey; noNote: TextKey; limit: TextKey }> = {
  daily: { ready: "hub.routine.daily.ready", noNote: "hub.routine.daily.noNote", limit: "hub.routine.daily.limit" },
  weekly: { ready: "hub.routine.weekly.ready", noNote: "hub.routine.weekly.noNote", limit: "hub.routine.weekly.limit" },
  custom: { ready: "hub.routine.custom.ready", noNote: "hub.routine.custom.noNote", limit: "hub.routine.custom.limit" },
};

/** A frase do balão, ou null quando não há o que mostrar ("Agora não" foi a própria pessoa que disse). */
export function routineLine(e: AgentRoutineEvent): string | null {
  const keys = LINES[e.kind];
  const name = e.kind === "custom" ? e.name ?? "" : "";
  if (e.phase === "done") return e.note ? t(keys.ready, { name, note: noteName(e.note) }) : t(keys.noNote, { name });
  if (e.reason === "limit") return t(keys.limit, { name, back: e.resetsAt ? t("hub.routine.back", { time: hour(e.resetsAt) }) : "" });
  return null;
}

/** O que o [Descartar] diz depois de desfazer. */
export const routineDiscarded = (): string => t("hub.routine.discarded");
