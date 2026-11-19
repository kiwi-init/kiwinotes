import { expect, test } from "bun:test";

import type { SetupPermission } from "../shared/first-run.ts";
import type { AppSettings, SettingsPatch } from "../store/settings.ts";
import { DEFAULT_SETTINGS } from "../store/settings.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

/** Só as peças do passo da primeira abertura (T20796); o resto nunca é chamado. Um helper de mentira, nada pede ao macOS. */
function caps(o: { helper?: boolean } = {}) {
  const log: string[] = [];
  let settings: AppSettings = { ...DEFAULT_SETTINGS, firstRun: "pending" };
  const permissions = { inputMonitoring: "undetermined" as const, accessibility: "denied" as const };
  const deps = {
    settings: {
      load: async () => settings,
      save: async (patch: SettingsPatch) => (log.push(`save:${JSON.stringify(patch)}`), (settings = { ...settings, ...patch } as AppSettings)),
    },
    settingsChanged: (s: AppSettings) => void log.push(`changed:${s.firstRun}`),
    ...(o.helper === false
      ? {}
      : {
          setup: {
            live: () => ({ permissions, model: { state: "loading" as const, fraction: 0.42, phase: "downloading" as const } }),
            request: async (p: SetupPermission) => void log.push(`request:${p}`),
            done: () => void log.push("done"),
          },
        }),
  };
  return { caps: uiCapabilities(deps as unknown as Parameters<typeof uiCapabilities>[0]), log };
}

test("setup.status junta o firstRun, as duas permissões e o modelo baixando", async () => {
  const { caps: c } = caps();
  expect(await directInvoke(c, "setup.status", {})).toEqual({
    ok: true,
    value: {
      firstRun: "pending",
      permissions: { inputMonitoring: "undetermined", accessibility: "denied" },
      model: { state: "loading", fraction: 0.42, phase: "downloading" },
    },
  });
  expect(await directInvoke(c, "setup.status", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
});

test("sem o helper: permissões null, o modelo starting, e o botão dá E_NO_HELPER", async () => {
  const { caps: c, log } = caps({ helper: false });
  expect(await directInvoke(c, "setup.status", {})).toMatchObject({ ok: true, value: { permissions: null, model: { state: "starting" } } });
  expect(await directInvoke(c, "setup.request", { permission: "accessibility" })).toMatchObject({ ok: false, code: "E_NO_HELPER" });
  expect(log).toEqual([]);
});

test("setup.request só aceita as duas permissões do passo", async () => {
  const { caps: c, log } = caps();
  expect(await directInvoke(c, "setup.request", { permission: "inputMonitoring" })).toMatchObject({ ok: true });
  for (const permission of ["microphone", "systemAudio", "outra", 1]) {
    expect(await directInvoke(c, "setup.request", { permission })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  }
  expect(await directInvoke(c, "setup.request", { permission: "accessibility", reset: true })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  expect(log).toEqual(["request:inputMonitoring"]);
});

test("setup.done grava o done, avisa as janelas e solta os pedidos da abertura, nessa ordem", async () => {
  const { caps: c, log } = caps();
  expect(await directInvoke(c, "setup.done", {})).toMatchObject({ ok: true, value: { firstRun: "done" } });
  expect(log).toEqual(['save:{"firstRun":"done"}', "changed:done", "done"]);
});
