// Os arquivos do Kiwi Notes em ~/Library/Application Support/KiwiNotes/ (T57).

import { homedir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { dataDir } from "../store/files.ts";
import { HistoryStore } from "../store/history.ts";
import { SettingsStore } from "../store/settings.ts";
import { SnippetStore } from "../store/snippets.ts";
import { Attachments } from "../notes/attachments.ts";
import { OcrIndex } from "../notes/ocr.ts";
import { DictationNotes } from "../notes/fromDictation.ts";
import { Vault } from "../notes/vault.ts";

/** `KIWI_DATA_DIR` troca a pasta (testes e agentes, sem mexer nos dados reais). */
const dir = process.env.KIWI_DATA_DIR || dataDir();

const notes = new Vault({ root: process.env.KIWI_VAULT_DIR || path.join(homedir(), "KiwiNotes"), watch: true });
const settings = new SettingsStore(dir);
/** O texto dos anexos para a busca (T2709). O helper entra depois (`setRunner`): o app e o headless sabem onde ele está. */
const ocr = new OcrIndex({
  root: notes.root,
  cacheDir: path.join(dir, "ocr"),
  runner: null,
  enabled: async () => (await settings.load()).ocr,
});

export const stores = {
  dir,
  dictionary: new DictionaryStore(dir),
  snippets: new SnippetStore(dir),
  history: new HistoryStore(dir),
  /** As Configurações que o engine guarda (T1499: o atalho da janela Notas). */
  settings,
  /**
   * As notas (T1316): Markdown puro em ~/KiwiNotes, que abre no Obsidian. `KIWI_VAULT_DIR` troca a pasta (testes e
   * agentes, sem mexer nas notas reais). A pasta só nasce na 1ª vez que alguém usa as notas.
   */
  notes,
  /** O ditado vira nota (T1320): o Histórico e a nota rápida do atalho passam pelo mesmo, um por vez. */
  dictationNotes: new DictationNotes(notes),
  /** Os anexos colados e arrastados (T2594), na pasta das Configurações (`Anexos/` por padrão). */
  attachments: new Attachments(notes, async () => (await settings.load()).attachmentsFolder, (p) => ocr.enqueue([p])),
  ocr,
};
