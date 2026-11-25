// T28192: a troca da língua nos Ajustes chega ao main. Pelo headless, --no-helper e dados num tmp: nada na tela.

import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const data = tempDir("kn-locale-");
// Cada chamada é um `bun` novo; na máquina compartilhada, com carga, um spawn leva até ~4 s (T15965).
const PER_CALL_MS = 10_000;

async function cli(args: string[]): Promise<{ code: number; json: { value?: Record<string, unknown> } | null }> {
  const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_HEADLESS_DATA: "", KIWI_SYSTEM_LANG: "" },
  });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  try {
    return { code, json: JSON.parse(out) };
  } catch {
    return { code, json: null };
  }
}

afterAll(async () => {
  await cli(["stop"]);
  rmSync(data, { recursive: true, force: true });
}, PER_CALL_MS * 2);

test(
  "o settings.set com a língua põe o main nela: o rótulo do menu sai em inglês, e volta ao português",
  async () => {
    const started = await cli(["start", "--no-helper"]);
    expect(started.code).toBe(0);
    expect(started.json?.value?.menuLabel).toBe("Helper desligado");

    expect((await cli(["invoke", "settings.set", JSON.stringify({ language: "en" })])).code).toBe(0);
    expect((await cli(["status"])).json?.value?.menuLabel).toBe("Helper off");

    expect((await cli(["invoke", "settings.set", JSON.stringify({ language: "pt" })])).code).toBe(0);
    expect((await cli(["status"])).json?.value?.menuLabel).toBe("Helper desligado");
  },
  PER_CALL_MS * 6,
);
