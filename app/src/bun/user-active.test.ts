import { expect, test } from "bun:test";

import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

// Gravar uma nota ou um arquivo conta como uso: a busca pelo sentido espera (spec #24228). Só o aviso, sem o texto.
test("o notes.save e o files.save avisam que a pessoa está digitando, e só isso", async () => {
  const seen: unknown[][] = [];
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: {} as never,
    userActive: (...args: unknown[]) => void seen.push(args),
  });
  await directInvoke(caps, "notes.save", { path: "Ideias.md", content: "uma ideia", baseVersion: null });
  expect(seen).toEqual([[]]);
  await directInvoke(caps, "files.save", { path: "Tabela.csv", content: "a,b" });
  expect(seen).toEqual([[], []]);
  // Ler não é digitar.
  await directInvoke(caps, "notes.get", { path: "Ideias.md" });
  await directInvoke(caps, "files.read", { path: "Tabela.csv" });
  expect(seen).toHaveLength(2);
});
