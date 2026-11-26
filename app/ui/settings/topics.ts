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
  appearance: "Aparência", // i18n-ok: o nome em pt que os links do hub e os roteiros procuram; a tela usa a chave do TOPIC_KEYS
  dictation: "Ditado",
  notes: "Notas",
  meetings: "Reuniões", // i18n-ok: o nome em pt que os links do hub e os roteiros procuram; a tela usa a chave do TOPIC_KEYS
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
  "shortcuts:Reuniões", // i18n-ok: o id do grupo de atalhos, não aparece
  "agentMeetings",
  "agent",
  "agentKiwi",
  "agentVoice",
  "agentMemory",
  "agentAdvanced",
  "usage",
  "trails",
  "doubtAnswers",
  "activity",
  "privacy",
  "about",
] as const;
export type SettingsBlock = (typeof SETTINGS_BLOCKS)[number];

/**
 * As abas de cada assunto (spec #31754, a proposta 2 do harry): cada uma junta blocos de hoje, para a página não rolar.
 * Todo assunto tem a barra de abas, mesmo com uma aba só, para a tela ser igual em todo lugar. O `id` vai no `?tab=`, no
 * `data-tab` da tela (os roteiros clicam em `.kn-prefs-tab[data-tab=…]`) e no último aberto.
 */
export interface TopicTab {
  readonly id: string;
  readonly label: TextKey;
  readonly blocks: readonly SettingsBlock[];
}

const tab = (id: string, label: TextKey, blocks: readonly SettingsBlock[]): TopicTab => ({ id, label, blocks });

export const TOPIC_TABS: Record<SettingsTopic, readonly TopicTab[]> = {
  general: [tab("general", "settings.tab.general", ["language"])],
  appearance: [tab("general", "settings.tab.general", ["appearance"])],
  // O microfone e o atalho Fn ficam nos Atalhos; o som, na Transcrição.
  dictation: [
    tab("shortcuts", "settings.tab.shortcuts", ["shortcuts:Ditado"]),
    tab("transcription", "settings.tab.transcription", ["transcription"]),
    tab("dictionary", "settings.tab.dictionary", ["dictionary"]),
    tab("snippets", "settings.tab.snippets", ["snippets"]),
  ],
  notes: [
    tab("folder", "settings.tab.folder", ["notes"]),
    tab("shortcuts", "settings.tab.shortcuts", ["shortcuts:Notas"]),
    tab("sidebar", "settings.tab.sidebar", ["sidebarKeys"]),
  ],
  meetings: [
    tab("recording", "settings.tab.recording", ["meetingSettings"]),
    tab("shortcuts", "settings.tab.shortcuts", ["shortcuts:Reuniões"]), // i18n-ok: o id do grupo de atalhos, não aparece
    tab("yours", "settings.tab.yours", ["agentMeetings"]),
  ],
  // Geral: ligar e qual agente, o Modelo, o econômico e a web. Kiwi: o Kiwi, o Control e o aviso. Voz: o Kiwi fala e o
  // que eu falei. Memória: a memória, as instruções, as rotinas, as trilhas e as respostas. Avançado: o gasto, o
  // onboarding, o teste e o Modelo de nota (T31765).
  agent: [
    tab("general", "settings.tab.general", ["agent"]),
    tab("kiwi", "settings.tab.kiwi", ["agentKiwi"]),
    tab("voice", "settings.tab.voice", ["agentVoice"]),
    tab("memory", "settings.tab.memory", ["agentMemory", "trails", "doubtAnswers"]),
    tab("advanced", "settings.tab.advanced", ["usage", "agentAdvanced"]),
  ],
  activity: [tab("general", "settings.tab.general", ["activity"])],
  privacy: [tab("general", "settings.tab.general", ["privacy"])],
  about: [tab("general", "settings.tab.general", ["about"])],
};

/** O que cada assunto mostra, na ordem da tela: os blocos das abas, uma depois da outra. */
export const TOPIC_BLOCKS: Record<SettingsTopic, readonly SettingsBlock[]> = Object.fromEntries(
  SETTINGS_TOPICS.map((t) => [t, TOPIC_TABS[t].flatMap((x) => x.blocks)]),
) as unknown as Record<SettingsTopic, readonly SettingsBlock[]>;

export const isTopicTab = (topic: SettingsTopic, v: unknown): v is string => TOPIC_TABS[topic].some((x) => x.id === v);

/** A aba de um bloco, no assunto dele. */
export function tabOf(block: SettingsBlock): string {
  return TOPIC_TABS[topicOf(block)].find((x) => x.blocks.includes(block))!.id;
}

/** ← e → nas abas: param na primeira e na última, como ↑ e ↓ na lista. */
export function stepTab(topic: SettingsTopic, current: string, dir: 1 | -1): string {
  const tabs = TOPIC_TABS[topic];
  const i = Math.max(0, tabs.findIndex((x) => x.id === current));
  return tabs[Math.max(0, Math.min(tabs.length - 1, i + dir))]!.id;
}

/** A última aba aberta de cada assunto, no `localStorage` da janela, como o último assunto. */
export const lastTabKey = (topic: SettingsTopic) => `kn-settings-tab:${topic}`;

export function readLastTab(storage: Pick<Storage, "getItem"> | null | undefined, topic: SettingsTopic): string {
  try {
    const v = storage?.getItem(lastTabKey(topic));
    if (isTopicTab(topic, v)) return v;
  } catch {
    // Sem o storage, abre a primeira.
  }
  return TOPIC_TABS[topic][0]!.id;
}

export function saveLastTab(storage: Pick<Storage, "setItem"> | null | undefined, topic: SettingsTopic, id: string): void {
  try {
    storage?.setItem(lastTabKey(topic), id);
  } catch {
    // Sem o storage, o app só não lembra.
  }
}

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
