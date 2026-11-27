// As regras locais da sugestão do painel do Kiwi (T32156): nada chama o agente, só os itens e o relógio.
import { describe, expect, test } from "bun:test";
import { fittingNotify, isoLocal, spokenDay, startMs, type SuggestItem, suggestion } from "./calendar-kiwi.ts";

// Quinta, 26/11/2026, 15h.
const NOW = startMs("2026-11-26T15:00");

const item = (o: Partial<SuggestItem> & Pick<SuggestItem, "title" | "start">): SuggestItem => ({
  id: `n:Projeto X/Pendências.md#1:${o.title}`,
  kind: "task",
  allDay: o.start.length === 10,
  notify: "none",
  source: { path: "Projeto X/Pendências.md" },
  ...o,
});

describe("a sugestão da vez", () => {
  test("nada para sugerir: null", () => {
    expect(suggestion([], NOW, "pt")).toBeNull();
    expect(suggestion([item({ title: "Relatório", start: "2026-11-27T09:00", notify: "dayBefore" })], NOW, "pt")).toBeNull();
  });

  test("prazo sem aviso nos próximos 3 dias: \"quer que eu te lembre?\" com o aviso que cabe", () => {
    const s = suggestion([item({ title: "Entrega do relatório", start: "2026-11-28T09:00" })], NOW, "pt")!;
    expect(s.rule).toBe("deadline");
    expect(s.text).toBe("“Entrega do relatório” é sábado, 9h. Quer que eu te lembre?");
    expect(s.accept).toEqual({ label: "Sim, me lembra", patch: { notify: "dayBefore" } });
    expect(s.dismissLabel).toBe("Agora não");
  });

  test("prazo de dia todo, e em inglês", () => {
    const pt = suggestion([item({ title: "Entrega", start: "2026-11-27" })], NOW, "pt")!;
    expect(pt.text).toBe("“Entrega” é amanhã. Quer que eu te lembre?");
    const en = suggestion([item({ title: "Entrega", start: "2026-11-28T09:00" })], NOW, "en")!;
    expect(en.text).toBe("“Entrega” is due Saturday, 9 AM. Want me to remind you?");
    expect(en.accept.label).toBe("Yes, remind me");
  });

  test("prazo com aviso, feito, longe demais ou de outro tipo: não sugere", () => {
    const none = [
      item({ title: "Com aviso", start: "2026-11-27T09:00", notify: "30m" }),
      item({ title: "Feito", start: "2026-11-27T09:00", done: true }),
      item({ title: "Longe", start: "2026-12-01T09:00" }),
      item({ title: "Nota", start: "2026-11-27T09:00", kind: "note" }),
    ];
    expect(suggestion(none, NOW, "pt")).toBeNull();
  });

  test("atrasada vem antes do prazo, a mais recente primeiro, e passa para amanhã às 9h", () => {
    const s = suggestion(
      [
        item({ title: "Entrega", start: "2026-11-27T09:00" }),
        item({ title: "Antiga", start: "2026-11-20T10:00" }),
        item({ title: "Ligar para a Ana", start: "2026-11-25T11:00", kind: "reminder", notify: "atTime" }),
      ],
      NOW,
      "pt",
    )!;
    expect(s.rule).toBe("overdue");
    expect(s.text).toBe("“Ligar para a Ana” ficou para trás desde ontem. Quer que eu passe para amanhã, 9h?");
    expect(s.accept).toEqual({ label: "Passar para amanhã", patch: { start: "2026-11-27T09:00" } });
  });

  test("a atrasada de dia todo passa de hoje para amanhã só no dia seguinte, e continua de dia todo", () => {
    expect(suggestion([item({ title: "Hoje", start: "2026-11-26" })], NOW, "pt")?.rule).not.toBe("overdue");
    const s = suggestion([item({ title: "Ontem", start: "2026-11-25" })], NOW, "pt")!;
    expect(s.rule).toBe("overdue");
    expect(s.accept.patch).toEqual({ start: "2026-11-27" });
  });

  test("a reunião gravada (só leitura) nunca é sugestão", () => {
    expect(suggestion([item({ title: "Gravada", start: "2026-11-25T10:00", kind: "reminder", readOnly: true })], NOW, "pt")).toBeNull();
  });

  test("reunião amanhã cedo com aviso curto: oferece 30 min antes", () => {
    const s = suggestion([item({ title: "Planejamento", start: "2026-11-27T08:30", kind: "meeting", notify: "10m" })], NOW, "pt")!;
    expect(s.rule).toBe("meetingTomorrow");
    expect(s.text).toBe("Amanhã às 8h30 tem “Planejamento”. Quer um aviso 30 minutos antes?");
    expect(s.accept.patch).toEqual({ notify: "30m" });
    // Já com 30 min, às 10h ou depois de amanhã: nada.
    expect(suggestion([item({ title: "A", start: "2026-11-27T08:30", kind: "meeting", notify: "30m" })], NOW, "pt")).toBeNull();
    expect(suggestion([item({ title: "B", start: "2026-11-27T10:00", kind: "meeting", notify: "10m" })], NOW, "pt")).toBeNull();
    expect(suggestion([item({ title: "C", start: "2026-11-28T08:30", kind: "meeting", notify: "10m" })], NOW, "pt")).toBeNull();
  });

  test("o \"Agora não\" tira aquela sugestão, e a próxima regra aparece", () => {
    const items = [item({ title: "Atrasada", start: "2026-11-25T10:00" }), item({ title: "Entrega", start: "2026-11-27T09:00" })];
    const first = suggestion(items, NOW, "pt")!;
    expect(first.rule).toBe("overdue");
    const next = suggestion(items, NOW, "pt", new Set([first.key]))!;
    expect(next.rule).toBe("deadline");
    expect(suggestion(items, NOW, "pt", new Set([first.key, next.key]))).toBeNull();
  });

  test("a chave do \"Agora não\" não muda com uma linha nova acima (o id muda, a chave não)", () => {
    const a = suggestion([item({ title: "Entrega", start: "2026-11-27T09:00", id: "n:P/x.md#3:aa" })], NOW, "pt")!;
    const b = suggestion([item({ title: "Entrega", start: "2026-11-27T09:00", id: "n:P/x.md#4:bb" })], NOW, "pt")!;
    expect(a.key).toBe(b.key);
    expect(a.itemId).not.toBe(b.itemId);
  });
});

describe("os ajudantes", () => {
  test("o aviso que cabe no tempo que falta", () => {
    expect(fittingNotify(item({ title: "x", start: "2026-11-28T09:00" }), NOW)).toBe("dayBefore");
    expect(fittingNotify(item({ title: "x", start: "2026-11-26T18:00" }), NOW)).toBe("30m");
    expect(fittingNotify(item({ title: "x", start: "2026-11-26T15:20" }), NOW)).toBe("atTime");
    expect(fittingNotify(item({ title: "x", start: "2026-11-27" }), NOW)).toBe("atTime");
  });

  test("o dia falado", () => {
    expect(spokenDay(startMs("2026-11-26T09:00"), NOW, "pt")).toBe("hoje");
    expect(spokenDay(startMs("2026-11-28T09:00"), NOW, "pt")).toBe("sábado");
    expect(spokenDay(startMs("2026-11-23T09:00"), NOW, "pt")).toBe("segunda");
    expect(spokenDay(startMs("2026-12-10T09:00"), NOW, "pt")).toBe("10/12");
    expect(spokenDay(startMs("2026-12-10T09:00"), NOW, "en")).toBe("Dec 10");
    expect(spokenDay(startMs("2026-11-27T09:00"), NOW, "en")).toBe("tomorrow");
  });

  test("o ISO local", () => {
    expect(isoLocal(startMs("2026-11-27T09:05"), false)).toBe("2026-11-27T09:05");
    expect(isoLocal(startMs("2026-11-27T09:05"), true)).toBe("2026-11-27");
  });
});
