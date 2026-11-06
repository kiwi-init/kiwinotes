import { afterEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NotesFolders, validateNotesRoot } from "./folders-workspace.ts";
import { Vault } from "./vault.ts";
import { SettingsStore } from "../store/settings.ts";
import { HistoryStore } from "../store/history.ts";
import { uiCapabilities, type CapabilityDeps } from "../bun/ui-capabilities.ts";
import { untilSeen } from "./watch-wait.ts";

const rigs: { root: string; folders: NotesFolders }[] = [];
async function rig(limit = 20_000, watch = false) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "kn-folders-")),
  );
  const home = path.join(root, "home"),
    dir = path.join(root, "data"),
    defaultRoot = path.join(home, "KiwiNotes");
  const a = path.join(home, "Obsidian A"),
    b = path.join(home, "Obsidian B");
  for (const p of [defaultRoot, a, b]) await mkdir(p, { recursive: true });
  const globalSettings = new SettingsStore(dir),
    internalNotes = new Vault({
      root: defaultRoot,
      watch,
      trash: async (p) => {
        await rm(p, { recursive: true, force: true });
      },
    });
  const options = {
    dir,
    defaultRoot,
    globalSettings,
    internalNotes,
    home,
    watch,
    limit,
  };
  const folders = new NotesFolders(options);
  rigs.push({ root, folders });
  let chosen: string | null = a;
  const history = new HistoryStore(dir);
  const deps = {
    ...folders.fixed,
    notesFolders: folders,
    chooseNotesFolder: async () => chosen,
    history,
    dictionary: { load: async () => [], save: async () => [] },
    snippets: { load: async () => [], save: async () => [] },
    clipboardWrite: () => {},
    settingsChanged: () => {},
  } as CapabilityDeps;
  const caps = uiCapabilities(deps);
  return {
    root,
    home,
    dir,
    defaultRoot,
    a,
    b,
    folders,
    options,
    caps,
    history,
    choose: (p: string | null) => {
      chosen = p;
    },
  };
}
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.folders.close();
    await rm(r.root, { recursive: true, force: true });
  }
});

test("fake picker: roots, wikilinks, search, preferences and version history stay separate; recents restore", async () => {
  const r = await rig();
  await writeFile(path.join(r.a, "Ana.md"), "A: [[Bia]] #equipe");
  await writeFile(path.join(r.a, "Bia.md"), "Colega A");
  await writeFile(path.join(r.b, "Ana.md"), "B: outro texto");
  await mkdir(path.join(r.a, ".obsidian"));
  await writeFile(
    path.join(r.a, ".obsidian", "app.json"),
    '{"showInlineTitle":false}',
  );
  expect((await r.folders.view()).current.path).toBe(r.defaultRoot);
  expect(await r.caps["notes.openFolder"]({})).toMatchObject({
    kind: "opened",
    folder: { path: r.a },
  });
  const a = await r.folders.current();
  await a.settings.save({
    pinned: ["Ana.md"],
    templatesFolder: "Modelos A",
    dailyFolder: "Dias A",
    attachmentsFolder: "Mídia A",
  });
  expect(await r.caps["notes.resolve"]({ link: "Bia" })).toBe("Bia.md");
  expect(await r.caps["notes.search"]({ query: "colega" })).toMatchObject([
    { path: "Bia.md" },
  ]);
  const old = await a.notes.get("Ana.md");
  expect(
    await r.caps["notes.save"]({
      folderId: a.ref.id,
      path: "Ana.md",
      content: "A editado",
      baseVersion: old.version,
    }),
  ).toMatchObject({ saved: true });
  await a.versions.flush();
  expect((await a.versions.list("Ana.md")).length).toBeGreaterThan(0);
  const attachment = await a.attachments.save(
    "diagrama.png",
    Buffer.from("synthetic").toString("base64"),
  );
  expect(attachment.path).toBe("Mídia A/diagrama.png");
  r.choose(r.b);
  await r.caps["notes.openFolder"]({});
  const b = await r.folders.current();
  expect(await b.settings.load()).toMatchObject({
    pinned: [],
    dailyFolder: "Diário",
    attachmentsFolder: "Anexos",
  });
  expect(await b.versions.list("Ana.md")).toEqual([]);
  await expect(
    Promise.resolve(
      r.caps["notes.save"]({
        folderId: a.ref.id,
        path: "Ana.md",
        content: "WRONG ROOT",
        baseVersion: (await b.notes.get("Ana.md")).version,
      }),
    ),
  ).rejects.toMatchObject({ code: "E_FOLDER_CHANGED" });
  expect((await b.notes.get("Ana.md")).content).toBe("B: outro texto");
  await b.settings.save({ dailyFolder: "Dias B" });
  await r.caps["notes.openFolder"]({ recent: a.ref.key });
  expect(await (await r.folders.current()).settings.load()).toMatchObject({
    pinned: ["Ana.md"],
    dailyFolder: "Dias A",
    templatesFolder: "Modelos A",
    attachmentsFolder: "Mídia A",
  });
  expect(await readFile(path.join(r.a, ".obsidian", "app.json"), "utf8")).toBe(
    '{"showInlineTitle":false}',
  );
  expect((await readdir(r.a)).filter((n) => !n.startsWith(".")).sort()).toEqual(
    ["Ana.md", "Bia.md", "Mídia A"],
  );
  const restored = new NotesFolders({
    ...r.options,
    internalNotes: new Vault({ root: r.defaultRoot }),
  });
  try {
    expect((await restored.view()).current.path).toBe(r.a);
    expect((await restored.view()).recent.map((x) => x.path)).toContain(r.b);
  } finally {
    await restored.close();
  }
});

test("external normal folder never redirects meeting CRUD or dictation history", async () => {
  const r = await rig();
  const fixed = r.folders.fixed;
  const meeting = await fixed.meetingNotes.start(
    "meeting-synthetic",
    "Teams",
    new Date("2026-11-05T12:00:00Z"),
  );
  await r.caps["notes.openFolder"]({});
  expect(await r.caps["notes.list"]({})).toMatchObject({ notes: [] });
  expect(await r.caps["meetings.list"]({})).toMatchObject({
    meetings: [{ path: meeting.path }],
  });
  const original = (await r.caps["notes.get"]({
    folderId: fixed.ref.id,
    path: meeting.path,
  })) as { version: string; content: string };
  expect(
    await r.caps["notes.save"]({
      folderId: fixed.ref.id,
      path: meeting.path,
      content: original.content.replace(
        "## Minhas notas",
        "## Minhas notas\n\nAnotação manual",
      ),
      baseVersion: original.version,
      baseContent: original.content,
    }),
  ).toMatchObject({ saved: true });
  const newPath = "Reuniões/Reunião renomeada.md";
  await r.caps["notes.rename"]({
    folderId: fixed.ref.id,
    path: meeting.path,
    newPath,
  });
  expect((await fixed.notes.get(newPath)).content).toContain("Anotação manual");
  await r.caps["notes.delete"]({ folderId: fixed.ref.id, path: newPath });
  await r.caps["notes.restore"]({ folderId: fixed.ref.id, path: newPath });
  expect((await fixed.notes.get(newPath)).content).toContain("Anotação manual");
  expect(await readdir(r.a)).toEqual([]);
  const history = await r.history.add({
    raw: "Sintético",
    text: "Sintético",
    at: new Date("2026-11-05T12:00:00Z"),
  } as Parameters<HistoryStore["add"]>[0]);
  r.choose(r.b);
  await r.caps["notes.openFolder"]({});
  expect(await r.caps["history.search"]({ query: "Sintético" })).toMatchObject({
    entries: [{ text: "Sintético" }],
  });
  expect(
    await readFile(
      path.join(r.dir, "history", history.at.slice(0, 10) + ".jsonl"),
      "utf8",
    ),
  ).toContain("Sintético");
});

test("large folder confirmation counts visible files, skips hidden/node_modules; cancel does not switch", async () => {
  const r = await rig(2);
  await mkdir(path.join(r.a, "node_modules"));
  await mkdir(path.join(r.a, ".git"));
  for (const dir of ["node_modules", ".git"])
    for (let i = 0; i < 4; i++)
      await writeFile(path.join(r.a, dir, `${i}.md`), "ignored");
  await writeFile(path.join(r.a, "A.md"), "A");
  await r.caps["notes.openFolder"]({});
  expect(
    (await r.folders.current()).notes.list().notes.map((n) => n.path),
  ).toEqual(["A.md"]);
  for (let i = 0; i < 3; i++) await writeFile(path.join(r.b, `${i}.md`), "B");
  const phases: string[] = [];
  r.folders.onChange((v) => phases.push(v.progress.phase));
  r.choose(r.b);
  const warning = (await r.caps["notes.openFolder"]({})) as {
    kind: string;
    token: string;
  };
  expect(warning.kind).toBe("confirm");
  expect((await r.folders.current()).ref.path).toBe(r.a);
  await r.caps["notes.openFolder"]({ cancel: warning.token });
  expect((await r.folders.view()).pending).toBeUndefined();
  const again = (await r.caps["notes.openFolder"]({})) as { token: string };
  await r.caps["notes.openFolder"]({ confirm: again.token });
  expect((await r.folders.current()).ref.path).toBe(r.b);
  expect(phases).toContain("counting");
  expect(phases).toContain("indexing");
});

test("picker cancellation, dangerous paths, symlinks and access errors preserve current root", async () => {
  const r = await rig();
  r.choose(null);
  expect(await r.caps["notes.openFolder"]({})).toEqual({ kind: "cancelled" });
  for (const root of ["/", r.home, "/System", "/Library", "/Applications"]) {
    await expect(validateNotesRoot(root, r.home)).rejects.toMatchObject({
      code: "E_BAD_FOLDER",
    });
  }
  // Os cofres sincronizados dentro de ~/Library passam; o resto de ~/Library, não.
  const icloud = path.join(r.home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents", "Cofre");
  const drive = path.join(r.home, "Library", "CloudStorage", "GoogleDrive-ana@exemplo.com", "Meu Drive", "Notas");
  const prefs = path.join(r.home, "Library", "Preferences");
  for (const dir of [icloud, drive, prefs]) await mkdir(dir, { recursive: true });
  expect(await validateNotesRoot(icloud, r.home)).toBe(await realpath(icloud));
  expect(await validateNotesRoot(drive, r.home)).toBe(await realpath(drive));
  for (const root of [path.join(r.home, "Library"), prefs]) {
    await expect(validateNotesRoot(root, r.home)).rejects.toMatchObject({ code: "E_BAD_FOLDER" });
  }
  const link = path.join(r.root, "home-link");
  await symlink(r.home, link);
  await expect(validateNotesRoot(link, r.home)).rejects.toMatchObject({
    code: "E_BAD_FOLDER",
  });
  const denied = path.join(r.root, "denied");
  await mkdir(denied);
  await chmod(denied, 0);
  try {
    await expect(r.folders.open(denied)).rejects.toThrow(denied);
  } finally {
    await chmod(denied, 0o700);
  }
  expect((await r.folders.current()).ref.path).toBe(r.defaultRoot);
  await expect(
    r.folders.open(path.join(r.root, "missing")),
  ).rejects.toMatchObject({ code: "E_ACCESS" });
  expect((await r.folders.view()).error).toContain("missing");
});

test("watcher reports only the current external root after switching", async () => {
  const r = await rig(20_000, true);
  await writeFile(path.join(r.a, "Ana.md"), "A");
  await r.folders.open(r.a);
  const events: { path: string; paths: string[] }[] = [];
  r.folders.onNotesChanged((f, paths) => events.push({ path: f.path, paths }));
  await untilSeen(
    (n) => writeFile(path.join(r.a, "Ana.md"), `A changed externally ${n}`),
    () => events.some((e) => e.path === r.a && e.paths.includes("Ana.md")),
    "Ana.md in the first root",
  );
  await r.folders.open(r.b);
  await Bun.sleep(200);
  events.length = 0;
  await writeFile(path.join(r.a, "Ana.md"), "old root");
  await untilSeen(
    (n) => writeFile(path.join(r.b, "Bia.md"), `new root ${n}`),
    () => events.some((e) => e.path === r.b && e.paths.includes("Bia.md")),
    "Bia.md in the new root",
  );
  expect(events.some((e) => e.path === r.a)).toBe(false);
}, 20_000);
