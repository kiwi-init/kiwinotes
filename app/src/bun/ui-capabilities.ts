// As capacidades do contrato 1.0.0 (src/shared/ui-contract.ts): o único jeito de uma UI do AppEngine pedir algo ao
// main (T1192). Cada handler valida os argumentos e responde `E_BAD_ARGS` quando eles não servem. Nada genérico: não
// há "rodar comando" nem "ler arquivo qualquer".

import type { AppAbout, DictionaryTerm, HistoryEntry, HistoryPage, HubSection, Snippet, UpdatesView } from "../shared/ui-contract.ts";
import { CLIPBOARD_MAX_CHARS, UI_CAPABILITIES, type UiCapabilities, type UiCapability } from "../shared/ui-contract.ts";
import { aliasWarnings, aliasWarningText } from "../store/aliasCheck.ts";
import { MAX_TERMS, sanitizeTerms } from "../store/dictionary.ts";
import { sanitizeSnippets } from "../store/snippets.ts";
import { type AppSettings, MAX_PINNED, type SettingsPatch } from "../store/settings.ts";
import { folderPath, notePath, VaultError } from "../notes/paths.ts";
import { isNotesShortcut } from "../shared/shortcuts.ts";
import { type ExternalMoves, followPinned, type Vault } from "../notes/vault.ts";
import { checkAppearancePatch } from "../shared/appearance.ts";
import type { ToNoteResult } from "../notes/fromDictation.ts";

/** O que as capacidades usam do app. Nos testes, tudo de mentira. */
export interface CapabilityDeps {
  dictionary: { load(): Promise<DictionaryTerm[]>; save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]> };
  snippets: { load(): Promise<Snippet[]>; save(snippets: Snippet[]): Promise<Snippet[]> };
  history: {
    search(params: { query?: string; limit?: number; before?: string }): Promise<HistoryPage>;
    delete(id: string): Promise<boolean>;
    get(id: string): Promise<HistoryEntry | null>;
  };
  /** O ditado vira nota (T1320): uma por vez, sem duplicar. */
  dictationNotes: {
    toNew(text: string, at: Date, id: string): Promise<ToNoteResult>;
    append(path: string, text: string, at: Date, id: string): Promise<ToNoteResult>;
  };
  /** As Configurações (T1499). */
  /** O `save` mescla a Aparência dada com a que está gravada, uma gravação por vez. */
  settings: { load(): Promise<AppSettings>; save(patch: SettingsPatch): Promise<AppSettings> };
  /** O helper passa a vigiar o atalho novo (T1499). */
  settingsChanged?(settings: AppSettings): void;
  /** O STT e a limpeza passam a usar o dicionário e os snippets novos já no próximo ditado. */
  dictionaryChanged?(terms: DictionaryTerm[]): void;
  snippetsChanged?(snippets: Snippet[]): void;
  clipboardWrite(text: string): void;
  /** A seção pedida para o hub que ainda vai abrir (T2121): devolve e esquece. Sem ela, null. */
  hubSection?(): HubSection | null;
  /** A intro avisou que terminou (T2308): o hub segue. */
  introDone?(): void;
  /**
   * A seção Sobre (T2386): a versão do app, o canal e as atualizações. Sem isto (o headless, os testes), o `app.about`
   * diz "dev" e as atualizações respondem `off`, sem ir à rede.
   */
  about?: {
    info(): Omit<AppAbout, "updates">;
    view(): UpdatesView;
    check(): Promise<UpdatesView>;
    apply(): Promise<UpdatesView>;
  };
  /** O vault das notas (T1316). Aberto na 1ª chamada: o ~/KiwiNotes só nasce quando alguém usa as notas. */
  notes: Pick<
    Vault,
    | "open" | "list" | "get" | "save" | "create" | "rename" | "delete" | "search" | "backlinks" | "resolve"
    | "moveNote" | "duplicate" | "restore" | "locate" | "createFolder" | "moveFolder" | "deleteFolder"
    | "onExternalMoves" | "existing" | "tags" | "templates"
  >;
  /**
   * "Mostrar no Finder" (T2468): o app abre o Finder no caminho absoluto. Sem isto (o headless, os testes, KIWI_DEBUG),
   * o `notes.reveal` só confere que o item existe.
   */
  reveal?(abs: string): void;
  /** Agora, em ms (para o limite de ritmo do clipboard). */
  now?(): number;
}

/** As atualizações sem o Updater por perto (o headless, os testes): nada vai à rede. */
const UPDATES_OFF: UpdatesView = { state: "off", reason: "sem o atualizador no headless e nos testes", lastCheck: null };

/** Um erro com código, que o AppEngine passa à UI como está (`E_BAD_ARGS`). */
export class CapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new CapabilityError("E_BAD_ARGS", message);

function object(args: unknown, cap: string): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw bad(`${cap}: args must be an object`);
  return args as Record<string, unknown>;
}

function noArgs(args: unknown, cap: string): void {
  const a = object(args, cap);
  if (Object.keys(a).length) throw bad(`${cap}: takes no args`);
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw bad(`${field} must be an array`);
  if (value.length > max) throw bad(`${field} has more than ${max} items`);
  return value;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  if (value.length > max) throw bad(`${field} is longer than ${max}`);
  return value;
}

/** Os handlers do contrato, por nome. O AppEngine recusa (`E_NO_CAPABILITY`) qualquer nome fora daqui. */
export function uiCapabilities(deps: CapabilityDeps): Record<UiCapability, (args: unknown) => Promise<unknown> | unknown> {
  const now = deps.now ?? Date.now;
  // O main não vê o clique: a UI só chama no gesto (navigator.userActivation), e aqui vai um limite de ritmo para uma
  // UI que tente encher o clipboard sozinha.
  let lastCopy = -Infinity;

  // As fixadas seguem também o que muda por fora (T2559): no 1º uso do vault, sai o que já não existe, e daí em diante
  // um rename feito no Obsidian leva a fixada junto.
  let watchingPins: Promise<void> | null = null;
  const vault = async () => {
    await deps.notes.open();
    watchingPins ??= (async () => {
      deps.notes.onExternalMoves((r) => void followPins(r).catch((e) => console.error("[notes] pinned:", e)));
      // Best effort (revisão #2574): uma limpeza de fixadas que falha (o disco, o settings) nunca derruba as notas.
      await followPins({ moves: new Map(), gone: [] }).catch((e) => console.error("[notes] pinned:", e));
    })();
    await watchingPins;
    return deps.notes;
  };
  const followPins = async (r: ExternalMoves) => {
    const current = await deps.settings.load();
    const next = followPinned(current.pinned, r, deps.notes.existing());
    if (next.length === current.pinned.length && next.every((p, i) => p === current.pinned[i])) return;
    const saved = await deps.settings.save({ pinned: next });
    deps.settingsChanged?.(saved);
  };
  /** Os argumentos de uma capacidade de notas: só os campos conhecidos, para um typo não passar calado. */
  const fields = (args: unknown, cap: string, allowed: string[]) => {
    const a = object(args, cap);
    const extra = Object.keys(a).find((k) => !allowed.includes(k));
    if (extra) throw bad(`${cap}: unknown field ${extra}`);
    return a;
  };

  /**
   * As fixadas seguem a nota ou a pasta (T2468): `map` diz para onde foi cada caminho (null: saiu). Uma pasta movida
   * leva junto as fixadas de dentro dela.
   */
  const fixPinned = async (map: (p: string) => string | null) => {
    const current = await deps.settings.load();
    const next = [...new Set(current.pinned.map(map).filter((p): p is string => p !== null))];
    if (next.length === current.pinned.length && next.every((p, i) => p === current.pinned[i])) return;
    // Em duas linhas: num `settingsChanged?.(await save())`, sem o listener, o `?.` pula o argumento e nada é salvo.
    const saved = await deps.settings.save({ pinned: next });
    deps.settingsChanged?.(saved);
  };
  const under = (prefix: string, p: string) => p === prefix || p.startsWith(`${prefix}/`);
  const moveUnder = (from: string, to: string) => (p: string) => (under(from, p) ? `${to}${p.slice(from.length)}` : p);
  const dropUnder = (gone: string) => (p: string) => (under(gone, p) ? null : p);

  const handlers: { [K in UiCapability]: (args: unknown) => Promise<UiCapabilities[K]["result"]> | UiCapabilities[K]["result"] } = {
    "dictionary.get": (args) => {
      noArgs(args, "dictionary.get");
      return deps.dictionary.load();
    },
    "dictionary.set": async (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.set").terms, "terms", MAX_TERMS * 2));
      const saved = await deps.dictionary.save(terms);
      deps.dictionaryChanged?.(saved);
      return saved;
    },
    "dictionary.check": (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.check").terms, "terms", MAX_TERMS * 2));
      return aliasWarnings(terms).map((w) => ({ ...w, text: aliasWarningText(w) }));
    },
    "snippets.get": (args) => {
      noArgs(args, "snippets.get");
      return deps.snippets.load();
    },
    "snippets.set": async (args) => {
      const snippets = sanitizeSnippets(list(object(args, "snippets.set").snippets, "snippets", 2000));
      const saved = await deps.snippets.save(snippets);
      deps.snippetsChanged?.(saved);
      return saved;
    },
    "history.search": (args) => {
      const a = object(args, "history.search");
      const query = optionalString(a.query, "query", 500);
      const before = optionalString(a.before, "before", 64);
      if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 500)) {
        throw bad("limit must be an integer from 1 to 500");
      }
      return deps.history.search({ query, before, limit: a.limit as number | undefined });
    },
    "history.delete": (args) => {
      const id = optionalString(object(args, "history.delete").id, "id", 128);
      if (!id) throw bad("id is required");
      return deps.history.delete(id);
    },
    "history.toNote": async (args) => {
      const a = fields(args, "history.toNote", ["id", "path"]);
      const id = optionalString(a.id, "id", 128);
      if (!id) throw bad("id is required");
      const path = optionalString(a.path, "path", 1024);
      const entry = await deps.history.get(id);
      if (!entry) throw new CapabilityError("E_NOT_FOUND", `history.toNote: no dictation ${id}`);
      const at = new Date(entry.at);
      return path ? deps.dictationNotes.append(path, entry.text, at, entry.id) : deps.dictationNotes.toNew(entry.text, at, entry.id);
    },
    "settings.get": (args) => {
      noArgs(args, "settings.get");
      return deps.settings.load();
    },
    "settings.set": async (args) => {
      const a = object(args, "settings.set");
      const patch: SettingsPatch = {};
      for (const [key, value] of Object.entries(a)) {
        if (key === "notesShortcut") {
          if (!isNotesShortcut(value)) throw bad("notesShortcut must be one of the offered shortcuts, or null");
          patch.notesShortcut = value;
        } else if (key === "pinned") {
          patch.pinned = pinnedList(value);
        } else if (key === "appearance") {
          // Só os campos dados (1.8.0, T2503): o resto da Aparência fica como estava.
          const checked = checkAppearancePatch(value);
          if (!checked.ok) throw bad(`settings.set: ${checked.error}`);
          patch.appearance = checked.patch;
        } else if (key === "templatesFolder") {
          // Uma pasta do vault (T2619); a raiz não serve (todas as notas virariam modelo).
          let p: string;
          try {
            p = folderPath(value);
          } catch (e) {
            throw e instanceof VaultError ? new CapabilityError(e.code, `templatesFolder: ${e.message}`) : e;
          }
          if (!p) throw bad("templatesFolder can't be the vault root");
          patch.templatesFolder = p;
        } else throw bad(`settings.set: unknown setting ${key}`);
      }
      const saved = await deps.settings.save(patch);
      deps.settingsChanged?.(saved);
      return saved;
    },
    "hub.section": (args) => {
      noArgs(args, "hub.section");
      return { section: deps.hubSection?.() ?? null };
    },
    "app.about": (args) => {
      noArgs(args, "app.about");
      if (!deps.about) return { version: "dev", channel: "dev", releaseUrl: null, updates: UPDATES_OFF } satisfies AppAbout;
      return { ...deps.about.info(), updates: deps.about.view() } satisfies AppAbout;
    },
    "updates.check": async (args) => {
      noArgs(args, "updates.check");
      return deps.about ? deps.about.check() : UPDATES_OFF;
    },
    "updates.apply": async (args) => {
      noArgs(args, "updates.apply");
      return deps.about ? deps.about.apply() : UPDATES_OFF;
    },
    "intro.done": (args) => {
      noArgs(args, "intro.done");
      deps.introDone?.();
      return true as const;
    },
    "clipboard.write": (args) => {
      const text = object(args, "clipboard.write").text;
      if (typeof text !== "string") throw bad("text must be a string");
      if (text.length > CLIPBOARD_MAX_CHARS) throw bad(`text is longer than ${CLIPBOARD_MAX_CHARS} characters`);
      const t = now();
      if (t - lastCopy < 300) throw new CapabilityError("E_RATE", "clipboard.write: too soon after the last copy");
      lastCopy = t;
      deps.clipboardWrite(text);
      return true;
    },
    // O vault valida caminho, conteúdo e limites (E_OUTSIDE_VAULT, E_BAD_ARGS); aqui, os campos.
    "notes.list": async (args) => {
      noArgs(args, "notes.list");
      return (await vault()).list();
    },
    "notes.get": async (args) => (await vault()).get(fields(args, "notes.get", ["path"]).path),
    "notes.save": async (args) => {
      const a = fields(args, "notes.save", ["path", "content", "baseVersion"]);
      return (await vault()).save(a.path, a.content, a.baseVersion);
    },
    "notes.create": async (args) => {
      const a = fields(args, "notes.create", ["folder", "title", "content", "template"]);
      return (await vault()).create(a.folder, a.title, a.content ?? "", a.template);
    },
    "notes.rename": async (args) => {
      const a = fields(args, "notes.rename", ["path", "newPath"]);
      const r = await (await vault()).rename(a.path, a.newPath);
      await fixPinned(moveUnder(notePath(a.path), r.meta.path));
      return r;
    },
    "notes.delete": async (args) => {
      const p = fields(args, "notes.delete", ["path"]).path;
      const r = await (await vault()).delete(p);
      await fixPinned(dropUnder(notePath(p)));
      return r;
    },
    "notes.move": async (args) => {
      const a = fields(args, "notes.move", ["path", "folder"]);
      const r = await (await vault()).moveNote(a.path, a.folder);
      await fixPinned(moveUnder(notePath(a.path), r.meta.path));
      return r;
    },
    "notes.duplicate": async (args) => (await vault()).duplicate(fields(args, "notes.duplicate", ["path"]).path),
    "notes.restore": async (args) => (await vault()).restore(fields(args, "notes.restore", ["path"]).path),
    "notes.reveal": async (args) => {
      const abs = await (await vault()).locate(fields(args, "notes.reveal", ["path"]).path);
      deps.reveal?.(abs);
      return true as const;
    },
    "folders.create": async (args) => (await vault()).createFolder(fields(args, "folders.create", ["path"]).path),
    "folders.rename": async (args) => {
      const a = fields(args, "folders.rename", ["path", "newPath"]);
      const r = await (await vault()).moveFolder(a.path, a.newPath);
      await fixPinned(moveUnder(folderPath(a.path), r.path));
      return r;
    },
    "folders.move": async (args) => {
      const a = fields(args, "folders.move", ["path", "parent"]);
      const from = folderPath(a.path);
      const parent = folderPath(a.parent ?? "");
      const name = from.split("/").at(-1) ?? "";
      const r = await (await vault()).moveFolder(from, parent ? `${parent}/${name}` : name);
      await fixPinned(moveUnder(from, r.path));
      return r;
    },
    "folders.delete": async (args) => {
      const p = folderPath(fields(args, "folders.delete", ["path"]).path);
      const r = await (await vault()).deleteFolder(p);
      await fixPinned(dropUnder(p));
      return r;
    },
    "notes.search": async (args) => {
      const a = fields(args, "notes.search", ["query", "limit"]);
      return (await vault()).search(a.query, a.limit);
    },
    "notes.backlinks": async (args) => (await vault()).backlinks(fields(args, "notes.backlinks", ["path"]).path),
    "notes.resolve": async (args) => (await vault()).resolve(fields(args, "notes.resolve", ["link"]).link),
    "notes.tags": async (args) => {
      noArgs(args, "notes.tags");
      return { tags: (await vault()).tags() };
    },
    "notes.templates": async (args) => {
      noArgs(args, "notes.templates");
      const folder = (await deps.settings.load()).templatesFolder;
      return { folder, templates: (await vault()).templates(folder) };
    },
  };
  // A lista do contrato e os handlers andam juntos.
  for (const cap of UI_CAPABILITIES) if (!handlers[cap]) throw new Error(`no handler for ${cap}`);
  return handlers;
}

export type { HistoryEntry };

/** O `pinned` do `settings.set`: caminhos de nota ou pasta do vault, sem repetir, até `MAX_PINNED`. */
function pinnedList(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad("pinned must be a list of note or folder paths");
  if (value.length > MAX_PINNED) throw bad(`pinned has more than ${MAX_PINNED} items`);
  const out: string[] = [];
  for (const v of value) {
    let p: string;
    try {
      p = typeof v === "string" && /\.md$/i.test(v) ? notePath(v) : folderPath(v);
    } catch (e) {
      throw e instanceof VaultError ? new CapabilityError(e.code, `pinned: ${e.message}`) : e;
    }
    if (!p) throw bad("pinned can't hold the vault root");
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
