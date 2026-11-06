import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DictionaryStore } from "../store/dictionary.ts";
import { SnippetStore } from "../store/snippets.ts";
import { helperLogLine, loadLists } from "./session.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

test("do log do helper, só o diagnóstico do mic (ditado e reunião) vai para o log do app; o texto do dryRun nunca", () => {
  expect(helperLogLine("mic: diag · engine new · first audio 120 ms")).toBe("[sidecar] mic: diag · engine new · first audio 120 ms");
  expect(helperLogLine("meeting mic: diag · Teams")).toBe("[sidecar] meeting mic: diag · Teams");
  expect(helperLogLine("insert (dry run): bom dia a todos")).toBeNull();
  expect(helperLogLine("transcript: bom dia")).toBeNull();
});

describe("loadLists", () => {
  test("a hand-edited JSON that doesn't parse is an empty list with a warning, not a crash, and stays on disk (T914)", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kiwi-session-"));
    const broken = '{ "version": 1, "terms": [ { "term": "DICOM" } ';
    writeFileSync(path.join(dir, "dictionary.json"), broken);
    writeFileSync(path.join(dir, "snippets.json"), JSON.stringify({ version: 1, snippets: [{ trigger: "meu email", text: "a@b.c" }] }));
    const warnings: string[] = [];
    const lists = await loadLists({ dictionary: new DictionaryStore(dir), snippets: new SnippetStore(dir) }, (m) => warnings.push(m));
    expect(lists.terms).toEqual([]);
    // The other file still loads.
    expect(lists.snippets).toEqual([{ trigger: "meu email", text: "a@b.c" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("dictionary.json");
    expect(readFileSync(path.join(dir, "dictionary.json"), "utf8")).toBe(broken);
  });

  test("missing files are empty lists without a warning", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "kiwi-session-"));
    const warnings: string[] = [];
    const lists = await loadLists({ dictionary: new DictionaryStore(dir), snippets: new SnippetStore(dir) }, (m) => warnings.push(m));
    expect(lists).toEqual({ terms: [], snippets: [] });
    expect(warnings).toEqual([]);
  });
});
