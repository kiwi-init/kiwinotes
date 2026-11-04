// A seção Sobre (T2386): o que ela diz em cada estado das atualizações, e as capacidades atrás dela.

import { describe, expect, test } from "bun:test";

import { uiCapabilities } from "../../src/bun/ui-capabilities.ts";
import { directInvoke } from "../../src/bun/ui-engine.ts";
import type { UpdatesView } from "../../src/shared/ui-contract.ts";
import { statusLine } from "./aboutText.ts";

const at = "2026-11-04T12:30:00.000Z";
const hhmm = new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

describe("a linha do estado", () => {
  test("cada estado, dito para a pessoa", () => {
    const line = (v: UpdatesView) => statusLine(v);
    expect(line({ state: "idle", lastCheck: null })).toBe("Ainda não verificado.");
    expect(line({ state: "idle", lastCheck: { at, result: "latest" } })).toBe(`Você está na última versão. Verificado às ${hhmm}.`);
    expect(line({ state: "idle", lastCheck: { at, result: "error", message: "Sem internet: não deu para falar com o GitHub." } })).toBe(
      `Sem internet: não deu para falar com o GitHub. (às ${hhmm})`,
    );
    expect(line({ state: "checking", lastCheck: null })).toBe("Verificando…");
    expect(line({ state: "downloading", version: "0.1.0-rc4", lastCheck: null })).toBe("Baixando a 0.1.0-rc4…");
    expect(line({ state: "ready", version: "0.1.0-rc4", lastCheck: null })).toBe("A 0.1.0-rc4 está pronta.");
    expect(line({ state: "ready", version: "0.1.0-rc4", lastCheck: { at, result: "error", message: "não deu para trocar" } })).toBe("não deu para trocar");
    expect(line({ state: "off", reason: "KIWI_DEBUG=1", lastCheck: null })).toBe("As atualizações estão desligadas neste build (KIWI_DEBUG=1).");
  });
});

describe("app.about e updates.* (contrato 1.6.0)", () => {
  const base = {} as unknown as Parameters<typeof uiCapabilities>[0];

  test("sem o atualizador (headless, testes): dev, off, e nada vai à rede", async () => {
    const caps = uiCapabilities(base);
    const about = await directInvoke(caps, "app.about", {});
    expect(about).toMatchObject({ ok: true, value: { version: "dev", channel: "dev", releaseUrl: null, updates: { state: "off" } } });
    expect(await directInvoke(caps, "updates.check", {})).toMatchObject({ ok: true, value: { state: "off" } });
    expect(await directInvoke(caps, "updates.apply", {})).toMatchObject({ ok: true, value: { state: "off" } });
    expect(await directInvoke(caps, "updates.check", { force: true })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("com o atualizador: a versão, o canal e a checagem", async () => {
    let checks = 0;
    const view: UpdatesView = { state: "idle", lastCheck: { at, result: "latest" } };
    const caps = uiCapabilities({
      ...base,
      about: {
        info: () => ({ version: "0.1.0-rc3", channel: "rc", releaseUrl: "https://github.com/kiwi-init/kiwinotes/releases/tag/v0.1.0-rc3" }),
        view: () => view,
        check: async () => (checks++, view),
        apply: async () => view,
      },
    });
    expect(await directInvoke(caps, "app.about", {})).toMatchObject({ ok: true, value: { version: "0.1.0-rc3", channel: "rc", updates: view } });
    expect(await directInvoke(caps, "updates.check", {})).toEqual({ ok: true, value: view });
    expect(checks).toBe(1);
  });
});
