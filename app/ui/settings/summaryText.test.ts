// Os textos do resumo executivo em Ajustes (spec #11546).
import { describe, expect, test } from "bun:test";

import { DEFAULT_SUMMARY_SETTINGS, SUMMARY_BLOCKS } from "../../src/shared/summary-settings.ts";
import { firstDaysHint, SUMMARY_BLOCK_LABELS, summaryBlocksHint } from "./summaryText.ts";

describe("o resumo executivo em Ajustes", () => {
  test("os 6 blocos, na ordem do resumo", () => {
    expect(SUMMARY_BLOCK_LABELS.map((b) => b.key)).toEqual([...SUMMARY_BLOCKS]);
  });

  test("a dica diz o que entra", () => {
    const all = DEFAULT_SUMMARY_SETTINGS.blocks;
    expect(summaryBlocksHint(all)).toBe("Os 6 blocos, nesta ordem.");
    expect(summaryBlocksHint({ ...all, decisoes: false, reunioes: false })).toBe("O resumo leva Situação, O que andou, Riscos e bloqueios e Próximos passos, nesta ordem.");
    const none = Object.fromEntries(SUMMARY_BLOCKS.map((k) => [k, false])) as typeof all;
    expect(summaryBlocksHint(none)).toContain("Nenhum bloco");
    expect(firstDaysHint(7)).toContain("últimos 7 dias");
  });
});
