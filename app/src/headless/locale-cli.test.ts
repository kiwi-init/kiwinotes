// T28192: a troca da língua nos Ajustes chega ao main. T29319: sem a escolha (o app de release desta vez), o app fica
// em português mesmo com English salvo. Pelo headless, --no-helper e dados num tmp: nada na tela.

import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
// Cada chamada é um `bun` novo; na máquina compartilhada, com carga, um spawn leva até ~4 s (T15965).
const PER_CALL_MS = 10_000;

/** Um headless por pasta; `choice` é o `KIWI_LANGUAGE_CHOICE` dele (o do app de release é desligado). */
function headless(choice: "1" | "0") {
  const data = tempDir("kn-locale-");
  const cli = async (args: string[]): Promise<{ code: number; json: { value?: Record<string, unknown> } | null }> => {
    const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args, "--data", data], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, KIWI_HEADLESS_DATA: "", KIWI_SYSTEM_LANG: "en-US", KIWI_LANGUAGE_CHOICE: choice },
    });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    try {
      return { code, json: JSON.parse(out) };
    } catch {
      return { code, json: null };
    }
  };
  afterAll(async () => {
    await cli(["stop"]);
    rmSync(data, { recursive: true, force: true });
  }, PER_CALL_MS * 2);
  return cli;
}

const withChoice = headless("1");
const releaseLike = headless("0");

test(
  "o settings.set com a língua põe o main nela: o rótulo do menu sai em inglês, e volta ao português",
  async () => {
    const cli = withChoice;
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

test(
  "T29319: sem a escolha, English salvo (de um build de antes) deixa o menu e as telas em português, também ao reabrir",
  async () => {
    const cli = releaseLike;
    expect((await cli(["start", "--no-helper"])).code).toBe(0);
    expect((await cli(["invoke", "settings.set", JSON.stringify({ language: "en" })])).code).toBe(0);
    const check = async () => {
      expect((await cli(["status"])).json?.value?.menuLabel).toBe("Helper desligado");
      // O `app.locale` é o que cada janela lê ao abrir: a escolha fica salva, mas a língua é o português.
      expect((await cli(["invoke", "app.locale", "{}"])).json?.value).toEqual({ setting: "en", locale: "pt", system: "en" });
    };
    await check();
    // Reaberto com o settings.json em "en": a língua da partida também.
    expect((await cli(["stop"])).code).toBe(0);
    await Bun.sleep(300);
    expect((await cli(["start", "--no-helper"])).code).toBe(0);
    await check();
  },
  PER_CALL_MS * 9,
);
