// As Configurações por assunto (spec #11966, T12115): a barra lateral com os 9 assuntos e, em cada um, os blocos de
// Ajustes que ele mostra. Os blocos são as seções de antes do spec, só mudadas de lugar: nenhuma linha muda por dentro.
// Toda linha está em exatamente um assunto (o teste confere a lista).

import { LANGUAGE_CHOICE, type TextKey } from "../../src/shared/i18n/index.ts";
import { SHORTCUTS, type ShortcutDef } from "../../src/shared/shortcuts.ts";

// "Geral" (T28190, spec #28171) é o primeiro, como nos Ajustes do macOS: o idioma do app.
export const SETTINGS_TOPICS = ["general", "appearance", "dictation", "notes", "meetings", "agent", "activity", "privacy", "about"] as const;
export type SettingsTopic = (typeof SETTINGS_TOPICS)[number];

/**
 * Os assuntos que a lista mostra. O Geral só tem o Idioma do app, que some com a `LANGUAGE_CHOICE` desligada (T29319,
 * harry #29314): sem ele, o assunto sai da lista, do `?topic=` e do último aberto. A T30629 ligou a chave.
 */
export function shownTopics(choice = LANGUAGE_CHOICE): readonly SettingsTopic[] {
  return choice ? SETTINGS_TOPICS : SETTINGS_TOPICS.filter((t) => t !== "general");
}
export const SHOWN_TOPICS = shownTopics();
export const isSettingsTopic = (v: unknown): v is SettingsTopic => (SHOWN_TOPICS as readonly unknown[]).includes(v);

/** O nome de cada assunto no catálogo (spec #28171): a tela mostra `t(TOPIC_LABEL_KEYS[t])`. */
export const TOPIC_LABEL_KEYS: Record<SettingsTopic, TextKey> = {
  general: "settings.topic.general",
  appearance: "settings.topic.appearance",
  dictation: "settings.topic.dictation",
  notes: "settings.topic.notes",
  meetings: "settings.topic.meetings",
  agent: "settings.topic.agent",
  activity: "settings.topic.activity",
  privacy: "settings.topic.privacy",
  about: "settings.topic.about",
};

/** Os nomes em português: os links de dentro do hub e os scripts de tela procuram por eles. */
export const TOPIC_LABELS: Record<SettingsTopic, string> = {
  general: "Geral",
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
  "language",
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
  "trails",
  "doubtAnswers",
  "activity",
  "privacy",
  "about",
] as const;
export type SettingsBlock = (typeof SETTINGS_BLOCKS)[number];

/** O que cada assunto mostra, na ordem da tela. */
export const TOPIC_BLOCKS: Record<SettingsTopic, readonly SettingsBlock[]> = {
  general: ["language"],
  appearance: ["appearance"],
  // O microfone, o atalho Fn, a transcrição, o dicionário, os snippets e os sons (o som fica na Transcrição).
  dictation: ["shortcuts:Ditado", "transcription", "dictionary", "snippets"],
  // A pasta de notas, as opções das notas e os atalhos (os do app e os da barra lateral).
  notes: ["notes", "shortcuts:Notas", "sidebarKeys"],
  // A gravação (os ajustes de reunião e os atalhos) e "Suas reuniões" (o resumo do agente).
  meetings: ["meetingSettings", "shortcuts:Reuniões", "agentMeetings"],
  // Ligar e testar, a cor, o Control, o aviso, o modo econômico e o gasto, a memória, as instruções, o Modelo, as trilhas e as respostas.
  agent: ["agent", "usage", "trails", "doubtAnswers"],
  activity: ["activity"],
  privacy: ["privacy"],
  about: ["about"],
};

/** O bloco dos atalhos de um grupo. */
export const shortcutBlock = (group: ShortcutGroup) => `shortcuts:${group}` as SettingsBlock;
/**
 * Os grupos de atalho que existem (o teste confere que cada um tem o seu bloco). O do Kiwi Cat (spec #12946) fica na
 * linha "Falar com o Kiwi Cat" de Ajustes › Agente, com o interruptor, e não tem bloco de atalhos.
 */
export const shortcutGroups = (): ShortcutGroup[] => [...new Set(SHORTCUTS.map((s) => s.group))].filter((g) => g !== "Kiwi Cat");

/** O assunto de um bloco. */
export function topicOf(block: SettingsBlock): SettingsTopic {
  return SETTINGS_TOPICS.find((t) => TOPIC_BLOCKS[t].includes(block))!;
}

/** ↑ e ↓ na lista: para no primeiro e no último, como a barra lateral do Channels. */
export function stepTopic(current: SettingsTopic, dir: 1 | -1, topics: readonly SettingsTopic[] = SHOWN_TOPICS): SettingsTopic {
  const i = topics.indexOf(current);
  return topics[Math.max(0, Math.min(topics.length - 1, i + dir))]!;
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
