import { describe, expect, test } from "bun:test";

import { modelBusy, waitModel, type ModelState } from "./cpu-scenarios.ts";

/** Um relógio falso: cada `sleep` anda o tempo, sem esperar de verdade. */
const fakeClock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

/** Os estados que o `status` devolve, um por leitura; o último se repete. */
const states = (...list: ModelState[]) => {
  let i = 0;
  return async () => list[Math.min(i++, list.length - 1)]!;
};

describe("o repouso espera o modelo de voz (T25655)", () => {
  test("espera o helper baixar e compilar, e diz quanto esperou", async () => {
    const r = await waitModel(states({ stt: "starting" }, { stt: "loading" }, { stt: "loading" }, { stt: "ready" }), 300, fakeClock());
    expect(r).toEqual({ seconds: 3 });
  });

  test("o modelo do vocabulário carregando também é trabalho do começo", async () => {
    expect(modelBusy({ stt: "ready", boosting: "loading" })).toBe(true);
    expect(modelBusy({ stt: "ready", boosting: "off" })).toBe(false);
    expect(modelBusy({ stt: "ready" })).toBe(false);
    expect(modelBusy({})).toBe(true);
    const r = await waitModel(states({ stt: "ready", boosting: "loading" }, { stt: "ready", boosting: "ready" }), 300, fakeClock());
    expect(r).toEqual({ seconds: 1 });
  });

  test("o modelo que não carrega (a rede fora do ar) não passa calado: o roteiro sai pulado com o motivo", async () => {
    const r = await waitModel(states({ stt: "loading" }, { stt: "unavailable" }), 300, fakeClock());
    expect("skipped" in r && r.skipped).toContain("o modelo de voz não carregou em 1 s (unavailable");
    const boost = await waitModel(states({ stt: "ready", boosting: "unavailable" }), 300, fakeClock());
    expect("skipped" in boost && boost.skipped).toContain("o modelo do vocabulário não carregou");
  });

  test("passou do teto: pula com o motivo, nunca mede o helper carregando", async () => {
    const r = await waitModel(states({ stt: "loading" }), 300, fakeClock());
    expect(r).toEqual({ skipped: "o modelo de voz não ficou pronto em 300 s (stt loading), e o repouso não mede o helper carregando" });
  });
});
