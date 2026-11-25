// Os Ajustes de Reuniões em inglês (T29273, spec #28171): "Suas reuniões" e o resumo executivo. As frases das funções
// e a tela inteira, sem o app. Sem a língua, cada função segue em português.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_SUMMARY_SETTINGS } from "../../src/shared/summary-settings.ts";
import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { DEFAULT_AGENT_MEETING_SETTINGS } from "../../src/store/settings.ts";
import { setAppLocale } from "../src/i18n.ts";
import { blocksHint, folderHint, namePreview, proposeHint } from "./meetingsText.ts";
import { MeetingsRows } from "./MeetingsRows.tsx";
import { firstDaysHint, summaryBlocksHint } from "./summaryText.ts";

afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

/** Nenhum resto de português numa frase em inglês. */
const noPortuguese = (s: string) => expect(s).not.toMatch(/[ãõçáéíóúâê]|\b(reunião|reuniões|nota|pasta|resumo|projeto|dias|quando|para|com|sem)\b/i);

describe("Ajustes de Reuniões em inglês", () => {
  test("as dicas e a prévia do nome", () => {
    const today = new Date(2026, 10, 13);
    expect(namePreview("date-theme", today, "en")).toBe("2026-11-13 · Moving schedule.md");
    expect(namePreview("date-theme", today)).toBe("2026-11-13 · Cronograma da mudança.md");
    for (const s of [proposeHint("auto", false, "en"), proposeHint("auto", true, "en"), proposeHint("on-request", false, "en")]) noPortuguese(s);
    expect(folderHint({ kind: "single", path: "Atas" }, "en")).toBe("All meeting notes go to Atas, and the project's main note gets the link.");
    noPortuguese(folderHint({ kind: "project" }, "en"));
    expect(blocksHint(DEFAULT_AGENT_MEETING_SETTINGS.blocks, "en")).toBe(
      "The note has Summary, Decisions, Actions, Participants, and Next steps, and always the link to the transcript.",
    );
    expect(blocksHint({ summary: false, decisions: true, actions: true, participants: false, nextSteps: false }, "en")).toBe(
      "The note has Decisions and Actions, and always the link to the transcript.",
    );
    expect(blocksHint({ summary: false, decisions: true, actions: true, participants: false, nextSteps: false })).toBe(
      "A nota leva Decisões e Ações, e sempre o link para a transcrição.",
    );
  });

  test("o resumo executivo", () => {
    const all = DEFAULT_SUMMARY_SETTINGS.blocks;
    expect(summaryBlocksHint(all, "en")).toBe("All 6 sections, in this order.");
    expect(summaryBlocksHint({ ...all, decisoes: false, reunioes: false }, "en")).toBe("The summary has Status, Progress, Risks and blockers, and Next steps, in this order.");
    expect(firstDaysHint(14, "en")).toBe('Without a previous summary, "Progress" covers the last 14 days. After that, it covers everything since the last summary.');
  });

  test("a tela inteira em inglês", () => {
    setAppLocale({ setting: "en", locale: "en", system: "en" });
    const status = {
      economy: false,
      meetings: { ...DEFAULT_AGENT_MEETING_SETTINGS, folder: { kind: "single", path: "Atas" } },
      summary: DEFAULT_SUMMARY_SETTINGS,
    } as unknown as AgentStatus;
    const html = renderToStaticMarkup(<MeetingsRows status={status} run={async () => {}} />);
    for (const text of ["Your meetings", "After the meeting", "Suggest on its own", "Where the note goes", "In a single folder", "Preview: ", "Moving schedule", "Project executive summary", "7 days", "Risks and blockers", "Progress (executive summary)"])
      expect(html).toContain(text);
    // O nome da pasta do cofre fica como está.
    expect(html).toContain("Atas");
    noPortuguese(html.replace(/Atas/g, "").replace(/<[^>]+>/g, " "));
  });
});
