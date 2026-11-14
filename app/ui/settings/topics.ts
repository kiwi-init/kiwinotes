// As Configurações por assunto (spec #11966, T12115): a barra lateral com os 8 assuntos e, em cada um, os blocos de
// Ajustes que ele mostra. Os blocos são as seções de antes do spec, só mudadas de lugar: nenhuma linha muda por dentro.
// Toda linha está em exatamente um assunto (o teste confere a lista).

import { SHORTCUTS, type ShortcutDef } from "../../src/shared/shortcuts.ts";

export const SETTINGS_TOPICS = ["appearance", "dictation", "notes", "meetings", "agent", "activity", "privacy", "about"] as const;
export type SettingsTopic = (typeof SETTINGS_TOPICS)[number];
export const isSettingsTopic = (v: unknown): v is SettingsTopic => (SETTINGS_TOPICS as readonly unknown[]).includes(v);

export const TOPIC_LABELS: Record<SettingsTopic, string> = {
  appearance: "Aparência",
  dictation: "Ditado",
  notes: "Notas",
  meetings: "Reuniões",
  agent: "Agente",
  activity: "Atividade do agente",
  privacy: "Privacidade",
  about: "Sobre",
};

type ShortcutGroup = ShortcutDef["group"];

/** Os blocos de Ajustes: cada um é uma seção de hoje (os atalhos, um bloco por grupo). */
export const SETTINGS_BLOCKS = [
  "appearance",
  "shortcuts:Ditado",
  "transcription",
  "dictionary",
  "snippets",
  "notes",
  "shortcuts:Notas",
  "sidebarKeys",
  "meetingSettings",
  "shortcuts:Reuniões",
  "agentMeetings",
  "agent",
  "usage",
  "doubtAnswers",
  "activity",
  "privacy",
  "about",
] as const;
export type SettingsBlock = (typeof SETTINGS_BLOCKS)[number];

/** O que cada assunto mostra, na ordem da tela. */
export const TOPIC_BLOCKS: Record<SettingsTopic, readonly SettingsBlock[]> = {
  appearance: ["appearance"],
  // O microfone, o atalho Fn, a transcrição, o dicionário, os snippets e os sons (o som fica na Transcrição).
  dictation: ["shortcuts:Ditado", "transcription", "dictionary", "snippets"],
  // A pasta de notas, as opções das notas e os atalhos (os do app e os da barra lateral).
  notes: ["notes", "shortcuts:Notas", "sidebarKeys"],
  // A gravação (os ajustes de reunião e os atalhos) e "Suas reuniões" (o resumo do agente).
  meetings: ["meetingSettings", "shortcuts:Reuniões", "agentMeetings"],
  // Ligar e testar, a cor, o Control, o aviso, o modo econômico e o gasto, a memória, as instruções, o Modelo e as respostas.
  agent: ["agent", "usage", "doubtAnswers"],
  activity: ["activity"],
  privacy: ["privacy"],
  about: ["about"],
};

/** O bloco dos atalhos de um grupo. */
export const shortcutBlock = (group: ShortcutGroup) => `shortcuts:${group}` as SettingsBlock;
/** Os grupos de atalho que existem (o teste confere que cada um tem o seu bloco). */
export const shortcutGroups = (): ShortcutGroup[] => [...new Set(SHORTCUTS.map((s) => s.group))];

/** O assunto de um bloco. */
export function topicOf(block: SettingsBlock): SettingsTopic {
  return SETTINGS_TOPICS.find((t) => TOPIC_BLOCKS[t].includes(block))!;
}

/** ↑ e ↓ na lista: para no primeiro e no último, como a barra lateral do Channels. */
export function stepTopic(current: SettingsTopic, dir: 1 | -1): SettingsTopic {
  const i = SETTINGS_TOPICS.indexOf(current);
  return SETTINGS_TOPICS[Math.max(0, Math.min(SETTINGS_TOPICS.length - 1, i + dir))]!;
}

/** O último assunto aberto fica no `localStorage` da janela (só neste Mac). */
export const LAST_TOPIC_KEY = "kn-settings-topic";

export function readLastTopic(storage: Pick<Storage, "getItem"> | null | undefined): SettingsTopic {
  try {
    const v = storage?.getItem(LAST_TOPIC_KEY);
    return isSettingsTopic(v) ? v : "appearance";
  } catch {
    return "appearance";
  }
}

export function saveLastTopic(storage: Pick<Storage, "setItem"> | null | undefined, topic: SettingsTopic): void {
  try {
    storage?.setItem(LAST_TOPIC_KEY, topic);
  } catch {
    // Sem o storage, o app só não lembra.
  }
}

/** Abaixo desta largura, a barra lateral vira uma lista que abre o assunto em tela cheia, com "‹ Voltar". */
export const NARROW_PX = 720;
