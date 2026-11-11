// A seção Sobre (T2386): o que ela diz em cada estado das atualizações, e as capacidades atrás dela.

import { describe, expect, test } from "bun:test";

import { uiCapabilities } from "../../src/bun/ui-capabilities.ts";
import { directInvoke } from "../../src/bun/ui-engine.ts";
import type { UpdatesView } from "../../src/shared/ui-contract.ts";
import { CREDITS, creditsLine, statusLine } from "./aboutText.ts";

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

describe("os créditos (spec #7079)", () => {
  test("cada biblioteca aparece com a licença que o pacote dela declara", async () => {
    const pdf = (await import("pdfjs-dist/package.json")).default as { license: string };
    const mammoth = (await import("mammoth/package.json")).default as { license: string };
    expect(CREDITS.find((c) => c.name === "PDF.js")?.license).toBe(pdf.license);
    const { readFileSync } = await import("node:fs");
    // O `xlsx` não exporta o package.json; ele é lido do disco.
    const xlsx = JSON.parse(readFileSync(new URL("../../node_modules/xlsx/package.json", import.meta.url), "utf8")) as { license: string };
    expect(CREDITS.find((c) => c.name === "Mammoth")?.license).toBe(mammoth.license);
    expect(CREDITS.find((c) => c.pkg === "xlsx")?.license).toBe(xlsx.license);
    expect(creditsLine()).toBe("Com PDF.js, da Mozilla (Apache-2.0); Mammoth, de Michael Williamson (BSD-2-Clause); SheetJS Community Edition, de SheetJS LLC (Apache-2.0); draw.io, de JGraph Ltd (Apache-2.0).");
    expect(creditsLine([])).toBe("");
    expect(creditsLine([CREDITS[0]!, { name: "X", by: "Y", license: "MIT", use: "z", pkg: "x" }])).toBe("Com PDF.js, da Mozilla (Apache-2.0); X, de Y (MIT).");
  });
});

describe("o arquivo de avisos de terceiros (revisão do T7109)", () => {
  test("está em dia: o texto inteiro de cada licença, como o pacote instalado traz", async () => {
    const { currentNotices, NOTICES_PATH } = await import("../../scripts/third-party-notices.ts");
    const { readFileSync } = await import("node:fs");
    const file = readFileSync(NOTICES_PATH, "utf8");
    expect(file).toBe(currentNotices());
    expect(file).toContain("Apache License");
    expect(file).toContain("Version 2.0, January 2004");
    expect(file).toContain("Redistribution and use in source and binary forms");
    for (const c of CREDITS) expect(file).toContain(`(${c.pkg}), de ${c.by}`);
    // As dependências que vão junto também (revisão do T7110): as do mammoth, com a licença MIT do jszip e a do pako.
    for (const dep of ["jszip", "pako", "@xmldom/xmldom", "underscore", "lop"]) expect(file).toContain(`(${dep}), de seus autores`);
    // O viewer do draw.io, que vai copiado no repo (T7112): a versão fixada e a licença da JGraph.
    const { DRAWIO_VERSION } = await import("../../scripts/drawio-viewer.ts");
    expect(file).toContain(`draw.io ${DRAWIO_VERSION} (jgraph/drawio), de JGraph Ltd`);
    // O que é só para Node, opcional, não entra (o canvas do pdf.js).
    expect(file).not.toContain("@napi-rs/canvas");
  });
});
