// O pedido de agenda lido pelo Kiwi (spec #34706, T34753): a hora, o dia e o aviso de frases variadas, com o "agora"
// fixo numa quinta, 26/11/2026, às 15:00. Frases inventadas.
import { describe, expect, test } from "bun:test";

import type { CalendarNotify } from "./calendar.ts";
import { calendarHint, readCalendarAsk } from "./calendar-pedido.ts";

const NOW = new Date(2026, 10, 26, 15, 0);
const ask = (t: string) => readCalendarAsk(t, NOW);

describe("readCalendarAsk", () => {
  test("a hora e o aviso: um item na hora pedida, e o aviso separado", () => {
    const cases: [string, string | null, CalendarNotify | null][] = [
      ["me lembra às 10h e me avisa 50 min antes", "2026-11-27T10:00", "50m"],
      ["me lembra amanhã às 9h de ligar para a Ana, avisa meia hora antes", "2026-11-27T09:00", "30m"],
      ["reunião com o Bruno às 16:30, me avisa 2 horas antes", "2026-11-26T16:30", "2h"],
      ["lembrete às 10 horas, uma hora e meia antes", "2026-11-27T10:00", "90m"],
      ["me avisa 15 minutos antes da reunião das 17h", "2026-11-26T17:00", "15m"],
      ["entrega do relatório sexta às 18h, avisa um dia antes", "2026-11-27T18:00", "dayBefore"],
      ["entrega dia 5 às 11h, me avisa 3 dias antes", "2026-12-05T11:00", "3d"],
      ["consulta segunda às 8h30, avisa na véspera", "2026-11-30T08:30", "dayBefore"],
      ["me lembra às 3 da tarde de pagar a conta, na hora", "2026-11-27T15:00", "atTime"],
      ["me lembra ao meio-dia", "2026-11-27T12:00", null],
      ["me lembra daqui a 20 min de tirar o bolo", "2026-11-26T15:20", null],
      ["em 2 horas me lembra de ligar, avisa 10 min antes", "2026-11-26T17:00", "10m"],
      ["remind me at 3pm tomorrow, 20 minutes before", "2026-11-27T15:00", "20m"],
      ["me lembra às 10h, sem aviso", "2026-11-27T10:00", "none"],
      ["me lembra depois de amanhã", "2026-11-28", null],
    ];
    for (const [t, start, notify] of cases) expect([t, ask(t)]).toEqual([t, { start, notify }]);
  });

  test("a antecedência não vira a hora: \"2 h antes\" não é às 2:00", () => {
    expect(ask("me avisa 2 h antes").start).toBeNull();
    expect(ask("me avisa 2 h antes").notify).toBe("2h");
  });

  test("mais de 30 dias de aviso não vale; o pedido sem hora nem aviso não leva linha", () => {
    expect(ask("me avisa 40 dias antes").notify).toBeNull();
    expect(calendarHint("resume a nota Ideias", NOW)).toBe("");
    expect(calendarHint("me lembra às 10h e me avisa 50 min antes", NOW)).toBe("[Kiwi leu no pedido: inicio 2026-11-27T10:00, aviso 50m. Um item só; o aviso não é o começo nem o fim.]");
  });
});
