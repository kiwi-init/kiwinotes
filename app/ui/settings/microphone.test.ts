// O seletor de microfone dos Ajustes (T3230): as opções e a dica.

import { describe, expect, test } from "bun:test";

import type { AudioInputs } from "../../src/shared/microphone.ts";
import { micHint, micOptions } from "./microphone.ts";

const AIRPODS: AudioInputs = {
  inputs: [
    { uid: "BuiltIn", name: "Microfone (MacBook Pro)", transport: "builtin", isDefault: false },
    { uid: "AA:input", name: "AirPods Pro", transport: "bluetooth", isDefault: true },
    { uid: "Yeti", name: "Yeti Stereo Microphone", transport: "usb", isDefault: false },
  ],
  output: { name: "AirPods Pro", transport: "bluetooth" },
};

const values = (o: { value: string }[]) => o.map((x) => x.value);

describe("as opções", () => {
  test("Automático, Mic do Mac, os outros microfones (sem repetir o do Mac) e o Padrão do sistema", () => {
    expect(micOptions("auto", AIRPODS)).toEqual([
      { value: "auto", label: "Automático" },
      { value: "builtin", label: "Mic do Mac" },
      { value: "uid:AA:input", label: "AirPods Pro" },
      { value: "uid:Yeti", label: "Yeti Stereo Microphone" },
      { value: "system", label: "Padrão do sistema" },
    ]);
  });

  test("sem o helper, só as fixas; um uid salvo continua escolhido", () => {
    expect(values(micOptions("auto", null))).toEqual(["auto", "builtin", "system"]);
    expect(micOptions("uid:Yeti", null)).toContainEqual({ value: "uid:Yeti", label: "Microfone salvo" });
  });

  test("um salvo que saiu aparece como desconectado, sem sumir da escolha", () => {
    expect(micOptions("uid:Sumiu", AIRPODS)).toContainEqual({ value: "uid:Sumiu", label: "Microfone salvo (desconectado)" });
  });

  test("Mac sem microfone (Mac mini): sem a linha do Mac, a não ser que esteja escolhida", () => {
    const mini: AudioInputs = { inputs: [{ uid: "Yeti", name: "Yeti", transport: "usb", isDefault: true }], output: null };
    expect(values(micOptions("auto", mini))).toEqual(["auto", "uid:Yeti", "system"]);
    expect(values(micOptions("builtin", mini))).toContain("builtin");
  });
});

describe("a dica", () => {
  test("o Automático diz o que faz com o fone que está na saída", () => {
    expect(micHint("auto", AIRPODS)).toBe("Com AirPods Pro na saída, o ditado grava pelo mic do Mac e o som do fone não cai.");
    expect(micHint("auto", null)).toContain("Com fone Bluetooth na saída");
  });

  test("o Padrão do sistema e um mic Bluetooth avisam que o som abaixa", () => {
    expect(micHint("system", AIRPODS)).toContain("abaixa");
    expect(micHint("uid:AA:input", AIRPODS)).toContain("abaixa");
  });

  test("um salvo desconectado diz que o Automático vale até ele voltar", () => {
    expect(micHint("uid:Sumiu", AIRPODS)).toBe("Desconectado. Até ele voltar, o ditado usa o Automático.");
    expect(micHint("uid:Yeti", AIRPODS)).toContain("sempre por este microfone");
  });
});

describe("a dica ao vivo (T3344), com o using do helper", () => {
  const LID_CLOSED: AudioInputs = {
    ...AIRPODS,
    using: { name: "Yeti Stereo Microphone", transport: "usb", systemDefault: false, fellBack: false, reason: "lid closed, built-in mic off: usb" },
  };

  test("o caso comum (Automático pelo mic do Mac) fica com o texto de sempre", () => {
    const common: AudioInputs = {
      ...AIRPODS,
      using: { name: "Microfone (MacBook Pro)", transport: "builtin", systemDefault: false, fellBack: false, reason: "Bluetooth output: built-in mic" },
    };
    expect(micHint("auto", common)).toBe(micHint("auto", { ...AIRPODS }));
    expect(micHint("builtin", common)).toBe("O ditado grava sempre pelo mic do Mac.");
  });

  test("tampa fechada: o Automático diz que foi para o USB", () => {
    expect(micHint("auto", LID_CLOSED)).toBe(
      "Com a tampa fechada, o mic do Mac não grava. Agora o ditado grava pelo Yeti Stereo Microphone.",
    );
  });

  test("tampa fechada e só o AirPods: avisa que o som do fone abaixa", () => {
    const onlyAirPods: AudioInputs = {
      ...AIRPODS,
      using: { name: "AirPods Pro", transport: "bluetooth", systemDefault: true, fellBack: false, reason: "lid closed, built-in mic off: system default" },
    };
    expect(micHint("auto", onlyAirPods)).toBe(
      "Com a tampa fechada, o mic do Mac não grava. Agora o ditado grava pelo AirPods Pro: enquanto você dita, o som do fone abaixa.",
    );
  });

  test("um salvo desconectado diz por qual grava até ele voltar", () => {
    const gone: AudioInputs = {
      ...AIRPODS,
      using: { name: "Microfone (MacBook Pro)", transport: "builtin", systemDefault: false, fellBack: true, reason: "chosen mic gone: auto" },
    };
    expect(micHint("uid:Sumiu", gone)).toBe("Desconectado. Até ele voltar, o ditado grava pelo Microfone (MacBook Pro).");
  });

  test("sem nome (helper não sabe): fala do padrão do macOS", () => {
    const noName: AudioInputs = { ...AIRPODS, using: { name: "", transport: null, systemDefault: true, fellBack: true, reason: "" } };
    expect(micHint("uid:Sumiu", noName)).toContain("o ditado grava pelo microfone padrão do macOS");
  });
});
