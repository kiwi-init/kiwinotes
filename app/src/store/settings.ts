// As Configurações que o engine guarda (T1499): `settings.json`, ao lado do dicionário e dos snippets. Por enquanto só o
// atalho da janela Notas; o resto da tela de Configurações ainda é casca.

import path from "node:path";

import { DEFAULT_NOTES_SHORTCUT, isNotesShortcut, type NotesShortcut } from "../shared/shortcuts.ts";
import { readJson, writeJson } from "./files.ts";

export interface AppSettings {
  /** O atalho global que abre a janela Notas, ou null (desligado). */
  notesShortcut: NotesShortcut | null;
}

export const DEFAULT_SETTINGS: AppSettings = { notesShortcut: DEFAULT_NOTES_SHORTCUT };

interface SettingsFile extends Partial<AppSettings> {
  version: 1;
}

/** Só o que vale: um campo editado à mão com um valor que não existe volta ao padrão, sem derrubar os outros. */
export function sanitizeSettings(input: unknown): AppSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { notesShortcut: "notesShortcut" in o && isNotesShortcut(o.notesShortcut) ? o.notesShortcut : DEFAULT_SETTINGS.notesShortcut };
}

export class SettingsStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "settings.json");
  }

  async load(): Promise<AppSettings> {
    return sanitizeSettings(await readJson<SettingsFile>(this.file));
  }

  /** Muda só os campos de `patch` (já validados por quem chama). Devolve tudo como ficou. */
  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.load()), ...patch };
    await writeJson(this.file, { version: 1, ...next } satisfies SettingsFile);
    return next;
  }
}
