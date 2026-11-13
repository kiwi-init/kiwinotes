// A leitura do que o agente informa sobre o gasto e o limite (spec #11084, T11114). As formas vêm do adaptador fixado
// (claude-agent-acp 0.106.0, claude-agent-sdk 0.3.322); nada aqui fala com o Claude Code de verdade.

import { describe, expect, test } from "bun:test";

import { parseLimit, parseResetFromError, parseUsage, parseUsageMarkdown, usageTotal } from "./usage.ts";

describe("o gasto de um pedido", () => {
  test("o usage da resposta do session/prompt; sem ele ou estranho, null", () => {
    const u = parseUsage({ inputTokens: 1200, outputTokens: 340, cachedReadTokens: 9000, cachedWriteTokens: 50, totalTokens: 10590 });
    expect(u).toEqual({ input: 1200, output: 340, cacheRead: 9000, cacheWrite: 50 });
    expect(usageTotal(u!)).toBe(10590);
    expect(parseUsage({ inputTokens: 10, outputTokens: 2 })).toEqual({ input: 10, output: 2, cacheRead: 0, cacheWrite: 0 });
    expect(parseUsage(undefined)).toBeNull();
    expect(parseUsage({ inputTokens: "10", outputTokens: 2 })).toBeNull();
    expect(parseUsage({ inputTokens: -1, outputTokens: 2 })).toBeNull();
  });
});

describe("o uso da janela", () => {
  test("o SDKRateLimitInfo do usage_update, com a fração virando porcentagem e o resetsAt em ms", () => {
    expect(parseLimit({ "_claude/rateLimit": { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.82, resetsAt: 1_800_000_000 } })).toEqual({
      status: "allowed_warning",
      window: "five_hour",
      percent: 82,
      resetsAt: 1_800_000_000_000,
    });
    expect(parseLimit({ "_claude/rateLimit": { status: "rejected", utilization: 100 } })).toEqual({ status: "rejected", percent: 100 });
    expect(parseLimit({ "_claude/rateLimit": { status: "estranho" } })).toBeNull();
    expect(parseLimit({ "_claude/origin": "x" })).toBeNull();
    expect(parseLimit(null)).toBeNull();
  });
});

describe("a hora de volta no erro", () => {
  const now = new Date(2026, 10, 13, 14, 0).getTime();
  test("a frase da mensagem, na próxima vez que a hora chega; sem a frase, null", () => {
    expect(new Date(parseResetFromError("Claude usage limit reached. Your limit will reset at 5pm.", now)!).getHours()).toBe(17);
    const late = parseResetFromError("resets at 6:40 PM", now)!;
    expect([new Date(late).getHours(), new Date(late).getMinutes()]).toEqual([18, 40]);
    // Uma hora que já passou hoje é amanhã.
    const tomorrow = parseResetFromError("will reset at 9am", now)!;
    expect(new Date(tomorrow).getDate()).toBe(14);
    expect(parseResetFromError("Claude usage limit reached.", now)).toBeNull();
    expect(parseResetFromError("resets at 13pm", now)).toBeNull();
  });
});

describe("o /usage", () => {
  const now = new Date(2026, 10, 13, 14, 0).getTime();
  const md = [
    "> Claude Max subscription usage",
    "",
    "**5-hour limit** — **37%** · Resets Nov 13, 6:40 PM",
    "",
    "`███████░░░░░░░░░░░░░`",
    "",
    "**Weekly · all models** — **12%** · Resets Nov 18, 9:00 AM",
  ].join("\n");
  test("as janelas de 5 horas e da semana, com a hora de volta no fuso do Mac", () => {
    const u = parseUsageMarkdown(md, now)!;
    expect(u.fiveHour!.percent).toBe(37);
    expect(new Date(u.fiveHour!.resetsAt!).toString()).toBe(new Date(2026, 10, 13, 18, 40).toString());
    expect(u.week!.percent).toBe(12);
    expect(new Date(u.week!.resetsAt!).getDate()).toBe(18);
  });
  test("as duas formas do ICU: 'Nov 13, 6:40 PM' e 'Nov 13 at 6:40 PM', também com o espaço fino", () => {
    for (const label of ["Nov 13, 6:40 PM", "Nov 13 at 6:40 PM", "Nov 13, 6:40\u202fPM"]) {
      const u = parseUsageMarkdown(`**5-hour limit** — **50%** · Resets ${label}`, now)!;
      expect(new Date(u.fiveHour!.resetsAt!).toString()).toBe(new Date(2026, 10, 13, 18, 40).toString());
    }
  });
  test("a virada do ano: uma volta em janeiro, lida em dezembro, é do ano seguinte", () => {
    const dec = new Date(2026, 11, 30, 22, 0).getTime();
    const u = parseUsageMarkdown("**5-hour limit** — **90%** · Resets Jan 1, 1:00 AM", dec)!;
    expect(new Date(u.fiveHour!.resetsAt!).getFullYear()).toBe(2027);
  });
  test("sem as linhas (a saída crua do Claude Code), null; sem a hora, só a porcentagem", () => {
    expect(parseUsageMarkdown("Usage: something else", now)).toBeNull();
    expect(parseUsageMarkdown("**5-hour limit** — **5%**", now)).toEqual({ fiveHour: { percent: 5 } });
  });
});
