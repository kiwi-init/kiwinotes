import { UI_CAPABILITIES, type UiCapability } from "../shared/ui-contract.ts";
import type { CapabilityDeps } from "./ui-capabilities.ts";
import { FolderError, type FolderBundle } from "../notes/folders-workspace.ts";

type Handlers = Record<UiCapability, (args: unknown) => unknown>;
const scoped = (cap: string) =>
  /^(notes\.|folders\.|attachments\.|images\.|files\.|trash\.|settings\.)/.test(
    cap,
  ) ||
  cap === "meetings.speakers" ||
  cap === "meetings.renameSpeaker";
/** A call captures one root-bound bundle. Old UI ids are refused; operations already running finish in their old root. */
export function folderCapabilities(
  deps: CapabilityDeps,
  build: (deps: CapabilityDeps) => Handlers,
): Handlers {
  const folders = deps.notesFolders!;
  const base = build({ ...deps, notesFolders: undefined });
  const cached = new Map<string, Handlers>();
  const handlers = (b: FolderBundle) => {
    let existing = cached.get(b.ref.id);
    if (existing) return existing;
    existing = build({
      ...deps,
      notesFolders: undefined,
      notes: b.notes,
      settings: b.settings,
      attachments: b.attachments,
      ocr: b.ocr,
      versions: b.versions,
      exporter: b.exporter,
      meetingNotes: b.meetingNotes,
      dictationNotes: b.dictationNotes,
    });
    cached.set(b.ref.id, existing);
    return existing;
  };
  return Object.fromEntries(
    UI_CAPABILITIES.map((cap) => [
      cap,
      async (args: unknown) => {
        if (cap === "notes.folder") return folders.view();
        if (cap === "notes.openFolder") {
          const a = (args ?? {}) as Record<string, unknown>;
          if (
            !a ||
            typeof a !== "object" ||
            Array.isArray(a) ||
            Object.keys(a).some(
              (k) => !["recent", "confirm", "cancel"].includes(k),
            )
          )
            throw new FolderError(
              "E_BAD_ARGS",
              "Argumentos de pasta inválidos.",
            );
          if (
            (a.confirm !== undefined && typeof a.confirm !== "string") ||
            (a.recent !== undefined && typeof a.recent !== "string")
          )
            throw new FolderError("E_BAD_ARGS", "Pasta inválida.");
          if (a.cancel !== undefined) {
            if (typeof a.cancel !== "string")
              throw new FolderError("E_BAD_ARGS", "Confirmação inválida.");
            folders.cancelConfirmation(a.cancel);
            return { kind: "cancelled" };
          }
          const root = a.confirm
            ? undefined
            : a.recent
              ? await folders.recent(a.recent as string)
              : await deps.chooseNotesFolder?.();
          return folders.open(
            root ?? undefined,
            a.confirm as string | undefined,
          );
        }
        if (cap === "meetings.list")
          return handlers(await folders.internal())[cap](args);
        if (!scoped(cap)) return base[cap](args);
        let clean = args,
          folderId: string | undefined;
        if (
          args &&
          typeof args === "object" &&
          !Array.isArray(args) &&
          "folderId" in args
        ) {
          const { folderId: id, ...rest } = args as Record<string, unknown>;
          if (typeof id !== "string")
            throw new FolderError("E_BAD_ARGS", "Pasta inválida.");
          folderId = id;
          clean = rest;
        }
        // Speaker labels are in the fixed meeting store, unless an explicit editor context was supplied.
        if (
          folderId === undefined &&
          (cap === "meetings.speakers" || cap === "meetings.renameSpeaker")
        )
          folderId = (await folders.internal()).ref.id;
        return handlers(await folders.resolve(folderId))[cap](clean);
      },
    ]),
  ) as Handlers;
}
