import { describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { SLOW_LINES_PER_MINUTE, slowLog, timedCapabilities, watchBusy } from "./slow-log.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

describe("slow-log (spec #12918)", () => {
  test("a slow call logs its name and time only; a fast one logs nothing", async () => {
    const lines: string[] = [];
    let t = 0;
    const caps = timedCapabilities(
      {
        "notes.list": async (_a: unknown) => {
          t += 812;
          return { secret: "texto da nota" };
        },
        "notes.get": (_a: unknown) => {
          t += 5;
          return 1;
        },
      },
      slowLog((l) => lines.push(l), () => 0),
      () => t,
    );
    expect(await caps["notes.list"]({ path: "Diário/segredo.md" })).toEqual({ secret: "texto da nota" });
    expect(caps["notes.get"]({})).toBe(1);
    expect(lines).toEqual(["[slow] notes.list levou 812 ms"]);
  });

  test("a slow failure is logged as failed and still rejects", async () => {
    const lines: string[] = [];
    let t = 0;
    const caps = timedCapabilities(
      {
        "projects.mark": async (_a: unknown) => {
          t += 300;
          throw new Error("E_X");
        },
        "notes.save": (_a: unknown) => {
          t += 200;
          throw new Error("E_Y");
        },
      },
      slowLog((l) => lines.push(l), () => 0),
      () => t,
    );
    await expect(caps["projects.mark"]({})).rejects.toThrow("E_X");
    expect(() => caps["notes.save"]({})).toThrow("E_Y");
    expect(lines).toEqual(["[slow] projects.mark levou 300 ms (falhou)", "[slow] notes.save levou 200 ms (falhou)"]);
  });

  test("at most a few lines a minute; the rest become a count", () => {
    const lines: string[] = [];
    let now = 0;
    const log = slowLog((l) => lines.push(l), () => now);
    for (let i = 0; i < SLOW_LINES_PER_MINUTE + 5; i++) log.line(`x ${i}`);
    expect(lines.length).toBe(SLOW_LINES_PER_MINUTE);
    now = 61_000;
    log.line("depois");
    expect(lines.slice(-2)).toEqual(["[slow] mais 5 linhas no último minuto, fora do log", "[slow] depois"]);
  });

  test("a blocked event loop is logged", async () => {
    const lines: string[] = [];
    const stop = watchBusy(slowLog((l) => lines.push(l)), 20);
    await Bun.sleep(30);
    const until = performance.now() + 400;
    while (performance.now() < until) {
      // segura o processo, como uma tarefa síncrona pesada
    }
    await Bun.sleep(50);
    stop();
    expect(lines.some((l) => /^\[slow\] o Bun ficou \d+ ms sem responder$/.test(l))).toBe(true);
  });

  test("diagnostics.slowFrame takes a short screen name and the ms, and nothing else", async () => {
    const frames: string[] = [];
    const caps = uiCapabilities({
      dictionary: { load: async () => [], save: async (t) => t },
      snippets: { load: async () => [], save: async (s) => s },
      history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
      dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
      settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
      clipboardWrite: () => {},
      notes: {} as never,
      slowFrame: (where, ms) => frames.push(`${where} ${ms}`),
    });
    const call = (args: unknown) => directInvoke(caps, "diagnostics.slowFrame", args);
    expect(await call({ where: "settings", ms: 812.4 })).toEqual({ ok: true, value: true });
    expect(await call({ where: "onboarding", ms: 120 })).toEqual({ ok: true, value: true });
    for (const bad of [{ where: "settings" }, { where: "Diário/nota.md", ms: 5 }, { where: "settings", ms: -1 }, { where: "settings", ms: Infinity }, { where: "settings", ms: 5, text: "x" }])
      expect(await call(bad)).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(frames).toEqual(["settings 812", "onboarding 120"]);
  });
});
