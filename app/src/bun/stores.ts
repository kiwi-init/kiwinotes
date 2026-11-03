// Os arquivos do Kiwi Notes em ~/Library/Application Support/KiwiNotes/ (T57).

import { homedir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { dataDir } from "../store/files.ts";
import { HistoryStore } from "../store/history.ts";
import { SnippetStore } from "../store/snippets.ts";
import { Vault } from "../notes/vault.ts";

/** `KIWI_DATA_DIR` troca a pasta (testes e agentes, sem mexer nos dados reais). */
const dir = process.env.KIWI_DATA_DIR || dataDir();

export const stores = {
  dir,
  dictionary: new DictionaryStore(dir),
  snippets: new SnippetStore(dir),
  history: new HistoryStore(dir),
  /**
   * As notas (T1316): Markdown puro em ~/KiwiNotes, que abre no Obsidian. `KIWI_VAULT_DIR` troca a pasta (testes e
   * agentes, sem mexer nas notas reais). A pasta só nasce na 1ª vez que alguém usa as notas.
   */
  notes: new Vault({ root: process.env.KIWI_VAULT_DIR || path.join(homedir(), "KiwiNotes"), watch: true }),
};
