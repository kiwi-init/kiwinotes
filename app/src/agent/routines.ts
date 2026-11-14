// Os pedidos das rotinas (spec #12150, T12190): o que o Kiwi manda ao agente na hora marcada. O agente só lê pelas
// ferramentas do Kiwi (as notas, as reuniões e o `project_status`), que passam pelo guardrail como num pedido comum, e
// escreve uma nota nova pelo `notes_create` (o snapshot, a Atividade e o [Desfazer] de sempre).

import { routineDay, type RoutineKind } from "../shared/agent-routines.ts";

/** O nome da rotina, como a pessoa vê. */
export const ROUTINE_LABELS: Record<RoutineKind, string> = {
  daily: "O resumo do dia",
  weekly: "Os pendentes da semana",
};

/** O título da nota que a rotina cria: a data vai com hífen, porque a barra não cabe num nome de arquivo. */
export function routineNoteTitle(kind: RoutineKind, now: Date): string {
  const day = routineDay(now).replace(/\//g, "-");
  return kind === "daily" ? `Resumo de ${day}` : `Pendentes da semana de ${day}`;
}

/** O começo do pedido de toda rotina: o agente falso e o registro reconhecem por ele. */
export const ROUTINE_MARK = "[Rotina do Kiwi]";

/** O pedido de uma rotina, sempre o mesmo texto para a mesma data e pasta. */
export function routinePrompt(kind: RoutineKind, folder: string, now: Date): string {
  const day = routineDay(now);
  const title = routineNoteTitle(kind, now);
  const only = "Leia só pelas ferramentas do Kiwi, não mude nenhuma outra nota e não pergunte nada: a pessoa vê a nota depois.";
  if (kind === "daily")
    return (
      `${ROUTINE_MARK} ${ROUTINE_LABELS.daily} de ${day}. Veja o que mudou hoje nas notas (notes_list mostra a última mudança de cada uma) ` +
      `e nas reuniões de hoje (meetings_list e meetings_get), e o estado dos projetos (project_status). ` +
      `Crie com notes_create a nota "${title}" na pasta "${folder}", no Modelo de nota, com o que mudou, as decisões e os próximos passos, ` +
      `e o link [[…]] da nota de onde veio cada item. ${only}`
    );
  return (
    `${ROUTINE_MARK} ${ROUTINE_LABELS.weekly}, semana de ${day}. Junte as ações em aberto das notas (as caixas "- [ ]") e das reuniões ` +
    `(meetings_list e meetings_get), por projeto (projects_list e project_status). ` +
    `Crie com notes_create a nota "${title}" na pasta "${folder}", com uma seção por projeto e, em cada ação, o link [[…]] de onde ela veio. ${only}`
  );
}

/** A pergunta do modo econômico (#11084) antes de a rotina gastar o pedido. */
export function routineEconomyQuestion(kind: RoutineKind): string {
  return `${ROUTINE_LABELS[kind]} lê as notas e as reuniões e gasta um pedido do seu plano. Fazer agora?`;
}

/** A resposta quando a pessoa disse "Agora não" (ou não respondeu): nada foi lido. */
export function routineDeclined(kind: RoutineKind): string {
  return `Tudo bem, ${ROUTINE_LABELS[kind].toLowerCase()} fica para a próxima: nada foi lido.`;
}

/**
 * A nota que a rotina criou, entre as mudanças do pedido: a primeira nota `.md` criada, com a posição dela (1 é a
 * primeira, como o `agent.change` conta). O [Ver] do balão abre essa mudança, mesmo que o agente tenha escrito outra
 * coisa antes (revisão do #479).
 */
export function routineNoteChange(changes: readonly { kind: string; path: string }[]): { note: string; change: number } | null {
  const i = changes.findIndex((c) => c.kind === "created" && c.path.endsWith(".md"));
  return i < 0 ? null : { note: changes[i]!.path, change: i + 1 };
}

/** O pedido é de uma rotina (o agente falso e a Atividade reconhecem pelo começo). */
export const isRoutinePrompt = (text: string) => text.startsWith(ROUTINE_MARK);
