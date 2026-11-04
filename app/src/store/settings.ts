// As Configurações que o engine guarda (T1499): `settings.json`, ao lado do dicionário e dos snippets. O atalho da janela
// Notas e a Aparência (T2503); o resto da tela de Configurações ainda é casca.

import path from "node:path";

import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "../shared/appearance.ts";
import { DEFAULT_TEMPLATES_FOLDER } from "../shared/templates.ts";
import { DEFAULT_NOTES_SHORTCUT, isNotesShortcut, type NotesShortcut } from "../shared/shortcuts.ts";
import { folderPath } from "../notes/paths.ts";
import { readJson, writeJson } from "./files.ts";

export interface AppSettings {
  /** O atalho global que abre a janela Notas, ou null (desligado). */
  notesShortcut: NotesShortcut | null;
  /**
   * As notas e pastas fixadas na janela Notas (T2468), relativas ao vault. Ficam aqui e não no frontmatter, para não
   * mexer no arquivo da pessoa por uma preferência da UI; o engine corrige quando elas mudam de nome, de pasta ou somem.
   */
  pinned: string[];
  /** Modo, temas, texto, fonte e movimento, para todas as janelas (T2503). */
  appearance: Appearance;
  /** A pasta dos modelos de nota, relativa ao vault (T2619). */
  templatesFolder: string;
  /** A pasta da nota do dia (T2593), relativa ao vault. Como no Obsidian, configurável. */
  dailyFolder: string;
}

/** Até quantas fixadas. */
export const MAX_PINNED = 200;

export const DEFAULT_SETTINGS: AppSettings = { notesShortcut: DEFAULT_NOTES_SHORTCUT, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: DEFAULT_TEMPLATES_FOLDER, dailyFolder: "Diário" };

/** Uma pasta de modelos que vale: relativa, sem `..` nem ponto no começo de um pedaço (a validação de vault é do engine). */
export function sanitizeTemplatesFolder(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_TEMPLATES_FOLDER;
  const p = input.trim().replace(/^\/+|\/+$/g, "");
  return p && p.length <= 512 && p.split("/").every((s) => s && !s.startsWith(".")) ? p : DEFAULT_TEMPLATES_FOLDER;
}

/** A pasta da nota do dia que vale: um caminho de pasta do vault, não vazio; senão, a padrão. */
export function sanitizeDailyFolder(input: unknown): string {
  try {
    const p = folderPath(input);
    return p || DEFAULT_SETTINGS.dailyFolder;
  } catch {
    return DEFAULT_SETTINGS.dailyFolder;
  }
}

/** A lista de fixadas que vale: strings curtas, sem repetir, até `MAX_PINNED` (a validação de caminho é de quem grava). */
export function sanitizePinned(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024))].slice(0, MAX_PINNED);
}

/** O que o `save` aceita: a Aparência pode vir em parte, e o resto dela fica como está. */
export type SettingsPatch = Partial<Omit<AppSettings, "appearance">> & { appearance?: Partial<Appearance> };

interface SettingsFile extends Partial<AppSettings> {
  version: 1;
}

/** Só o que vale: um campo editado à mão com um valor que não existe volta ao padrão, sem derrubar os outros. */
export function sanitizeSettings(input: unknown): AppSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    notesShortcut: "notesShortcut" in o && isNotesShortcut(o.notesShortcut) ? o.notesShortcut : DEFAULT_SETTINGS.notesShortcut,
    pinned: sanitizePinned(o.pinned),
    appearance: sanitizeAppearance(o.appearance),
    templatesFolder: sanitizeTemplatesFolder(o.templatesFolder),
    dailyFolder: "dailyFolder" in o ? sanitizeDailyFolder(o.dailyFolder) : DEFAULT_SETTINGS.dailyFolder,
  };
}

export class SettingsStore {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "settings.json");
  }

  async load(): Promise<AppSettings> {
    return sanitizeSettings(await readJson<SettingsFile>(this.file));
  }

  /** As gravações, uma depois da outra: ler, mesclar e gravar sem outra no meio (o `fixPinned` e a Aparência). */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Muda só os campos de `patch` (já validados por quem chama), e da Aparência só os campos dados. Devolve tudo como
   * ficou. Uma por vez: duas trocas rápidas de janelas diferentes não perdem campo (T2503, revisão #2582).
   */
  save(patch: SettingsPatch): Promise<AppSettings> {
    return this.update(() => patch);
  }

  /**
   * Lê, decide e grava na mesma fila (T2639): `change` recebe as configurações de agora (depois de toda gravação que veio
   * antes) e devolve o que mudar, ou null para não gravar. É o caminho das fixadas que seguem a nota (`fixPinned`): ler
   * fora da fila deixava uma fixada nova da janela, gravada no meio, ser trocada pela lista velha.
   */
  update(change: (current: AppSettings) => SettingsPatch | null): Promise<AppSettings> {
    const run = this.queue.then(async () => {
      const current = await this.load();
      const patch = change(current);
      if (!patch) return current;
      const next: AppSettings = { ...current, ...patch, appearance: { ...current.appearance, ...patch.appearance } };
      await writeJson(this.file, { version: 1, ...next } satisfies SettingsFile);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
