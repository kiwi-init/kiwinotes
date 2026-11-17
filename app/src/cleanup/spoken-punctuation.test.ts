import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanupWithRules, rulesDroppedTooMuch } from "./index.ts";

// The same end-to-end regression cases also run as a fast unit check, without helper or models.
const cases = readFileSync(
  new URL("../../test/dictation/casos.jsonl", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line))
  .filter((c) => c.name.startsWith("L7:"));
for (const c of cases)
  test(c.name, () => {
    expect(
      cleanupWithRules({
        raw: c.text,
        bundleId: c.app === "slack" ? "com.tinyspeck.slackmacgap" : undefined,
      }).text,
    ).toBe(c.expect.text);
  });
test("dictionary terms and terminal code remain protected", () => {
  expect(
    cleanupWithRules({
      raw: "o projeto ponto final chegou",
      dictionary: [{ term: "Ponto Final" }],
    }).text,
  ).toBe("O projeto Ponto Final chegou.");
  expect(
    cleanupWithRules({ raw: "git commit --message comma", tone: "literal" })
      .text,
  ).toBe("git commit --message comma");
});
test("command removal is allowed; deleting content about punctuation is still guarded", () => {
  expect(
    rulesDroppedTooMuch(
      "abra o relatório ponto de interrogação",
      "Abra o relatório?",
    ),
  ).toBe(false);
  expect(
    rulesDroppedTooMuch("o ponto final representa conclusão importante", "O."),
  ).toBe(true);
});
