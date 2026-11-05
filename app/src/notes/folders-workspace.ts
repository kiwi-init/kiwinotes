// Choosing the root is separate from a relative vault path (ADR 0007). All tests pass scratch folders.
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "../store/files.ts";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type SettingsPatch,
  type SettingsStore,
  sanitizeSettings,
} from "../store/settings.ts";
import { Vault, type IndexProgress } from "./vault.ts";
import { NoteVersions } from "./versions.ts";
import { DictationNotes } from "./fromDictation.ts";
import { MeetingNotes } from "./meetings.ts";
import { Attachments } from "./attachments.ts";
import { OcrIndex, type OcrRunner } from "./ocr.ts";
import { NoteExporter } from "./export.ts";

export interface FolderRef {
  id: string;
  key: string;
  path: string;
  name: string;
}
export interface FolderView {
  current: FolderRef;
  pending?: { token: string; path: string; count: number };
  error?: string;
  internal: FolderRef;
  recent: Omit<FolderRef, "id">[];
  progress: {
    phase: "idle" | "counting" | "indexing";
    path: string;
    seen: number;
    notes: number;
  };
}
export type OpenFolderResult =
  | { kind: "cancelled" }
  | { kind: "opened"; folder: FolderRef }
  | { kind: "confirm"; token: string; path: string; count: number };
interface Registry {
  version: 1;
  current: string;
  recent: string[];
}
export class FolderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const within = (p: string, root: string) =>
  p.toLowerCase() === root.toLowerCase() ||
  p.toLowerCase().startsWith(root.toLowerCase() + path.sep);
export const folderKey = (root: string) =>
  createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 20);
export async function validateNotesRoot(
  input: string,
  home = os.homedir(),
): Promise<string> {
  if (
    typeof input !== "string" ||
    !path.isAbsolute(input) ||
    input.includes("\0")
  )
    throw new FolderError("E_BAD_FOLDER", "Escolha uma pasta do Mac.");
  const root = await realpath(input).catch(() => {
    throw new FolderError(
      "E_ACCESS",
      `Não foi possível acessar a pasta ${input}. Confira a permissão de acesso.`,
    );
  });
  const realHome = await realpath(home).catch(() => path.resolve(home));
  const forbidden = [
    "/System",
    "/Library",
    "/Applications",
    "/bin",
    "/sbin",
    "/usr",
    "/dev",
    path.join(realHome, "Library"),
  ];
  if (
    root === path.parse(root).root ||
    root === realHome ||
    forbidden.some((p) => within(root, p))
  )
    throw new FolderError(
      "E_BAD_FOLDER",
      `A pasta ${input} não pode ser usada para notas. Escolha uma pasta de documentos, sem incluir a pasta pessoal inteira ou pastas do sistema.`,
    );
  if (!(await lstat(root)).isDirectory())
    throw new FolderError("E_BAD_FOLDER", `${input} não é uma pasta.`);
  return root;
}

const NOTE_KEYS = [
  "pinned",
  "templatesFolder",
  "dailyFolder",
  "attachmentsFolder",
  "savedSearches",
] as const;
/** Global appearance/shortcuts remain global. Relative note preferences live in Application Support per folder. */
export class FolderSettings {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private global: SettingsStore,
    private file: string,
    private legacy = false,
  ) {}
  async load(): Promise<AppSettings> {
    const global = await this.global.load();
    const local = await readJson<Partial<AppSettings>>(this.file);
    const source = local ?? (this.legacy ? global : DEFAULT_SETTINGS);
    const checked = sanitizeSettings(source);
    return {
      ...global,
      ...Object.fromEntries(NOTE_KEYS.map((key) => [key, checked[key]])),
    } as AppSettings;
  }
  save(patch: SettingsPatch): Promise<AppSettings> {
    return this.update(() => patch);
  }
  update(
    change: (current: AppSettings) => SettingsPatch | null,
  ): Promise<AppSettings> {
    const run = this.queue.then(async () => {
      const current = await this.load(),
        patch = change(current);
      if (!patch) return current;
      const globalPatch = { ...patch };
      for (const key of NOTE_KEYS)
        delete (globalPatch as Record<string, unknown>)[key];
      if (Object.keys(globalPatch).length) await this.global.save(globalPatch);
      if (NOTE_KEYS.some((key) => key in patch)) {
        const next = sanitizeSettings({ ...current, ...patch });
        await writeJson(
          this.file,
          Object.fromEntries(NOTE_KEYS.map((key) => [key, next[key]])),
        );
      }
      return this.load();
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
export interface FolderBundle {
  ref: FolderRef;
  notes: Vault;
  settings: FolderSettings;
  versions: NoteVersions;
  dictationNotes: DictationNotes;
  meetingNotes: MeetingNotes;
  attachments: Attachments;
  ocr: OcrIndex;
  exporter: NoteExporter;
}
interface Options {
  dir: string;
  defaultRoot: string;
  globalSettings: SettingsStore;
  internalNotes: Vault;
  home?: string;
  watch?: boolean;
  limit?: number;
  guard?(path: string): void;
}
/** Root-bound bundles never mutate their root during an in-flight save. The UI's id rejects calls from an old view. */
export class NotesFolders {
  private active?: FolderBundle;
  private internalBundle?: FolderBundle;
  private registry?: Registry;
  private ready?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(view: FolderView) => void>();
  private changes = new Set<(folder: FolderRef, paths: string[]) => void>();
  private fileChanges = new Set<(folder: FolderRef, paths: string[]) => void>();
  private progress: FolderView["progress"] = {
    phase: "idle",
    path: "",
    seen: 0,
    notes: 0,
  };
  private lastError?: string;
  private pending?: { token: string; path: string; count: number };
  private ocrRunner: OcrRunner | null = null;
  private pdf?: Parameters<NoteExporter["setPdf"]>[0];
  private generation = 0;
  readonly registryFile: string;
  constructor(private options: Options) {
    this.registryFile = path.join(options.dir, "notes-folders.json");
    this.internalBundle = this.bundle(options.defaultRoot, true);
  }
  get fixed(): FolderBundle {
    return this.internalBundle!;
  }
  private bundle(root: string, internal = false): FolderBundle {
    const key = folderKey(root),
      ref = {
        id: internal ? `internal:${key}` : `${key}:${++this.generation}`,
        key,
        path: root,
        name: path.basename(root),
      };
    const settings = new FolderSettings(
      this.options.globalSettings,
      path.join(this.options.dir, "folders", key, "settings.json"),
      root === this.options.defaultRoot,
    );
    const notes = internal
      ? this.options.internalNotes
      : new Vault({
          root,
          watch: this.options.watch ?? true,
          strictRoot: true,
          onIndexProgress: (p) => this.indexProgress(root, p),
        });
    const ocr = new OcrIndex({
      root,
      cacheDir: internal
        ? path.join(this.options.dir, "ocr")
        : path.join(this.options.dir, "folders", key, "ocr"),
      runner: this.ocrRunner,
      enabled: async () => (await settings.load()).ocr,
    });
    const exporter = new NoteExporter({ vault: notes });
    if (this.pdf) exporter.setPdf(this.pdf);
    const bundle = {
      ref,
      notes,
      settings,
      ocr,
      exporter,
      versions: new NoteVersions({
        dir: internal
          ? path.join(this.options.dir, "history", "notes")
          : path.join(this.options.dir, "folders", key, "history"),
      }),
      dictationNotes: new DictationNotes(notes),
      meetingNotes: new MeetingNotes(notes, {
        onError: () =>
          console.error("[meetings] note write failed; pending text retained"),
      }),
      attachments: new Attachments(
        notes,
        async () => (await settings.load()).attachmentsFolder,
        (p) => ocr.enqueue([p]),
      ),
    };
    notes.onChanged((paths) => {
      for (const fn of this.changes) fn(ref, paths);
    });
    notes.onOtherFiles((paths) => {
      for (const fn of this.fileChanges) fn(ref, paths);
    });
    return bundle;
  }
  async ensure(): Promise<void> {
    this.ready ??= (async () => {
      const saved = await readJson<Registry>(this.registryFile);
      this.registry =
        saved && saved.version === 1 && Array.isArray(saved.recent)
          ? {
              version: 1,
              current:
                typeof saved.current === "string"
                  ? saved.current
                  : this.options.defaultRoot,
              recent: saved.recent
                .filter((p) => typeof p === "string" && path.isAbsolute(p))
                .slice(0, 10),
            }
          : { version: 1, current: this.options.defaultRoot, recent: [] };
      let root = this.registry.current;
      if (root !== this.options.defaultRoot) {
        try {
          this.options.guard?.(root);
          root = await validateNotesRoot(root, this.options.home);
        } catch (error) {
          this.lastError=error instanceof Error?error.message:String(error);
          root = this.options.defaultRoot;
        }
      }
      this.active =
        root === this.options.defaultRoot
          ? this.internalBundle
          : this.bundle(root);
      this.registry.current = root;
    })();
    return this.ready;
  }
  async current(): Promise<FolderBundle> {
    await this.ensure();
    return this.active!;
  }
  async internal(): Promise<FolderBundle> {
    await this.ensure();
    return this.internalBundle!;
  }
  async resolve(id?: string): Promise<FolderBundle> {
    await this.ensure();
    if (id === this.internalBundle!.ref.id) return this.internalBundle!;
    if (id !== undefined && id !== this.active!.ref.id)
      throw new FolderError(
        "E_FOLDER_CHANGED",
        "A pasta das notas mudou. Sua edição permanece na pasta anterior.",
      );
    return this.active!;
  }
  async view(): Promise<FolderView> {
    await this.ensure();
    return {
      current: this.active!.ref,
      internal: this.internalBundle!.ref,
      pending: this.pending,
      error: this.lastError,
      recent: this.registry!.recent.map((p) => ({
        key: folderKey(p),
        path: p,
        name: path.basename(p),
      })),
      progress: this.progress,
    };
  }
  onChange(fn: (view: FolderView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onNotesChanged(fn: (folder: FolderRef, paths: string[]) => void): () => void {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }
  onFilesChanged(fn: (folder: FolderRef, paths: string[]) => void): () => void {
    this.fileChanges.add(fn);
    return () => this.fileChanges.delete(fn);
  }
  private emit() {
    void this.view().then((v) => {
      for (const fn of this.listeners) fn(v);
    });
  }
  indexProgress(root: string, p: IndexProgress) {
    void this.ensure()
      .then(() => {
        if (
          root !== this.active!.ref.path &&
          !(this.progress.phase === "indexing" && this.progress.path === root)
        )
          return;
        this.progress = {
          phase: p.done ? "idle" : "indexing",
          path: root,
          seen: p.seen,
          notes: p.notes,
        };
        this.emit();
      })
      .catch(() => {});
  }
  setOcrRunner(runner: OcrRunner) {
    this.ocrRunner = runner;
    this.active?.ocr.setRunner(runner);
    this.internalBundle?.ocr.setRunner(runner);
  }
  setPdf(pdf: Parameters<NoteExporter["setPdf"]>[0]) {
    this.pdf = pdf;
    this.active?.exporter.setPdf(pdf);
    this.internalBundle?.exporter.setPdf(pdf);
  }
  cancelConfirmation(token: string) {
    if (this.pending?.token === token) {
      this.pending = undefined;
      this.emit();
    }
  }
  async recent(key: string): Promise<string> {
    await this.ensure();
    const root = this.registry!.recent.find((p) => folderKey(p) === key);
    if (!root)
      throw new FolderError(
        "E_BAD_FOLDER",
        "Esta pasta não está nas recentes.",
      );
    return root;
  }
  async open(root?: string, token?: string): Promise<OpenFolderResult> {
    const run = this.queue
      .then(async () => {
        await this.ensure();
        this.lastError = undefined;
        let candidate: string;
        if (token) {
          if (!this.pending || token !== this.pending.token)
            throw new FolderError(
              "E_BAD_FOLDER",
              "Confirme novamente a pasta escolhida.",
            );
          candidate = await validateNotesRoot(
            this.pending.path,
            this.options.home,
          );
          if (candidate !== this.pending.path)
            throw new FolderError(
              "E_BAD_FOLDER",
              "A pasta mudou. Escolha novamente.",
            );
        } else {
          if (!root) return { kind: "cancelled" } as OpenFolderResult;
          this.options.guard?.(root);
          candidate = await validateNotesRoot(root, this.options.home);
        }
        this.options.guard?.(candidate);
        if (candidate === this.active!.ref.path)
          return {
            kind: "opened",
            folder: this.active!.ref,
          } as OpenFolderResult;
        if (!token) {
          this.progress = {
            phase: "counting",
            path: candidate,
            seen: 0,
            notes: 0,
          };
          this.emit();
          const count = await this.count(candidate);
          if (count > (this.options.limit ?? 20_000)) {
            const pending = {
              token: crypto.randomUUID(),
              path: candidate,
              count,
            };
            this.pending = pending;
            this.progress = { ...this.progress, phase: "idle" };
            this.emit();
            return { kind: "confirm", ...pending } as OpenFolderResult;
          }
        }
        const next =
          candidate === this.options.defaultRoot
            ? this.internalBundle!
            : this.bundle(candidate);
        this.progress = {
          phase: "indexing",
          path: candidate,
          seen: 0,
          notes: 0,
        };
        this.emit();
        try {
          await next.notes.open();
          if (
            candidate === this.options.defaultRoot &&
            (this.options.watch ?? true)
          )
            next.notes.watch();
        } catch (error) {
          if (next !== this.internalBundle) next.notes.close();
          this.progress = { ...this.progress, phase: "idle" };
          this.emit();
          throw error;
        }
        const previous = this.active!;
        const registry: Registry = {
          version: 1,
          current: candidate,
          recent: [candidate, previous.ref.path, ...this.registry!.recent]
            .filter((p, i, a) => a.indexOf(p) === i)
            .slice(0, 10),
        };
        try {
          await writeJson(this.registryFile, registry);
        } catch (error) {
          if (next !== this.internalBundle) {
            next.notes.close();
            await next.versions.close();
          }
          throw error;
        }
        this.active = next;
        this.pending = undefined;
        this.registry = registry;
        if (previous !== this.internalBundle && previous !== next) {
          previous.notes.close();
          await previous.versions.close();
        }
        this.progress = { ...this.progress, phase: "idle" };
        this.emit();
        return { kind: "opened", folder: next.ref } as OpenFolderResult;
      })
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.progress = { ...this.progress, phase: "idle" };
        this.emit();
        throw error;
      });
    this.queue = run.catch(() => {});
    return run;
  }
  private async count(root: string): Promise<number> {
    let seen = 0;
    const limit = this.options.limit ?? 20_000;
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
        throw new FolderError(
          "E_ACCESS",
          `Não foi possível ler a pasta ${dir}. Confira a permissão de acesso.`,
        );
      });
      for (const e of entries) {
        if (
          e.name.startsWith(".") ||
          e.name === "node_modules" ||
          e.isSymbolicLink()
        )
          continue;
        if (e.isDirectory()) await walk(path.join(dir, e.name));
        else if (e.isFile()) seen++;
        if (seen % 128 === 0) {
          this.progress = { phase: "counting", path: root, seen, notes: 0 };
          this.emit();
          await new Promise((r) => setTimeout(r, 0));
        }
        if (seen > limit) return;
      }
    };
    await walk(root);
    return seen;
  }
  async close() {
    await this.ensure();
    await this.queue;
    const all = new Set([this.active!, this.internalBundle!]);
    for (const b of all) {
      b.notes.close();
      await b.versions.close();
    }
  }
}
