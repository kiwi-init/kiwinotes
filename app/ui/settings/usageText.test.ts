// Os textos do medidor (spec #11084, T11114), estado por estado. Sem dinheiro em nenhum.

import { describe, expect, test } from "bun:test";

import { at, limitBubble, limitLine, outLine, subscriptionLine, sumLine, tokens } from "./usageText.ts";

const now = new Date(2026, 10, 13, 14, 0).getTime();
const iso = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

describe("o medidor", () => {
  test("as somas: pedidos, tokens e o quanto veio do cache", () => {
    expect(tokens(950)).toBe("950 tokens");
    expect(tokens(12_340)).toBe("12,3 mil tokens");
    expect(tokens(2_500_000)).toBe("2,5 mi tokens");
    expect(sumLine({ requests: 0, tokens: 0, cacheRead: 0 })).toBe("Nenhum pedido.");
    expect(sumLine({ requests: 1, tokens: 10_000, cacheRead: 4000 })).toBe("1 pedido · 10 mil tokens · 40% lidos do cache");
    expect(sumLine({ requests: 3, tokens: 900, cacheRead: 0 })).toBe("3 pedidos · 900 tokens");
  });

  test("a hora: hoje, amanhã e outro dia", () => {
    expect(at(iso(2026, 10, 13, 18, 40), now)).toBe("às 18h40");
    expect(at(iso(2026, 10, 14, 9, 0), now)).toBe("amanhã às 9h00");
    expect(at(iso(2026, 10, 18, 9, 0), now)).toMatch(/18\/11 às 9h00$/);
  });

  test("o limite acabado, com e sem a hora que o agente informou", () => {
    expect(outLine(null, now)).toBeNull();
    expect(outLine({ at: iso(2026, 10, 13, 13, 0), resetsAt: iso(2026, 10, 13, 18, 40) }, now)).toBe("O limite acabou. Ele volta às 18h40.");
    expect(outLine({ at: iso(2026, 10, 13, 13, 0) }, now)).toBe("O limite acabou. O agente não disse quando ele volta.");
  });

  test("o último uso da janela que o agente informou", () => {
    expect(limitLine({ status: "allowed_warning", at: iso(2026, 10, 13, 13, 20), window: "five_hour", percent: 82 }, now)).toBe(
      "O agente informou 82% da janela de 5 horas usados (às 13h20).",
    );
    expect(limitLine({ status: "allowed", at: iso(2026, 10, 13, 13, 20) }, now)).toBeNull();
  });

  test("a assinatura pelo /usage: antes de atualizar, sem as janelas e com elas", () => {
    expect(subscriptionLine(null, now)).toBe("Toque em Atualizar para ver o uso da sua assinatura.");
    expect(subscriptionLine({ at: iso(2026, 10, 13, 13, 0), unavailable: true }, now)).toContain("só o gasto do Kiwi");
    expect(
      subscriptionLine({ at: iso(2026, 10, 13, 13, 0), fiveHour: { percent: 37, resetsAt: iso(2026, 10, 13, 18, 40) }, week: { percent: 12 } }, now),
    ).toBe("5 horas: 37%, volta às 18h40 · Semana: 12%");
  });

  test("o balão: o aviso do agente e o limite acabado", () => {
    expect(limitBubble("warning", 82, undefined, now)).toBe("Você já usou 82% do seu limite. Eu sigo, mas vale ir com calma.");
    expect(limitBubble("out", undefined, iso(2026, 10, 13, 18, 40), now)).toBe("O seu limite acabou. Ele volta às 18h40.");
    expect(limitBubble("out", undefined, undefined, now)).toBe("O seu limite acabou.");
  });
});
