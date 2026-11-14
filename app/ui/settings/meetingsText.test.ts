// "Suas reuniões" (spec #8360, T11294): os textos e a prévia do nome.

import { expect, test } from "bun:test";

import { DEFAULT_AGENT_MEETING_SETTINGS } from "../../src/store/settings.ts";
import { blocksHint, folderHint, namePreview, proposeHint } from "./meetingsText.ts";

test("a prévia do nome, com a data de hoje, nos dois formatos", () => {
  const today = new Date(2026, 10, 13);
  expect(namePreview("date-theme", today)).toBe("2026-11-13 · Cronograma da migração.md");
  expect(namePreview("theme-date", today)).toBe("Cronograma da migração · 2026-11-13.md");
});

test("as dicas: quando propor, onde salvar e os blocos", () => {
  expect(proposeHint("auto", false)).toContain("gasta um pedido");
  expect(proposeHint("auto", true)).toContain("pergunta antes");
  expect(proposeHint("on-request", true)).toContain("Só quando você pedir");
  expect(folderHint({ kind: "single", path: "Atas" })).toContain("Atas");
  expect(folderHint({ kind: "project" })).toContain("pasta do projeto");
  expect(blocksHint(DEFAULT_AGENT_MEETING_SETTINGS.blocks)).toBe("A nota leva Resumo, Decisões, Ações, Participantes e Próximos passos, e sempre o link para a transcrição.");
  expect(blocksHint({ summary: false, decisions: true, actions: false, participants: false, nextSteps: false })).toBe("A nota leva Decisões, e sempre o link para a transcrição.");
  expect(blocksHint({ summary: false, decisions: false, actions: false, participants: false, nextSteps: false })).toContain("só o link");
});
