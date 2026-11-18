// O script dos roteiros de Ajustes com modelo (T18690): acha o modelo inteiro na primeira pasta que tem, e nunca um pela metade.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { modelDir, type ModelManifest } from "../src/notes/semantic/model.ts";
import { findModel } from "./ajustes-models-check.ts";

const fake: ModelManifest = { id: "modelo-exemplo", revision: "abc123", files: [{ name: "a.bin", size: 1, sha256: "" }, { name: "b.json", size: 1, sha256: "" }] } as unknown as ModelManifest;

test("acha o modelo inteiro na primeira pasta que tem; um pela metade ou ausente não conta", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "kiwi-find-model-"));
  try {
    const half = path.join(tmp, "metade"), full = path.join(tmp, "inteiro"), other = path.join(tmp, "outro");
    mkdirSync(modelDir(half, fake), { recursive: true });
    writeFileSync(path.join(modelDir(half, fake), "a.bin"), "x");
    for (const root of [full, other]) {
      mkdirSync(modelDir(root, fake), { recursive: true });
      for (const f of fake.files) writeFileSync(path.join(modelDir(root, fake), f.name), "x");
    }
    expect(findModel(fake, [undefined, half, full, other])).toBe(modelDir(full, fake));
    expect(findModel(fake, [half, path.join(tmp, "nada")])).toBeNull();
    expect(findModel(fake, [])).toBeNull();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
