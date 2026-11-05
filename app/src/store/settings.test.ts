import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_NOTES_SHORTCUT, NOTES_SHORTCUTS } from "../shared/shortcuts.ts";
import { DEFAULT_APPEARANCE } from "../shared/appearance.ts";
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettings } from "./settings.ts";

import { DEFAULT_MEETING_SETTINGS } from "../shared/meetings.ts";
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const fresh = () => (dir = mkdtempSync(path.join(tmpdir(), "kiwi-settings-")));

test("sem arquivo, o padrão: ⌃⌥N abre a janela Notas (T1499)", async () => {
  fresh();
  expect(await new SettingsStore(dir).load()).toEqual({ notesShortcut: "control+option+n", pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, savedSearches: [], microphone: "auto", showExtensions: false, meetings: DEFAULT_MEETING_SETTINGS });
  expect(DEFAULT_SETTINGS.notesShortcut).toBe(DEFAULT_NOTES_SHORTCUT);
});

test("grava só o que mudou, só para o usuário, e lê de volta; null (desligado) fica", async () => {
  fresh();
  const store = new SettingsStore(dir);
  const off = { notesShortcut: null, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, savedSearches: [], microphone: "auto" as const, showExtensions: false, meetings: DEFAULT_MEETING_SETTINGS };
  expect(await store.save({ notesShortcut: null })).toEqual(off);
  expect(await new SettingsStore(dir).load()).toEqual(off);
  expect(JSON.parse(readFileSync(store.file, "utf8"))).toEqual({ version: 1, ...off });
  expect(statSync(store.file).mode & 0o777).toBe(0o600);
  expect(await store.save({})).toEqual(off);
});

test("editado à mão com um valor que não existe: volta ao padrão, sem quebrar", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, notesShortcut: "command+q" }));
  expect(await new SettingsStore(dir).load()).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings({ notesShortcut: "option+command+n" })).toEqual({ notesShortcut: "option+command+n", pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, savedSearches: [], microphone: "auto", showExtensions: false, meetings: DEFAULT_MEETING_SETTINGS });
});

test("a Aparência (T2503): um settings.json de antes dela abre no padrão, e um campo ruim volta sozinho", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, notesShortcut: null }));
  expect(await new SettingsStore(dir).load()).toEqual({ notesShortcut: null, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, savedSearches: [], microphone: "auto", showExtensions: false, meetings: DEFAULT_MEETING_SETTINGS });
  const mixed = { mode: "light", lightTheme: "glacier-mint", darkTheme: 42, textSize: "huge", font: "lato", motion: "reduced" };
  expect(sanitizeSettings({ appearance: mixed }).appearance).toEqual({
    ...DEFAULT_APPEARANCE,
    mode: "light",
    lightTheme: "glacier-mint",
    font: "lato",
    motion: "reduced",
  });
  const store = new SettingsStore(dir);
  const saved = await store.save({ appearance: { ...DEFAULT_APPEARANCE, mode: "dark" } });
  expect(saved.appearance.mode).toBe("dark");
  expect((await new SettingsStore(dir).load()).appearance.mode).toBe("dark");
});

test("as combinações oferecidas estão no formato que o helper entende (KeyCombo, ADR 0001)", () => {
  for (const { value, label } of NOTES_SHORTCUTS) {
    // Modificadores conhecidos, sem repetir, com pelo menos ⌃/⌥/⌘, e uma letra no fim.
    const parts = value.split("+");
    const mods = parts.slice(0, -1);
    expect(mods.every((m) => ["control", "option", "command", "shift"].includes(m))).toBe(true);
    expect(new Set(mods).size).toBe(mods.length);
    expect(mods.some((m) => m !== "shift")).toBe(true);
    expect(parts.at(-1)).toMatch(/^[a-z0-9]$/);
    expect(label.endsWith(parts.at(-1)!.toUpperCase())).toBe(true);
  }
});

test("gravações ao mesmo tempo (T2503, revisão #2582): uma por vez, sem perder campo nem corromper o arquivo", async () => {
  fresh();
  const store = new SettingsStore(dir);
  await Promise.all([
    store.save({ appearance: { font: "inter" } }),
    store.save({ appearance: { mode: "dark" } }),
    store.save({ pinned: ["A.md"] }),
    store.save({ appearance: { textSize: "large" } }),
    store.save({ notesShortcut: null }),
  ]);
  const raw = readFileSync(store.file, "utf8");
  expect(raw.endsWith("}\n")).toBe(true);
  expect(await new SettingsStore(dir).load()).toEqual({
    notesShortcut: null,
    pinned: ["A.md"],
    appearance: { ...DEFAULT_APPEARANCE, font: "inter", mode: "dark", textSize: "large" },
    templatesFolder: "Modelos",
    dailyFolder: "Diário",
    attachmentsFolder: "Anexos",
    savedSearches: [],
    ocr: true,
    microphone: "auto",
    showExtensions: false,
    meetings: DEFAULT_MEETING_SETTINGS,
  });
});

test("a pasta de anexos (T2594): padrão Anexos, e um valor que sai do vault volta ao padrão", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, attachmentsFolder: "../fora" }));
  expect((await new SettingsStore(dir).load()).attachmentsFolder).toBe("Anexos");
  expect(sanitizeSettings({ attachmentsFolder: "Arquivos/Imagens" }).attachmentsFolder).toBe("Arquivos/Imagens");
  expect(sanitizeSettings({ attachmentsFolder: "" }).attachmentsFolder).toBe("");
  expect(sanitizeSettings({}).attachmentsFolder).toBe("Anexos");
});

test("os ajustes de reunião (R6, T4947): o padrão, um campo ruim volta sozinho, e a lista de apps sem repetir", () => {
  expect(DEFAULT_SETTINGS.meetings.shortcut).toBe("control+option+r");
  expect(DEFAULT_SETTINGS.meetings.pauseShortcut).toBe("control+option+m");
  expect(DEFAULT_SETTINGS.meetings.suggest).toBe(true);
  expect(DEFAULT_SETTINGS.meetings.apps.map((a) => a.name)).toContain("Teams");
  const m = sanitizeSettings({ meetings: { shortcut: "command+q", pauseShortcut: null, suggest: "sim", apps: [{ bundleId: "com.hnc.Discord", name: " Discord " }, { bundleId: "com.hnc.discord", name: "De novo" }, { bundleId: "não vale", name: "x" }] } }).meetings;
  expect(m).toEqual({ shortcut: "control+option+r", pauseShortcut: null, suggest: true, apps: [{ bundleId: "com.hnc.Discord", name: "Discord" }] });
});
