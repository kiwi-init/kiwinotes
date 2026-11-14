// O nome da nota da reunião (spec #8360): `2026-11-11 · tema` ou `tema · 2026-11-11`. Puro e sem Node, para o motor da
// proposta (`src/agent/proposals.ts`) e a prévia ao vivo de Ajustes › Agente › "Suas reuniões" darem o mesmo nome.

import { linkSafeName } from "./wikilinks.ts";

export type MeetingNoteName = "date-theme" | "theme-date";

/** O título da nota da reunião, que vira o nome do arquivo. O tema sai sem `# ^ | [ ] \ / :`. */
export function meetingNoteTitle(date: string, theme: string, name: MeetingNoteName): string {
  const t = linkSafeName(theme.replace(/\s+/g, " ").trim()).replace(/[\\/:]/g, " ").replace(/\s+/g, " ").trim() || "Reunião";
  return name === "theme-date" ? `${t} · ${date}` : `${date} · ${t}`;
}
