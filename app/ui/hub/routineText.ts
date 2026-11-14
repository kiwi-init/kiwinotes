// Os textos do balão das rotinas (spec #12150, T12190): o resultado com [Ver] [Manter] [Descartar], e por que a rotina
// não rodou. Puros, para o teste.

import type { AgentRoutineEvent, RoutineKind } from "../../src/shared/ui-contract.ts";

export const ROUTINE_NAMES: Record<RoutineKind, string> = { daily: "O resumo do dia", weekly: "Os pendentes da semana" };

/** A hora `HH:MM` de um ISO, no relógio do Mac. */
const hour = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** O nome da nota, sem a pasta e sem o `.md`. */
export const noteName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

/** A concordância de cada rotina: o resumo (singular) e os pendentes (plural). */
const VERBS: Record<RoutineKind, { ready: string; ended: string; notRun: string; again: string }> = {
  daily: { ready: "está pronto", ended: "terminou", notRun: "não rodou", again: "Ele roda" },
  weekly: { ready: "estão prontos", ended: "terminaram", notRun: "não rodaram", again: "Eles rodam" },
};

/** A frase do balão, ou null quando não há o que mostrar ("Agora não" foi a própria pessoa que disse). */
export function routineLine(e: AgentRoutineEvent): string | null {
  const name = ROUTINE_NAMES[e.kind];
  const v = VERBS[e.kind];
  if (e.phase === "done") return e.note ? `${name} ${v.ready}: ${noteName(e.note)}.` : `${name} ${v.ended}, mas o agente não criou a nota. A resposta está na Atividade.`;
  if (e.reason === "limit") return `${name} ${v.notRun}: o limite do seu plano acabou${e.resetsAt ? ` e volta às ${hour(e.resetsAt)}` : ""}. ${v.again} de novo no próximo horário.`;
  return null;
}

/** O que o [Descartar] diz depois de desfazer. */
export const ROUTINE_DISCARDED = "Descartado: a nota foi para a Lixeira.";
