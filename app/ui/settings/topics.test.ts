// Configurações por assunto (spec #11966): cada bloco de Ajustes num assunto só, e a lista do teclado e do último assunto.

import { expect, test } from "bun:test";

import { HUB_SECTIONS } from "../../src/shared/ui-contract.ts";
import { LAST_TOPIC_KEY, readLastTopic, saveLastTopic, SETTINGS_BLOCKS, SETTINGS_TOPICS, shortcutBlock, shortcutGroups, stepTopic, TOPIC_BLOCKS, TOPIC_LABELS, topicOf } from "./topics.ts";

test("os 8 assuntos do spec, na ordem, cada um com nome", () => {
  expect(SETTINGS_TOPICS.map((t) => TOPIC_LABELS[t])).toEqual(["Aparência", "Ditado", "Notas", "Reuniões", "Agente", "Atividade do agente", "Privacidade", "Sobre"]);
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

test("↑ e ↓ param no primeiro e no último assunto", () => {
  expect(stepTopic("appearance", -1)).toBe("appearance");
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
