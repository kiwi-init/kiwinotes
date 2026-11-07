import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_NOTES_SHORTCUT, DEFAULT_SHORTCUTS, NOTES_SHORTCUTS } from "../shared/shortcuts.ts";
import { DEFAULT_APPEARANCE } from "../shared/appearance.ts";
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettings } from "./settings.ts";

import { DEFAULT_MEETING_SETTINGS } from "../shared/meetings.ts";
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const fresh = () => (dir = mkdtempSync(path.join(tmpdir(), "kiwi-settings-")));
/** Os padrões, com o atalho das Notas desligado (nos `shortcuts` e no campo de antes, iguais). */
const notesOff = { shortcuts: { ...DEFAULT_SHORTCUTS, notes: null }, notesShortcut: null };

test("sem arquivo, o padrão: ⌃⌥N abre a janela Notas (T1499)", async () => {
  fresh();
  expect(await new SettingsStore(dir).load()).toEqual({ shortcuts: DEFAULT_SHORTCUTS, notesShortcut: "control+option+n", pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, savedSearches: [], microphone: "auto", showExtensions: false, cues: true, preciseDictation: false, meetings: DEFAULT_MEETING_SETTINGS, noteWidth: 760 });
  expect(DEFAULT_SETTINGS.notesShortcut).toBe(DEFAULT_NOTES_SHORTCUT);
});

test("grava só o que mudou, só para o usuário, e lê de volta; null (desligado) fica", async () => {
  fresh();
  const store = new SettingsStore(dir);
  const off = { ...notesOff, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, savedSearches: [], microphone: "auto" as const, showExtensions: false, cues: true, preciseDictation: false, meetings: DEFAULT_MEETING_SETTINGS, noteWidth: 760 };
  expect(await store.save({ notesShortcut: null })).toEqual(off);
  expect(await new SettingsStore(dir).load()).toEqual(off);
  expect(JSON.parse(readFileSync(store.file, "utf8"))).toEqual({ version: 1, ...off });
  expect(statSync(store.file).mode & 0o777).toBe(0o600);
  expect(await store.save({})).toEqual(off);
});

test("editado à mão com um valor que não existe: volta ao padrão, sem quebrar", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, notesShortcut: "q" }));
  expect(await new SettingsStore(dir).load()).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings({ notesShortcut: "option+command+n" })).toEqual({ shortcuts: { ...DEFAULT_SHORTCUTS, notes: "option+command+n" }, notesShortcut: "option+command+n", pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, savedSearches: [], microphone: "auto", showExtensions: false, cues: true, preciseDictation: false, meetings: DEFAULT_MEETING_SETTINGS, noteWidth: 760 });
});

test("a Aparência (T2503): um settings.json de antes dela abre no padrão, e um campo ruim volta sozinho", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, notesShortcut: null }));
  expect(await new SettingsStore(dir).load()).toEqual({ ...notesOff, pinned: [], appearance: DEFAULT_APPEARANCE, templatesFolder: "Modelos", dailyFolder: "Diário", attachmentsFolder: "Anexos", ocr: true, semanticSearch: true, savedSearches: [], microphone: "auto", showExtensions: false, cues: true, preciseDictation: false, meetings: DEFAULT_MEETING_SETTINGS, noteWidth: 760 });
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
    ...notesOff,
    pinned: ["A.md"],
    appearance: { ...DEFAULT_APPEARANCE, font: "inter", mode: "dark", textSize: "large" },
    templatesFolder: "Modelos",
    dailyFolder: "Diário",
    attachmentsFolder: "Anexos",
    savedSearches: [],
    ocr: true,
    semanticSearch: true,
    microphone: "auto",
    showExtensions: false,
    cues: true,
    preciseDictation: false,
    meetings: DEFAULT_MEETING_SETTINGS,
    noteWidth: 760,
  });
});

test("a largura da nota (T5299): arredonda, fica nos limites e um valor ruim volta ao padrão", () => {
  expect(sanitizeSettings({ noteWidth: 900.4 }).noteWidth).toBe(900);
  expect(sanitizeSettings({ noteWidth: 100 }).noteWidth).toBe(480);
  expect(sanitizeSettings({ noteWidth: 99999 }).noteWidth).toBe(1400);
  expect(sanitizeSettings({ noteWidth: "largo" }).noteWidth).toBe(760);
  expect(sanitizeSettings({ noteWidth: Number.NaN }).noteWidth).toBe(760);
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
  const m = sanitizeSettings({ meetings: { shortcut: "q", pauseShortcut: null, suggest: "sim", apps: [{ bundleId: "com.hnc.Discord", name: " Discord " }, { bundleId: "com.hnc.discord", name: "De novo" }, { bundleId: "não vale", name: "x" }] } }).meetings;
  expect(m).toEqual({ shortcut: "control+option+r", pauseShortcut: null, suggest: true, apps: [{ bundleId: "com.hnc.Discord", name: "Discord" }] });
});

test("os atalhos (T5349): um settings.json de antes deles traz os campos antigos, e os novos ganham deles", () => {
  // De antes do T5349: o das Notas e os das reuniões.
  const old = sanitizeSettings({ notesShortcut: "control+command+n", meetings: { shortcut: null, pauseShortcut: "option+command+m" } });
  expect(old.shortcuts).toEqual({ ...DEFAULT_SHORTCUTS, notes: "control+command+n", meeting: null, meetingPause: "option+command+m" });
  expect(old.meetings.shortcut).toBeNull();
  // Com `shortcuts`, eles mandam, e os campos de antes repetem.
  const now = sanitizeSettings({ notesShortcut: "control+command+n", shortcuts: { notes: "double:rightCommand", dictation: "control+option+d", palette: "q" } });
  expect(now.shortcuts.notes).toBe("double:rightCommand");
  expect(now.notesShortcut).toBe("double:rightCommand");
  expect(now.shortcuts.dictation).toBe("control+option+d");
  expect(now.shortcuts.palette).toBe("command+k"); // uma letra sozinha volta ao padrão
});

test("os atalhos (T5349): o save muda só os dados, e os campos de antes entram neles", async () => {
  fresh();
  const store = new SettingsStore(dir);
  const a = await store.save({ shortcuts: { ...DEFAULT_SHORTCUTS, dictation: "rightOption" } });
  expect(a.shortcuts.dictation).toBe("rightOption");
  const b = await store.save({ notesShortcut: "f5" });
  expect(b.shortcuts).toEqual({ ...DEFAULT_SHORTCUTS, dictation: "rightOption", notes: "f5" });
  const c = await store.save({ meetings: { ...b.meetings, pauseShortcut: null } });
  expect(c.shortcuts.meetingPause).toBeNull();
  expect((await new SettingsStore(dir).load()).shortcuts).toEqual(c.shortcuts);
});

test("o modo preciso do ditado (T6602): desligado por padrão, e só um true liga", () => {
  expect(DEFAULT_SETTINGS.preciseDictation).toBe(false);
  expect(sanitizeSettings({}).preciseDictation).toBe(false);
  expect(sanitizeSettings({ preciseDictation: true }).preciseDictation).toBe(true);
  expect(sanitizeSettings({ preciseDictation: "sim" }).preciseDictation).toBe(false);
});

test("os sons de início e de fim (T5833): ligados por padrão, e só um false desliga", () => {
  expect(DEFAULT_SETTINGS.cues).toBe(true);
  expect(sanitizeSettings({}).cues).toBe(true);
  expect(sanitizeSettings({ cues: false }).cues).toBe(false);
  expect(sanitizeSettings({ cues: "não" }).cues).toBe(true);
});
