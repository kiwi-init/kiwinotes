import { expect, test } from "bun:test";

import type { PreciseStatus } from "../../src/shared/ui-contract.ts";
import { preciseHint } from "./PreciseRow.tsx";

const SIZE = 269_751_136;
const s = (o: Partial<PreciseStatus>): PreciseStatus => ({ enabled: true, phase: "ready", size: SIZE, ...o });

test("a dica diz o custo antes de ligar e o que o modelo está fazendo depois (T6602)", () => {
  expect(preciseHint(s({ enabled: false, phase: "off" }), false)).toBe(
    "Erra menos termos técnicos, com o seu dicionário. Leva ~0,3 s a mais por ditado. Ligar baixa o modelo (270 MB) uma vez.",
  );
  expect(preciseHint(s({ phase: "downloading", done: SIZE / 4, total: SIZE }), false)).toBe(
    "Baixando o modelo: 25% de 270 MB, uma vez só. Até terminar, o ditado sai como sempre.",
  );
  expect(preciseHint(s({ phase: "downloading" }), false)).toStartWith("Baixando o modelo: 0% de 270 MB");
  expect(preciseHint(s({ phase: "loading" }), false)).toBe("Carregando o modelo…");
  expect(preciseHint(s({ phase: "error", error: "download" }), false)).toContain("Desligue e ligue para tentar de novo");
  expect(preciseHint(s({ phase: "error", error: "load" }), false)).toContain("O ditado continua como sempre");
  expect(preciseHint(s({}), false)).toContain("o áudio e o texto não saem daqui");
  expect(preciseHint(s({}), true)).toBe("Não deu para salvar. Tente de novo.");
});
