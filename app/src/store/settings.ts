// As Configurações que o engine guarda (T1499): `settings.json`, ao lado do dicionário e dos snippets. O atalho da janela
// Notas e a Aparência (T2503); o resto da tela de Configurações ainda é casca.

import path from "node:path";

import { attachmentsFolder, DEFAULT_ATTACHMENTS_FOLDER } from "../notes/attachments.ts";
import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "../shared/appearance.ts";
import { type SavedSearch, sanitizeSavedSearches } from "../shared/query.ts";
import { DEFAULT_TEMPLATES_FOLDER } from "../shared/templates.ts";
import { DEFAULT_MICROPHONE, isMicrophoneChoice, type MicrophoneChoice } from "../shared/microphone.ts";
import { DEFAULT_NOTES_SHORTCUT, isNotesShortcut, type NotesShortcut } from "../shared/shortcuts.ts";
import { DEFAULT_MEETING_SETTINGS, type MeetingSettings, sanitizeMeetingSettings } from "../shared/meetings.ts";
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
  /** Onde os anexos colados e arrastados vão, relativo ao vault ("" é a raiz). Padrão: `Anexos` (T2594). */
  attachmentsFolder: string;
  /** As buscas salvas, fixadas na árvore das Notas (T2660). */
  savedSearches: SavedSearch[];
  /** Ler o texto das imagens e dos PDFs anexados para a busca, no Mac (T2709). Ligado por padrão. */
  ocr: boolean;
  /** Por qual microfone o ditado grava (spec #3202, T3230). O helper recebe no `config.set`. Padrão: "auto". */
  microphone: MicrophoneChoice;
  /** A árvore das Notas mostra a extensão (`.md`, `.pdf`…) depois do nome (T3370). Desligado por padrão. */
  showExtensions: boolean;
  /** Os ajustes de reunião (R6, T4947): os atalhos, o pop-up e os apps que contam. O helper recebe no `config.set`. */
  meetings: MeetingSettings;
}

/** Até quantas fixadas. */
export const MAX_PINNED = 200;

export const DEFAULT_SETTINGS: AppSettings = { notesShortcut: DEFAULT_NOTES_SHORTCUT, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: DEFAULT_TEMPLATES_FOLDER, dailyFolder: "Diário", attachmentsFolder: DEFAULT_ATTACHMENTS_FOLDER, ocr: true, savedSearches: [], microphone: DEFAULT_MICROPHONE, showExtensions: false, meetings: DEFAULT_MEETING_SETTINGS };

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

/** A pasta de anexos que vale, ou o padrão (um valor editado à mão que sai do vault volta ao padrão). */
function sanitizeAttachmentsFolder(input: unknown): string {
  try {
    return attachmentsFolder(input);
  } catch {
    return DEFAULT_ATTACHMENTS_FOLDER;
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
    attachmentsFolder: "attachmentsFolder" in o ? sanitizeAttachmentsFolder(o.attachmentsFolder) : DEFAULT_ATTACHMENTS_FOLDER,
    savedSearches: sanitizeSavedSearches(o.savedSearches),
    ocr: typeof o.ocr === "boolean" ? o.ocr : true,
    microphone: isMicrophoneChoice(o.microphone) ? o.microphone : DEFAULT_MICROPHONE,
    showExtensions: o.showExtensions === true,
    meetings: sanitizeMeetingSettings(o.meetings),
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
      const next: AppSettings = {
        ...current,
        ...patch,
        appearance: { ...current.appearance, ...patch.appearance },
      };
      await writeJson(this.file, { version: 1, ...next } satisfies SettingsFile);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
