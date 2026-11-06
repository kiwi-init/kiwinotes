// Os arquivos do Kiwi Notes em ~/Library/Application Support/KiwiNotes/ (T57).

import { homedir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { dataDir } from "../store/files.ts";
import { RecordingRecoveries } from "../store/recording-recovery.ts";
import { HistoryStore } from "../store/history.ts";
import { type AppSettings, type SettingsPatch, SettingsStore } from "../store/settings.ts";
import { SnippetStore } from "../store/snippets.ts";
import { DictationNotes } from "../notes/fromDictation.ts";
import { NotesFolders } from "../notes/folders-workspace.ts";
import { assertHeadlessNotesFolder, resolveReal } from "../headless/guard.ts";
import { Vault } from "../notes/vault.ts";

/** `KIWI_DATA_DIR` troca a pasta (testes e agentes, sem mexer nos dados reais). */
const dir = process.env.KIWI_DATA_DIR || dataDir();

const defaultRoot = resolveReal(process.env.KIWI_VAULT_DIR || path.join(homedir(), "KiwiNotes"));
const globalSettings = new SettingsStore(dir);
const recoveries = new RecordingRecoveries(dir);
let folders: NotesFolders;
const internalNotes = new Vault({ root: defaultRoot, watch: true, onIndexProgress: p => folders?.indexProgress(defaultRoot,p) });
folders = new NotesFolders({dir,defaultRoot,globalSettings,internalNotes,
  guard: process.env.KIWI_HEADLESS === "1" ? root => assertHeadlessNotesFolder(root) : undefined,
});
const fixed = folders.fixed;

export const stores = {
  dir,
  folders,
  globalSettings,
  dictionary: new DictionaryStore(dir),
  snippets: new SnippetStore(dir),
  recoveries,
  history: new HistoryStore(dir, recoveries),
  settings: {
    load: async () => (await folders.current()).settings.load(),
    save: async (patch: SettingsPatch) => (await folders.current()).settings.save(patch),
    update: async (change: (settings: AppSettings) => SettingsPatch | null) => (await folders.current()).settings.update(change),
  },
  // The app's fixed vault remains the home of meetings, independent of the selected folder for regular notes.
  notes: fixed.notes,
  meetingNotes: fixed.meetingNotes,
  dictationNotes: {
    toNew: async (...args: Parameters<DictationNotes["toNew"]>) => (await folders.current()).dictationNotes.toNew(...args),
    append: async (...args: Parameters<DictationNotes["append"]>) => (await folders.current()).dictationNotes.append(...args),
  },
  attachments: fixed.attachments,
  ocr: fixed.ocr,
  versions: fixed.versions,
  exporter: fixed.exporter,
};
