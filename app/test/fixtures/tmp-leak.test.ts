// Só roda no teste do ajudante (`test/tmp.test.ts`), num `bun test` filho com KIWI_TMP_FIXTURE=leak: um teste que
// passa, mas deixa de propósito uma pasta `kiwi-*` criada sem o tempDir. A conferência do preload tem de reprovar.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const on = process.env.KIWI_TMP_FIXTURE === "leak";

test.skipIf(!on)("deixa uma pasta para trás", () => {
  mkdtempSync(path.join(tmpdir(), "kiwi-fixture-leak-"));
  expect(1).toBe(1);
});
