import { describe, expect, test } from "bun:test";

import {
  canonicalShortcut, checkShortcutsPatch, conflictOf, DEFAULT_SHORTCUTS, isShortcutFor, matchesKeyEvent, parseShortcut,
  sanitizeShortcuts, SHORTCUTS, shortcutLabel, shortcutsConflict,
} from "./shortcuts.ts";

describe("o texto dos atalhos (T5349), o mesmo do Shortcut.swift", () => {
  test("os quatro gestos", () => {
    expect(parseShortcut("fn")).toEqual({ kind: "key", key: "fn" });
    expect(parseShortcut("double:rightCommand")).toEqual({ kind: "double", key: "rightCommand" });
    expect(parseShortcut("control+option+r")).toEqual({ kind: "combo", step: { modifiers: ["control", "option"], key: "r" } });
    expect(parseShortcut("control+k r r")?.kind).toBe("sequence");
    expect(parseShortcut("f5")?.kind).toBe("combo");
  });

  test("o canônico, na ordem dos menus do Mac (o mesmo spec do Swift)", () => {
    for (const t of ["fn", "double:rightOption", "control+option+n", "control+option+shift+command+space", "f12", "control+k r r", "option+command+1 2"]) {
      expect(canonicalShortcut(t)).toBe(t);
    }
    expect(canonicalShortcut("Command+Option+N")).toBe("option+command+n");
    expect(canonicalShortcut("RIGHTOPTION")).toBe("rightOption");
  });

  test("recusa o que dispararia digitando", () => {
    for (const t of ["r", "shift+r", "r control+k", "space", "double:r", "double:", "control+k a b c d", "", "control+fn", "control+option", "control  k", 7, null]) {
      expect(parseShortcut(t)).toBeNull();
    }
  });

  test("os do app só como uma combinação", () => {
    expect(isShortcutFor("palette", "command+k")).toBe(true);
    expect(isShortcutFor("palette", "fn")).toBe(false);
    expect(isShortcutFor("palette", "control+k r")).toBe(false);
    expect(isShortcutFor("dictation", "control+k r")).toBe(true);
    // Os padrões valem para as próprias ações e não conflitam entre si.
    for (const s of SHORTCUTS) expect(isShortcutFor(s.id, s.default)).toBe(true);
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, {})).toEqual({ ok: true, patch: {} });
  });
});

describe("como aparece", () => {
  test("rótulos", () => {
    expect(shortcutLabel("fn")).toBe("Fn 🌐");
    expect(shortcutLabel("double:rightCommand")).toBe("⌘ direito duas vezes");
    expect(shortcutLabel("control+option+r")).toBe("⌃⌥R");
    expect(shortcutLabel("shift+command+d")).toBe("⇧⌘D");
    expect(shortcutLabel("command+shift+space")).toBe("⇧⌘ Espaço");
    expect(shortcutLabel("f5")).toBe("F5");
    expect(shortcutLabel("f5 f5")).toBe("F5 duas vezes");
    expect(shortcutLabel("control+k r r")).toBe("⌃K, R, R");
    expect(shortcutLabel(null)).toBe("Desligado");
  });
});

describe("conflitos: dois atalhos do Kiwi nas mesmas teclas", () => {
  test("o mesmo, a mesma tecla modificadora, o começo de uma sequência", () => {
    expect(shortcutsConflict("control+option+r", "Option+Control+R")).toBe(true);
    expect(shortcutsConflict("fn", "double:fn")).toBe(true);
    expect(shortcutsConflict("control+k", "control+k r")).toBe(true);
    expect(shortcutsConflict("control+k r", "control+k r r")).toBe(true);
    expect(shortcutsConflict("control+k r", "control+k n")).toBe(false);
    expect(shortcutsConflict("rightOption", "option+r")).toBe(false); // o ⌥ direito sozinho e ⌥R convivem (T1653)
    expect(shortcutsConflict("fn", "rightOption")).toBe(false);
  });

  test("conflictOf diz com qual", () => {
    expect(conflictOf(DEFAULT_SHORTCUTS, "notes", "control+option+r")).toBe("meeting");
    expect(conflictOf(DEFAULT_SHORTCUTS, "meeting", "control+option+r")).toBeNull();
    expect(conflictOf({ ...DEFAULT_SHORTCUTS, meeting: null }, "notes", "control+option+r")).toBeNull();
    expect(conflictOf(DEFAULT_SHORTCUTS, "notes", "double:fn")).toBe("dictation");
  });

  test("o patch que deixa dois nas mesmas teclas é recusado; trocar os dois juntos vale", () => {
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { notes: "control+option+r" })).toMatchObject({ ok: false });
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { notes: "control+option+r", meeting: "f5" })).toEqual({ ok: true, patch: { notes: "control+option+r", meeting: "f5" } });
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { quit: "command+q" })).toMatchObject({ ok: false });
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { palette: "fn" })).toMatchObject({ ok: false });
  });
});

describe("guardar", () => {
  test("os de antes do T5349 e um valor ruim", () => {
    expect(sanitizeShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
    expect(sanitizeShortcuts({}, { notes: null, meeting: "control+command+r" })).toEqual({ ...DEFAULT_SHORTCUTS, notes: null, meeting: "control+command+r" });
    expect(sanitizeShortcuts({ notes: "q", dictation: "Double:Fn" })).toEqual({ ...DEFAULT_SHORTCUTS, dictation: "double:fn" });
  });
});

describe("os do app, num keydown do WebView", () => {
  const key = (k: string, code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat", boolean>> = {}) => ({
    key: k, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, ...mods,
  });

  test("exatamente estes modificadores, e a letra do layout", () => {
    expect(matchesKeyEvent("command+k", key("k", "KeyK", { metaKey: true }))).toBe(true);
    expect(matchesKeyEvent("command+k", key("k", "KeyK", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(matchesKeyEvent("command+k", key("k", "KeyK", { metaKey: true, repeat: true }))).toBe(false);
    expect(matchesKeyEvent("command+k", key("k", "KeyV", { metaKey: true }))).toBe(true); // Dvorak: a tecla V digita K
    expect(matchesKeyEvent("shift+command+d", key("D", "KeyD", { metaKey: true, shiftKey: true }))).toBe(true);
    // ⌥ muda a letra (⌥N é ˜): vale a posição da tecla.
    expect(matchesKeyEvent("option+command+n", key("˜", "KeyN", { metaKey: true, altKey: true }))).toBe(true);
    expect(matchesKeyEvent("f5", key("F5", "F5"))).toBe(true);
    expect(matchesKeyEvent(null, key("k", "KeyK", { metaKey: true }))).toBe(false);
    expect(matchesKeyEvent("fn", key("k", "KeyK"))).toBe(false);
  });
});

describe("o cancelar do ditado (L5, T5458)", () => {
  test("só ele aceita uma tecla nomeada sozinha, nunca uma letra", () => {
    expect(DEFAULT_SHORTCUTS.cancel).toBe("escape");
    expect(isShortcutFor("cancel", "escape")).toBe(true);
    expect(isShortcutFor("cancel", "Delete")).toBe(true);
    expect(isShortcutFor("cancel", "r")).toBe(false);
    expect(isShortcutFor("cancel", "control+c")).toBe(true);
    expect(isShortcutFor("notes", "escape")).toBe(false);
    expect(sanitizeShortcuts({ cancel: "Return" }).cancel).toBe("return");
    expect(sanitizeShortcuts({ cancel: "q" }).cancel).toBe("escape");
  });

  test("rótulo e conflitos", () => {
    expect(shortcutLabel("escape")).toBe("Esc");
    expect(shortcutLabel("delete")).toBe("⌫");
    expect(conflictOf(DEFAULT_SHORTCUTS, "notes", "escape")).toBe("cancel");
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { cancel: "control+option+r" })).toMatchObject({ ok: false });
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { cancel: "delete" })).toEqual({ ok: true, patch: { cancel: "delete" } });
  });
});

describe("o atalho do Kiwi Cat (spec #12946)", () => {
  test("o padrão é o Control; vale uma tecla sozinha ou uma combinação, segurada", () => {
    expect(DEFAULT_SHORTCUTS.agent).toBe("control");
    expect(shortcutLabel("control")).toBe("Control");
    for (const ok of ["control", "rightControl", "rightOption", "rightCommand", "control+option+space", "f5"]) expect(isShortcutFor("agent", ok)).toBe(true);
    for (const bad of ["double:rightOption", "control+k r", "escape", "a"]) expect(isShortcutFor("agent", bad)).toBe(false);
    // O `control` (os dois Controls) só vale para ele: o ditado continua com o ⌃ direito.
    for (const id of ["dictation", "notes", "meeting"] as const) expect(isShortcutFor(id, "control")).toBe(false);
    expect(sanitizeShortcuts({}).agent).toBe("control");
    expect(sanitizeShortcuts({ agent: "double:rightOption" }).agent).toBe("control");
  });

  test("um atalho que repete outro do Kiwi é recusado, nos dois sentidos", () => {
    // Os dois Controls ocupam o ⌃ direito do ditado.
    expect(shortcutsConflict("control", "rightControl")).toBe(true);
    expect(shortcutsConflict("control", "double:rightControl")).toBe(true);
    expect(shortcutsConflict("control", "fn")).toBe(false);
    expect(shortcutsConflict("control", "control+option+v")).toBe(false);
    expect(conflictOf(DEFAULT_SHORTCUTS, "agent", "control+option+r")).toBe("meeting");
    expect(conflictOf({ ...DEFAULT_SHORTCUTS, dictation: "rightControl" }, "agent", "control")).toBe("dictation");
    expect(conflictOf(DEFAULT_SHORTCUTS, "dictation", "rightControl")).toBe("agent");
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { agent: "fn" })).toMatchObject({ ok: false });
    expect(checkShortcutsPatch(DEFAULT_SHORTCUTS, { agent: "rightOption" })).toEqual({ ok: true, patch: { agent: "rightOption" } });
  });
});
