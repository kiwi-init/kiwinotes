// "Suas reuniões" em Ajustes › Agente (spec #8360, T11294): os textos e a prévia do nome do arquivo. Cada função leva a
// língua no fim (T29273): sem ela, o português de sempre.

import { INTL_TAG, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import { meetingNoteTitle, type MeetingNoteName } from "../../src/shared/meeting-note-name.ts";
import type { AgentMeetingSettings } from "../../src/store/settings.ts";

export const MEETINGS_TITLE = translate("pt", "settings.meetings.title");
export const MEETINGS_HINT = translate("pt", "settings.meetings.hint");

export const proposeOptions = (locale: Locale = "pt"): { value: AgentMeetingSettings["propose"]; label: string }[] => [
  { value: "auto", label: translate(locale, "settings.meetings.propose.auto") },
  { value: "on-request", label: translate(locale, "settings.meetings.propose.onRequest") },
];
export const folderOptions = (locale: Locale = "pt"): { value: AgentMeetingSettings["folder"]["kind"]; label: string }[] => [
  { value: "project", label: translate(locale, "settings.meetings.folder.project") },
  { value: "single", label: translate(locale, "settings.meetings.folder.single") },
];
export const nameOptions = (locale: Locale = "pt"): { value: MeetingNoteName; label: string }[] => [
  { value: "date-theme", label: translate(locale, "settings.meetings.name.dateTheme") },
  { value: "theme-date", label: translate(locale, "settings.meetings.name.themeDate") },
];

const BLOCK_KEYS: { key: keyof AgentMeetingSettings["blocks"]; text: TextKey }[] = [
  { key: "summary", text: "settings.meetings.block.summary" },
  { key: "decisions", text: "settings.meetings.block.decisions" },
  { key: "actions", text: "settings.meetings.block.actions" },
  { key: "participants", text: "settings.meetings.block.participants" },
  { key: "nextSteps", text: "settings.meetings.block.nextSteps" },
];
export const blocks = (locale: Locale = "pt"): { key: keyof AgentMeetingSettings["blocks"]; label: string }[] =>
  BLOCK_KEYS.map((b) => ({ key: b.key, label: translate(locale, b.text) }));
export const BLOCKS = blocks();

/** "A, B e C" em português, "A, B, and C" em inglês. */
export const listOf = (items: string[], locale: Locale) => new Intl.ListFormat(INTL_TAG[locale], { type: "conjunction" }).format(items);

/** O que "propor sozinho" quer dizer agora, com o modo econômico. */
export function proposeHint(propose: AgentMeetingSettings["propose"], economy: boolean, locale: Locale = "pt"): string {
  if (propose === "on-request") return translate(locale, "settings.meetings.propose.hint.onRequest");
  return translate(locale, economy ? "settings.meetings.propose.hint.economy" : "settings.meetings.propose.hint.auto");
}

/** A prévia ao vivo do nome do arquivo, com a data de hoje e um tema de exemplo. */
export function namePreview(name: MeetingNoteName, today: Date, locale: Locale = "pt"): string {
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `${meetingNoteTitle(date, translate(locale, "settings.meetings.name.example"), name)}.md`;
}

/** Onde a nota vai, dito por extenso. */
export function folderHint(folder: AgentMeetingSettings["folder"], locale: Locale = "pt"): string {
  return folder.kind === "single"
    ? translate(locale, "settings.meetings.folder.hint.single", { path: folder.path })
    : translate(locale, "settings.meetings.folder.hint.project");
}

/** "Resumo, Decisões e Ações", ou o aviso de que só fica o link. */
export function blocksHint(on: AgentMeetingSettings["blocks"], locale: Locale = "pt"): string {
  const names = blocks(locale).filter((b) => on[b.key]).map((b) => b.label);
  if (!names.length) return translate(locale, "settings.meetings.blocks.none");
  return translate(locale, "settings.meetings.blocks.some", { list: listOf(names, locale) });
}
