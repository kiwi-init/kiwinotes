// Os arquivos do Kiwi Notes em ~/Library/Application Support/KiwiNotes/ (T57).

import { homedir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { dataDir } from "../store/files.ts";
import { HistoryStore } from "../store/history.ts";
import { SettingsStore } from "../store/settings.ts";
import { SnippetStore } from "../store/snippets.ts";
import { DictationNotes } from "../notes/fromDictation.ts";
import { Vault } from "../notes/vault.ts";

/** `KIWI_DATA_DIR` troca a pasta (testes e agentes, sem mexer nos dados reais). */
const dir = process.env.KIWI_DATA_DIR || dataDir();

const notes = new Vault({ root: process.env.KIWI_VAULT_DIR || path.join(homedir(), "KiwiNotes"), watch: true });

export const stores = {
  dir,
  dictionary: new DictionaryStore(dir),
  snippets: new SnippetStore(dir),
  history: new HistoryStore(dir),
  /** As Configurações que o engine guarda (T1499: o atalho da janela Notas). */
  settings: new SettingsStore(dir),
  /**
   * As notas (T1316): Markdown puro em ~/KiwiNotes, que abre no Obsidian. `KIWI_VAULT_DIR` troca a pasta (testes e
   * agentes, sem mexer nas notas reais). A pasta só nasce na 1ª vez que alguém usa as notas.
   */
  notes,
  /** O ditado vira nota (T1320): o Histórico e a nota rápida do atalho passam pelo mesmo, um por vez. */
  dictationNotes: new DictationNotes(notes),
};
