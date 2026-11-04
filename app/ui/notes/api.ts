// De onde a janela Notas tira o vault: das capacidades `notes.*` do engine (contrato 1.1.0, A1), ou, só no Vite do
// navegador em dev, do vault de mentira (mock.ts). No app sem as capacidades (um engine antigo), não há vault: a janela
// diz isso em vez de mostrar notas inventadas.

import "../src/api.ts"; // o tipo do `window.engine`

import { MockVault } from "./mock.ts";
import type { AttachmentFile, AttachmentSource } from "./editor/attachments.ts";
import type { SavedSearch } from "../../src/shared/query.ts";
import type { ExtrasApi, FoldersApi, VersionsApi, NoteMeta, NotesApi, TagNode, ExportFormat, TreePrefs } from "./types.ts";

type Invoke = (cap: string, args?: unknown) => Promise<unknown>;

/** As capacidades pelo `window.engine.invoke`, com os nomes e os argumentos do contrato. */
export function engineNotes(
  invoke: Invoke,
  on: (name: string, fn: (payload: unknown) => void) => () => void,
  has: (cap: string) => boolean = () => false,
): NotesApi {
  const call = <T>(cap: string, args: object = {}) => invoke(cap, args) as Promise<T>;
  // As de pastas e as fixadas vêm juntas no contrato 1.7.0 (T2468, #2493). Num engine antigo, a janela esconde o que
  // depende delas; o `pinned` também, porque um campo desconhecido no settings.set dá E_INVALID.
  const withFolders = has("folders.create");
  const folders: FoldersApi | undefined = withFolders
    ? {
        create: (path) => call("folders.create", { path }),
        rename: (path, newPath) => call("folders.rename", { path, newPath }),
        move: (path, parent) => call("folders.move", { path, parent }),
        delete: (path) => call("folders.delete", { path }),
        moveNote: (path, folder) => call("notes.move", { path, folder }),
        duplicateNote: (path) => call("notes.duplicate", { path }),
        restore: (path) => call("notes.restore", { path }),
        reveal: (path) => call("notes.reveal", { path }),
      }
    : undefined;
  const pins = withFolders
    ? {
        list: () => call<{ pinned?: string[] }>("settings.get").then((s) => s.pinned ?? []),
        set: (pinned: string[]) => call<{ pinned?: string[] }>("settings.set", { pinned }).then((s) => s.pinned ?? []),
      }
    : undefined;
  // A nota do dia, os links e a Lixeira vêm no contrato 1.8.0 (T2593); num engine antigo, a janela esconde.
  const extras: ExtrasApi | undefined = has("notes.daily")
    ? {
        daily: (date) => call("notes.daily", date ? { date } : {}),
        createFromLink: (link, from) => call("notes.createFromLink", { link, ...(from ? { from } : {}) }),
        unlinkedMentions: (path) => call("notes.unlinkedMentions", { path }),
        linkMentions: (path, target) => call("notes.linkMentions", { path, target }),
        trashList: () => call<{ items: never[] }>("trash.list").then((r) => r.items),
        trashEmpty: () => call<{ trashed: number }>("trash.empty").then((r) => r.trashed),
        trashReveal: () => call("trash.reveal"),
      }
    : undefined;
  // Os anexos (1.11.0, T2594).
  const attachments: AttachmentSource | undefined = has("attachments.save")
    ? {
        save: (name, data) => call("attachments.save", { name, data }),
        read: (link) => call("attachments.read", { link }),
        ...(has("images.remote") ? { remote: (url: string) => call<AttachmentFile>("images.remote", { url }) } : {}),
      }
    : undefined;
  // As buscas salvas vivem nas settings: um engine que não as conhece não manda o campo (e recusa no set).
  const savedSearches = has("settings.get")
    ? {
        list: () => call<{ savedSearches?: SavedSearch[] }>("settings.get").then((s) => s.savedSearches ?? null),
        set: (list: SavedSearch[]) => call<{ savedSearches?: SavedSearch[] }>("settings.set", { savedSearches: list }).then((s) => s.savedSearches ?? []),
      }
    : undefined;
  // O histórico de versões (T2680), só num engine que tem.
  const versions: VersionsApi | undefined = has("notes.versions")
    ? {
        list: (path) => call<{ versions: never[] }>("notes.versions", { path }).then((r) => r.versions),
        get: (path, id) => call("notes.version", { path, id }),
        restore: (path, id) => call("notes.restoreVersion", { path, id }),
      }
    : undefined;
  // Os outros arquivos do cofre e as preferências da árvore (1.19.0, T3370).
  const files: NotesApi["files"] = has("files.open")
    ? { open: (path) => call("files.open", { path }), onChanged: (fn) => on("files.changed", () => fn()) }
    : undefined;
  const treePrefs = (s: { showExtensions?: boolean; dailyFolder?: string }): TreePrefs => ({
    showExtensions: s.showExtensions === true,
    dailyFolder: typeof s.dailyFolder === "string" ? s.dailyFolder : "",
  });
  const prefs: NotesApi["prefs"] = has("settings.get")
    ? {
        get: () => call<{ showExtensions?: boolean; dailyFolder?: string }>("settings.get").then(treePrefs),
        onChanged: (fn) => on("settings.changed", (s) => fn(treePrefs((s ?? {}) as { showExtensions?: boolean; dailyFolder?: string }))),
      }
    : undefined;
  return {
    ...(files ? { files } : {}),
    ...(prefs ? { prefs } : {}),
    ...(folders ? { folders } : {}),
    ...(versions ? { versions } : {}),
    ...(extras ? { extras } : {}),
    ...(savedSearches ? { savedSearches } : {}),
    ...(pins ? { pins } : {}),
    ...(attachments ? { attachments } : {}),
    ...(has("notes.export") ? { export: (path: string, format: ExportFormat, theme: Record<string, string>) => call<{ file: string }>("notes.export", { path, format, theme }) } : {}),
    list: () => call("notes.list"),
    get: (path) => call("notes.get", { path }),
    save: (path, content, baseVersion) => call("notes.save", { path, content, baseVersion }),
    create: (title, folder, content, template) =>
      call("notes.create", { title, ...(folder ? { folder } : {}), ...(content ? { content } : {}), ...(template ? { template } : {}) }),
    ...(has("notes.tags")
      ? {
          tags: () => call<{ tags: TagNode[] }>("notes.tags").then((r) => r.tags),
          templates: () => call<{ folder: string; templates: NoteMeta[] }>("notes.templates"),
        }
      : {}),
    rename: (path, newPath) => call("notes.rename", { path, newPath }),
    delete: (path) => call("notes.delete", { path }),
    search: (query, limit) => call("notes.search", { query, ...(limit ? { limit } : {}) }),
    backlinks: (path) => call("notes.backlinks", { path }),
    resolve: (link) => call("notes.resolve", { link }),
    onChanged: (fn) => on("notes.changed", (payload) => fn((payload as { paths: string[] }).paths)),
  };
}

/** O vault desta janela, ou `null` quando o engine não tem as capacidades das notas. */
export function notesApi(): NotesApi | null {
  const engine = window.engine;
  if (engine) return engine.has("notes.list") ? engineNotes(
          (c, a) => engine.invoke(c, a),
          (n, f) => engine.on(n, f),
          (c) => engine.has(c),
        ) : null;
  if (!import.meta.env?.DEV) return null;
  // Só no Vite do navegador: os testes de interação simulam por aqui uma edição feita fora (no Obsidian).
  const mock = new MockVault();
  (window as { __kiwiNotesMock?: MockVault }).__kiwiNotesMock = mock;
  return mock;
}
