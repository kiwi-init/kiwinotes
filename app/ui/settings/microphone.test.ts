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
