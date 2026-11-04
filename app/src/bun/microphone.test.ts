// O microfone do ditado (spec #3202, T3230): a escolha nas Configurações, o `audio.inputs` e o que vem do helper.

import { describe, expect, test } from "bun:test";

import { type AudioInputs, isMicrophoneChoice, sanitizeAudioInputs } from "../shared/microphone.ts";
import { UI_CAPABILITIES, UI_CONTRACT_VERSION } from "../shared/ui-contract.ts";
import { DEFAULT_SETTINGS, type SettingsPatch, sanitizeSettings } from "../store/settings.ts";
import { listAudioInputs } from "./audio-inputs.ts";
import { uiCapabilities } from "./ui-capabilities.ts";
import { directInvoke } from "./ui-engine.ts";

const INPUTS: AudioInputs = {
  inputs: [
    { uid: "BuiltInMicrophoneDevice", name: "Microfone (MacBook Pro)", transport: "builtin", isDefault: false },
    { uid: "AA:input", name: "AirPods Pro", transport: "bluetooth", isDefault: true },
  ],
  output: { name: "AirPods Pro", transport: "bluetooth" },
};

describe("a escolha do microfone", () => {
  test("só as fixas e um uid: de verdade", () => {
    for (const ok of ["auto", "builtin", "system", "uid:BuiltInMicrophoneDevice", "uid:AppleUSBAudioEngine:Blue:Yeti:1"]) expect(isMicrophoneChoice(ok)).toBe(true);
    for (const bad of ["", "mac", "uid:", "AUTO", 42, null, `uid:${"x".repeat(600)}`, "uid:a\nb"]) expect(isMicrophoneChoice(bad)).toBe(false);
  });

  test("nas Configurações: padrão auto, e um valor ruim editado à mão volta ao auto", () => {
    expect(DEFAULT_SETTINGS.microphone).toBe("auto");
    expect(sanitizeSettings({}).microphone).toBe("auto");
    expect(sanitizeSettings({ microphone: "uid:AA:input" }).microphone).toBe("uid:AA:input");
    expect(sanitizeSettings({ microphone: "mic do mac" }).microphone).toBe("auto");
  });
});

describe("o que o helper manda no audio.inputs", () => {
  test("fica só o que vale: sem uid, repetido ou com transporte desconhecido", () => {
    const got = sanitizeAudioInputs({
      inputs: [
        { uid: "A", name: "Um", transport: "usb", isDefault: true },
        { uid: "A", name: "Repetido", transport: "usb" },
        { name: "Sem uid", transport: "usb" },
        { uid: "B", transport: "thunderbolt" },
        "lixo",
      ],
      output: { name: "AirPods", transport: "bluetooth", extra: 1 },
      extra: true,
    });
    expect(got).toEqual({
      inputs: [
        { uid: "A", name: "Um", transport: "usb", isDefault: true },
        { uid: "B", name: "B", transport: "other", isDefault: false },
      ],
      output: { name: "AirPods", transport: "bluetooth" },
    });
    expect(sanitizeAudioInputs({ inputs: "não" })).toBeNull();
    expect(sanitizeAudioInputs(null)).toBeNull();
    expect(sanitizeAudioInputs({ inputs: [] })).toEqual({ inputs: [], output: null });
  });

  test("helper de pé responde a lista; antigo (unknown_type) ou fora do ar dá null", async () => {
    const sent: unknown[] = [];
    expect(await listAudioInputs(async (c) => (sent.push(c), { ok: true, data: INPUTS }))).toEqual(INPUTS);
    expect(sent).toEqual([{ type: "audio.inputs" }]);
    expect(await listAudioInputs(async () => ({ ok: false, error: "unknown_type" }))).toBeNull();
    expect(await listAudioInputs(() => Promise.reject(new Error("helper not connected")))).toBeNull();
  });
});

describe("as capacidades (contrato 1.18.0)", () => {
  function caps(audioInputs?: () => Promise<AudioInputs | null>) {
    const saved: SettingsPatch[] = [];
    const changed: string[] = [];
    let settings = { ...DEFAULT_SETTINGS };
    const deps = {
      settings: {
        load: async () => settings,
        save: async (p: SettingsPatch) => (saved.push(p), (settings = { ...settings, ...p } as typeof settings)),
      },
      settingsChanged: (s: typeof settings) => void changed.push(s.microphone),
      audioInputs,
    } as unknown as Parameters<typeof uiCapabilities>[0];
    const c = uiCapabilities(deps);
    return { call: (cap: string, args: unknown) => directInvoke(c, cap, args), saved, changed };
  }

  test("o contrato tem o audio.inputs e subiu para 1.18.0", () => {
    expect(UI_CONTRACT_VERSION).toBe("1.18.0");
    expect(UI_CAPABILITIES).toContain("audio.inputs");
  });

  test("settings.set microphone: só uma escolha válida, e o helper fica sabendo", async () => {
    const f = caps();
    expect(await f.call("settings.set", { microphone: "uid:AA:input" })).toMatchObject({ ok: true, value: { microphone: "uid:AA:input" } });
    expect(f.changed).toEqual(["uid:AA:input"]);
    for (const bad of ["mac", "", 1, null, "uid:"]) expect(await f.call("settings.set", { microphone: bad })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
    expect(f.saved).toEqual([{ microphone: "uid:AA:input" }]);
  });

  test("audio.inputs: a lista do helper; sem helper, E_NO_HELPER; argumento a mais, E_BAD_ARGS", async () => {
    expect(await caps(async () => INPUTS).call("audio.inputs", {})).toEqual({ ok: true, value: INPUTS });
    expect(await caps(async () => null).call("audio.inputs", {})).toMatchObject({ ok: false, code: "E_NO_HELPER" });
    expect(await caps().call("audio.inputs", {})).toMatchObject({ ok: false, code: "E_NO_HELPER" });
    expect(await caps(async () => INPUTS).call("audio.inputs", { x: 1 })).toMatchObject({ ok: false, code: "E_BAD_ARGS" });
  });
});
