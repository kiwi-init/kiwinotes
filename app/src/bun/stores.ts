// Os arquivos do Kiwi Notes em ~/Library/Application Support/KiwiNotes/ (T57).

import { DictionaryStore } from "../store/dictionary.ts";
import { dataDir } from "../store/files.ts";
import { HistoryStore } from "../store/history.ts";
import { SnippetStore } from "../store/snippets.ts";

/** `KIWI_DATA_DIR` troca a pasta (testes e agentes, sem mexer nos dados reais). */
const dir = process.env.KIWI_DATA_DIR || dataDir();

export const stores = {
  dir,
  dictionary: new DictionaryStore(dir),
  snippets: new SnippetStore(dir),
  history: new HistoryStore(dir),
};
