import { expect, test } from "bun:test";

import { fakeElevenLabs, parseFakeElevenLabs } from "../../src/headless/fake-elevenlabs.ts";
import { ELEVENLABS_MODELS, ELEVENLABS_REASONS } from "../../src/shared/elevenlabs.ts";
import { catSpeaksHint } from "./CatSpeaksRow.tsx";
import { fallbackHint, keyHint, modelLabel, reasonText, testHint } from "./ElevenLabsRows.tsx";

test("o seletor de modelo: os 5 do harry (#31625), o v4 Turbo marcado como padrão", () => {
  expect(ELEVENLABS_MODELS.map((m) => modelLabel(m))).toEqual(["v4 Turbo (padrão)", "v4", "v3", "Multilingual v2", "Flash v2.5"]);
  expect(modelLabel("eleven_v4_turbo", "en")).toBe("v4 Turbo (default)");
});

test("cada motivo tem uma frase nas duas línguas", () => {
  for (const locale of ["pt", "en"] as const) {
    const texts = ELEVENLABS_REASONS.map((r) => reasonText(r, locale));
    for (const t of texts) expect(t).not.toMatch(/^agent\./);
    expect(new Set(texts).size).toBe(ELEVENLABS_REASONS.length);
  }
  expect(reasonText("quota_exceeded")).toBe("Os créditos da conta acabaram.");
  expect(reasonText("voice_not_found", "en")).toBe("That voice isn't in the account.");
});

test("a linha da chave: guardada no Keychain, sem chave, chave com cara errada e falha ao guardar", () => {
  expect(keyHint(false, null)).toBe("Cole a chave da sua conta do ElevenLabs. Ela fica no Keychain do Mac, e só lá.");
  expect(keyHint(true, null)).toBe("Chave guardada no Keychain do Mac.");
  expect(keyHint(false, "invalid")).toBe("Isso não parece uma chave do ElevenLabs.");
  expect(keyHint(true, "failed", "en")).toBe("Couldn't save the key to the Keychain.");
  expect(keyHint(true, "deleteFailed")).toBe("Não deu para apagar a chave do Keychain.");
  expect(keyHint(true, "deleteFailed", "en")).toBe("Couldn't remove the key from the Keychain.");
});

test("o Testar: parado, falando, funcionou e o motivo de não falar", () => {
  expect(testHint({ phase: "idle" })).toBe("O Kiwi fala uma frase curta com essa voz e esse modelo.");
  expect(testHint({ phase: "running" }, "en")).toBe("Speaking…");
  expect(testHint({ phase: "done", result: { ok: true } })).toBe("Funcionou: essa é a voz do Kiwi.");
  expect(testHint({ phase: "done", result: { ok: false, reason: "invalid_api_key" } })).toBe("Não falou. A chave não vale.");
  expect(testHint({ phase: "done", result: { ok: false, reason: "network" } }, "en")).toBe("It didn't speak. Couldn't reach ElevenLabs.");
});

test("a linha da queda para a voz local: só quando caiu, com a hora e o motivo", () => {
  expect(fallbackHint(null)).toBeNull();
  expect(fallbackHint({ reason: "network", at: "não é data" })).toBeNull();
  const at = new Date(2026, 10, 26, 14, 5).toISOString();
  expect(fallbackHint({ reason: "quota_exceeded", at })).toBe("Às 14:05, o Kiwi falou com a voz local. Os créditos da conta acabaram.");
  expect(fallbackHint({ reason: "no_key", at }, "en")).toMatch(/^At 2:05\sPM, Kiwi used the local voice\. No key is saved\.$/);
});

test("com o ElevenLabs, o interruptor não diz mais que nada sai do Mac", () => {
  for (const on of [true, false]) {
    expect(catSpeaksHint(on, false, "pt")).toContain("nada sai dele");
    expect(catSpeaksHint(on, false, "pt", "elevenlabs")).not.toContain("nada sai");
    expect(catSpeaksHint(on, false, "en", "elevenlabs")).not.toContain("nothing leaves");
  }
  expect(catSpeaksHint(true, false, "pt", "elevenlabs")).toContain("ElevenLabs");
});

test("o ElevenLabs de mentira do headless: o estado do JSON, a chave só na memória", async () => {
  for (const raw of ["[]", '{"hasKey":"sim"}', '{"test":"talvez"}', '{"fallback":{"reason":"network"}}', '{"fallback":{"reason":"x","at":"2026-11-26T10:00:00Z"}}'])
    expect(() => parseFakeElevenLabs(raw)).toThrow();
  const el = fakeElevenLabs('{"test":"quota_exceeded","fallback":{"reason":"network","at":"2026-11-26T10:00:00Z"}}');
  expect(await el.hasKey()).toBe(false);
  await el.setKey("sk_exemplo0123456789abcdef");
  expect(await el.hasKey()).toBe(true);
  await expect(el.speakOnce("oi")).rejects.toMatchObject({ reason: "quota_exceeded" });
  expect(el.lastFallback?.()).toEqual({ reason: "network", at: "2026-11-26T10:00:00Z" });
  await el.deleteKey();
  expect(await el.hasKey()).toBe(false);
  await expect(fakeElevenLabs('{"hasKey":true}').speakOnce("oi")).resolves.toBeUndefined();
});
