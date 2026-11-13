// O ajudante das pastas temporárias dos testes (spec #10077, issue #416).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { insideRoot, removeTempDir, tempDir, tempRoot } from "./tmp.ts";

const app = path.resolve(import.meta.dirname, "..");

describe("tempDir", () => {
  test("cria dentro da pasta temporária, e o fim do teste apaga", () => {
    const dir = tempDir("kiwi-tmp-test-");
    expect(insideRoot(tempRoot(), dir)).toBe(true);
    expect(existsSync(dir)).toBe(true);
    removeTempDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  test("recusa apagar fora da pasta temporária, e o que não criou", () => {
    expect(() => removeTempDir(homedir())).toThrow(/fora da pasta temporária/);
    expect(() => removeTempDir(app)).toThrow(/fora da pasta temporária/);
    expect(() => removeTempDir(tempRoot())).toThrow(/fora da pasta temporária/);
    expect(() => removeTempDir(path.join(tempRoot(), "..", "x"))).toThrow(/fora da pasta temporária/);
    // Uma pasta de dentro da temporária, mas que não é dele: recusa, e ela fica.
    const other = mkdtempSync(path.join(tmpdir(), "kiwi-tmp-other-"));
    try {
      expect(() => removeTempDir(other)).toThrow(/não foi criada por tempDir/);
      expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    expect(() => tempDir("../fora")).toThrow(/prefixo inválido/);
  });

  test("um teste que falha e um que estoura o tempo não deixam a pasta para trás", () => {
    // Um `bun test` filho, com a sua própria pasta temporária: o preload põe a rodada dele numa pasta dentro dela.
    const box = mkdtempSync(path.join(tmpdir(), "kiwi-tmp-box-"));
    try {
      mkdirSync(box, { recursive: true });
      const r = Bun.spawnSync([process.execPath, "test", "./test/fixtures/tmp-fail.test.ts"], {
        cwd: app,
        env: { ...process.env, TMPDIR: box, KIWI_TMP_FIXTURE: "1", KIWI_TMP_KEEP: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = `${r.stdout}${r.stderr}`;
      // Os dois testes falharam (um pelo expect, outro pelo tempo)…
      expect(out).toContain("2 fail");
      // …e a rodada não deixou nenhuma pasta kiwi-* (o KIWI_TMP_KEEP mantém a pasta da rodada para a gente olhar).
      expect(out).not.toContain("[tmp] os testes deixaram");
      const runs = readdirSync(box).filter((n) => n.startsWith("kr-"));
      expect(runs).toHaveLength(1);
      expect(readdirSync(path.join(box, runs[0]!)).filter((n) => /^(kiwi|kn)-/.test(n))).toEqual([]);
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  }, 60_000);
});
