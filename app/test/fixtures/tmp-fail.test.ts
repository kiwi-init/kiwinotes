// Só roda no teste do ajudante (`test/tmp.test.ts`), num `bun test` filho com KIWI_TMP_FIXTURE=1: um teste que falha e
// um que estoura o tempo, os dois com uma pasta de tempDir. Na suíte normal, os dois ficam pulados.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../tmp.ts";

const on = process.env.KIWI_TMP_FIXTURE === "1";

test.skipIf(!on)("falha com uma pasta temporária", () => {
  const dir = tempDir("kiwi-fixture-fail-");
  writeFileSync(path.join(dir, "a.txt"), "x");
  expect(1).toBe(2);
});

test.skipIf(!on)(
  "estoura o tempo com uma pasta temporária",
  async () => {
    tempDir("kiwi-fixture-timeout-");
    await Bun.sleep(5_000);
  },
  200,
);
