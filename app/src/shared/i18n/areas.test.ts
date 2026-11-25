// Os catálogos por área (`<área>.pt.ts`, T29244; o lead em #29289): cada um entra no `pt.ts` por spread, e um spread
// com a mesma chave de outro lugar passa calado no `tsc` (o último vence). Aqui uma chave repetida falha (#29295).

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = import.meta.dir;
/** As chaves escritas num arquivo (`  "a.b": …`), sem as que chegam por spread. */
const keysIn = (file: string) => [...readFileSync(path.join(dir, file), "utf8").matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]!);

describe("os catálogos por área", () => {
  const areas = readdirSync(dir).filter((f) => /^[a-z-]+\.pt\.ts$/.test(f));

  test("há pelo menos a área das Notas, e cada uma entra no pt.ts e no en.ts", () => {
    expect(areas).toContain("notes.pt.ts");
    const pt = readFileSync(path.join(dir, "pt.ts"), "utf8");
    const en = readFileSync(path.join(dir, "en.ts"), "utf8");
    for (const f of areas) {
      expect(pt).toContain(`"./${f}"`);
      expect(en).toContain(`"./${f.replace(".pt.ts", ".en.ts")}"`);
    }
  });

  test("nenhuma chave aparece em dois lugares (pt.ts e as áreas)", () => {
    for (const lang of ["pt", "en"]) {
      const seen = new Map<string, string>();
      const files = [`${lang}.ts`, ...areas.map((f) => f.replace(".pt.ts", `.${lang}.ts`))];
      for (const file of files)
        for (const key of keysIn(file)) {
          expect({ key, file, also: seen.get(key) }).toEqual({ key, file, also: undefined });
          seen.set(key, file);
        }
    }
  });
});
