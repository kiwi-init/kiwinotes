// A voz local com um `SinteseFala` falso: nada do kiwi-voice de verdade roda aqui.

import { expect, test } from "bun:test";

import { measure, prepare } from "./core.ts";
import { localProvider } from "./local.ts";

test("frase por frase, PCM a 24 kHz, custo zero", async () => {
  const frases: string[] = [];
  const p = localProvider(() => ({
    async *sintetizar(frase: string) {
      frases.push(frase);
      yield new Int16Array(1920);
    },
  }));
  const voice = p.voices("pt-BR")[0]!;
  expect(voice.id).toBe("pt-a");
  const { text } = prepare("Achei! A reunião com a Ana ficou para 12/03.", "pt-BR");
  const m = await measure(p, voice, { id: "f", text }, { rounds: 1 });
  expect(m.error).toBeUndefined();
  expect(frases.length).toBe(2);
  expect(m.rounds[0]!.bytes).toBe(2 * 1920 * 2);
  expect(m.costUsd).toBe(0);
});

test("o erro do processo vira a linha com erro", async () => {
  const p = localProvider(() => ({
    // eslint-disable-next-line require-yield
    async *sintetizar() {
      throw new Error("o modelo da voz não foi baixado");
    },
  }));
  const m = await measure(p, p.voices("en-US")[0]!, { id: "f", text: "Hi." }, { rounds: 1 });
  expect(m.error).toBe("local: o modelo da voz não foi baixado");
});
