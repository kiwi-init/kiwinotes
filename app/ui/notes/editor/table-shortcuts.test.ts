import { expect, test } from "bun:test";
import { canonicalShortcut, NOTES_SHORTCUTS, SHORTCUTS, shortcutsConflict } from "../../../src/shared/shortcuts.ts";
import { TABLE_ACTIONS } from "./table.ts";

// Compare CodeMirror's Mac notation with the app's actual shortcut registry.
function macShortcut(key: string): string {
  const aliases: Record<string, string> = {
    Mod: "command", Alt: "option", Shift: "shift", Ctrl: "control",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Backspace: "delete",
  };
  const result = canonicalShortcut(key.split("-").map((part) => aliases[part] ?? part.toLowerCase()).join("+"));
  expect(result).not.toBeNull();
  return result!;
}
const dock = { label: "Dock do macOS", key: "option+command+d" };
// Apple: https://support.apple.com/en-us/102650 (Option-Command-D shows/hides the Dock).
const reserved = [dock, ...SHORTCUTS.map((it) => ({ label: it.label, key: it.default })),
  ...NOTES_SHORTCUTS.map((it) => ({ label: "Atalho legado das Notas", key: it.value }))];

test("table shortcuts never collide with the Dock, app defaults or the legacy Notes presets", () => {
  const collisions: string[] = [];
  const seen = new Map<string, string>();
  for (const action of TABLE_ACTIONS) {
    if (!action.key) continue;
    const key = macShortcut(action.key);
    const previous = seen.get(key);
    if (previous) collisions.push(`${action.id} / ${previous}`);
    seen.set(key, action.id);
    for (const other of reserved) if (shortcutsConflict(key, other.key)) collisions.push(`${action.id} / ${other.label}`);
  }
  expect(collisions).toEqual([]);
});
test("the collision check recognizes both rejected candidates", () => {
  expect(shortcutsConflict(macShortcut("Mod-Alt-d"), dock.key)).toBe(true);
  expect(shortcutsConflict(macShortcut("Mod-Shift-d"), SHORTCUTS.find((it) => it.id === "dailyNote")!.default)).toBe(true);
});
