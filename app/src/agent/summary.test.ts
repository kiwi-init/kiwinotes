// O resumo executivo (spec #11546): a seção no formato fixo, os blocos de Ajustes, a troca do anterior e o período.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SUMMARY_SETTINGS,
  lastSummaryDate,
  mainNoteWithSummary,
  sanitizeSummarySettings,
  type SummaryFields,
  summarySection,
  summarySince,
} from "./summary.ts";

const FIELDS: SummaryFields = {
  signal: "amarelo",
  status: "a migração atrasou uma semana",
  progress: [{ text: "O cronograma foi revisto", source: "Projetos/Kiwi/2026-11-10 · Cronograma.md" }],
  decisions: [{ text: "Migrar em dezembro", date: "2026-11-10", source: "Projetos/Kiwi/2026-11-10 · Cronograma.md" }],
  risks: [{ text: "A janela de manutenção ainda não foi confirmada" }],
  nextSteps: [{ text: "Confirmar a janela", who: "Ana", when: "sexta", source: "Projetos/Kiwi/Kiwi.md" }],
  meetings: [{ path: "Projetos/Kiwi/2026-11-10 · Cronograma.md", title: "Cronograma", date: "2026-11-10" }],
  since: "2026-10-30",
};

describe("o resumo executivo", () => {
  test("os 6 blocos na ordem fixa, com o sinal, a data e os links das fontes", () => {
    const s = summarySection(FIELDS, DEFAULT_SUMMARY_SETTINGS, "2026-11-13");
    const order = ["## Resumo executivo", "**Situação:** 🟡 Atenção · 13/11/2026", "### O que andou desde 30/10/2026", "### Decisões", "### Riscos e bloqueios", "### Próximos passos", "### Reuniões recentes"].map((x) => s.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s).toContain("- Migrar em dezembro (10/11/2026, [[Projetos/Kiwi/2026-11-10 · Cronograma|2026-11-10 · Cronograma]])");
    expect(s).toContain("- [ ] Confirmar a janela (Ana, sexta) · [[Projetos/Kiwi/Kiwi|Kiwi]]");
    expect(s).toContain("- 10/11/2026 · [[Projetos/Kiwi/2026-11-10 · Cronograma|Cronograma]]");
  });

  test("um bloco desligado em Ajustes não entra, e um bloco vazio também não", () => {
    const s = summarySection({ ...FIELDS, risks: [] }, { ...DEFAULT_SUMMARY_SETTINGS, blocks: { ...DEFAULT_SUMMARY_SETTINGS.blocks, decisoes: false } }, "2026-11-13");
    expect(s).not.toContain("### Decisões");
    expect(s).not.toContain("### Riscos");
    expect(s).toContain("### Próximos passos");
  });

  test("entra no topo, depois do frontmatter e do título; o resto da nota não muda", () => {
    const note = "---\ntags: [kiwi]\n---\n# Kiwi\n\nO projeto do app.\n\n## Pendências\n\n- [ ] Algo\n";
    const next = mainNoteWithSummary(note, summarySection(FIELDS, DEFAULT_SUMMARY_SETTINGS, "2026-11-13"));
    expect(next.startsWith("---\ntags: [kiwi]\n---\n# Kiwi\n\n## Resumo executivo")).toBe(true);
    expect(next.endsWith("O projeto do app.\n\n## Pendências\n\n- [ ] Algo\n")).toBe(true);
    // Sem título nem frontmatter, logo no começo.
    expect(mainNoteWithSummary("Texto solto.\n", "## Resumo executivo\n\nX\n")).toBe("## Resumo executivo\n\nX\n\nTexto solto.\n");
  });

  test("um resumo novo substitui o anterior, e só ele", () => {
    const note = "# Kiwi\n\n## Resumo executivo\n\n**Situação:** 🟢 No rumo · 01/11/2026\n\n### Decisões\n\n- Velha\n\n## Pendências\n\n- [ ] Algo\n";
    const next = mainNoteWithSummary(note, summarySection(FIELDS, DEFAULT_SUMMARY_SETTINGS, "2026-11-13"));
    expect(next.match(/## Resumo executivo/g)).toHaveLength(1);
    expect(next).not.toContain("- Velha");
    expect(next).toContain("🟡 Atenção · 13/11/2026");
    expect(next.endsWith("## Pendências\n\n- [ ] Algo\n")).toBe(true);
  });

  test("o período: desde o último resumo, ou o do primeiro em Ajustes", () => {
    const note = "# Kiwi\n\n## Resumo executivo\n\n**Situação:** 🟢 No rumo · 01/11/2026\n";
    expect(lastSummaryDate(note)).toBe("2026-11-01");
    expect(summarySince(note, DEFAULT_SUMMARY_SETTINGS, new Date(2026, 10, 13))).toBe("2026-11-01");
    expect(summarySince("# Kiwi\n", { ...DEFAULT_SUMMARY_SETTINGS, firstDays: 7 }, new Date(2026, 10, 13, 12))).toBe("2026-11-06");
    expect(summarySince(null, DEFAULT_SUMMARY_SETTINGS, new Date(2026, 10, 13, 12))).toBe("2026-10-30");
  });

  test("os Ajustes saneados: tudo ligado e 14 dias por padrão", () => {
    expect(sanitizeSummarySettings(undefined)).toEqual(DEFAULT_SUMMARY_SETTINGS);
    expect(sanitizeSummarySettings({ blocks: { riscos: false }, firstDays: 30 })).toEqual({ blocks: { ...DEFAULT_SUMMARY_SETTINGS.blocks, riscos: false }, firstDays: 30 });
    expect(sanitizeSummarySettings({ firstDays: 9 }).firstDays).toBe(14);
  });
});
