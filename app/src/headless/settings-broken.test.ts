// T7816: um settings.json que não é JSON na pasta de dados não derruba o engine ao abrir as Notas (antes, a busca pelo
// sentido e as pastas das notas liam os ajustes em segundo plano, e a rejeição sem dono encerrava o processo).

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const data = tempDir("kn-settings-");

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_HEADLESS_DATA: "" },
  });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(out);
  } catch {}
  return { code, json };
}

afterAll(async () => {
  await cli(["stop"]);
  rmSync(data, { recursive: true, force: true });
});

describe("settings.json torto (T7816)", () => {
  test(
    "o engine abre as Notas e segue de pé; os ajustes voltam ao padrão, e o próximo set grava um arquivo bom",
    async () => {
      mkdirSync(data, { recursive: true });
      const broken = '{"cues": false, "dailyFolder": "Diário/2026", ';
      writeFileSync(path.join(data, "settings.json"), broken);
      expect((await cli(["start", "--no-helper"])).code).toBe(0);
      expect((await cli(["invoke", "notes.list"])).code).toBe(0);
      expect(await cli(["invoke", "settings.get"])).toMatchObject({ code: 0, json: { ok: true } });
      // O que derrubava vinha em segundo plano, logo depois de abrir: dá tempo de cair.
      await Bun.sleep(3000);
      expect((await cli(["status"])).code).toBe(0);
      expect(await cli(["invoke", "settings.set", JSON.stringify({ ocr: false })])).toMatchObject({ code: 0 });
      expect(JSON.parse(readFileSync(path.join(data, "settings.json"), "utf8")).ocr).toBe(false);
      const kept = readdirSync(data).filter((n) => n.startsWith("settings.json.broken-"));
      expect(kept.map((n) => readFileSync(path.join(data, n), "utf8"))).toEqual([broken]);
    },
    60_000,
  );
});
