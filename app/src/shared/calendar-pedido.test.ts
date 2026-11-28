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

  test("a duração não vira a hora (#34842): \"de 1 hora\", \"de 2 horas\", \"por 30 min\", \"2 hour meeting\"", () => {
    // NOW é quinta, 26/11, 15:00: amanhã é 27/11 e a próxima segunda, 30/11.
    const cases: [string, string | null, CalendarNotify | null][] = [
      ["marca uma reunião de 1 hora amanhã às 14h", "2026-11-27T14:00", null],
      ["agenda um foco de 2 horas na segunda às 9h", "2026-11-30T09:00", null],
      ["reunião de 2 horas na segunda às 15h, me avisa 30 min antes", "2026-11-30T15:00", "30m"],
      ["bloco de foco de 3 horas amanhã", "2026-11-27", null],
      ["reunião de uma hora e meia amanhã às 10h", "2026-11-27T10:00", null],
      ["foco por 2h amanhã às 8h", "2026-11-27T08:00", null],
      ["schedule a 2 hour meeting tomorrow at 3pm", "2026-11-27T15:00", null],
      ["book a 1-hour call on monday at 9am", "2026-11-30T09:00", null],
      ["block focus for 45 minutes tomorrow at 4pm", "2026-11-27T16:00", null],
      // "de 9h" é a hora, e "das 9h às 10h" é o começo.
      ["reunião de 9h amanhã", "2026-11-27T09:00", null],
      ["foco amanhã das 9h às 10h", "2026-11-27T09:00", null],
      // A duração colada no "às" (#34851); o intervalo segue sendo o começo.
      ["marca uma reunião de 1 hora às 14h", "2026-11-27T14:00", null],
      ["foco por 2h às 10h", "2026-11-27T10:00", null],
      ["reunião de 30 minutos às 16h", "2026-11-26T16:00", null],
      ["reunião das 9h às 10h", "2026-11-27T09:00", null],
      ["reunião de 9h às 10h", "2026-11-27T09:00", null],
      ["reunião de 9 horas às 10 horas amanhã", "2026-11-27T09:00", null],
      // A mesma unidade nas duas pontas é intervalo só quando é plausível (#34969): o começo entre 6 e 23 e o fim depois.
      ["reunião de 2 horas às 10 horas amanhã", "2026-11-27T10:00", null],
      ["marca uma reunião de 1 hora às 14 horas", "2026-11-27T14:00", null],
      ["reunião de 1h às 14h", "2026-11-27T14:00", null],
      ["workshop de 3 horas às 3 da tarde", "2026-11-27T15:00", null],
      ["plantão de 8h às 17h na segunda", "2026-11-30T08:00", null],
      ["plantão de 12 horas às 7h amanhã", "2026-11-27T07:00", null],
    ];
    for (const [text, start, notify] of cases) expect([text, ask(text)]).toEqual([text, { start, notify }]);
  });

  test("o intervalo se lê como um todo (#35013): o começo é a 1ª ponta, e o período vale para a ponta em que está", () => {
    // NOW é quinta, 26/11, 15:00: o que já passou hoje vai para amanhã, 27/11.
    const cases: [string, string | null, CalendarNotify | null][] = [
      ["reunião das 10 às 11 e me avisa 5 min antes", "2026-11-27T10:00", "5m"],
      ["das 9 às 10 amanhã", "2026-11-27T09:00", null],
      ["das 7 às 8", "2026-11-27T07:00", null],
      ["das 10 às 2 da tarde", "2026-11-27T10:00", null],
      ["das 9h às 3 da tarde", "2026-11-27T09:00", null],
      ["de 9h às 3 da tarde", "2026-11-27T09:00", null],
      ["das 8 da manhã às 2 da tarde", "2026-11-27T08:00", null],
      ["from 9 to 10am", "2026-11-27T09:00", null],
      ["between 2 and 3pm", "2026-11-27T14:00", null],
      ["das 2 às 4 da tarde", "2026-11-27T14:00", null],
      ["das 9:30 às 11", "2026-11-27T09:30", null],
      ["from 9am to 3pm", "2026-11-27T09:00", null],
      ["de 14 horas às 16 horas", "2026-11-27T14:00", null],
      ["foco das 16h às 18h", "2026-11-26T16:00", null],
      ["plantão das 22 às 2", "2026-11-26T22:00", null],
      ["entre 2 e 3 da tarde", "2026-11-27T14:00", null],
      ["das 2 da tarde às 4", "2026-11-27T14:00", null],
      ["from 12am to 2am", "2026-11-27T00:00", null],
      ["between 11 and 1pm", "2026-11-27T11:00", null],
      ["das 8 às 10 da noite", "2026-11-26T20:00", null],
      ["das 12 às 2 da tarde", "2026-11-27T12:00", null],
      ["de 10 a 12 de dezembro às 9h", "2026-11-27T09:00", null],
      // Sem marca de hora, o "de N a M" é quantidade, e a hora da frase ganha (#35031).
      ["marca uma reunião de 3 a 5 pessoas amanhã às 10h", "2026-11-27T10:00", null],
      ["revisar os capítulos de 3 a 5 amanhã às 14h", "2026-11-27T14:00", null],
      ["treino de 5 a 10 km às 7h", "2026-11-27T07:00", null],
      ["separar de 2 e 3 caixas às 15h", "2026-11-27T15:00", null],
      ["reunião às 15h para ver os itens de 1 a 4", "2026-11-27T15:00", null],
      ["semana de 3 a 7 às 9h", "2026-11-27T09:00", null],
      ["foco das 9 às 11 e almoço às 12h", "2026-11-27T09:00", null],
      // Quantidade e datas não são hora.
      ["férias de 10 a 15 dias", null, null],
      ["viagem de 10 a 15 de dezembro", null, null],
    ];
    for (const [text, start, notify] of cases) expect([text, ask(text)]).toEqual([text, { start, notify }]);
  });

  test("mais de 30 dias de aviso não vale; o pedido sem hora nem aviso não leva linha", () => {
    expect(ask("me avisa 40 dias antes").notify).toBeNull();
    expect(calendarHint("resume a nota Ideias", NOW)).toBe("");
    expect(calendarHint("me lembra às 10h e me avisa 50 min antes", NOW)).toBe("[Kiwi leu no pedido: inicio 2026-11-27T10:00, aviso 50m. Um item só; o aviso não é o começo nem o fim.]");
  });
});
