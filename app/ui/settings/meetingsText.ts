// "Suas reuniões" em Ajustes › Agente (spec #8360, T11294): os textos e a prévia do nome do arquivo.

import { meetingNoteTitle, type MeetingNoteName } from "../../src/shared/meeting-note-name.ts";
import type { AgentMeetingSettings } from "../../src/store/settings.ts";

export const MEETINGS_TITLE = "Suas reuniões";
export const MEETINGS_HINT = "Depois de uma reunião gravada, o agente prepara a nota dela para a pasta do projeto. Nada é escrito antes do [Aplicar].";

export const PROPOSE_OPTIONS: { value: AgentMeetingSettings["propose"]; label: string }[] = [
  { value: "auto", label: "Propor sozinho" },
  { value: "on-request", label: "Só quando eu pedir" },
];
export const FOLDER_OPTIONS: { value: AgentMeetingSettings["folder"]["kind"]; label: string }[] = [
  { value: "project", label: "Na pasta do projeto" },
  { value: "single", label: "Numa pasta única" },
];
export const NAME_OPTIONS: { value: MeetingNoteName; label: string }[] = [
  { value: "date-theme", label: "data · tema" },
  { value: "theme-date", label: "tema · data" },
];
export const BLOCKS: { key: keyof AgentMeetingSettings["blocks"]; label: string }[] = [
  { key: "summary", label: "Resumo" },
  { key: "decisions", label: "Decisões" },
  { key: "actions", label: "Ações" },
  { key: "participants", label: "Participantes" },
  { key: "nextSteps", label: "Próximos passos" },
];

/** O que "propor sozinho" quer dizer agora, com o modo econômico. */
export function proposeHint(propose: AgentMeetingSettings["propose"], economy: boolean): string {
  if (propose === "on-request") return 'Só quando você pedir, como "atualiza o projeto com a reunião que eu acabei de ter".';
  return economy
    ? "Com o modo econômico, o Kiwi pergunta antes, porque cada proposta gasta um pedido do seu plano."
    : "Cada proposta gasta um pedido do seu plano.";
}

/** A prévia ao vivo do nome do arquivo, com a data de hoje e um tema de exemplo. */
export function namePreview(name: MeetingNoteName, today: Date): string {
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${meetingNoteTitle(date, "Cronograma da migração", name)}.md`;
}

/** Onde a nota vai, dito por extenso. */
export function folderHint(folder: AgentMeetingSettings["folder"]): string {
  return folder.kind === "single"
    ? `Todas as notas de reunião vão para ${folder.path}, e a nota principal do projeto ganha o link.`
    : "Na pasta do projeto da reunião. Sem projeto, na pasta principal.";
}

/** "Resumo, Decisões e Ações", ou o aviso de que só fica o link. */
export function blocksHint(blocks: AgentMeetingSettings["blocks"]): string {
  const on = BLOCKS.filter((b) => blocks[b.key]).map((b) => b.label);
  if (!on.length) return "Nenhum bloco: a nota leva só o link para a transcrição.";
  const list = on.length === 1 ? on[0]! : `${on.slice(0, -1).join(", ")} e ${on.at(-1)}`;
  return `A nota leva ${list}, e sempre o link para a transcrição.`;
}
