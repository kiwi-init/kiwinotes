import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_NOTES_SHORTCUT, NOTES_SHORTCUTS } from "../shared/shortcuts.ts";
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettings } from "./settings.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const fresh = () => (dir = mkdtempSync(path.join(tmpdir(), "kiwi-settings-")));

test("sem arquivo, o padrão: ⌃⌥N abre a janela Notas (T1499)", async () => {
  fresh();
  expect(await new SettingsStore(dir).load()).toEqual({ notesShortcut: "control+option+n", pinned: [] });
  expect(DEFAULT_SETTINGS.notesShortcut).toBe(DEFAULT_NOTES_SHORTCUT);
});

test("grava só o que mudou, só para o usuário, e lê de volta; null (desligado) fica", async () => {
  fresh();
  const store = new SettingsStore(dir);
  expect(await store.save({ notesShortcut: null })).toEqual({ notesShortcut: null, pinned: [] });
  expect(await new SettingsStore(dir).load()).toEqual({ notesShortcut: null, pinned: [] });
  expect(JSON.parse(readFileSync(store.file, "utf8"))).toEqual({ version: 1, notesShortcut: null, pinned: [] });
  expect(statSync(store.file).mode & 0o777).toBe(0o600);
  expect(await store.save({})).toEqual({ notesShortcut: null, pinned: [] });
});

test("editado à mão com um valor que não existe: volta ao padrão, sem quebrar", async () => {
  fresh();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 1, notesShortcut: "command+q" }));
  expect(await new SettingsStore(dir).load()).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(sanitizeSettings({ notesShortcut: "option+command+n" })).toEqual({ notesShortcut: "option+command+n", pinned: [] });
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
