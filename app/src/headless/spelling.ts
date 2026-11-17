// Explicit test fixture only. The ordinary headless path uses the same sidecar data API as the app.
import { readFileSync } from "node:fs";
import { spellingResult, type SpellingResult } from "../shared/spelling.ts";
export function fakeSpelling(file: string): (word: string) => Promise<SpellingResult> {
  const text = readFileSync(file, "utf8");
  if (text.length > 128_000) throw new Error("spelling fixture too large");
  const entries = JSON.parse(text) as Record<string, unknown>;
  return async (word) => {
    const value = entries[word];
    const entry = Array.isArray(value) ? { suggestions: value } : value as { suggestions?: unknown; delayMs?: unknown } | undefined;
    if (entry && typeof entry.delayMs === "number") await Bun.sleep(Math.min(1000, Math.max(0, entry.delayMs)));
    return spellingResult({ available: true, misspelled: entry !== undefined, suggestions: entry?.suggestions }, word);
  };
}
