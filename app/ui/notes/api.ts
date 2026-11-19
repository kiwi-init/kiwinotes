// De onde a janela Notas tira o vault: das capacidades `notes.*` do engine (contrato 1.1.0, A1), ou, só no Vite do
// navegador em dev, do vault de mentira (mock.ts). No app sem as capacidades (um engine antigo), não há vault: a janela
// diz isso em vez de mostrar notas inventadas.

import "../src/api.ts"; // o tipo do `window.engine`

import { MockVault } from "./mock.ts";
import { applyFilesDelta, type FilesDelta } from "./files-delta.ts";
import type { AttachmentFile, AttachmentSource } from "./editor/attachments.ts";
import type { SavedSearch } from "../../src/shared/query.ts";
import type { ListingPatch } from "../../src/shared/ui-contract.ts";
import type { AgentWrote, ExtrasApi, FoldersApi, VersionsApi, NoteMeta, NotesApi, TagNode, ExportFormat, TreePrefs, VaultFile, VaultListing,
} from "./types.ts";

type Invoke = (cap: string, args?: unknown) => Promise<unknown>;

/** As capacidades pelo `window.engine.invoke`, com os nomes e os argumentos do contrato. */
export function engineNotes(
  invoke: Invoke,
  on: (name: string, fn: (payload: unknown) => void) => () => void,
  has: (cap: string) => boolean = () => false,
  folderId?: string,
): NotesApi {
  const call = <T>(cap: string, args: object = {}) => invoke(cap, {...args,...(folderId?{folderId}:{})}) as Promise<T>;
  /** A nota aberta, para o agente (T14359): um erro aqui nunca chega à tela. */
  const agentOpenNote = (path: string | null) => {
    if (has("agent.openNote")) void Promise.resolve(invoke("agent.openNote", { path })).catch(() => {});
  };
  /** Os arquivos que não são nota da última `notes.list` e a versão deles (spec #13384). */
  let filesCache: { version: string; files: VaultFile[] } | null = null;
  /**
   * A árvore preguiçosa (spec #13664, contrato 1.74.0): a abertura não traz os arquivos (no cofre do harry, 150 mil e
   * 16,6 MB); cada pasta, quando abre. Aqui, os das pastas já abertas, por pasta, e a versão deles: quando ela muda, as
   * mesmas pastas vêm de novo. `flat` é a união, a mesma lista enquanto nada muda (a árvore guarda o índice por ela).
   */
  const lazyFiles = has("notes.files");
  let byFolder: { version: string; map: Map<string, VaultFile[]>; flat: VaultFile[] | null } = { version: "", map: new Map(), flat: null };
  const flatFiles = () => (byFolder.flat ??= [...byFolder.map.values()].flat());
  const folderFiles = (folder: string, page: { offset?: number; limit?: number } = {}) =>
    call<{ files: VaultFile[]; filesVersion: string; total?: number }>("notes.files", { folder, ...page }).catch(() => null);
  /** Uma pasta grande vem por partes (spec #13664): o começo na hora, o resto logo depois. */
  const FIRST_PAGE = 300;
  const syncFolders = async (version: string) => {
    if (byFolder.version === version) return;
    const keys = [...byFolder.map.keys()];
    const got = await Promise.all(keys.map((k) => folderFiles(k)));
    const map = new Map<string, VaultFile[]>();
    keys.forEach((k, i) => got[i] && map.set(k, got[i]!.files));
    byFolder = { version, map, flat: null };
  };
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
        list: () => call<{ pinned?: string[] }>("settings.get").then((s) => s.pinned ?? [],
          ),
        set: (pinned: string[]) => call<{ pinned?: string[] }>("settings.set", { pinned }).then((s) => s.pinned ?? [],
          ),
        // O engine corrige as fixadas sozinho (renomear, mover, apagar, pela janela, pelo agente ou por fora) e manda as
        // configurações novas no `settings.changed` (T20167): a janela relê dali, não depois de cada operação.
        onChanged: (fn: (pinned: string[]) => void) =>
          on("settings.changed", (s) => {
            const pinned = (s as { pinned?: unknown } | undefined)?.pinned;
            if (Array.isArray(pinned)) fn(pinned.filter((p): p is string => typeof p === "string"));
          }),
      }
    : undefined;
  // Os projetos (1.49.0, spec #9847): o evento só vale para a pasta de notas desta janela.
  const projects: NotesApi["projects"] = has("projects.list") && has("projects.mark")
    ? {
        list: () => call("projects.list"),
        mark: (folder) => call("projects.mark", { folder }),
        unmark: (folder) => call("projects.unmark", { folder }),
        setMain: (folder, note) => call("projects.setMain", { folder, note }),
        onChanged: (fn) =>
          on("projects.changed", (e) => {
            const event = (e ?? {}) as { folderId?: string };
            if (!folderId || !event.folderId || event.folderId === folderId) fn();
          }),
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
        ...(has("images.remote") ? { remote: (url: string) => call<AttachmentFile>("images.remote", { url }),
            } : {}),
      }
    : undefined;
  // As buscas salvas vivem nas settings: um engine que não as conhece não manda o campo (e recusa no set).
  const savedSearches = has("settings.get")
    ? {
        list: () => call<{ savedSearches?: SavedSearch[] }>("settings.get").then((s) => s.savedSearches ?? null,
          ),
        set: (list: SavedSearch[]) => call<{ savedSearches?: SavedSearch[] }>("settings.set", { savedSearches: list,
          }).then((s) => s.savedSearches ?? []),
      }
    : undefined;
  // O histórico de versões (T2680), só num engine que tem.
  const versions: VersionsApi | undefined = has("notes.versions")
    ? {
        list: (path) => call<{ versions: never[] }>("notes.versions", { path }).then((r) => r.versions,
          ),
        get: (path, id) => call("notes.version", { path, id }),
        restore: (path, id) => call("notes.restoreVersion", { path, id }),
      }
    : undefined;
  // Os outros arquivos do cofre e as preferências da árvore (1.19.0, T3370).
  const files: NotesApi["files"] = has("files.open")
    ? { open: (path) => call("files.open", { path }), ...(has("files.read") ? { read: (path: string, as: "text" | "binary") => call("files.read", { path, as }) } : {}), ...(has("files.save") ? { save: (path: string, content: string, baseVersion: string) => call("files.save", { path, content, baseVersion }), saveBytes: (path: string, base64: string, baseVersion: string) => call("files.save", { path, base64, baseVersion }) } : {}), ...(has("files.rename") ? { rename: (path: string, newPath: string) => call("files.rename", { path, newPath }) } : {}), ...(has("files.rename") && has("files.delete") ? { delete: (path: string) => call("files.delete", { path }) } : {}), onChanged: (fn) => on("files.changed", e => {const event=e as {paths?:string[];folderId?:string};if(!folderId||!event.folderId||event.folderId===folderId)fn(event.paths??[]);}),
      }
    : undefined;
  // O quadro branco (1.37.0, T6600).
  const canvas: NotesApi["canvas"] = has("notes.canvasGet")
    ? {
        get: (path) => call("notes.canvasGet", { path }),
        save: (path, content, baseVersion) => call("notes.canvasSave", { path, content, baseVersion }),
        create: (folder, title, content) => call("notes.canvasCreate", { folder, title, ...(content === undefined ? {} : { content }) }),
        rename: (from, to) => call("notes.canvasRename", { from, to }),
      }
    : undefined;
  type Prefs = { showExtensions?: boolean; dailyFolder?: string; noteWidth?: number; kiwicat?: { cor?: string } };
  const treePrefs = (s: Prefs): TreePrefs => ({
    showExtensions: s.showExtensions === true,
    dailyFolder: typeof s.dailyFolder === "string" ? s.dailyFolder : "",
    noteWidth: typeof s.noteWidth === "number" ? s.noteWidth : null,
    ...(typeof s.kiwicat?.cor === "string" ? { catColor: s.kiwicat.cor } : {}),
  });
  const prefs: NotesApi["prefs"] = has("settings.get")
    ? {
        get: () => call<Prefs>("settings.get").then(treePrefs),
        onChanged: (fn) => on("settings.changed", () => {
          void call<Prefs>("settings.get").then(s=>fn(treePrefs(s)),()=>{});
        }),
        setNoteWidth: async (px) => {
          await call("settings.set", { noteWidth: px });
        },
      }
    : undefined;
  return {
    agentOpenNote,
    ...(files ? { files } : {}),
    ...(canvas ? { canvas } : {}),
    ...(prefs ? { prefs } : {}),
    ...(folders ? { folders } : {}),
    ...(versions ? { versions } : {}),
    ...(extras ? { extras } : {}),
    ...(savedSearches ? { savedSearches } : {}),
    ...(pins ? { pins } : {}),
    ...(projects ? { projects } : {}),
    ...(attachments ? { attachments } : {}),
    ...(has("notes.export") ? { export: (path: string, format: ExportFormat, theme: Record<string, string>,
          ) => call<{ file: string }>("notes.export", { path, format, theme }),
        } : {}),
    ...(has("diagnostics.slowFrame")
      ? { slow: (where: string, ms: number) => void (invoke("diagnostics.slowFrame", { where, ms: Math.round(ms) }) as Promise<unknown>).catch(() => {}) }
      : {}),
    ...(lazyFiles
      ? {
          filesIn: async (folder: string, more?: (files: VaultFile[]) => void) => {
            if (byFolder.map.has(folder)) return null;
            const r = await folderFiles(folder, { limit: FIRST_PAGE });
            if (!r) return null;
            if ((r.total ?? 0) > r.files.length) {
              const at = r.files.length;
              void folderFiles(folder, { offset: at }).then((rest) => {
                if (!rest || rest.filesVersion !== r.filesVersion || byFolder.map.get(folder) !== r.files) return;
                byFolder.map.set(folder, [...r.files, ...rest.files]);
                byFolder.flat = null;
                more?.(flatFiles());
              });
            }
            // A versão andou desde a última lista: as outras pastas vêm de novo no próximo `list`.
            if (r.filesVersion !== byFolder.version) byFolder = { version: "", map: new Map(byFolder.map), flat: null };
            byFolder.map.set(folder, r.files);
            byFolder.flat = null;
            return flatFiles();
          },
          findFiles: async (query: string) => (await call<{ files: VaultFile[] }>("notes.files", { query })).files,
          resolveFiles: async (targets: string[]) =>
            targets.length ? (await call<{ paths: Record<string, string | null> }>("files.resolve", { targets: targets.slice(0, 500) })).paths : {},
        }
      : {}),
    list: async () => {
      if (lazyFiles) {
        // A abertura sem os arquivos (spec #13664): só os das pastas abertas, e os contadores de todas.
        const l = await call<VaultListing & { filesVersion?: string; fileCounts?: Record<string, number> }>("notes.list", { lazy: true });
        if (!l) return l;
        await syncFolders(l.filesVersion ?? "");
        return { ...l, files: flatFiles() };
      }
      // Os arquivos só quando mudaram (spec #13384, contrato 1.73.0): com a versão que a tela já tem, eles não vêm. Um
      // engine antigo não manda versão, e então a tela nunca a pede.
      const l = await call<VaultListing & { filesVersion?: string; filesDelta?: FilesDelta }>("notes.list", filesCache ? { filesVersion: filesCache.version } : undefined);
      if (!l) return l;
      if (l.filesVersion && l.files) filesCache = { version: l.filesVersion, files: l.files };
      else if (filesCache && l.filesVersion && l.filesDelta) {
        // Só a diferença: a lista nova sai da que a tela tem.
        filesCache = { version: l.filesVersion, files: applyFilesDelta(filesCache.files, l.filesDelta) };
        const { filesDelta: _, ...rest } = l;
        return { ...rest, files: filesCache.files };
      } else if (filesCache && l.filesVersion === filesCache.version) return { ...l, files: filesCache.files };
      else if (filesCache) {
        filesCache = null;
        return call("notes.list");
      }
      return l;
    },
    get: (path) => call("notes.get", { path }),
    save: (path, content, baseVersion, baseContent) => call("notes.save", { path, content, baseVersion,
        ...(has("meetings.speakers") && baseContent !== undefined
          ? { baseContent }
          : {}),
      }),
    ...(has("meetings.speakers") && has("meetings.renameSpeaker")
      ? {
          meetings: {
            speakers: (path: string) =>
              call<{ speakers: string[] }>("meetings.speakers", { path }).then(
                (r) => r.speakers,
              ),
            renameSpeaker: (path: string, from: string, to: string) =>
              call<NoteMeta>("meetings.renameSpeaker", { path, from, to }),
          },
        }
      : {}),
    create: (title, folder, content, template) =>
      call("notes.create", { title, ...(folder ? { folder } : {}), ...(content ? { content } : {}), ...(template ? { template } : {}),
      }),
    ...(has("notes.tags")
      ? {
          tags: () => call<{ tags: TagNode[] }>("notes.tags").then((r) => r.tags),
          templates: () => call<{ folder: string; templates: NoteMeta[] }>("notes.templates"),
        }
      : {}),
    rename: (path, newPath) => call("notes.rename", { path, newPath }),
    ...(has("notes.renameHeading") ? { renameHeading: (path: string, offset: number, title: string, baseVersion: string) => call("notes.renameHeading", { path, offset, title, baseVersion }) } : {}),
    ...(has("notes.renameTag") ? { renameTag: (from: string, to: string) => call("notes.renameTag", { from, to }) } : {}),
    ...(has("notes.linkWarnings") ? { linkWarnings: (path: string) => call("notes.linkWarnings", { path }) } : {}),
    delete: (path) => call("notes.delete", { path }),
    search: (query, limit) => call("notes.search", { query, ...(limit ? { limit } : {}) }),
    backlinks: (path) => call("notes.backlinks", { path }),
    resolve: (link) => call("notes.resolve", { link }),
    ...(has("notes.embed") ? { embed: (link: string) => call("notes.embed", { link }) } : {}),
    onAgentWrote: (fn) => on("agent.wrote", (payload) => {const e=payload as AgentWrote;if(e&&typeof e.path==="string"&&(!folderId||!e.folderId||e.folderId===folderId))fn(e);}),
    onChanged: (fn) => on("notes.changed", (payload) => {const e=payload as {paths:string[];folderId?:string;listing?:ListingPatch|null};if(!folderId||!e.folderId||e.folderId===folderId)fn(e.paths,e.listing);}),
  };
}

/** O vault desta janela, ou `null` quando o engine não tem as capacidades das notas. */
export function notesApi(folderId?: string): NotesApi | null {
  const engine = window.engine;
  if (engine) return engine.has("notes.list") ? engineNotes(
          (c, a) => engine.invoke(c, a),
          (n, f) => engine.on(n, f),
          (c) => engine.has(c),
          folderId,
        ) : null;
  if (!import.meta.env?.DEV) return null;
  // Só no Vite do navegador: os testes de interação simulam por aqui uma edição feita fora (no Obsidian).
  const mock = new MockVault();
  (window as { __kiwiNotesMock?: MockVault }).__kiwiNotesMock = mock;
  return mock;
}
