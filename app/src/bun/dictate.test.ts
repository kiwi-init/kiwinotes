import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DictationOutcome } from "./dictation.ts";
import { APP_ALIASES, dictate, parseRequest, report, resolveApp } from "./dictate.ts";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const wav = () => {
  dir = mkdtempSync(path.join(tmpdir(), "kiwi-dictate-"));
  const file = path.join(dir, "a.wav");
  writeFileSync(file, "RIFF");
  return file;
};

describe("o pedido do dictate (T1740)", () => {
  test("wav ou text, um só; o resto validado antes de chegar ao helper", () => {
    const bad = (m: unknown) => expect(() => parseRequest(m)).toThrow(expect.objectContaining({ code: "E_BAD_ARGS" }));
    bad({});
    bad({ text: "a", wav: "/x.wav" });
    bad({ wav: "/nao/existe.wav" });
    bad({ text: 7 });
    bad({ text: "a", note: "yes" });
    bad({ text: "a", app: "rm -rf /" });
    bad({ text: "a", fieldBefore: 3 });
    bad({ text: "a", field: { role: 1 } });
    bad({ text: "a", field: { secureInput: "on" } });
    bad({ text: "a", field: { password: true } });
    bad({ text: "a", extra: 1 });
    bad({ text: "x".repeat(20_001) });
    bad([]);
  });

  test("o app por alias ou bundle id, e o campo descrito vira o simulate", () => {
    expect(resolveApp("Slack")).toEqual(APP_ALIASES.slack!);
    expect(resolveApp("com.apple.Safari")).toEqual({ bundleId: "com.apple.Safari", name: "com.apple.Safari" });
    const file = wav();
    expect(parseRequest({ cmd: "dictate", id: 4, wav: file, app: "ghostty", note: false })).toMatchObject({
      input: "wav",
      value: file,
      app: { bundleId: "com.mitchellh.ghostty" },
      note: false,
      simulate: {},
    });
    expect(parseRequest({ text: "oi", fieldBefore: "", field: { role: null, secureInput: true } }).simulate).toEqual({
      role: null,
      secureInput: true,
      textBefore: "",
    });
  });

  test("o relatório: o que entraria no campo, com o espaço, e nada de insert na nota rápida", () => {
    const o: DictationOutcome = {
      text: "Manda o laudo.",
      raw: "manda o laudo",
      sttMs: 120,
      appMs: 8,
      tone: "casual",
      pasted: true,
      app: APP_ALIASES.slack,
      entry: { id: "h1" } as any,
      insert: { plan: "paste", autoSpace: true, spaced: true },
    };
    expect(report("text", false, o)).toEqual({
      input: "text",
      app: APP_ALIASES.slack!,
      note: false,
      raw: "manda o laudo",
      text: "Manda o laudo.",
      tone: "casual",
      latencyMs: { stt: 120, app: 8 },
      insert: { plan: "paste", reason: null, autoSpace: true, spaced: true, typed: " Manda o laudo." },
      historyId: "h1",
    });
    const note = report("wav", true, { ...o, insert: undefined, note: { note: { path: "Caixa de entrada/X.md", title: "X" } as any, created: true, already: false } });
    expect(note.insert).toBeNull();
    expect(note.createdNote).toEqual({ path: "Caixa de entrada/X.md", title: "X", created: true });
  });

  test("dictate: text pelo dictateText, wav pelo dictateWav, e o helper que recusa vira E_HELPER", async () => {
    const calls: unknown[] = [];
    const outcome: DictationOutcome = { text: "Oi.", raw: "oi", appMs: 1, pasted: true };
    const session = {
      dictation: {
        dictateText: async (text: string, o: unknown) => (calls.push(["text", text, o]), outcome),
        dictateWav: async (file: string) => {
          calls.push(["wav", file]);
          throw new Error("already_recording");
        },
      },
    };
    expect((await dictate(session as any, { text: "oi", app: "mail", fieldBefore: "a" })).text).toBe("Oi.");
    expect(calls[0]).toEqual(["text", "oi", { app: APP_ALIASES.mail, note: false, simulate: { textBefore: "a" } }]);
    await expect(dictate(session as any, { wav: wav() })).rejects.toMatchObject({ code: "E_HELPER" });
    await expect(dictate(session as any, { text: 1 })).rejects.toMatchObject({ code: "E_BAD_ARGS" });
  });
});
