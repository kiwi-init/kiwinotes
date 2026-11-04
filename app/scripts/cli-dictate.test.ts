import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { check, loadBatch, parseArgs, runBatch, runDictate, type Send } from "./cli-dictate.ts";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const tmp = () => (dir = mkdtempSync(path.join(tmpdir(), "kiwi-cli-dictate-")));

const reportFor = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  tone: "casual",
  insert: { plan: "paste", spaced: false, typed: text },
  ...extra,
});

describe("cli dictate (T1740)", () => {
  test("os argumentos viram o cmd dictate", () => {
    expect(parseArgs(["a.wav"])).toEqual({ request: { wav: "a.wav" } });
    expect(parseArgs(["--text", "oi", "--app", "slack", "--note", "--field-before", ""])).toEqual({
      request: { text: "oi", app: "slack", note: true, fieldBefore: "" },
    });
    expect(parseArgs(["--text", "-x", "--field-role", "none", "--secure-input", "--no-accessibility", "--no-caret"])).toEqual({
      request: { text: "-x", field: { role: null, secureInput: true, accessibility: false, hasCaret: false } },
    });
    expect(parseArgs(["--batch", "casos.jsonl"])).toEqual({ batch: "casos.jsonl" });
    for (const bad of [[], ["a.wav", "b.wav"], ["--text", "a", "--wav", "b"], ["--bogus"], ["--app"], ["--batch", "x", "--note"]]) {
      expect(() => parseArgs(bad)).toThrow();
    }
  });

  test("a bateria: um jsonl com comentários, ou uma pasta de wav com o json do lado", () => {
    const d = tmp();
    writeFileSync(
      path.join(d, "casos.jsonl"),
      ['// tom do Slack', '{"name":"slack","text":"oi","app":"slack","expect":{"tone":"casual"}}', "", '{"wav":"x.wav"}'].join("\n"),
    );
    const cases = loadBatch(path.join(d, "casos.jsonl"));
    expect(cases).toEqual([
      { name: "slack", request: { text: "oi", app: "slack" }, expect: { tone: "casual" } },
      { name: "line 4", request: { wav: path.join(d, "x.wav") }, expect: undefined },
    ]);
    writeFileSync(path.join(d, "b.wav"), "");
    writeFileSync(path.join(d, "a.wav"), "");
    writeFileSync(path.join(d, "a.json"), JSON.stringify({ app: "mail", expect: { contains: "bom dia" } }));
    expect(loadBatch(d)).toEqual([
      { name: "a.wav", request: { app: "mail", wav: path.join(d, "a.wav") }, expect: { contains: "bom dia" } },
      { name: "b.wav", request: { wav: path.join(d, "b.wav") }, expect: undefined },
    ]);
    writeFileSync(path.join(d, "ruim.jsonl"), "{nope");
    expect(() => loadBatch(path.join(d, "ruim.jsonl"))).toThrow("line 1");
  });

  test("o expect diz cada diferença", () => {
    const r = reportFor("Oi, tudo bem?", { insert: { plan: "paste", spaced: true, typed: " Oi, tudo bem?" } });
    expect(check(r as any, { text: "Oi, tudo bem?", spaced: true, contains: ["tudo"] })).toEqual([]);
    expect(check(r as any, { tone: "formal", plan: "clipboardOnly", contains: "nada" })).toEqual([
      'tone: expected "formal", got "casual"',
      'plan: expected "clipboardOnly", got "paste"',
      'text: expected it to contain "nada"',
    ]);
  });

  test("runBatch e runDictate: o relatório, e o exit code (0 ok, 1 falhou, 2 uso)", async () => {
    const sent: unknown[] = [];
    const send: Send = async (msg) => {
      sent.push(msg);
      if (msg.text === "quebra") return { ok: false, code: "E_HELPER", message: "no helper" };
      return { ok: true, value: reportFor(String(msg.text)) };
    };
    const batch = await runBatch(
      [
        { name: "ok", request: { text: "oi" }, expect: { text: "oi" } },
        { name: "errado", request: { text: "oi" }, expect: { text: "tchau" } },
        { name: "helper", request: { text: "quebra" } },
      ],
      send,
    );
    expect(batch).toMatchObject({ passed: 1, failed: 2 });
    expect(batch.cases.map((c) => [c.name, c.ok])).toEqual([["ok", true], ["errado", false], ["helper", false]]);
    expect(sent[0]).toEqual({ cmd: "dictate", text: "oi" });

    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runDictate(["--text", "oi"], send)).toBe(0);
      expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({ text: "oi" });
      expect(await runDictate(["--text", "quebra"], send)).toBe(1);
      expect(await runDictate(["--bogus"], send)).toBe(2);
      const d = tmp();
      writeFileSync(path.join(d, "c.jsonl"), '{"text":"oi","expect":{"text":"oi"}}\n');
      expect(await runDictate(["--batch", path.join(d, "c.jsonl")], send)).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
