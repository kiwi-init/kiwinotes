// Ajustes › Agente em inglês (T29271, spec #28171): as frases que saem das funções (o estado do agente, a tela "o que
// vai", o teste, o esforço, a voz do gato, o medidor e o placar) e as telas que não precisam do app (a tela "o que vai" e
// o placar). Sem a língua, cada função segue em português.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentPlacarView, CatVoiceStatus } from "../../src/shared/ui-contract.ts";
import { catSizeLabel } from "../../src/shared/kiwicat-place.ts";
import { setAppLocale } from "../src/i18n.ts";
import { Consent } from "./Agent.tsx";
import { adapterLine, agentLine, applyTurn, consentText, controlHint, effortHint, IDLE_TEST, kindHint, noticeHint, switchText, toolStatus } from "./agentText.ts";
import { catSpeaksHint, catVoiceLine, voiceRows, voiceSize } from "./CatSpeaksRow.tsx";
import { Placar } from "./Placar.tsx";
import { acharLerLine, cartoes, curto, seloFaro } from "./placarText.ts";
import { at, limitBubble, limitLine, outLine, subscriptionLine, sumLine, tokens } from "./usageText.ts";

const english = () => setAppLocale({ setting: "en", locale: "en", system: "en" });
afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const now = new Date(2026, 10, 13, 14, 0).getTime();
const iso = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();
/** Nenhum resto de português numa frase em inglês. */
const noPortuguese = (s: string) => expect(s).not.toMatch(/[ãõçáéíóúâêô]|\b(agente|pedido|ligar|nota|notas|para|pelo|pela|com|sem|quando)\b/i);

describe("Ajustes › Agente em inglês", () => {
  test("o estado do agente, ligar e o adaptador", () => {
    const ok = agentLine("claude", "Claude Code", { installed: true, version: "2.1.0", loggedIn: true, method: "claude.ai", versionOk: true }, "en");
    expect(ok.ok).toBe(true);
    expect(ok.text).toContain("Claude Code 2.1.0");
    noPortuguese(ok.text);
    const missing = agentLine("gemini", "Gemini", { installed: false, loggedIn: false, versionOk: false }, "en");
    expect(missing.ok).toBe(false);
    noPortuguese(missing.text);
    expect(agentLine("gemini", "Gemini", null, "en").text).toBe("Checking Gemini…");
    expect(agentLine("gemini", "Gemini", null).text).toBe("Conferindo o Gemini…");
    noPortuguese(kindHint("claude", true, "en"));
    noPortuguese(adapterLine({ name: "Claude Code", adapter: { phase: "missing" } } as never, "en"));
    expect(adapterLine({ name: "Claude Code", adapter: { phase: "missing" } } as never, "en")).toContain("4.4 MB");
    noPortuguese(controlHint(false, "Control", true, "en"));
    noPortuguese(noticeHint({ permission: "allowed", enabled: true }, false, "en"));
  });

  test("a tela \"o que vai\" e a troca de agente", () => {
    const c = consentText("Gemini", "Google", false, "en");
    for (const line of [c.title, ...c.goes, ...c.never, ...c.who]) noPortuguese(line);
    expect(c.who.join(" ")).toContain("Google");
    expect(switchText("gemini", "en").title).toContain("Gemini");
    english();
    const html = renderToStaticMarkup(<Consent kind="claude" onYes={() => {}} onNo={() => {}} />);
    for (const text of ["What goes to Claude Code", "What never goes", "Who sends it", "Turn on Claude Code", "Not now"]) expect(html).toContain(text);
    expect(html).not.toContain("Agora não");
  });

  test("o teste: o que o agente faz, o pedido negado e o esforço", () => {
    const search = toolStatus("notes_search", "caju", "en");
    expect(search).toContain("caju");
    noPortuguese(search);
    noPortuguese(toolStatus("unknown_tool", undefined, "en"));
    const running = { ...IDLE_TEST, id: "r1", phase: "running" as const };
    const refused = applyTurn(running, { id: "r1", type: "permission", tool: "Bash" } as never, "Claude Code", "en");
    expect(refused.status).toContain("Bash");
    noPortuguese(refused.status);
    expect(applyTurn(running, { id: "r1", type: "status", status: "thinking" } as never, "Claude Code", "en").status).not.toBe(
      applyTurn(running, { id: "r1", type: "status", status: "thinking" } as never, "Claude Code").status,
    );
    const hint = effortHint({ name: "Claude Code", model: "default", effort: undefined, efforts: { default: ["low", "high"] }, economy: false } as never, "en");
    noPortuguese(hint);
  });

  test("a voz do gato", () => {
    expect(voiceSize(1_540_000_000, "en")).toBe("1.5 GB");
    expect(voiceSize(1_540_000_000)).toBe("1,5 GB");
    expect(catSpeaksHint(true, false, "en")).toContain("The voice runs on this Mac");
    const v = { phase: "downloading", size: 2e9, total: 100, done: 40, voices: [], selected: "en-a", model: false } as unknown as CatVoiceStatus;
    expect(catVoiceLine(true, v, "en")?.hint).toBe("Downloading the voice: 40% of 2 GB. Until it finishes, Kiwi answers in writing.");
    const missing = { phase: "noVoice", size: 2e9, voices: [{ id: "en-a", state: "missing", size: 3e8 }, { id: "en-b", state: "ready" }], selected: "en-b", model: true } as unknown as CatVoiceStatus;
    expect(catVoiceLine(true, missing, "en")?.hint).toBe("1 voice missing (300 MB). The model is already here and won't download again.");
    expect(catVoiceLine(true, missing)?.hint).toBe("Falta 1 voz (300 MB). O modelo já está aqui e não baixa de novo.");
    expect(voiceRows(missing, "english", "en")[0]!.hint).toBe("Lively and fun. Not downloaded yet.");
    expect(catSizeLabel(1.3, "en")).toBe("1.3×");
  });

  test("o medidor e o balão do limite", () => {
    expect(tokens(12_340, "en")).toBe("12.3K tokens");
    expect(sumLine({ requests: 1, tokens: 10_000, cacheRead: 4000 }, "en")).toBe("1 request, 10K tokens, 40% read from cache.");
    expect(sumLine({ requests: 3, tokens: 900, cacheRead: 0 }, "en")).toBe("3 requests, 900 tokens.");
    expect(at(iso(2026, 10, 13, 18, 40), now, "en")).toBe("at 6:40 PM");
    expect(at(iso(2026, 10, 14, 9, 0), now, "en")).toBe("tomorrow at 9:00 AM");
    expect(at(iso(2026, 10, 18, 9, 0), now, "en")).toMatch(/11\/18 at 9:00 AM$/);
    expect(outLine({ at: iso(2026, 10, 13, 13, 0), resetsAt: iso(2026, 10, 13, 18, 40) }, now, "en")).toBe("The limit ran out. It comes back at 6:40 PM.");
    expect(limitLine({ status: "allowed_warning", at: iso(2026, 10, 13, 13, 20), window: "five_hour", percent: 82 }, now, "en")).toBe(
      "The agent reported 82% of the 5-hour window used (at 1:20 PM).",
    );
    expect(
      subscriptionLine({ at: iso(2026, 10, 13, 13, 0), fiveHour: { percent: 37, resetsAt: iso(2026, 10, 13, 18, 40) }, week: { percent: 12 } }, now, "en"),
    ).toBe("5 hours: 37%, back at 6:40 PM. Week: 12%.");
    expect(limitBubble("warning", 82, undefined, now, "en")).toBe("You've used 82% of your limit. I'll keep going, but take it easy.");
  });

  test("o placar", () => {
    const partes = { pedido: 50, achar: 5, ler: 4, bagagem: 21, fixo: 20 };
    const v: AgentPlacarView = {
      pedidos: 2,
      idas: 5,
      tokens: 16_600,
      partes,
      comFaro: 2,
      dePrimeira: 1,
      limite5h: 2.5,
      ultimos: [{ request: "r1", at: iso(2026, 10, 13, 13, 5), question: "Resuma a nota Caju", tokens: 8300, idas: 3, partes, faro: { kind: "certo", how: "som" } as never }],
    };
    expect(curto(8300, "en")).toBe("8.3K");
    expect(cartoes(v, "en").map((c) => c.label)).toEqual(["requests", "trips to the model", "tokens", "the Compass found it first try"]);
    expect(cartoes(v, "en")[3]!.valor).toBe("1 of 2");
    expect(acharLerLine(partes, "en")).toBe("Find and read: 9% of today's usage.");
    expect(seloFaro({ kind: "certo", how: "som" } as never, "en").texto).toBe("found · by sound");
    english();
    const html = renderToStaticMarkup(<Placar v={v} now={now} />);
    for (const text of ["Today&#x27;s scoreboard", "Latest requests", "The Compass", "Baggage", "found · by sound"]) expect(html).toContain(text);
    expect(html).not.toContain("Bússola");
  });
});
