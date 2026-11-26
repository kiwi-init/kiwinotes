// Configurações por assunto (spec #11966): cada bloco de Ajustes num assunto só, e a lista do teclado e do último assunto.

import { expect, test } from "bun:test";

import { translate } from "../../src/shared/i18n/index.ts";
import { HUB_SECTIONS } from "../../src/shared/ui-contract.ts";
import { isSettingsTopic, isTopicTab, LAST_TOPIC_KEY, lastTabKey, readLastTab, readLastTopic, saveLastTab, saveLastTopic, SETTINGS_BLOCKS, SETTINGS_TOPICS, SHOWN_TOPICS, shortcutBlock, shownTopics, shortcutGroups, stepTab, stepTopic, tabOf, TOPIC_BLOCKS, TOPIC_LABEL_KEYS, TOPIC_LABELS, TOPIC_TABS, topicOf } from "./topics.ts";

test("os 9 assuntos, na ordem, cada um com nome (o Geral do T28190 na frente)", () => {
  expect(SETTINGS_TOPICS.map((t) => TOPIC_LABELS[t])).toEqual(["Geral", "Aparência", "Ditado", "Notas", "Reuniões", "Agente", "Atividade do agente", "Privacidade", "Sobre"]);
});

test("o nome de cada assunto no catálogo é o mesmo em português, e tem o seu em inglês (T28190)", () => {
  for (const t of SETTINGS_TOPICS) expect(translate("pt", TOPIC_LABEL_KEYS[t])).toBe(TOPIC_LABELS[t]);
  expect(SETTINGS_TOPICS.map((t) => translate("en", TOPIC_LABEL_KEYS[t]))).toEqual(["General", "Appearance", "Dictation", "Notes", "Meetings", "Agent", "Agent activity", "Privacy", "About"]);
});

test("toda seção de Ajustes está em exatamente um assunto", () => {
  const all = SETTINGS_TOPICS.flatMap((t) => TOPIC_BLOCKS[t]);
  // Nenhum bloco em dois assuntos, e nenhum de fora.
  expect(all.length).toBe(new Set(all).size);
  expect([...all].sort()).toEqual([...SETTINGS_BLOCKS].sort());
  for (const b of SETTINGS_BLOCKS) expect(SETTINGS_TOPICS.filter((t) => TOPIC_BLOCKS[t].includes(b))).toHaveLength(1);
});

test("os atalhos: cada grupo tem o seu bloco, no assunto do mesmo nome", () => {
  for (const g of shortcutGroups()) {
    const b = shortcutBlock(g);
    expect(SETTINGS_BLOCKS).toContain(b);
    expect(TOPIC_LABELS[topicOf(b)]).toBe(g);
  }
});

test("o que mudou de lugar: o Sobre virou assunto, e Suas reuniões foi para Reuniões", () => {
  expect(topicOf("about")).toBe("about");
  expect(topicOf("agentMeetings")).toBe("meetings");
  expect(topicOf("meetingSettings")).toBe("meetings");
  expect(topicOf("sidebarKeys")).toBe("notes");
  expect(topicOf("transcription")).toBe("dictation");
  expect(topicOf("usage")).toBe("agent");
  // A seção `about` do contrato continua valendo (o menu da barra e os scripts): o hub a abre em Ajustes › Sobre.
  expect(HUB_SECTIONS).toContain("about");
});

test("T30629: o Geral (o Idioma do app) volta na frente da lista, pelo ?topic= e como o último aberto", () => {
  expect(SHOWN_TOPICS).toEqual(SETTINGS_TOPICS);
  expect(isSettingsTopic("general")).toBe(true);
  expect(readLastTopic({ getItem: () => "general" })).toBe("general");
  expect(stepTopic("appearance", -1)).toBe("general");
  // Sem a escolha (T29319, a release de antes), ele some da lista.
  expect(shownTopics(false)).toEqual(SETTINGS_TOPICS.filter((t) => t !== "general"));
});

test("↑ e ↓ param no primeiro e no último assunto", () => {
  expect(stepTopic("general", -1, SETTINGS_TOPICS)).toBe("general");
  expect(stepTopic("general", 1, SETTINGS_TOPICS)).toBe("appearance");
  expect(stepTopic("appearance", 1)).toBe("dictation");
  expect(stepTopic("about", 1)).toBe("about");
  expect(stepTopic("about", -1)).toBe("privacy");
});

test("o último assunto: lido e guardado no storage, com Aparência quando não há ou ele falha", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  expect(readLastTopic(storage)).toBe("appearance");
  saveLastTopic(storage, "agent");
  expect(map.get(LAST_TOPIC_KEY)).toBe("agent");
  expect(readLastTopic(storage)).toBe("agent");
  map.set(LAST_TOPIC_KEY, "lixo");
  expect(readLastTopic(storage)).toBe("appearance");
  const broken = {
    getItem: () => {
      throw new Error("sem storage");
    },
    setItem: () => {
      throw new Error("sem storage");
    },
  };
  expect(readLastTopic(broken)).toBe("appearance");
  expect(() => saveLastTopic(broken, "notes")).not.toThrow();
  expect(readLastTopic(null)).toBe("appearance");
});

// As abas internas (spec #31754, T31770).
test("toda seção de Ajustes está em exatamente uma aba, e as abas de um assunto têm ids diferentes", () => {
  for (const t of SETTINGS_TOPICS) {
    const ids = TOPIC_TABS[t].map((x) => x.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of TOPIC_TABS[t]) expect(x.blocks.length).toBeGreaterThan(0);
  }
  const all = SETTINGS_TOPICS.flatMap((t) => TOPIC_TABS[t].flatMap((x) => x.blocks));
  expect(all.length).toBe(new Set(all).size);
  expect([...all].sort()).toEqual([...SETTINGS_BLOCKS].sort());
  // O TOPIC_BLOCKS sai das abas, na ordem delas.
  for (const t of SETTINGS_TOPICS) expect(TOPIC_BLOCKS[t]).toEqual(TOPIC_TABS[t].flatMap((x) => x.blocks));
});

test("cada aba tem nome em português e em inglês", () => {
  for (const t of SETTINGS_TOPICS)
    for (const x of TOPIC_TABS[t]) {
      expect(translate("pt", x.label)).not.toBe(x.label);
      expect(translate("en", x.label)).not.toBe(x.label);
    }
  expect(TOPIC_TABS.dictation.map((x) => translate("pt", x.label))).toEqual(["Atalhos", "Transcrição", "Dicionário", "Snippets"]);
  expect(TOPIC_TABS.notes.map((x) => translate("pt", x.label))).toEqual(["Pasta e opções", "Atalhos", "Barra lateral"]);
  expect(TOPIC_TABS.meetings.map((x) => translate("en", x.label))).toEqual(["Recording", "Shortcuts", "Your meetings"]);
});

test("a aba de um bloco, ← e → param na primeira e na última, e o id vale só no seu assunto", () => {
  expect(tabOf("dictionary")).toBe("dictionary");
  expect(tabOf("sidebarKeys")).toBe("sidebar");
  expect(tabOf("agentMeetings")).toBe("yours");
  expect(stepTab("dictation", "shortcuts", -1)).toBe("shortcuts");
  expect(stepTab("dictation", "shortcuts", 1)).toBe("transcription");
  expect(stepTab("dictation", "snippets", 1)).toBe("snippets");
  expect(stepTab("dictation", "lixo", 1)).toBe("transcription");
  expect(isTopicTab("notes", "sidebar")).toBe(true);
  expect(isTopicTab("meetings", "sidebar")).toBe(false);
});

test("a última aba: uma por assunto no storage, com a primeira quando não há, é de outro assunto ou o storage falha", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  expect(readLastTab(storage, "dictation")).toBe("shortcuts");
  saveLastTab(storage, "dictation", "snippets");
  saveLastTab(storage, "notes", "sidebar");
  expect(map.get(lastTabKey("dictation"))).toBe("snippets");
  expect(readLastTab(storage, "dictation")).toBe("snippets");
  expect(readLastTab(storage, "notes")).toBe("sidebar");
  map.set(lastTabKey("meetings"), "sidebar");
  expect(readLastTab(storage, "meetings")).toBe("recording");
  const broken = {
    getItem: () => {
      throw new Error("sem storage");
    },
    setItem: () => {
      throw new Error("sem storage");
    },
  };
  expect(readLastTab(broken, "notes")).toBe("folder");
  expect(() => saveLastTab(broken, "notes", "sidebar")).not.toThrow();
  expect(readLastTab(null, "meetings")).toBe("recording");
});
