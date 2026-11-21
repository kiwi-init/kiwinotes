// A aparência de cada janela (T25031, spec #25011): o que sobe na próxima abertura e o "Voltar à aparência anterior",
// direto no engine.json. O caminho com um engine de verdade está em ui-engine.test.ts ("Nova aparência pronta e Voltar").

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { closedWindowStatus, installedToBoot, REVERT_REASON, revertedState, revertWindow } from "./ui-appearance.ts";

const builtIn = { uiVersion: "2026.11.1", seq: 100 };
const ui = (seq: number, dataSchema = 1) => ({ uiVersion: `2026.11.${seq - 100}`, sha256: `sha-${seq}`, seq, dataSchema, keyId: "k" });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function windowDir(state: unknown): string {
  const dir = tempDir("kiwinotes-ui-appearance-");
  dirs.push(dir);
  if (state !== undefined) writeFileSync(path.join(dir, "engine.json"), typeof state === "string" ? state : JSON.stringify(state));
  return dir;
}

describe("a UI de uma janela fechada", () => {
  test("a ordem do engine: next, retry, current, boas; sem a banida e sem a que não passa da de fábrica", () => {
    expect(installedToBoot(null, builtIn)).toBeNull();
    expect(installedToBoot({ current: ui(102), next: ui(103), good: [ui(101)] }, builtIn)?.seq).toBe(103);
    expect(installedToBoot({ current: ui(102), retry: ui(104) }, builtIn)?.seq).toBe(104);
    expect(installedToBoot({ current: ui(102), next: ui(103), bad: { "sha-103": "x" } }, builtIn)?.seq).toBe(102);
    expect(installedToBoot({ current: ui(100), good: [ui(99)] }, builtIn)).toBeNull();
    expect(installedToBoot({ current: { uiVersion: "x" }, good: "não" }, builtIn)).toBeNull();
  });

  test("closedWindowStatus lê o engine.json, e sem ele (ou estragado) é a de fábrica", () => {
    expect(closedWindowStatus(windowDir({ current: ui(102) }), builtIn)).toEqual({ uiVersion: "2026.11.2", builtIn: false, pending: null });
    expect(closedWindowStatus(windowDir(undefined), builtIn)).toEqual({ uiVersion: "2026.11.1", builtIn: true, pending: null });
    expect(closedWindowStatus(windowDir("{quebrado"), builtIn)).toEqual({ uiVersion: "2026.11.1", builtIn: true, pending: null });
  });
});

describe("Voltar à aparência anterior", () => {
  test("a da tela e as mais novas vão para o bad; a anterior boa fica, e o teto do esquema volta ao dela", () => {
    const state = { current: ui(102, 3), next: ui(103, 4), retry: null, good: [ui(101, 2), ui(102, 3)], bad: { old: "antes" }, strikes: { "sha-103": 1 }, dataSchemaHighWater: 4, extra: "fica" };
    const after = revertedState(state, builtIn)!;
    expect(after.bad).toEqual({ old: "antes", "sha-103": REVERT_REASON });
    expect(after.next).toBeNull();
    expect(after.current).toEqual(ui(102, 3));
    expect(after.strikes).toEqual({});
    expect(after.extra).toBe("fica");
    expect(installedToBoot(after, builtIn)?.seq).toBe(102);
    // Mais um: sai a 102 e fica a 101, com o teto dela.
    const again = revertedState(after, builtIn)!;
    expect(installedToBoot(again, builtIn)?.seq).toBe(101);
    expect(again.current).toBeNull();
    expect(again.good).toEqual([ui(101, 2)]);
    expect(again.dataSchemaHighWater).toBe(2);
    // E mais um: a de fábrica, e depois nada a desfazer.
    const factory = revertedState(again, builtIn)!;
    expect(installedToBoot(factory, builtIn)).toBeNull();
    expect(factory.dataSchemaHighWater).toBe(0);
    expect(revertedState(factory, builtIn)).toBeNull();
  });

  test("revertWindow grava de uma vez, só para a pessoa, e sem o arquivo não faz nada", () => {
    const dir = windowDir({ current: ui(102), good: [ui(102)] });
    expect(revertWindow(dir, builtIn)).toBe(true);
    const file = path.join(dir, "engine.json");
    expect(JSON.parse(readFileSync(file, "utf8")).bad).toEqual({ "sha-102": REVERT_REASON });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(revertWindow(dir, builtIn)).toBe(false);
    expect(revertWindow(windowDir(undefined), builtIn)).toBe(false);
  });
});
