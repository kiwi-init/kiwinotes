// O agendador dos avisos do Calendário (T32156) com o relógio, as notificações e a fala falsos.
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../../test/tmp.ts";
import {
  ALERT_GRACE_MS,
  type AlertItem,
  alertTexts,
  CALENDAR_NOTICE_PREFIX,
  alertsVia,
  CalendarAlerts,
  type CalendarAlertsDeps,
  micRecording,
  type DueAlert,
  FIRED_KEEP_MS,
  firedFile,
  type FiredStore,
  noticeId,
  whenText,
} from "./calendar-alerts.ts";
import { spokenTime, startMs } from "../shared/calendar-kiwi.ts";

const at = (s: string) => startMs(s);
const MIN = 60_000;

const meeting: AlertItem = { kind: "meeting", title: "Planejamento", project: "Projeto X", start: "2026-11-27T10:00", allDay: false };
const reminder: AlertItem = { kind: "reminder", title: "Ligar para a Ana", project: null, start: "2026-11-27T09:00", allDay: false };
const delivery: AlertItem = { kind: "task", title: "Entrega do relatório", project: "Projeto X", start: "2026-11-28T09:00", allDay: false };

/** Um calendário falso: os avisos fixos, devolvidos pela janela pedida. */
function rig(alerts: DueAlert[], o: { recording?: boolean; speaking?: boolean; speakFails?: boolean; fired?: FiredStore } = {}) {
  let clock = at("2026-11-27T08:00");
  const posted: { id: string; title: string; body: string }[] = [];
  const spoken: string[] = [];
  const logs: string[] = [];
  let saved: Record<string, number> = {};
  const fired: FiredStore = o.fired ?? { load: async () => ({ ...saved }), save: async (f) => void (saved = { ...f }) };
  const deps: CalendarAlertsDeps = {
    now: () => clock,
    alertsBetween: async (from, to) => alerts.filter((a) => a.at >= from && a.at < to),
    notices: { post: (id, title, body) => void posted.push({ id, title, body }) },
    speak: async (t) => {
      if (o.speakFails) throw new Error("helper_unavailable");
      spoken.push(t);
    },
    recording: () => o.recording ?? false,
    speaking: () => o.speaking ?? false,
    fired,
    locale: () => "pt",
    log: (m) => void logs.push(m),
  };
  return {
    alerts: new CalendarAlerts(deps),
    deps,
    posted,
    spoken,
    logs,
    saved: () => saved,
    set: (s: string | number) => void (clock = typeof s === "number" ? s : at(s)),
  };
}

const alert = (item: AlertItem, when: string, key = `${item.title}|${when}`): DueAlert => ({ item, at: at(when), key });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("o agendador", () => {
  test("nada antes da hora; na hora, a notificação e a fala", async () => {
    const r = rig([alert(meeting, "2026-11-27T09:50")]);
    r.set("2026-11-27T09:49");
    expect(await r.alerts.tick()).toEqual([]);
    expect(r.posted).toEqual([]);
    r.set("2026-11-27T09:50");
    expect((await r.alerts.tick()).length).toBe(1);
    await flush();
    expect(r.posted).toEqual([{ id: noticeId("Planejamento|2026-11-27T09:50"), title: "Em 10 minutos: reunião", body: "Planejamento · Projeto X" }]);
    expect(r.spoken).toEqual(["Em 10 minutos, reunião: Planejamento."]);
  });

  test("um aviso sai uma vez só, também depois de reabrir o app", async () => {
    const list = [alert(reminder, "2026-11-27T09:00")];
    const r = rig(list);
    r.set("2026-11-27T09:00");
    await r.alerts.tick();
    r.set("2026-11-27T09:01");
    expect(await r.alerts.tick()).toEqual([]);
    // O app reabre: um agendador novo, com o mesmo arquivo dos avisos dados.
    const again = new CalendarAlerts(r.deps);
    expect(await again.tick()).toEqual([]);
    expect(r.posted.length).toBe(1);
    expect(Object.keys(r.saved())).toEqual(["Ligar para a Ana|2026-11-27T09:00"]);
  });

  test("o aviso que passou com o app fechado sai se faz até 15 min; mais velho, não", async () => {
    const recent = rig([alert(reminder, "2026-11-27T09:00")]);
    recent.set(at("2026-11-27T09:00") + ALERT_GRACE_MS - MIN);
    expect((await recent.alerts.tick()).length).toBe(1);
    const old = rig([alert(reminder, "2026-11-27T09:00")]);
    old.set(at("2026-11-27T09:00") + ALERT_GRACE_MS);
    expect(await old.alerts.tick()).toEqual([]);
    expect(old.posted).toEqual([]);
  });

  test("vários na mesma conferência: uma notificação por aviso e uma fala com até 3 frases, na ordem da hora", async () => {
    const items = ["A", "B", "C", "D"].map((t, i) => alert({ ...reminder, title: t }, `2026-11-27T09:0${3 - i}`));
    const r = rig(items);
    r.set("2026-11-27T09:05");
    await r.alerts.tick();
    await flush();
    expect(r.posted.map((p) => p.body)).toEqual(["D", "C", "B", "A"]);
    expect(r.spoken.length).toBe(1);
    expect(r.spoken[0]!.match(/lembrete/g)?.length).toBe(3);
    expect(r.spoken[0]!.startsWith("Às 9h, lembrete: D.")).toBe(true);
  });

  test("a mesma chave duas vezes na lista avisa uma vez", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00", "k"), alert(reminder, "2026-11-27T09:00", "k")]);
    r.set("2026-11-27T09:00");
    expect((await r.alerts.tick()).length).toBe(1);
    expect(r.posted.length).toBe(1);
  });

  test("gravando uma reunião ou um ditado: só a notificação, sem a fala", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")], { recording: true });
    r.set("2026-11-27T09:00");
    await r.alerts.tick();
    await flush();
    expect(r.posted.length).toBe(1);
    expect(r.spoken).toEqual([]);
    expect(r.logs).toContain("calendar-alerts: recording now, not speaking");
  });

  test("o Kiwi falando (uma resposta): o aviso não corta a fala dele, só a notificação", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")], { speaking: true });
    r.set("2026-11-27T09:00");
    await r.alerts.tick();
    await flush();
    expect(r.posted.length).toBe(1);
    expect(r.spoken).toEqual([]);
    expect(r.logs).toContain("calendar-alerts: the Kiwi is speaking, not speaking over it");
  });

  test("sem a voz, a notificação sai e o motivo vai ao log, sem o nome do item", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")], { speakFails: true });
    r.set("2026-11-27T09:00");
    await r.alerts.tick();
    await flush();
    expect(r.posted.length).toBe(1);
    expect(r.logs.some((l) => l.includes("couldn't speak: helper_unavailable"))).toBe(true);
    expect(r.logs.join("\n")).not.toContain("Ana");
  });

  test("os avisos dados mais velhos que 3 dias saem do arquivo", async () => {
    let saved: Record<string, number> = { velho: at("2026-11-27T09:00") - FIRED_KEEP_MS - MIN, novo: at("2026-11-26T09:00") };
    const r = rig([alert(reminder, "2026-11-27T09:00")], { fired: { load: async () => ({ ...saved }), save: async (f) => void (saved = { ...f }) } });
    r.set("2026-11-27T09:00");
    await r.alerts.tick();
    expect(Object.keys(saved).sort()).toEqual(["Ligar para a Ana|2026-11-27T09:00", "novo"]);
  });

  test("um erro do calendário não derruba: vai ao log e a próxima conferência tenta de novo", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")]);
    let fail = true;
    const real = r.deps.alertsBetween;
    r.deps.alertsBetween = async (a, b) => {
      if (fail) throw new Error("E_IO");
      return real(a, b);
    };
    r.set("2026-11-27T09:00");
    expect(await r.alerts.tick()).toEqual([]);
    expect(r.logs).toContain("calendar-alerts: E_IO");
    fail = false;
    expect((await r.alerts.tick()).length).toBe(1);
  });

  test("uma conferência por vez", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")]);
    let release!: () => void;
    const real = r.deps.alertsBetween;
    r.deps.alertsBetween = async (a, b) => {
      await new Promise<void>((ok) => (release = ok));
      return real(a, b);
    };
    r.set("2026-11-27T09:00");
    const first = r.alerts.tick();
    expect(await r.alerts.tick()).toEqual([]);
    release();
    expect((await first).length).toBe(1);
  });

  test("start confere na hora e o stop desliga", async () => {
    const r = rig([alert(reminder, "2026-11-27T09:00")]);
    r.set("2026-11-27T09:00");
    r.alerts.start(60_000);
    await flush();
    await flush();
    expect(r.posted.length).toBe(1);
    r.alerts.stop();
    expect(await r.alerts.tick()).toEqual([]);
  });
});

describe("os textos", () => {
  test("quando: agora, em minutos, às, amanhã às, e o dia todo", () => {
    expect(whenText(reminder, at("2026-11-27T09:00"), "pt")).toBe("Agora");
    expect(whenText(meeting, at("2026-11-27T09:59"), "pt")).toBe("Em 1 minuto");
    expect(whenText(meeting, at("2026-11-27T09:30"), "pt")).toBe("Em 30 minutos");
    expect(whenText(meeting, at("2026-11-27T08:00"), "pt")).toBe("Às 10h");
    expect(whenText(delivery, at("2026-11-27T09:00"), "pt")).toBe("Amanhã às 9h");
    expect(whenText({ ...delivery, start: "2026-11-28", allDay: true }, at("2026-11-27T09:00"), "pt")).toBe("Amanhã");
    expect(whenText({ ...delivery, start: "2026-11-27", allDay: true }, at("2026-11-27T00:00"), "pt")).toBe("Agora");
    expect(whenText(meeting, at("2026-11-27T09:50"), "en")).toBe("In 10 minutes");
    expect(whenText(delivery, at("2026-11-27T09:00"), "en")).toBe("Tomorrow at 9 AM");
  });

  test("a hora falada", () => {
    expect(spokenTime(at("2026-11-27T09:30"), "pt")).toBe("9h30");
    expect(spokenTime(at("2026-11-27T14:00"), "pt")).toBe("14h");
    expect(spokenTime(at("2026-11-27T00:05"), "en")).toBe("12:05 AM");
    expect(spokenTime(at("2026-11-27T12:00"), "en")).toBe("12 PM");
  });

  test("a notificação e a fala, em português e em inglês", () => {
    expect(alertTexts(meeting, at("2026-11-27T09:50"), "pt")).toEqual({
      title: "Em 10 minutos: reunião",
      body: "Planejamento · Projeto X",
      speech: "Em 10 minutos, reunião: Planejamento.",
    });
    expect(alertTexts(reminder, at("2026-11-27T09:00"), "en")).toEqual({
      title: "Now: reminder",
      body: "Ligar para a Ana",
      speech: "Now, reminder: Ligar para a Ana.",
    });
  });

  test("o id da notificação é curto, estável e do Calendário", () => {
    expect(noticeId("a|b|1")).toBe(noticeId("a|b|1"));
    expect(noticeId("a|b|1")).not.toBe(noticeId("a|b|2"));
    expect(noticeId("a|b|1").startsWith(CALENDAR_NOTICE_PREFIX)).toBe(true);
  });
});

describe("o arquivo dos avisos dados", () => {
  test("grava, lê, e um arquivo estragado conta como vazio", async () => {
    const dir = tempDir("kiwi-calendar-alerts-");
    const file = path.join(dir, "calendar-alerts.json");
    const store = firedFile(file);
    expect(await store.load()).toEqual({});
    await store.save({ k: 1 });
    expect(await store.load()).toEqual({ k: 1 });
    writeFileSync(file, "{ não é json");
    expect(await store.load()).toEqual({});
    writeFileSync(file, JSON.stringify({ k: "x", j: 2 }));
    expect(await store.load()).toEqual({ j: 2 });
  });
});

describe("as pontas do agendador", () => {
  test("o alertsVia lê do dia do começo até o fim do dia seguinte ao do fim (o `to` do Calendário não entra)", async () => {
    const asked: { from: string; to: string }[] = [];
    const seen: [number, number][] = [];
    const via = alertsVia(
      async (range) => (asked.push(range), { items: [delivery] }),
      (items, from, to) => (seen.push([from, to]), items.map((item) => ({ item, at: at(item.start) - 86_400_000, key: "k" }))),
    );
    const out = await via(at("2026-11-27T23:50"), at("2026-11-28T00:20"));
    // O aviso de véspera de um item do dia 29 cai no dia 28: o 29 tem de vir na leitura.
    expect(asked).toEqual([{ from: "2026-11-27", to: "2026-11-30" }]);
    expect(seen).toEqual([[at("2026-11-27T23:50"), at("2026-11-28T00:20")]]);
    expect(out).toHaveLength(1);
  });

  test("o mic aberto: o ditado e o atalho do Kiwi, do started ao stopped, cancelado, erro ou helper novo; o stop solta os ouvintes", () => {
    const fns = new Map<string, () => void>();
    let offs = 0;
    const rec = micRecording((t, fn) => (fns.set(t, fn), () => void offs++));
    expect(rec.recording()).toBe(false);
    for (const [start, ends] of [
      ["record.started", ["record.stopped", "record.cancelled", "record.error", "ready"]],
      ["agent.record.started", ["agent.record.stopped", "agent.record.cancelled", "agent.record.error", "ready"]],
    ] as const) {
      for (const end of ends) {
        fns.get(start)!();
        expect(rec.recording()).toBe(true);
        fns.get(end)!();
        expect(rec.recording()).toBe(false);
      }
    }
    // Os dois juntos: o fim de um não fecha o outro.
    fns.get("record.started")!();
    fns.get("agent.record.started")!();
    fns.get("record.stopped")!();
    expect(rec.recording()).toBe(true);
    fns.get("agent.record.stopped")!();
    expect(rec.recording()).toBe(false);
    rec.stop();
    expect(offs).toBe(9);
  });
});
