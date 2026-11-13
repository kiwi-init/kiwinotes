// Só roda no teste do ajudante (`test/tmp.test.ts`), num `bun test --rerun-each` filho com KIWI_TMP_FIXTURE=rerun:
// pastas de tempDir num `beforeAll` e num teste, para cada volta achar a pasta da rodada de pé (#10905).
import { beforeAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { tempDir } from "../tmp.ts";

const on = process.env.KIWI_TMP_FIXTURE === "rerun";
let shared = "";

beforeAll(() => {
  if (on) shared = tempDir("kiwi-fixture-shared-");
});

test.skipIf(!on)("a pasta da rodada existe em cada volta", () => {
  expect(existsSync(tmpdir())).toBe(true);
  expect(existsSync(shared)).toBe(true);
  const dir = tempDir("kiwi-fixture-rerun-");
  writeFileSync(path.join(dir, "a.txt"), "x");
});
