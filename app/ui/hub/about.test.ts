// A seção Sobre (T2386): o que ela diz em cada estado das atualizações, e as capacidades atrás dela.

import { describe, expect, test } from "bun:test";

import { uiCapabilities } from "../../src/bun/ui-capabilities.ts";
import { directInvoke } from "../../src/bun/ui-engine.ts";
import { releaseNotesUrl, UPDATES_OFF_BY_SETTING, type UpdatesView } from "../../src/shared/ui-contract.ts";
import { formatTime } from "../../src/shared/i18n/index.ts";
import { appLocale, setAppLocale } from "../src/i18n.ts";
import { appearanceLine, CREDITS, creditsLine, creditUse, downloadProgress, updateBand } from "./aboutText.ts";

const at = "2026-11-04T12:30:00.000Z";
const hhmm = formatTime("pt", new Date(at));

describe("a faixa da atualização (spec #16837)", () => {
  const band = (v: UpdatesView) => updateBand(v);
  const MB = 1024 * 1024;

  test("parado: nunca verificou, na última, com uma disponível", () => {
    expect(band({ state: "idle", lastCheck: null })).toMatchObject({ tone: "quiet", title: "Ainda não verificado", bar: null, action: { kind: "check", label: "Verificar atualizações" } });
    expect(band({ state: "idle", lastCheck: { at, result: "latest" } })).toMatchObject({ title: "Você está na última versão", detail: `Verificado às ${hhmm}.`, action: { kind: "check" } });
    expect(band({ state: "idle", lastCheck: { at, result: "available", version: "2026.11.3" } }).title).toBe("A versão 2026.11.3 está disponível");
  });

  test("procurando e aplicando: andando, sem botão", () => {
    expect(band({ state: "checking", lastCheck: null })).toMatchObject({ tone: "busy", title: "Procurando atualizações…", action: null, bar: null });
    expect(band({ state: "applying", lastCheck: null })).toMatchObject({ tone: "busy", title: "Reiniciando…", detail: "O Kiwi Notes vai fechar e abrir de novo.", action: null });
  });

  test("baixando: a barra lê done/total; sem eles, indeterminada e sem número", () => {
    const withBytes = { state: "downloading", version: "2026.11.3", lastCheck: null, done: 38 * MB, total: 61 * MB } as UpdatesView;
    expect(band(withBytes)).toMatchObject({ tone: "busy", title: "Baixando a versão 2026.11.3", detail: "38 de 61 MB · 62%", bar: { pct: 62 }, action: null });
    const noBytes = band({ state: "downloading", version: "2026.11.3", lastCheck: null });
    expect(noBytes).toMatchObject({ detail: "Baixando…", bar: { pct: null } });
    expect(noBytes.detail).not.toMatch(/\d/);
    // total zero, negativo ou NaN não vira porcentagem; done além do total para em 100 %
    for (const bad of [{ done: 1, total: 0 }, { done: -1, total: 10 }, { done: Number.NaN, total: 10 }, { done: "1", total: 10 }])
      expect(downloadProgress({ state: "downloading", version: "x", lastCheck: null, ...bad } as UpdatesView)).toBeNull();
    expect(band({ state: "downloading", version: "x", lastCheck: null, done: 70 * MB, total: 61 * MB } as UpdatesView).bar).toEqual({ pct: 100 });
  });

  test("pronta: Atualizar e reiniciar; se a troca falhou, diz o porquê e o botão fica", () => {
    expect(band({ state: "ready", version: "2026.11.3", lastCheck: null })).toMatchObject({
      tone: "ready", title: "A versão 2026.11.3 está pronta", detail: "Baixada e conferida. Reinicia em segundos.", action: { kind: "apply", label: "Atualizar e reiniciar" },
    });
    expect(band({ state: "ready", version: "2026.11.3", lastCheck: { at, result: "error", message: "não deu para trocar" } })).toMatchObject({
      tone: "error", title: "não deu para trocar", action: { kind: "apply" },
    });
  });

  test("\"O que muda\" no baixando e no pronta, com as notas da versão nova; nos outros estados, não", () => {
    expect(band({ state: "downloading", version: "2026.11.3", lastCheck: null }).notesOf).toBe("2026.11.3");
    expect(band({ state: "ready", version: "2026.11.3", lastCheck: null }).notesOf).toBe("2026.11.3");
    expect(band({ state: "ready", version: "2026.11.3", lastCheck: { at, result: "error", message: "não deu para trocar" } }).notesOf).toBe("2026.11.3");
    expect(releaseNotesUrl("2026.11.3")).toBe("https://github.com/kiwi-init/kiwinotes/releases/tag/v2026.11.3");
    const others: UpdatesView[] = [
      { state: "idle", lastCheck: null },
      { state: "idle", lastCheck: { at, result: "available", version: "2026.11.3" } },
      { state: "checking", lastCheck: null },
      { state: "applying", lastCheck: null },
      { state: "off", reason: "KIWI_DEBUG=1", lastCheck: null },
    ];
    for (const v of others) expect(band(v).notesOf).toBeNull();
  });

  test("erro e desligado", () => {
    expect(band({ state: "idle", lastCheck: { at, result: "error", message: "Sem internet: não deu para falar com o GitHub." } })).toMatchObject({
      tone: "error", title: "Não deu para verificar", detail: `Sem internet: não deu para falar com o GitHub. (às ${hhmm})`, action: { kind: "check", label: "Tentar de novo" },
    });
    expect(band({ state: "off", reason: "KIWI_DEBUG=1", lastCheck: null })).toMatchObject({ tone: "quiet", title: "Atualizações desligadas", detail: "Neste build (KIWI_DEBUG=1).", action: null });
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
        info: () => ({ version: "2026.11.1", channel: "stable", releaseUrl: "https://github.com/kiwi-init/kiwinotes/releases/tag/v2026.11.1" }),
        view: () => view,
        check: async () => (checks++, view),
        apply: async () => view,
      },
    });
    expect(await directInvoke(caps, "app.about", {})).toMatchObject({ ok: true, value: { version: "2026.11.1", channel: "stable", updates: view } });
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
    const acp = JSON.parse(readFileSync(new URL("../../node_modules/@agentclientprotocol/sdk/package.json", import.meta.url), "utf8")) as { license: string; author: string };
    expect(CREDITS.find((c) => c.pkg === "@agentclientprotocol/sdk")).toMatchObject({ license: acp.license, by: acp.author });
    // As duas do spec #11549 (gerar pdf e docx) e o motor do docx nas Notas (T21151): a licença que o pacote declara.
    for (const pkg of ["pdf-lib", "docx", "@docx-editor.dev/core"]) {
      const j = JSON.parse(readFileSync(new URL(`../../node_modules/${pkg}/package.json`, import.meta.url), "utf8")) as { license: string };
      expect(CREDITS.find((c) => c.pkg === pkg)?.license).toBe(j.license);
    }
    expect(creditsLine()).toBe(
      "Com PDF.js, da Mozilla (Apache-2.0); Mammoth, de Michael Williamson (BSD-2-Clause); docx-editor, de eigenpal (Apache-2.0); SheetJS Community Edition, de SheetJS LLC (Apache-2.0); draw.io, de JGraph Ltd (Apache-2.0); pdf-lib, de Andrew Dillon (MIT); docx, de Dolan Miu (MIT); Agent Client Protocol SDK, de Zed Industries (Apache-2.0).",
    );
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
    // O motor do docx (T21151): os avisos dele e as licenças do que ele traz pronto (a HarfBuzz e os ícones).
    expect(file).toContain("harfbuzzjs 1.6.4");
    expect(file).toContain("HarfBuzz is licensed under the so-called");
    expect(file).toContain("Material Symbols");
    // O viewer do draw.io, que vai copiado no repo (T7112): a versão fixada e a licença da JGraph.
    const { DRAWIO_VERSION } = await import("../../scripts/drawio-viewer.ts");
    expect(file).toContain(`draw.io ${DRAWIO_VERSION} (jgraph/drawio), de JGraph Ltd`);
    // O que é só para Node, opcional, não entra (o canvas do pdf.js).
    expect(file).not.toContain("@napi-rs/canvas");
  });
});

describe("o atualizador de mentira do headless (KIWI_FAKE_UPDATES, T17098)", () => {
  test("mostra o estado do JSON, não vai à rede e o apply só passa a applying", async () => {
    const { fakeAbout, parseFakeUpdates } = await import("../../src/headless/fake-updates.ts");
    expect(() => parseFakeUpdates('{"state":"nada"}')).toThrow("estado desconhecido");
    const about = fakeAbout('{"state":"ready","version":"2026.11.3"}');
    expect(about.view()).toEqual({ state: "ready", version: "2026.11.3", lastCheck: null });
    expect(await about.check()).toMatchObject({ state: "ready" });
    expect(await about.apply()).toEqual({ state: "applying", lastCheck: null });
  });
});

describe("Buscar atualizações (T25110)", () => {
  test("desligado pela pessoa, a faixa diz o que deixa de acontecer, sem botão; o do build segue como antes", () => {
    expect(updateBand({ state: "off", reason: UPDATES_OFF_BY_SETTING, lastCheck: null })).toEqual({
      tone: "quiet",
      title: "Atualizações desligadas",
      detail: "O Kiwi não procura versão nova nem aparência nova.",
      bar: null,
      notesOf: null,
      action: null,
    });
    expect(updateBand({ state: "off", reason: "KIWI_DEBUG=1", lastCheck: null }).detail).toBe("Neste build (KIWI_DEBUG=1).");
  });

  test("o settings.set guarda o checkUpdates, só true ou false, e avisa o Sobre", async () => {
    const saved: unknown[] = [];
    const turned: boolean[] = [];
    const view: UpdatesView = { state: "idle", lastCheck: null };
    const caps = uiCapabilities({
      settings: { load: async () => ({}), save: async (patch: unknown) => (saved.push(patch), patch) },
      about: { info: () => ({ version: "2026.11.1", channel: "stable", releaseUrl: null }), view: () => view, check: async () => view, apply: async () => view, checkUpdatesChanged: (on: boolean) => void turned.push(on) },
    } as unknown as Parameters<typeof uiCapabilities>[0]);
    for (const bad of ["false", 0, null]) expect(await directInvoke(caps, "settings.set", { checkUpdates: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(saved).toEqual([]);
    expect(await directInvoke(caps, "settings.set", { checkUpdates: false })).toMatchObject({ ok: true, value: { checkUpdates: false } });
    expect(await directInvoke(caps, "settings.set", { checkUpdates: true })).toMatchObject({ ok: true, value: { checkUpdates: true } });
    expect(saved).toEqual([{ checkUpdates: false }, { checkUpdates: true }]);
    expect(turned).toEqual([false, true]);
    // Outro ajuste não mexe nas atualizações.
    await directInvoke(caps, "settings.set", { cues: false });
    expect(turned).toEqual([false, true]);
  });
});

describe("a aparência no Sobre e a faixa Nova aparência pronta (contrato 1.99.0, spec #25011)", () => {
  const base = {} as unknown as Parameters<typeof uiCapabilities>[0];

  test("sem engine (headless, testes): a de fábrica, nada pendente e nada a voltar", async () => {
    const caps = uiCapabilities(base);
    expect(await directInvoke(caps, "ui.status", {})).toEqual({ ok: true, value: { uiVersion: "dev", builtIn: true, pending: null } });
    expect(await directInvoke(caps, "ui.reload", {})).toMatchObject({ ok: true, value: { pending: null } });
    expect(await directInvoke(caps, "ui.revert", {})).toEqual({ ok: true, value: { windows: [], canRevert: false } });
    expect(await directInvoke(caps, "app.about", {})).not.toMatchObject({ ok: true, value: { ui: expect.anything() } });
    expect(await directInvoke(caps, "ui.reload", { now: true })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });

  test("a de mentira do headless (KIWI_FAKE_UI): Recarregar troca, Voltar põe na de fábrica", async () => {
    const { fakeAppearance, parseFakeUi } = await import("../../src/headless/fake-ui.ts");
    expect(() => parseFakeUi('{"uiVersion":1}')).toThrow("KIWI_FAKE_UI");
    const caps = uiCapabilities({ ...base, appearance: fakeAppearance('{"uiVersion":"2026.11.12","builtIn":false,"pending":"2026.11.13","factory":"2026.11.9"}') });
    expect(await directInvoke(caps, "ui.status", {})).toEqual({ ok: true, value: { uiVersion: "2026.11.12", builtIn: false, pending: "2026.11.13" } });
    expect(await directInvoke(caps, "app.about", {})).toMatchObject({ ok: true, value: { ui: { canRevert: true, windows: expect.arrayContaining([{ window: "hub", uiVersion: "2026.11.12", builtIn: false, pending: "2026.11.13" }]) } } });
    expect(await directInvoke(caps, "ui.reload", {})).toEqual({ ok: true, value: { uiVersion: "2026.11.13", builtIn: false, pending: null } });
    const back = await directInvoke(caps, "ui.revert", {});
    expect(back).toMatchObject({ ok: true, value: { canRevert: false } });
    expect(await directInvoke(caps, "ui.status", {})).toEqual({ ok: true, value: { uiVersion: "2026.11.9", builtIn: true, pending: null } });
  });

  test("cada linha diz a janela, a versão e se é de fábrica ou se há uma nova pronta", () => {
    expect(appearanceLine({ window: "notes", uiVersion: "2026.11.9", builtIn: true, pending: null })).toEqual({ name: "Notas", version: "2026.11.9 (de fábrica)" });
    expect(appearanceLine({ window: "settings", uiVersion: "2026.11.12", builtIn: false, pending: "2026.11.13" })).toEqual({ name: "Ajustes", version: "2026.11.12 · nova pronta: 2026.11.13" });
  });
});

test("o Sobre em inglês (spec #28171): a faixa, a aparência e o uso de cada biblioteca", () => {
  const before = appLocale();
  setAppLocale({ ...before, locale: "en" });
  try {
    const MB = 1024 * 1024;
    expect(updateBand({ state: "idle", lastCheck: { at, result: "latest" } })).toMatchObject({
      title: "You're on the latest version",
      detail: `Checked at ${formatTime("en", new Date(at))}.`,
      action: { kind: "check", label: "Check for updates" },
    });
    expect(updateBand({ state: "downloading", version: "2026.11.3", lastCheck: null, done: 1234 * MB, total: 2468 * MB } as UpdatesView)).toMatchObject({
      title: "Downloading version 2026.11.3",
      detail: "1,234 of 2,468 MB · 50%",
    });
    expect(updateBand({ state: "ready", version: "2026.11.3", lastCheck: null }).action).toEqual({ kind: "apply", label: "Update and restart" });
    expect(appearanceLine({ window: "notes", uiVersion: "2026.11.9", builtIn: true, pending: "2026.11.10" })).toEqual({ name: "Notes", version: "2026.11.9 (built in) · new one ready: 2026.11.10" });
    for (const c of CREDITS) expect(creditUse(c)).not.toBe(c.use);
  } finally {
    setAppLocale(before);
  }
  // O arquivo de avisos segue em português, seja qual for a língua do app.
  for (const c of CREDITS) expect(creditUse(c)).toBe(c.use);
});
